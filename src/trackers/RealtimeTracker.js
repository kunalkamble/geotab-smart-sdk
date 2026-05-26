'use strict';

const EventEmitter = require('events');
const { Diagnostics } = require('../constants/Diagnostics');

const DEFAULT_POLL_MS              = 5_000;
const MIN_POLL_MS                  = 1_000;
const SOFT_WARNING_POLL_MS         = 2_000;
const DRIVING_SPEED_THRESHOLD_KMH  = 5;
const IGNITION_MAX_AGE_MS          = 5 * 60_000;       // 5 min — ignore stale ignition
const DRIVER_LOOKBACK_MS           = 24 * 60 * 60_000; // 24h initial seed window
const IGNITION_LOOKBACK_MS         = 24 * 60 * 60_000; // 24h initial seed window
const CONNECTED_RECENCY_MS         = 2 * 60_000;       // a record within 2 min ⇒ connected
const LOGRECORD_PAGE_LIMIT         = 50_000;

/**
 * RealtimeTracker — high-fidelity live tracking driven by LogRecord (GetFeed),
 * with bearing computed between consecutive points and isDriving / driver
 * derived from companion entities.
 *
 * Use this when you need every GPS fix the device emits (smooth map animation,
 * geofencing, accident reconstruction). For "current snapshot per vehicle for
 * a dashboard," prefer LiveTracker (DeviceStatusInfo).
 *
 * Per poll we issue a single multiCall:
 *   [0]   GetFeed LogRecord (version-token incremental)
 *   [1]   Get StatusData    (diagnosticSearch: DiagnosticIgnitionId) — optional
 *   [2..] Get StatusData    (one per user-requested Diagnostic)
 *   [N+1] Get FaultData     (faultStates: ['Active'])               — optional
 *   [N+2] Get DriverChange  (type: 'Driver', fromDate)              — optional
 *
 * Per-device state retained between polls:
 *   - last GPS point (for bearing)
 *   - last known ignition value (StatusData fires on change only)
 *   - current driver assignment (DriverChange is event-based)
 *
 * Each emitted vehicle snapshot is shape-compatible with LiveTracker plus:
 *   { ignition: { value, dateTime } | null, source: 'logrecord' }
 */
class RealtimeTracker extends EventEmitter {
  /**
   * @param {import('../core/Session')} session
   * @param {import('../core/RateLimiter')} rateLimiter
   * @param {import('../cache/EntityCache')} cache
   */
  constructor(session, rateLimiter, cache) {
    super();
    this._session     = session;
    this._rateLimiter = rateLimiter;
    this._cache       = cache;

    // Fluent config
    this._diagnosticIds  = [];
    this._withIgnition   = false;
    this._withDriver     = false;
    this._withFaults     = false;
    this._deviceIds      = [];
    this._pollMs         = DEFAULT_POLL_MS;
    this._drivingSpeed   = DRIVING_SPEED_THRESHOLD_KMH;
    this._initialFrom    = null;

    // Per-device state retained across polls
    this._lastPoint        = new Map(); // id → { lat, lon, dateTime, bearing }
    this._lastIgnition     = new Map(); // id → { value, dateTime }
    this._driverByDevice   = new Map(); // id → { id, name, since }

    // Feed state
    this._logRecordToken   = null;
    this._statusDataSince  = null;   // ISO string for delta Get(StatusData)

    this._timer   = null;
    this._running = false;
  }

  // ─── Fluent builders ──────────────────────────────────────────────────────

  /**
   * Include latest values for these diagnostic IDs in each snapshot.
   * Each diagnostic adds one Get(StatusData) per poll.
   * @param {string[]} ids  Use Diagnostics.* constants.
   */
  withDiagnostics(ids) {
    this._diagnosticIds = Array.isArray(ids) ? ids : [ids];
    return this;
  }

  /**
   * Fetch DiagnosticIgnitionId in each poll and use it to derive accurate isDriving.
   * Strongly recommended for production tracking.
   */
  withIgnition() {
    this._withIgnition = true;
    return this;
  }

