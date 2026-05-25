'use strict';

const Session       = require('./core/Session');
const RateLimiter   = require('./core/RateLimiter');
const EntityCache   = require('./cache/EntityCache');
const FeedManager   = require('./feeds/FeedManager');
const LiveTracker   = require('./trackers/LiveTracker');
const HistoryQuery  = require('./queries/HistoryQuery');
const FleetSnapshot = require('./queries/FleetSnapshot');

/**
 * GeotabSDK — the primary entry point.
 *
 * Wraps mg-api-js with:
 *  - Automatic session management and re-authentication
 *  - Adaptive GetFeed streaming (with proper version-token handling)
 *  - Named diagnostic constants (no more opaque ID strings)
 *  - In-memory entity caching (Device, Diagnostic, etc.)
 *  - Rate-limit awareness with Retry-After backoff
 *  - Use-case helpers: liveTracker(), history(), fleetSnapshot()
 *
 * @example
 * const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');
 *
 * const sdk = new GeotabSDK({
 *   username: 'user@company.com',
 *   password: 'secret',
 *   database: 'my_company',
 * });
 *
 * // Live tracking with fuel + aux inputs
 * const tracker = sdk.liveTracker()
 *   .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.AUX_INPUT_1])
 *   .withFaults()
 *   .pollEvery(5000);
 *
 * tracker.on('update', vehicles => console.log(vehicles));
 * tracker.start();
 */
class GeotabSDK {
  /**
   * @param {object} credentials
   * @param {string} credentials.username
   * @param {string} credentials.password
   * @param {string} credentials.database
   * @param {string} [credentials.server]   Defaults to 'my.geotab.com'
   * @param {object} [options]
   * @param {number} [options.cacheTtlMs]   Entity cache TTL (default 1 hour)
   */
  constructor(credentials, options = {}) {
    this._session     = new Session(credentials);
    this._rateLimiter = new RateLimiter();
    this._cache       = new EntityCache({ ttlMs: options.cacheTtlMs });

    // Forward session lifecycle events for external monitoring
    this._session.on('session:connected', info => this.emit?.('connected', info));
    this._session.on('session:expired',   ()   => this.emit?.('reconnecting'));
  }

  // ─── Low-level access ────────────────────────────────────────────────────

  /**
   * Direct API call. Use for entity types not covered by the high-level helpers.
   * Handles authentication and session refresh automatically.
   *
   * @param {string} method   'Get' | 'GetFeed' | 'Add' | 'Set' | 'Remove' | ...
   * @param {object} params
   * @returns {Promise<any>}
   */
  call(method, params) {
    return this._session.call(method, params);
  }

  /**
   * Batch multiple API calls in a single HTTP request.
   * Each element is [method, params]. Results return in the same order.
   *
   * @param {Array<[string, object]>} calls
   * @returns {Promise<any[]>}
   */
  multiCall(calls) {
    return this._session.multiCall(calls);
  }

  // ─── High-level helpers ──────────────────────────────────────────────────

  /**
   * Create a real-time vehicle tracker.
   *
   * Combines DeviceStatusInfo (location, bearing, driver) with optional
   * StatusData (diagnostics) and FaultData in a single poll cycle.
   *
   * @returns {LiveTracker}
   *
   * @example
   * const tracker = sdk.liveTracker()
   *   .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER])
   *   .withFaults()
   *   .forDevices(['b1', 'b2'])
   *   .pollEvery(5000);
   *
   * tracker.on('update', vehicles => { ... });
   * await tracker.start();
   */
  liveTracker() {
    return new LiveTracker(this._session, this._rateLimiter, this._cache);
  }

