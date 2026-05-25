'use strict';

const { Diagnostics } = require('../constants/Diagnostics');

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
    const all = [...firstPage];

    while (all.length > 0 && all.length % PAGE_SIZE === 0) {
      const lastRecord  = all[all.length - 1];
      const nextFrom    = lastRecord.dateTime;

      const more = await this._session.call('Get', {
        typeName: 'LogRecord',
        search: {
          deviceSearch: { id: deviceId },
          fromDate:     nextFrom,
          toDate:       toISO_,
        },
        resultsLimit: PAGE_SIZE,
      });

      if (!more || more.length === 0) break;
      // Skip the first record — it's a duplicate of the last one we already have
      all.push(...more.slice(1));

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