  /**
   * Track current driver assignment per device via DriverChange.
   * Strongly recommended when you need driver attribution.
   */
  withDriverAttribution() {
    this._withDriver = true;
    return this;
  }

  /** Include active FaultData (DTCs) per device. */
  withFaults() {
    this._withFaults = true;
    return this;
  }

  /** Restrict tracking to a subset of devices. Omit for all devices. */
  forDevices(ids) {
    this._deviceIds = Array.isArray(ids) ? ids : [ids];
    return this;
  }

  /**
   * Poll interval in ms. Default 5000. Hard floor 1000.
   * Emits a console warning below 2000 ms (within rate-limit budget but tight).
   */
  pollEvery(ms) {
    this._pollMs = Math.max(MIN_POLL_MS, ms);
    if (this._pollMs < SOFT_WARNING_POLL_MS) {
      console.warn(`[RealtimeTracker] pollEvery(${this._pollMs}) < ${SOFT_WARNING_POLL_MS}ms — close to GetFeed rate limit (60/min).`);
    }
    return this;
  }

  /**
   * Speed (km/h) above which a vehicle counts as "driving" when ignition is on
   * or unknown. Default 5.
   */
  drivingSpeedThreshold(kmh) {
    this._drivingSpeed = kmh;
    return this;
  }

