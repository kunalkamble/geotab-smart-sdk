'use strict';

const EventEmitter = require('../core/EventEmitter');

const DEFAULT_POLL_MS = 5_000;

/**
 * LiveTracker provides real-time vehicle tracking via DeviceStatusInfo.
 *
 * DeviceStatusInfo is the only object that contains:
 *   - Bearing (heading) — NOT available in LogRecord
 *   - IsDriving         — current motion state
 *   - IsDeviceCommunicating
 *   - Current Driver
 *   - Active ExceptionEvents
 *
 * LiveTracker can optionally enrich each vehicle snapshot with:
 *   - Specific diagnostic readings (fuel, odometer, aux inputs, etc.)
 *     fetched from StatusData via multiCall
 *   - Active fault codes from FaultData
 *
 * All data is fetched in a single multiCall per poll cycle to minimise
 * HTTP overhead and keep results temporally aligned.
 *
 * Usage:
 *   const tracker = sdk.liveTracker()
 *     .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER])
 *     .withFaults()
 *     .forDevices(['b1', 'b2'])     // optional — all devices if omitted
 *     .pollEvery(5000);
 *
 *   tracker.on('update', (vehicles) => { ... });
 *   tracker.start();
 *
 * Each `vehicles` entry shape:
 *   {
 *     device:            { id, name, serialNumber, ... },
 *     location:          { latitude, longitude, bearing, speed },
 *     isDriving:         boolean,
 *     isConnected:       boolean,
 *     driver:            { id, name } | null,
 *     activeAlerts:      ExceptionEvent[],
 *     currentStateDuration: string,
 *     dateTime:          string,
 *     diagnostics:       { [humanLabel]: value } | {},
 *     faults:            FaultData[] | [],
 *   }
 */
class LiveTracker extends EventEmitter {
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

