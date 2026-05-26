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
   * @param {object} credentials
   * @param {string} credentials.username
   * @param {string} credentials.password
   * @param {string} credentials.database
   * @param {string} [credentials.server]  Defaults to 'my.geotab.com'
   */
  constructor(credentials) {
    super();

    if (!credentials || !credentials.username || !credentials.password || !credentials.database) {
      throw new Error('[GeotabSDK] credentials must include username, password, and database');
    }

    this._credentials = credentials;
    this._api = null;
    this._authenticated = false;
    this._authPromise = null;
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
    await this.connect();
    try {
      return await this._api.call(method, params);
    } catch (err) {
      if (this._isSessionExpired(err)) {
        this.emit('session:expired');
        this._authenticated = false;
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
    await this.connect();
    try {
      return await this._api.multiCall(calls);
    } catch (err) {
      if (this._isSessionExpired(err)) {
        this.emit('session:expired');
        this._authenticated = false;
        await this.connect();
        return this._api.multiCall(calls);
      }
      throw this._normalizeError(err, 'multiCall');
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  async _authenticate() {
    const { username, password, database, server } = this._credentials;

    this._api = new GeotabApi({
      credentials: { userName: username, password, database },
      path: server || 'my.geotab.com',
    }, {
      rememberMe: true,   // SDK handles token refresh internally
      timeout: 30,
    });

    // mg-api-js authenticates lazily on first call; force it now so
    // we surface auth errors at connect() time rather than later.
    await this._api.call('Get', { typeName: 'SystemSettings', resultsLimit: 1 });

    this._authenticated = true;
    this.emit('session:connected', { database, server });
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
