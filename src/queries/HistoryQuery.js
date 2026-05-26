'use strict';

const PAGE_SIZE = 50_000;

/**
 * HistoryQuery fetches historical data for one or more devices over a time range.
 * It combines GPS (LogRecord), diagnostics (StatusData), fault events (FaultData),
 * and completed trips (Trip) in a single composed query using multiCall.
 *
 * Key design decisions:
 *  - LogRecord and StatusData are fetched in the same time window using multiCall,
 *    so results are temporally aligned with one HTTP request.
 *  - LogRecord does NOT have bearing — this class can compute it from consecutive points.
 *  - Pagination is handled automatically when record counts hit the 50,000 limit.
 *  - Results are returned as a structured object per device.
 *
 * Usage:
 *   const history = await sdk.history({
 *     deviceId: 'b1',
 *     from: new Date('2024-01-15T00:00:00Z'),
 *     to:   new Date('2024-01-15T23:59:59Z'),
 *     include: {
 *       gps:         true,
 *       trips:       true,
 *       faults:      true,
 *       diagnostics: [Diagnostics.FUEL_LEVEL, Diagnostics.AUX_INPUT_1],
 *     },
 *     computeBearing: true,   // calculate bearing from consecutive GPS points
 *   });
 *
 * Returns:
 *   {
 *     deviceId: 'b1',
 *     period:   { from, to },
 *     gps:      LogRecord[],          // with optional .bearing added
 *     trips:    Trip[],
 *     faults:   FaultData[],
 *     diagnostics: {
 *       [diagId]: StatusData[]
 *     }
 *   }
 */
class HistoryQuery {
  /**
   * @param {import('../core/Session')} session
   * @param {import('../core/RateLimiter')} rateLimiter
   */
  constructor(session, rateLimiter) {
    this._session     = session;
    this._rateLimiter = rateLimiter;
  }

  /**
   * Execute a historical query.
   *
   * @param {object}   options
   * @param {string}   options.deviceId         Geotab device ID
   * @param {Date}     options.from              Start of the time range
   * @param {Date}     options.to                End of the time range
   * @param {object}   [options.include]
   * @param {boolean}  [options.include.gps=true]
   * @param {boolean}  [options.include.trips=false]
   * @param {boolean}  [options.include.faults=false]
   * @param {string[]} [options.include.diagnostics=[]]  Diagnostic IDs
   * @param {boolean}  [options.computeBearing=false]    Add bearing to GPS points
   * @returns {Promise<HistoryResult>}
   */
  async fetch(options) {
    const {
      deviceId,
      from,
      to,
      include = {},
      computeBearing = false,
    } = options;

    if (!deviceId) throw new Error('[HistoryQuery] deviceId is required');
    if (!from || !to) throw new Error('[HistoryQuery] from and to dates are required');

    const fromISO = toISO(from);
    const toISO_  = toISO(to);
    const devSearch = { deviceSearch: { id: deviceId }, fromDate: fromISO, toDate: toISO_ };

    const {
      gps         = true,
      trips       = false,
      faults      = false,
      diagnostics = [],
    } = include;

    // Build the first-page multiCall
    const calls = this._buildCalls({ devSearch, gps, trips, faults, diagnostics });
    const firstPage = await this._session.multiCall(calls);

    // Collect results — paginate LogRecord and StatusData if needed
    let gpsRecords   = gps   ? (firstPage[0] ?? []) : [];
    let faultRecords = [];
    let tripRecords  = [];
    const diagResults = {};

    let offset = gps ? 1 : 0;

    for (const diagId of diagnostics) {
      diagResults[diagId] = firstPage[offset] ?? [];
      offset++;
    }
    if (faults) { faultRecords = firstPage[offset] ?? []; offset++; }
    if (trips)  { tripRecords  = firstPage[offset] ?? []; }

    // Paginate GPS if we hit the page limit
    if (gps && gpsRecords.length >= PAGE_SIZE) {
      gpsRecords = await this._paginateLogRecord(gpsRecords, deviceId, fromISO, toISO_);
    }

    // Paginate each diagnostic stream if it hit the page limit too. StatusData
    // can match LogRecord's volume on long ranges, so a silent truncation here
    // would lose real data.
    for (const diagId of diagnostics) {
      if (diagResults[diagId].length >= PAGE_SIZE) {
        diagResults[diagId] = await this._paginateStatusData(
          diagResults[diagId], deviceId, diagId, fromISO, toISO_,
        );
      }
    }

    // Compute bearing from consecutive GPS points if requested
    if (computeBearing && gpsRecords.length > 1) {
      this._addBearing(gpsRecords);
    }

    return {
      deviceId,
      period: { from, to },
      gps:    gpsRecords,
      trips:  tripRecords,
      faults: faultRecords,
      diagnostics: diagResults,
    };
  }

  /**
   * Fetch history for multiple devices in parallel.
   * Internally uses individual fetch() calls — each device gets its own multiCall.
   *
   * @param {string[]} deviceIds
   * @param {object}   options    Same as fetch() minus deviceId
   * @returns {Promise<HistoryResult[]>}
   */
  async fetchMany(deviceIds, options) {
    return Promise.all(deviceIds.map(id => this.fetch({ ...options, deviceId: id })));
  }

