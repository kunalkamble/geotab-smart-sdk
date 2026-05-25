'use strict';

/**
 * RateLimiter tracks per-entity-type rate limits and enforces backoff
 * when an OverLimitException is received.
 *
 * Geotab rate limits are per-user, per-entity, per-method:
 *   - GetFeed:  60 requests/min per entity type
 *   - Get:      varies (900-1000/min for most entities)
 *   - Auth:     10/min
 *
 * When a limit is exceeded the API returns an OverLimitException and
 * sets the `Retry-After` response header (seconds until reset).
 * mg-api-js surfaces this as an error — we catch it and wait.
 */
class RateLimiter {
  constructor() {
    // entityType -> { blockedUntil: Date, retryAfterMs: number }
    this._blocked = new Map();
  }

  /**
   * Check if a given entity is currently rate-limited.
   * Returns the number of ms to wait (0 if clear).
   *
   * @param {string} entityType
   * @returns {number}
   */
  waitTime(entityType) {
    const entry = this._blocked.get(entityType);
    if (!entry) return 0;
    const remaining = entry.blockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Pause until rate limit clears for the given entity type.
   * @param {string} entityType
   */
  async wait(entityType) {
    const ms = this.waitTime(entityType);
    if (ms > 0) await sleep(ms);
  }

  /**
   * Register an OverLimitException for an entity type.
   * Parses the Retry-After value or falls back to exponential backoff.
   *
   * @param {string} entityType
   * @param {Error}  err         The raw error from the API
   */
  registerLimit(entityType, err) {
    const retryAfterMs = this._parseRetryAfter(err);
    this._blocked.set(entityType, {
      blockedUntil: Date.now() + retryAfterMs,
      retryAfterMs,
    });
  }

  /**
   * Clear the rate limit for a given entity (after a successful call).
   * @param {string} entityType
   */
  clear(entityType) {
    this._blocked.delete(entityType);
  }

  /**
   * Wrap an API call with rate-limit awareness and retry.
   * Will wait for the limit to clear then retry the call once.
   *
   * @param {string}   entityType
   * @param {Function} fn         Async function to call
   * @returns {Promise<any>}
   */
  async withRetry(entityType, fn) {
    await this.wait(entityType);

    try {
      const result = await fn();
      this.clear(entityType);
      return result;
    } catch (err) {
      if (this._isRateLimitError(err)) {
        this.registerLimit(entityType, err);
        await this.wait(entityType);
        return fn(); // single retry after wait
      }
      throw err;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _isRateLimitError(err) {
    const msg = (err.message || '').toLowerCase();
    return (
      msg.includes('overlimitexception') ||
      msg.includes('quota exceeded') ||
      msg.includes('rate limit') ||
      err.code === 'OverLimitException'
    );
  }

  _parseRetryAfter(err) {
    // mg-api-js may surface Retry-After from response headers
    if (err.retryAfter) {
      return parseInt(err.retryAfter, 10) * 1000;
    }

    // Fallback: extract from error message "Maximum admitted N per Xm"
    const match = (err.message || '').match(/per\s+(\d+)([ms])/i);
    if (match) {
      const unit = match[2].toLowerCase();
      const value = parseInt(match[1], 10);
      return unit === 'm' ? value * 60 * 1000 : value * 1000;
    }

    return 60_000; // conservative 60s default
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = RateLimiter;