  /**
   * Fetch historical GPS, diagnostics, faults and trips for a time range.
   * Paginates automatically. Results are correlated by device and time.
   *
   * @param {object}   options
   * @param {string}   options.deviceId
   * @param {Date}     options.from
   * @param {Date}     options.to
   * @param {object}   [options.include]
   * @param {boolean}  [options.include.gps=true]
   * @param {boolean}  [options.include.trips=false]
   * @param {boolean}  [options.include.faults=false]
   * @param {string[]} [options.include.diagnostics=[]]
   * @param {boolean}  [options.computeBearing=false]
   * @returns {Promise<HistoryResult>}
   *
   * @example
   * const data = await sdk.history({
   *   deviceId: 'b1',
   *   from: new Date('2024-01-15'),
   *   to:   new Date('2024-01-16'),
   *   include: {
   *     gps:         true,
   *     trips:       true,
   *     faults:      true,
   *     diagnostics: [Diagnostics.FUEL_LEVEL, Diagnostics.AUX_INPUT_1],
   *   },
   *   computeBearing: true,
   * });
   */
  history(options) {
    return new HistoryQuery(this._session, this._rateLimiter).fetch(options);
  }

  /**
   * Fetch historical data for multiple devices in parallel.
   *
   * @param {string[]} deviceIds
   * @param {object}   options    Same as history() minus deviceId
   * @returns {Promise<HistoryResult[]>}
   */
  historyMany(deviceIds, options) {
    return new HistoryQuery(this._session, this._rateLimiter).fetchMany(deviceIds, options);
  }

  /**
   * Fetch a point-in-time snapshot of the entire fleet via multiCall.
   *
   * @param {object}   [options]
   * @param {object}   [options.include]
   * @param {boolean}  [options.include.devices=true]
   * @param {boolean}  [options.include.liveStatus=true]
   * @param {boolean}  [options.include.activeFaults=false]
   * @param {string[]} [options.include.diagnostics=[]]
   * @param {number}   [options.include.recentTrips=0]
   * @param {string[]} [options.groupIds]  Filter to specific groups
   * @returns {Promise<FleetSnapshotResult>}
   *
   * @example
   * const fleet = await sdk.fleetSnapshot({
   *   include: {
   *     liveStatus:   true,
   *     activeFaults: true,
   *     diagnostics:  [Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER],
   *     recentTrips:  5,
   *   }
   * });
   *
   * console.log(fleet.summary);
   * // { total: 45, driving: 12, stopped: 28, disconnected: 5, withActiveFaults: 3 }
   */
  fleetSnapshot(options = {}) {
    return new FleetSnapshot(this._session, this._rateLimiter, this._cache).fetch(options);
  }

  /**
   * Create an adaptive GetFeed stream manager.
   * Use this for high-volume, continuous data sync scenarios.
   *
   * @returns {FeedManager}
   *
   * @example
   * const feeds = sdk.feeds()
   *   .addFeed('LogRecord', { fromDate: new Date('2024-01-15') })
   *   .addFeed('StatusData', { fromVersion: savedToken });
   *
   * feeds.on('data',    (type, records) => syncToDatabase(type, records));
   * feeds.on('version', (type, token)   => saveToken(type, token));
   * feeds.on('error',   (type, err)     => logger.error(type, err));
   * feeds.start();
   */
  feeds() {
    return new FeedManager(this._session, this._rateLimiter);
  }

  /**
   * Warm up the session and optional entity caches.
   * Call this explicitly at startup if you want to fail fast on bad credentials.
   *
   * @param {object} [options]
   * @param {boolean} [options.cacheDevices=false]    Pre-load all devices
   * @param {boolean} [options.cacheDiagnostics=false] Pre-load diagnostic definitions
   * @returns {Promise<void>}
   */
  async connect(options = {}) {
    await this._session.connect();

    if (options.cacheDevices) {
      const devices = await this._session.call('Get', { typeName: 'Device', search: {} });
      this._cache.set('Device', devices);
    }

    if (options.cacheDiagnostics) {
      const diags = await this._session.call('Get', { typeName: 'Diagnostic', search: {} });
      this._cache.set('Diagnostic', diags);
    }
  }
}

module.exports = GeotabSDK;
