'use strict';

const EventEmitter = require('events');

const DEFAULT_RESULTS_LIMIT = 50_000;
const MIN_POLL_INTERVAL_MS  = 1_000;   // 1s — safe for 60/min limit
const MAX_POLL_INTERVAL_MS  = 30_000;  // 30s — Geotab recommendation for idle
const BACKOFF_MULTIPLIER    = 2;

/**
 * FeedManager manages one or more concurrent GetFeed streams.
 *
 * Each feed tracks its own `toVersion` token and polls adaptively:
 *   - Full batch returned → poll again immediately (more data waiting)
 *   - Partial batch       → reset to MIN interval
 *   - Empty batch         → back off progressively up to MAX interval
 *
 * Per Geotab documentation:
 *   • Only pass `search.fromDate` on the VERY FIRST call to anchor the start position.
 *   • After that, only ever pass `fromVersion`. Never use fromDate again.
 *   • GetFeed with scoped users is significantly slower — use a root-group service account.
 *
 * Events emitted per feed name:
 *   'data'    (entityType, records[])      — new records arrived
 *   'error'   (entityType, err)            — non-fatal poll error
 *   'version' (entityType, token)          — new toVersion token (persist this!)
 */
class FeedManager extends EventEmitter {
  /**
   * @param {import('../core/Session')} session
   * @param {import('../core/RateLimiter')} rateLimiter
   */
  constructor(session, rateLimiter) {
    super();
    this._session     = session;
    this._rateLimiter = rateLimiter;
    this._feeds       = new Map(); // entityType -> FeedState
    this._running     = false;
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  /**
   * Register an entity type to stream. Call before start().
   *
   * @param {string}  entityType              e.g. 'LogRecord', 'StatusData'
   * @param {object}  [options]
   * @param {string}  [options.fromVersion]   Resume from a saved token
   * @param {Date}    [options.fromDate]       Anchor start time (first call only)
   * @param {number}  [options.resultsLimit]   Max records per poll (default 50,000)
   * @param {object}  [options.search]         Additional search params for the initial fromDate call
   * @returns {this}  Fluent
   */
  addFeed(entityType, options = {}) {
    if (this._running) {
      throw new Error(`[FeedManager] Cannot add feed '${entityType}' after start(). Stop first.`);
    }

    this._feeds.set(entityType, {
      entityType,
      fromVersion:  options.fromVersion ?? null,
      fromDate:     options.fromDate ?? null,     // used once, then discarded
      seeded:       Boolean(options.fromVersion),  // if we have a token, skip fromDate
      resultsLimit: options.resultsLimit ?? DEFAULT_RESULTS_LIMIT,
      extraSearch:  options.search ?? {},
      pollIntervalMs: MIN_POLL_INTERVAL_MS,
      timer:        null,
      active:       true,
    });

    return this;
  }

  /**
   * Start all registered feeds. Each feed runs its own adaptive poll loop.
   */
  start() {
    if (this._running) return;
    this._running = true;
    for (const feed of this._feeds.values()) {
      this._schedulePoll(feed, 0);
    }
  }

  /**
   * Stop all feeds gracefully.
   */
  stop() {
    this._running = false;
    for (const feed of this._feeds.values()) {
      feed.active = false;
      if (feed.timer) clearTimeout(feed.timer);
    }
  }

  /**
   * Update the persisted version token for a feed.
   * Call this with a saved token to resume a feed after a restart.
   *
   * @param {string} entityType
   * @param {string} token
   */
  setVersion(entityType, token) {
    const feed = this._feeds.get(entityType);
    if (feed) { feed.fromVersion = token; feed.seeded = true; }
  }

  /**
   * Get the current toVersion token for a feed.
   * Persist this to storage after every 'version' event for crash recovery.
   *
   * @param {string} entityType
   * @returns {string|null}
   */
  getVersion(entityType) {
    return this._feeds.get(entityType)?.fromVersion ?? null;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _schedulePoll(feed, delayMs) {
    if (!feed.active || !this._running) return;
    feed.timer = setTimeout(() => this._poll(feed), delayMs);
  }

  async _poll(feed) {
    if (!feed.active || !this._running) return;

    try {
      const params = this._buildParams(feed);

      const result = await this._rateLimiter.withRetry(
        feed.entityType,
        () => this._session.call('GetFeed', params)
      );

      const records   = result.data   ?? [];
      const toVersion = result.toVersion;

      // Always persist toVersion BEFORE processing (per Geotab recommendation)
      if (toVersion && toVersion !== feed.fromVersion) {
        feed.fromVersion = toVersion;
        feed.seeded      = true;
        this.emit('version', feed.entityType, toVersion);
      }

      // After the first seeding call, never send fromDate again
      feed.fromDate    = null;
      feed.extraSearch = {};

      if (records.length > 0) {
        this.emit('data', feed.entityType, records);
      }

      // Adaptive interval:
      //   Full batch → poll immediately (more data waiting)
      //   Partial    → reset to min interval
      //   Empty      → back off
      const nextDelay = this._nextDelay(feed, records.length);
      this._schedulePoll(feed, nextDelay);

    } catch (err) {
      this.emit('error', feed.entityType, err);
      // Back off on error to avoid hammering a broken connection
      const backoff = Math.min(feed.pollIntervalMs * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
      feed.pollIntervalMs = backoff;
      this._schedulePoll(feed, backoff);
    }
  }

  _buildParams(feed) {
    const params = {
      typeName:     feed.entityType,
      resultsLimit: feed.resultsLimit,
    };

    if (feed.fromVersion) {
      params.fromVersion = feed.fromVersion;
    } else if (feed.fromDate && !feed.seeded) {
      // Initial seed: pass fromDate inside search object, once only
      params.search = { ...feed.extraSearch, fromDate: feed.fromDate };
    }

    return params;
  }

  _nextDelay(feed, recordCount) {
    if (recordCount >= feed.resultsLimit) {
      // Full batch — poll again immediately, there's more data
      feed.pollIntervalMs = MIN_POLL_INTERVAL_MS;
      return 0;
    }

    if (recordCount > 0) {
      // Partial batch — reset to minimum interval
      feed.pollIntervalMs = MIN_POLL_INTERVAL_MS;
      return MIN_POLL_INTERVAL_MS;
    }

    // Empty — progressive backoff
    feed.pollIntervalMs = Math.min(
      feed.pollIntervalMs * BACKOFF_MULTIPLIER,
      MAX_POLL_INTERVAL_MS
    );
    return feed.pollIntervalMs;
  }
}

module.exports = FeedManager;
