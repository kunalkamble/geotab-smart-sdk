'use strict';

const GeotabApi = require('mg-api-js');
const EventEmitter = require('./EventEmitter');

/**
 * Session manages authentication against the MyGeotab API.
 *
 * Responsibilities:
 *  - Initial authenticate() on first use
 *  - Transparent re-auth when a session expires (InvalidUserException)
 *  - Exposing a low-level call() that always has valid credentials
 *  - Exposing multiCall() with the same guarantees
 *
 * The official mg-api-js SDK handles credential renewal internally when
 * rememberMe is true, but we wrap it to give consistent error surfacing
 * and lifecycle events (useful for logging / monitoring).
 */
class Session extends EventEmitter {
  /**
   * @param {object}  credentials
   * @param {string}  credentials.username
   * @param {string}  credentials.database
   * @param {string}  [credentials.password]   Required unless `sessionId` is provided.
   * @param {string}  [credentials.sessionId]  Resume an existing MyGeotab session (valid up to 14 days).
   *                                            If both `password` and `sessionId` are supplied, mg-api-js
   *                                            tries the sessionId first and falls back to password.
   * @param {string}  [credentials.server]      Defaults to 'my.geotab.com'.
   */
  /**
   * @param {object}  credentials  (see class JSDoc)
   * @param {object}  [options]
   * @param {boolean} [options.readOnly=false]  If true, reject any method that
   *                                            isn't a `Get*` call. Useful for
   *                                            sandboxed UIs (e.g. our Playground)
   *                                            that must never mutate.
   */
  constructor(credentials, options = {}) {
    super();

    if (!credentials || !credentials.username || !credentials.database) {
      throw new Error('[GeotabSDK] credentials must include username and database');
    }
    if (!credentials.password && !credentials.sessionId) {
      throw new Error('[GeotabSDK] credentials must include either password or sessionId');
    }

    // Defensive copy so external mutation doesn't surprise us.
    this._credentials = { ...credentials };
    this._api = null;
    this._authenticated = false;
    this._authPromise = null;
    this._session = null;     // captured from api.getSession() after auth
    this._readOnly = Boolean(options.readOnly);
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  /**
   * Ensure the session is active. Safe to call multiple times — only
   * authenticates once even if called concurrently.
   */
  async connect() {
    if (this._authenticated) return;
    if (this._authPromise) return this._authPromise;

    this._authPromise = this._authenticate();
    await this._authPromise;
    this._authPromise = null;
  }

  /**
   * Make a single API call. Handles re-auth if session has expired.
   *
   * @param {string} method  e.g. 'Get', 'GetFeed', 'Add'
   * @param {object} params
   * @returns {Promise<any>}
   */
  async call(method, params) {
    this._assertAllowed(method);
    await this.connect();
    try {
      return await this._api.call(method, params);
    } catch (err) {
      if (this._isSessionExpired(err)) {
        this.emit('session:expired');
        this._authenticated = false;
        // Drop the stale sessionId so the next authenticate() uses the
        // password if one was supplied. If only a sessionId was provided,
        // the re-auth will surface a clear error.
        this._credentials.sessionId = null;
        await this.connect();
        return this._api.call(method, params);
      }
      throw this._normalizeError(err, method);
    }
  }

  /**
   * Batch multiple API calls into a single HTTP request.
   * Each element of `calls` is [method, params].
   *
   * @param {Array<[string, object]>} calls
   * @returns {Promise<any[]>}
   */
  async multiCall(calls) {
    if (Array.isArray(calls)) {
      for (const entry of calls) {
        if (Array.isArray(entry) && entry.length > 0) this._assertAllowed(entry[0]);
      }
    }
    await this.connect();
    try {
      return await this._api.multiCall(calls);
    } catch (err) {
      if (this._isSessionExpired(err)) {
        this.emit('session:expired');
        this._authenticated = false;
        // Drop the stale sessionId so the next authenticate() uses the
        // password if one was supplied. If only a sessionId was provided,
        // the re-auth will surface a clear error.
        this._credentials.sessionId = null;
        await this.connect();
        return this._api.multiCall(calls);
      }
      throw this._normalizeError(err, 'multiCall');
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  async _authenticate() {
    const { username, password, database, server, sessionId } = this._credentials;

    // Build mg-api-js credentials. sessionId takes precedence; if it's expired
    // mg-api-js falls back to password (when both are present).
    const apiCredentials = { userName: username, database };
    if (password)  apiCredentials.password  = password;
    if (sessionId) apiCredentials.sessionId = sessionId;

    this._api = new GeotabApi({
      credentials: apiCredentials,
      path: server || 'my.geotab.com',
    }, {
      rememberMe: true,   // SDK handles credential renewal internally
      timeout: 30,
    });

    // mg-api-js authenticates lazily on the first .call(). Force it now via
    // its explicit authenticate() method so we surface auth errors at
    // connect() time rather than at a later call. This is one HTTP request;
    // the previous "Get SystemSettings" warm-up made it two for no reason.
    await this._api.authenticate();

    // Capture the live session info (mg-api-js may have renewed the sessionId)
    // for persistence by consumers — e.g. saving to localStorage so the next
    // page load can reconnect without re-entering a password.
    let captured = null;
    try {
      const result = await this._api.getSession();
      captured = {
        sessionId: result?.credentials?.sessionId ?? sessionId ?? null,
        userName:  result?.credentials?.userName  ?? username,
        database:  result?.credentials?.database  ?? database,
        server:    result?.path                   ?? server ?? 'my.geotab.com',
      };
    } catch {
      // getSession failed — not fatal, we just won't expose a session.
      captured = null;
    }
    this._session = captured;

    this._authenticated = true;
    this.emit('session:connected', { database, server });
    if (captured?.sessionId) {
      // Emit a richer event for consumers that want to persist the session.
      this.emit('session:authenticated', { ...captured });
    }
  }

  /**
   * Returns the current MyGeotab session — `{ sessionId, userName, database, server }`
   * — or `null` if the session has not been authenticated yet (or getSession
   * failed). The shape is safe to persist for up to 14 days.
   */
  getSession() {
    return this._session ? { ...this._session } : null;
  }

  /**
   * Enforce read-only mode when enabled. The Playground (and any other
   * sandboxed UI that explicitly opts in) passes `{ readOnly: true }` to
   * guarantee that no mutation can sneak through `sdk.call()` or
   * `sdk.multiCall()`. The check is a simple `Get*` allowlist:
   *   Get, GetFeed, GetCountOf, GetFeedCountOf, GetSession, ...
   * — anything starting with "Get".
   */
  _assertAllowed(method) {
    if (!this._readOnly) return;
    // Case-insensitive on the prefix so a stray `'get'` / `'GET'` still
    // routes through the same check; case-sensitive comparison would have
    // *correctly* rejected lowercase too, but normalising is clearer and
    // protects against future hand-written calls.
    const ok = typeof method === 'string' && method.slice(0, 3).toLowerCase() === 'get';
    if (!ok) {
      const err = new Error(
        `[GeotabSDK] readOnly mode rejected method "${method}". ` +
        `Only Get*-style methods are allowed in this SDK instance.`
      );
      err.code = 'ReadOnlyViolation';
      err.method = method;
      throw err;
    }
  }

  _isSessionExpired(err) {
    const msg = (err.message || '').toLowerCase();
    return (
      msg.includes('invaliduserexception') ||
      msg.includes('session expired') ||
      msg.includes('not authenticated') ||
      err.code === 'InvalidUserException'
    );
  }

  _normalizeError(err, context) {
    const normalized = new Error(err.message || String(err));
    normalized.code = err.code || err.data?.type;
    normalized.context = context;
    normalized.raw = err;
    return normalized;
  }
}

module.exports = Session;