    this._diagnosticIds  = [];   // IDs to fetch via StatusData
    this._includeFaults  = false;
    this._deviceIds      = [];   // empty = all devices
    this._groupIds       = [];   // empty = all groups (no server-side filter)
    this._pollMs         = DEFAULT_POLL_MS;
    this._timer          = null;
    this._running        = false;
  }

  // ─── Fluent builder ───────────────────────────────────────────────────────

  /**
   * Include specific diagnostic readings in each vehicle snapshot.
   * @param {string[]} diagnosticIds  Use Diagnostics.* constants
   * @returns {this}
   */
  withDiagnostics(diagnosticIds) {
    this._diagnosticIds = Array.isArray(diagnosticIds) ? diagnosticIds : [diagnosticIds];
    return this;
  }

  /**
   * Include active fault codes (DTCs) in each vehicle snapshot.
   * @returns {this}
   */
  withFaults() {
    this._includeFaults = true;
    return this;
  }

  /**
   * Restrict tracking to a subset of devices.
   * Pass Geotab device IDs, e.g. ['b1', 'b3', 'b4'].
   * If not called, all devices are tracked.
   *
   * @param {string[]} deviceIds
   * @returns {this}
   */
  forDevices(deviceIds) {
    this._deviceIds = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
    return this;
  }

  /**
   * Restrict tracking to devices in one or more groups.
   * Applied server-side via DeviceSearch.groups — narrows the payload
   * before client-side device-id filtering (if any).
   *
   * Use Geotab group IDs (e.g. 'groupCompanyId' or a custom group's id).
   * If both .forGroups() and .forDevices() are set, the result is the
   * intersection (devices that are in one of the groups AND in the id list).
   *
   * @param {string[]} groupIds
   * @returns {this}
   */
  forGroups(groupIds) {
    this._groupIds = Array.isArray(groupIds) ? groupIds : [groupIds];
    return this;
  }

  /**
   * Set the poll interval in milliseconds. Minimum 1000ms.
   * @param {number} ms
   * @returns {this}
   */
  pollEvery(ms) {
    this._pollMs = Math.max(1_000, ms);
    return this;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start polling. Emits 'update', 'error' events.
   */
  async start() {
    if (this._running) return;
    this._running = true;

    // Warm device cache so we can resolve names
    await this._warmDeviceCache();

    // First poll immediately, then schedule
    await this._poll();
    this._scheduleNext();
  }

  /**
   * Stop polling.
   */
  stop() {
    this._running = false;
    if (this._timer) clearTimeout(this._timer);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

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
      const results = await this._rateLimiter.withRetry(
        'DeviceStatusInfo',
        () => this._session.multiCall(calls)
      );

      const vehicles = this._mergeResults(results);
      this.emit('update', vehicles);
    } catch (err) {
      this.emit('error', err);
    }
  }

  _buildCalls() {
    const calls = [];

    // Group filter — two shapes, same as FleetSnapshot:
    //   - DeviceStatusInfo:           search.groups
    //   - StatusData / FaultData:     search.deviceSearch.groups
    // Individual device-id filtering still happens client-side after fetch
    // (DeviceSearch by id is slower than by groups on Geotab's side).
    const hasGroups   = this._groupIds.length > 0;
    const groupRefs   = hasGroups ? this._groupIds.map(id => ({ id })) : null;
    const groupTop    = hasGroups ? { groups: groupRefs } : {};
    const groupNested = hasGroups ? { deviceSearch: { groups: groupRefs } } : {};

    // [0] Always: DeviceStatusInfo — live location, bearing, driver, alerts
    calls.push(['Get', { typeName: 'DeviceStatusInfo', search: { ...groupTop } }]);

    // [1..N] One Get(StatusData) call per diagnostic type
    for (const diagId of this._diagnosticIds) {
      calls.push(['Get', {
        typeName: 'StatusData',
        search: { ...groupNested, diagnosticSearch: { id: diagId } },
      }]);
    }

    // [N+1] Optional: FaultData for active faults
    if (this._includeFaults) {
      calls.push(['Get', {
        typeName: 'FaultData',
        search: { ...groupNested, faultStates: ['Active'] },
      }]);
    }

    return calls;
  }

  _mergeResults(results) {
    // results[0] = DeviceStatusInfo[]
    let statuses = results[0] ?? [];

    // Client-side filters. We always apply these — even when forGroups()
    // already added a server-side group filter to the search — because
    // DeviceStatusInfo's `groups` filter is not reliably honored across
    // Geotab tenants and can return the full fleet anyway. The device
    // cache (warmed by sdk.connect({ cacheDevices: true })) carries each
    // device's `groups` array, which is the source of truth.
    const deviceCache    = this._cache.getAll('Device');
    const deviceIdSet    = this._deviceIds.length > 0 ? new Set(this._deviceIds) : null;
    const allowedGroups  = this._groupIds.length > 0  ? new Set(this._groupIds)  : null;
    if (deviceIdSet || allowedGroups) {
      statuses = statuses.filter((s) => {
        const devId = s.device?.id;
        if (!devId) return false;
        if (deviceIdSet && !deviceIdSet.has(devId)) return false;
        if (allowedGroups) {
          const dev = deviceCache?.get(devId);
          // Unknown-to-cache devices are dropped to avoid leaking out-of-scope
          // vehicles — the device cache is warmed in start() before the first
          // poll, so this only matters for vehicles added after start.
          if (!dev) return false;
          if (!Array.isArray(dev.groups) || !dev.groups.some(g => allowedGroups.has(g?.id))) {
            return false;
          }
        }
        return true;
      });
    }

    // Build lookup maps for diagnostics
    // results[1..N] = StatusData[] per diagnostic type
    const diagMaps = {};
    for (let i = 0; i < this._diagnosticIds.length; i++) {
      const diagId = this._diagnosticIds[i];
      const records = results[1 + i] ?? [];
      // Map: deviceId → latest StatusData value
      const map = new Map();
      for (const r of records) {
        const devId = r.device?.id;
        if (!devId) continue;
        if (!map.has(devId) || new Date(r.dateTime) > new Date(map.get(devId).dateTime)) {
          map.set(devId, r);
        }
      }
      diagMaps[diagId] = map;
    }

    // Build fault lookup: deviceId → FaultData[]
    const faultMap = new Map();
    if (this._includeFaults) {
      const faultIdx = 1 + this._diagnosticIds.length;
      for (const f of (results[faultIdx] ?? [])) {
        const devId = f.device?.id;
        if (!devId) continue;
        if (!faultMap.has(devId)) faultMap.set(devId, []);
        faultMap.get(devId).push(f);
      }
    }

    // Hydrate device names from the cache we already read above.
    return statuses.map(s => {
      const deviceId  = s.device?.id;
      const devRecord = deviceCache?.get(deviceId) || s.device;

      // Collect diagnostic values
      const diagnostics = {};
      for (const diagId of this._diagnosticIds) {
        const record = diagMaps[diagId]?.get(deviceId);
        if (record) {
          diagnostics[diagId] = {
            value:    record.data,
            dateTime: record.dateTime,
          };
        }
      }

      return {
        device: {
          id:           deviceId,
          name:         devRecord?.name ?? deviceId,
          serialNumber: devRecord?.serialNumber,
        },
        location: {
          latitude:  s.latitude,
          longitude: s.longitude,
          bearing:   s.bearing,   // heading in degrees — only in DeviceStatusInfo
          speed:     s.speed,     // km/h
        },
        isDriving:            s.isDriving ?? false,
        isConnected:          s.isDeviceCommunicating ?? false,
        driver:               s.driver?.id ? s.driver : null,
        activeAlerts:         s.exceptionEvents ?? [],
        currentStateDuration: s.currentStateDuration,
        dateTime:             s.dateTime,
        diagnostics,
        faults: faultMap.get(deviceId) ?? [],
      };
    });
  }

  async _warmDeviceCache() {
    if (this._cache.isFresh('Device')) return;
    const devices = await this._session.call('Get', { typeName: 'Device', search: {} });
    this._cache.set('Device', devices);
  }
}

module.exports = LiveTracker;