  /**
   * Fetch history for every device in one or more groups.
   * Issues a single Get(Device) with the groups filter to resolve the device
   * list, then delegates to fetchMany() — one multiCall per resolved device,
   * in parallel.
   *
   * @param {string[]} groupIds   Geotab group IDs (must be non-empty)
   * @param {object}   options    Same as fetch() minus deviceId
   * @returns {Promise<HistoryResult[]>}  Empty array if no devices match.
   */
  async fetchByGroups(groupIds, options) {
    if (!Array.isArray(groupIds) || groupIds.length === 0) {
      throw new Error('[HistoryQuery] groupIds is required and must be non-empty');
    }
    if (!options || !options.from || !options.to) {
      throw new Error('[HistoryQuery] options.from and options.to are required');
    }

    const devices = await this._session.call('Get', {
      typeName: 'Device',
      search: { groups: groupIds.map(id => ({ id })) },
    });
    const deviceIds = (devices || []).map(d => d.id).filter(Boolean);
    if (deviceIds.length === 0) return [];

    return this.fetchMany(deviceIds, options);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _buildCalls({ devSearch, gps, trips, faults, diagnostics }) {
    const calls = [];

    if (gps) {
      calls.push(['Get', {
        typeName:     'LogRecord',
        search:        devSearch,
        resultsLimit:  PAGE_SIZE,
      }]);
    }

    for (const diagId of diagnostics) {
      calls.push(['Get', {
        typeName: 'StatusData',
        search: {
          deviceSearch:    { id: devSearch.deviceSearch.id },
          diagnosticSearch: { id: diagId },
          fromDate:         devSearch.fromDate,
          toDate:           devSearch.toDate,
        },
        resultsLimit: PAGE_SIZE,
      }]);
    }

    if (faults) {
      calls.push(['Get', {
        typeName: 'FaultData',
        search:   devSearch,
      }]);
    }

    if (trips) {
      calls.push(['Get', {
        typeName: 'Trip',
        search:   devSearch,
      }]);
    }

    return calls;
  }

  async _paginateLogRecord(firstPage, deviceId, fromISO, toISO_) {
    return this._paginate(firstPage, async (nextFrom) => this._session.call('Get', {
      typeName: 'LogRecord',
      search: {
        deviceSearch: { id: deviceId },
        fromDate:     nextFrom,
        toDate:       toISO_,
      },
      resultsLimit: PAGE_SIZE,
    }));
  }

  async _paginateStatusData(firstPage, deviceId, diagId, fromISO, toISO_) {
    return this._paginate(firstPage, async (nextFrom) => this._session.call('Get', {
      typeName: 'StatusData',
      search: {
        deviceSearch:     { id: deviceId },
        diagnosticSearch: { id: diagId },
        fromDate:         nextFrom,
        toDate:           toISO_,
      },
      resultsLimit: PAGE_SIZE,
    }));
  }

  /**
   * Shared pagination loop for LogRecord / StatusData. Each successive page
   * starts at the last record's `dateTime`, which Geotab interprets as `>=`.
   * That re-fetches the boundary records — so we dedupe by record ID, which
   * is correct even when multiple records share the same dateTime (a real
   * edge case at high sample rates that the older slice(1) approach lost).
   */
  async _paginate(firstPage, fetchPage) {
    const all = [...firstPage];
    const seen = new Set();
    for (const r of all) {
      if (r?.id) seen.add(r.id);
    }

    while (all.length > 0 && all.length % PAGE_SIZE === 0) {
      const lastRecord = all[all.length - 1];
      const more = await fetchPage(lastRecord.dateTime);
      if (!more || more.length === 0) break;

      // Filter out anything we already have. If the entire page is duplicates
      // (every record had the same timestamp as the boundary), we'd loop
      // forever — break to be safe.
      const fresh = more.filter((r) => r?.id && !seen.has(r.id));
      if (fresh.length === 0) break;

      for (const r of fresh) seen.add(r.id);
      all.push(...fresh);

      // The server returned a partial page → no more data to fetch.
      if (more.length < PAGE_SIZE) break;
    }

    return all;
  }

  /** Add .bearing to each GPS point based on the direction to the next point. */
  _addBearing(points) {
    for (let i = 0; i < points.length - 1; i++) {
      points[i].bearing = calcBearing(points[i], points[i + 1]);
    }
    // Last point inherits bearing from the second-to-last
    if (points.length > 1) {
      points[points.length - 1].bearing = points[points.length - 2].bearing;
    }
  }
}

/**
 * Calculate the initial bearing from point p1 to point p2 (in degrees, 0-360).
 * @param {{ latitude: number, longitude: number }} p1
 * @param {{ latitude: number, longitude: number }} p2
 * @returns {number}
 */
function calcBearing(p1, p2) {
  const toRad = d => d * Math.PI / 180;
  const dLon  = toRad(p2.longitude - p1.longitude);
  const lat1  = toRad(p1.latitude);
  const lat2  = toRad(p2.latitude);
  const y     = Math.sin(dLon) * Math.cos(lat2);
  const x     = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function toISO(date) {
  return date instanceof Date ? date.toISOString() : date;
}

module.exports = HistoryQuery;
