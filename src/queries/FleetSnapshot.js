'use strict';

/**
 * FleetSnapshot fetches a point-in-time picture of the entire fleet
 * (or a subset) in a single multiCall.
 *
 * A fleet snapshot is ideal for:
 *  - Dashboard initial load
 *  - Generating reports
 *  - Detecting vehicles that haven't communicated recently
 *
 * Usage:
 *   const fleet = await sdk.fleetSnapshot({
 *     include: {
 *       devices:     true,   // Device list with names and groups
 *       liveStatus:  true,   // DeviceStatusInfo (location, bearing, driver)
 *       activeFaults: true,  // Active DTCs for each vehicle
 *       diagnostics: [Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER],
 *       recentTrips: 5,      // N most recent trips per vehicle
 *     }
 *   });
 *
 * Returns:
 *   {
 *     devices:    Device[],
 *     liveStatus: Map<deviceId, DeviceStatusInfo>,
 *     faults:     Map<deviceId, FaultData[]>,
 *     diagnostics: { [diagId]: Map<deviceId, StatusData> },
 *     recentTrips: Map<deviceId, Trip[]>,
 *     summary: {
 *       total:        number,
 *       driving:      number,
 *       stopped:      number,
 *       disconnected: number,
 *       withActiveFaults: number,
 *     }
 *   }
 */
class FleetSnapshot {
  /**
   * @param {import('../core/Session')} session
   * @param {import('../core/RateLimiter')} rateLimiter
   * @param {import('../cache/EntityCache')} cache
   */
  constructor(session, rateLimiter, cache) {
    this._session     = session;
    this._rateLimiter = rateLimiter;
    this._cache       = cache;
  }

  /**
   * Execute the fleet snapshot query.
   *
   * @param {object}   [options]
   * @param {object}   [options.include]
   * @param {boolean}  [options.include.devices=true]
   * @param {boolean}  [options.include.liveStatus=true]
   * @param {boolean}  [options.include.activeFaults=false]
   * @param {string[]} [options.include.diagnostics=[]]
   * @param {number}   [options.include.recentTrips=0]   0 = skip, N = last N trips
   * @param {string[]} [options.groupIds]  Restrict to devices in these group IDs
   * @returns {Promise<FleetSnapshotResult>}
   */
  async fetch(options = {}) {
    const {
      include    = {},
      groupIds   = [],
    } = options;

    const {
      devices      = true,
      liveStatus   = true,
      activeFaults = false,
      diagnostics  = [],
      recentTrips  = 0,
    } = include;

    // Geotab uses two different shapes for the group filter:
    //   - Device, DeviceStatusInfo:           search.groups
    //   - StatusData, FaultData, Trip, etc.:  search.deviceSearch.groups
    // We pre-compute both forms once so each call site stays terse.
    const hasGroups   = groupIds.length > 0;
    const groupRefs   = hasGroups ? groupIds.map(id => ({ id })) : null;
    const groupTop    = hasGroups ? { groups: groupRefs } : {};
    const groupNested = hasGroups ? { deviceSearch: { groups: groupRefs } } : {};

    const calls   = [];
    const callMap = {};  // index → what the result represents
    let idx = 0;

    if (devices) {
      calls.push(['Get', { typeName: 'Device', search: { ...groupTop } }]);
      callMap[idx++] = 'devices';
    }

    if (liveStatus) {
      calls.push(['Get', { typeName: 'DeviceStatusInfo', search: { ...groupTop } }]);
      callMap[idx++] = 'liveStatus';
    }

    for (const diagId of diagnostics) {
      calls.push(['Get', {
        typeName: 'StatusData',
        search: { ...groupNested, diagnosticSearch: { id: diagId } },
      }]);
      callMap[idx++] = { type: 'diagnostic', diagId };
    }

    if (activeFaults) {
      calls.push(['Get', {
        typeName: 'FaultData',
        search: { ...groupNested, faultStates: ['Active'] },
      }]);
      callMap[idx++] = 'faults';
    }

    if (recentTrips > 0) {
      // Note: Trip doesn't support resultsLimit per-device. We fetch recent
      // trips (optionally scoped to groupIds) and bucket by device on the client.
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      calls.push(['Get', {
        typeName:     'Trip',
        search:        { ...groupNested, fromDate: since },
        resultsLimit:  Math.min(recentTrips * 500, 50_000), // rough upper bound
      }]);
      callMap[idx++] = { type: 'recentTrips', limit: recentTrips };
    }

    const results = await this._session.multiCall(calls);

    return this._assemble(results, callMap);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _assemble(results, callMap) {
    let deviceList     = [];
    const liveMap      = new Map();
    const faultMap     = new Map();
    const diagMaps     = {};
    const tripMap      = new Map();

    for (const [idxStr, role] of Object.entries(callMap)) {
      const i   = parseInt(idxStr, 10);
      const raw = results[i] ?? [];

      if (role === 'devices') {
        deviceList = raw;
        this._cache.set('Device', raw);
      } else if (role === 'liveStatus') {
        for (const s of raw) {
          liveMap.set(s.device?.id, s);
        }
      } else if (role === 'faults') {
        for (const f of raw) {
          const devId = f.device?.id;
          if (!devId) continue;
          if (!faultMap.has(devId)) faultMap.set(devId, []);
          faultMap.get(devId).push(f);
        }
      } else if (typeof role === 'object' && role.type === 'diagnostic') {
        const map = new Map();
        for (const r of raw) {
          const devId = r.device?.id;
          if (!devId) continue;
          if (!map.has(devId) || new Date(r.dateTime) > new Date(map.get(devId).dateTime)) {
            map.set(devId, r);
          }
        }
        diagMaps[role.diagId] = map;
      } else if (typeof role === 'object' && role.type === 'recentTrips') {
        // Group trips by device, keep only the N most recent
        const tempMap = new Map();
        for (const t of raw) {
          const devId = t.device?.id;
          if (!devId) continue;
          if (!tempMap.has(devId)) tempMap.set(devId, []);
          tempMap.get(devId).push(t);
        }
        for (const [devId, trips] of tempMap.entries()) {
          // Sort by stop date descending and take N
          const sorted = trips.sort((a, b) => new Date(b.stop) - new Date(a.stop));
          tripMap.set(devId, sorted.slice(0, role.limit));
        }
      }
    }

    // Build fleet summary
    const summary = {
      total:            deviceList.length || liveMap.size,
      driving:          0,
      stopped:          0,
      disconnected:     0,
      withActiveFaults: faultMap.size,
    };

    for (const s of liveMap.values()) {
      if (!s.isDeviceCommunicating) summary.disconnected++;
      else if (s.isDriving)         summary.driving++;
      else                          summary.stopped++;
    }

    return {
      devices:     deviceList,
      liveStatus:  liveMap,
      faults:      faultMap,
      diagnostics: diagMaps,
      recentTrips: tripMap,
      summary,
    };
  }
}

module.exports = FleetSnapshot;