  /**
   * Override the initial LogRecord seed time. Defaults to "now - pollMs"
   * so the first poll only sees fresh fixes.
   */
  startingFrom(date) {
    this._initialFrom = date instanceof Date ? date : new Date(date);
    return this;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async start() {
    if (this._running) return;
    this._running = true;

    await this._warmDeviceCache();
    await this._seedIgnitionMap();
    await this._seedDriverMap();

    await this._poll();
    this._scheduleNext();
  }

  stop() {
    this._running = false;
    if (this._timer) clearTimeout(this._timer);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _scheduleNext() {
    if (!this._running) return;
    this._timer = setTimeout(async () => {
      await this._poll();
      this._scheduleNext();
    }, this._pollMs);
  }

  async _poll() {
    try {
      const calls = this._buildCalls();
      const results = await this._rateLimiter.withRetry('LogRecord', () =>
        this._session.multiCall(calls.map(c => c.call))
      );
      const vehicles = this._merge(results, calls);
      this._statusDataSince = new Date().toISOString();
      this.emit('update', vehicles);
    } catch (err) {
      this.emit('error', err);
    }
  }

  _buildCalls() {
    const calls = [];

    // [0] LogRecord — incremental via GetFeed
    if (this._logRecordToken) {
      calls.push({
        role: 'logrecord',
        call: ['GetFeed', {
          typeName: 'LogRecord',
          fromVersion: this._logRecordToken,
          resultsLimit: LOGRECORD_PAGE_LIMIT,
        }],
      });
    } else {
      const fromDate = (this._initialFrom ?? new Date(Date.now() - this._pollMs)).toISOString();
      calls.push({
        role: 'logrecord',
        call: ['GetFeed', {
          typeName: 'LogRecord',
          search: { fromDate },
          resultsLimit: LOGRECORD_PAGE_LIMIT,
        }],
      });
    }

    // Delta window for StatusData (Get-based). Includes a small overlap.
    const deltaFrom = this._statusDataSince
      ?? new Date(Date.now() - Math.max(this._pollMs * 3, 30_000)).toISOString();

    // [1] StatusData(ignition) delta
    if (this._withIgnition) {
      calls.push({
        role: 'ignition',
        call: ['Get', {
          typeName: 'StatusData',
          search: { diagnosticSearch: { id: Diagnostics.IGNITION }, fromDate: deltaFrom },
        }],
      });
    }

    // [2..N] StatusData(diagnostic) delta — one per requested ID
    for (const diagId of this._diagnosticIds) {
      calls.push({
        role: 'diagnostic',
        diagId,
        call: ['Get', {
          typeName: 'StatusData',
          search: { diagnosticSearch: { id: diagId }, fromDate: deltaFrom },
        }],
      });
    }

    // [N+1] FaultData (active, full set)
    if (this._withFaults) {
      calls.push({
        role: 'faults',
        call: ['Get', { typeName: 'FaultData', search: { faultStates: ['Active'] } }],
      });
    }

    // [N+2] DriverChange delta
    if (this._withDriver) {
      calls.push({
        role: 'driverchange',
        call: ['Get', {
          typeName: 'DriverChange',
          search: { fromDate: deltaFrom, type: 'Driver' },
        }],
      });
    }

    return calls;
  }

  _merge(results, calls) {
    // Index results by role
    const logRaw = results[0];
    let ignitionRecords = [];
    const diagRecords = {};
    let faultRecords = [];
    let driverChanges = [];

    for (let i = 1; i < calls.length; i++) {
      const role = calls[i].role;
      const data = results[i] || [];
      if (role === 'ignition')          ignitionRecords = data;
      else if (role === 'diagnostic')   diagRecords[calls[i].diagId] = data;
      else if (role === 'faults')       faultRecords = data;
      else if (role === 'driverchange') driverChanges = data;
    }

    // LogRecord GetFeed returns { data, toVersion }
    const logs = logRaw?.data ?? [];
    if (logRaw?.toVersion) this._logRecordToken = logRaw.toVersion;

    // Merge ignition delta into the cache
    for (const rec of ignitionRecords) {
      const devId = rec.device?.id;
      if (!devId) continue;
      const cur = this._lastIgnition.get(devId);
      if (!cur || new Date(rec.dateTime) > new Date(cur.dateTime)) {
        this._lastIgnition.set(devId, { value: rec.data, dateTime: rec.dateTime });
      }
    }

    // Merge driver-change delta into the cache (chronological replay)
    if (driverChanges.length) {
      driverChanges
        .slice()
        .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
        .forEach(change => this._applyDriverChange(change));
    }

    // Build per-diagnostic, per-device latest map
    const diagByDev = {};
    for (const diagId of this._diagnosticIds) {
      const map = new Map();
      for (const rec of (diagRecords[diagId] || [])) {
        const devId = rec.device?.id;
        if (!devId) continue;
        if (!map.has(devId) || new Date(rec.dateTime) > new Date(map.get(devId).dateTime)) {
          map.set(devId, rec);
        }
      }
      diagByDev[diagId] = map;
    }

    // Group active faults by device
    const faultsByDev = new Map();
    for (const f of faultRecords) {
      const devId = f.device?.id;
      if (!devId) continue;
      if (!faultsByDev.has(devId)) faultsByDev.set(devId, []);
      faultsByDev.get(devId).push(f);
    }

    // Pick the latest LogRecord per device (poll may return many per device)
    const latestPerDevice = new Map();
    for (const rec of logs) {
      const devId = rec.device?.id;
      if (!devId) continue;
      if (this._deviceIds.length > 0 && !this._deviceIds.includes(devId)) continue;
      const cur = latestPerDevice.get(devId);
      if (!cur || new Date(rec.dateTime) > new Date(cur.dateTime)) {
        latestPerDevice.set(devId, rec);
      }
    }

    const deviceCache = this._cache.getAll('Device');
    const nowMs = Date.now();
    const vehicles = [];

    for (const [devId, log] of latestPerDevice.entries()) {
      // Compute bearing from the previous observation for this device
      const prev = this._lastPoint.get(devId);
      let bearing = null;
      if (prev && (prev.lat !== log.latitude || prev.lon !== log.longitude)) {
        bearing = calcBearing(prev, { lat: log.latitude, lon: log.longitude });
      } else if (prev && prev.bearing != null) {
        bearing = prev.bearing; // hold heading when stationary
      }
      this._lastPoint.set(devId, {
        lat: log.latitude, lon: log.longitude,
        dateTime: log.dateTime, bearing,
      });

      const speed     = isValidSpeed(log.speed) ? log.speed : null;
      const ignition  = this._currentIgnition(devId, nowMs);
      const isDriving = computeIsDriving(speed, ignition, this._drivingSpeed);
      const isMoving  = speed != null && speed > 0;

      const diagSnapshot = {};
      for (const diagId of this._diagnosticIds) {
        const rec = diagByDev[diagId]?.get(devId);
        if (rec) diagSnapshot[diagId] = { value: rec.data, dateTime: rec.dateTime };
      }

      const driver = this._driverByDevice.get(devId);
      const devRec = deviceCache?.get(devId);

      vehicles.push({
        device: {
          id: devId,
          name: devRec?.name ?? devId,
          serialNumber: devRec?.serialNumber,
        },
        location: {
          latitude:  log.latitude,
          longitude: log.longitude,
          bearing,
          speed,
        },
        isDriving,
        isMoving,
        isConnected: (nowMs - new Date(log.dateTime).getTime()) < CONNECTED_RECENCY_MS,
        driver: driver ? { id: driver.id, name: driver.name } : null,
        dateTime: log.dateTime,
        diagnostics: diagSnapshot,
        faults: faultsByDev.get(devId) ?? [],
        ignition,
        source: 'logrecord',
      });
    }

    return vehicles;
  }

  _currentIgnition(devId, nowMs) {
    const ig = this._lastIgnition.get(devId);
    if (!ig) return null;
    if (nowMs - new Date(ig.dateTime).getTime() > IGNITION_MAX_AGE_MS) return null;
    return { value: ig.value, dateTime: ig.dateTime };
  }

  _applyDriverChange(change) {
    const devId = change.device?.id;
    if (!devId) return;
    // A DriverChange to the "UnknownDriver" or null driver means logout
    if (!change.driver || change.driver.id === 'UnknownDriverId') {
      this._driverByDevice.delete(devId);
      return;
    }
    const cur = this._driverByDevice.get(devId);
    if (!cur || new Date(change.dateTime) > new Date(cur.since)) {
      this._driverByDevice.set(devId, {
        id:    change.driver.id,
        name:  change.driver.name ?? null,
        since: change.dateTime,
      });
    }
  }

  async _warmDeviceCache() {
    if (this._cache.isFresh('Device')) return;
    const devices = await this._session.call('Get', { typeName: 'Device', search: {} });
    this._cache.set('Device', devices);
  }

  async _seedIgnitionMap() {
    if (!this._withIgnition) return;
    const fromDate = new Date(Date.now() - IGNITION_LOOKBACK_MS).toISOString();
    const records = await this._session.call('Get', {
      typeName: 'StatusData',
      search: { diagnosticSearch: { id: Diagnostics.IGNITION }, fromDate },
    });
    for (const rec of (records || [])) {
      const devId = rec.device?.id;
      if (!devId) continue;
      const cur = this._lastIgnition.get(devId);
      if (!cur || new Date(rec.dateTime) > new Date(cur.dateTime)) {
        this._lastIgnition.set(devId, { value: rec.data, dateTime: rec.dateTime });
      }
    }
  }

  async _seedDriverMap() {
    if (!this._withDriver) return;
    const fromDate = new Date(Date.now() - DRIVER_LOOKBACK_MS).toISOString();
    const changes = await this._session.call('Get', {
      typeName: 'DriverChange',
      search: { fromDate, type: 'Driver' },
    });
    (changes || [])
      .slice()
      .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
      .forEach(c => this._applyDriverChange(c));
  }
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

function calcBearing(p1, p2) {
  const toRad = d => d * Math.PI / 180;
  const dLon  = toRad(p2.lon - p1.lon);
  const lat1  = toRad(p1.lat);
  const lat2  = toRad(p2.lat);
  const y     = Math.sin(dLon) * Math.cos(lat2);
  const x     = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function isValidSpeed(s) {
  return typeof s === 'number' && s >= 0 && s < 500;
}

function computeIsDriving(speed, ignition, threshold) {
  // Known-off ignition trumps everything
  if (ignition && (ignition.value === 0 || ignition.value === false)) return false;
  // Known-on: require speed above threshold to count as driving
  if (ignition && (ignition.value === 1 || ignition.value === true)) {
    return speed != null && speed > threshold;
  }
  // Ignition unknown: speed-only heuristic
  return speed != null && speed > threshold;
}

module.exports = RealtimeTracker;
