import { useState, useRef, useEffect } from "react";

const CASES = [
  {
    id: "setup", label: "Setup & connect", icon: "ti-plug",
    tagline: "Authenticate, warm caches, and you're ready",
    primaryObject: "GeotabSDK", method: "new + connect()",
    accentColor: "var(--accent-green-fg)", accentBg: "var(--accent-green-bg)", accentBorder: "var(--accent-green-border)",
    fields: [
      { name: "username / password / database", highlight: false, note: "MyGeotab credentials — required" },
      { name: "server", highlight: false, note: "Optional. Defaults to my.geotab.com" },
      { name: "options.cacheTtlMs", highlight: false, note: "EntityCache TTL. Defaults to 1 hour" },
      { name: "connect({ cacheDevices })", highlight: true, note: "Warms the device cache up front — instant name lookups" },
      { name: "connect({ cacheDiagnostics })", highlight: false, note: "Pre-load Diagnostic definitions" },
    ],
    gotchas: [
      { type: "tip",  text: "Call connect() at startup to fail fast on bad credentials rather than waiting for the first real call to fail." },
      { type: "info", text: "connect() is idempotent — multiple concurrent callers share a single auth round-trip." },
      { type: "tip",  text: "Session expiry is handled transparently. You don't need a re-auth loop." },
    ],
    code: `const { GeotabSDK } = require('geotab-smart-sdk');

const sdk = new GeotabSDK({
  username: process.env.GEOTAB_USER,
  password: process.env.GEOTAB_PASS,
  database: process.env.GEOTAB_DB,
  server:   process.env.GEOTAB_SERVER, // optional
}, {
  cacheTtlMs: 60 * 60 * 1000, // optional
});

// Optional: warm caches up front
await sdk.connect({ cacheDevices: true });

// All helpers are now ready
const fleet = await sdk.fleetSnapshot({ include: { liveStatus: true } });
console.log(fleet.summary);`,
  },
  {
    id: "live", label: "Live tracking (DSI)", icon: "ti-map-pin",
    tagline: "Real-time location, bearing, diagnostics, faults — one multiCall per poll",
    primaryObject: "LiveTracker", method: "sdk.liveTracker()",
    accentColor: "var(--accent-green-fg)", accentBg: "var(--accent-green-bg)", accentBorder: "var(--accent-green-border)",
    fields: [
      { name: ".withDiagnostics([ids])", highlight: true, note: "Enrich each vehicle snapshot with StatusData (use Diagnostics.* constants)" },
      { name: ".withFaults()", highlight: false, note: "Include active fault codes per vehicle" },
      { name: ".forDevices([ids])", highlight: false, note: "Restrict tracking; omit for all devices" },
      { name: ".pollEvery(ms)", highlight: false, note: "Poll interval — minimum 1000 ms" },
      { name: ".on('update', vehicles)", highlight: true, note: "Fires every poll with the merged snapshot" },
      { name: ".on('error', err)", highlight: false, note: "Non-fatal — the poll loop continues" },
      { name: ".start() / .stop()", highlight: false, note: "Lifecycle" },
    ],
    gotchas: [
      { type: "tip",  text: "Each poll is a single multiCall: DeviceStatusInfo + StatusData × N + FaultData. No extra round-trips." },
      { type: "info", text: "Bearing comes from DeviceStatusInfo (the only object that has it). The SDK picks the right object for you." },
      { type: "warn", text: "Builder methods return `this`. Don't forget the trailing .start() — the tracker doesn't poll until you call it." },
      { type: "info", text: "Group filtering isn't a builder yet. Pre-resolve device IDs via sdk.call('Get', { typeName: 'Device', search: { groups: [{ id }] } }) and pass them via .forDevices()." },
    ],
    code: `const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');
const sdk = new GeotabSDK({ /* ... */ });

const tracker = sdk.liveTracker()
  .withDiagnostics([
    Diagnostics.FUEL_LEVEL,
    Diagnostics.ODOMETER,
    Diagnostics.AUX_INPUT_1,
  ])
  .withFaults()
  .forDevices(['b1', 'b2'])   // optional
  .pollEvery(5000);

tracker.on('update', vehicles => {
  for (const v of vehicles) {
    console.log(v.device.name);
    console.log(v.location.bearing);   // heading in degrees
    console.log(v.isDriving, v.isConnected);
    console.log(v.driver?.name);
    console.log(v.diagnostics[Diagnostics.FUEL_LEVEL]?.value);
    console.log(v.faults);              // active DTCs
  }
});
tracker.on('error', err => console.error(err));

await tracker.start();
// ... later:
tracker.stop();`,
  },
  {
    id: "realtime", label: "Realtime tracking (LogRecord)", icon: "ti-broadcast",
    tagline: "Every GPS fix the device emits — bearing/driver/isDriving derived for you",
    primaryObject: "RealtimeTracker", method: "sdk.realtimeTracker()",
    accentColor: "var(--accent-green-fg)", accentBg: "var(--accent-green-bg)", accentBorder: "var(--accent-green-border)",
    fields: [
      { name: ".withDiagnostics([ids])", highlight: false, note: "Latest StatusData per requested Diagnostic" },
      { name: ".withIgnition()", highlight: true, note: "Recommended — adds DiagnosticIgnitionId for accurate isDriving" },
      { name: ".withDriverAttribution()", highlight: true, note: "Recommended — tracks current driver via DriverChange" },
      { name: ".withFaults()", highlight: false, note: "Include active fault codes per vehicle" },
      { name: ".forDevices([ids])", highlight: false, note: "Restrict tracking; omit for all devices" },
      { name: ".pollEvery(ms)", highlight: false, note: "Default 5000 ms. Floor 1000 ms. Warns if < 2000 ms." },
      { name: ".drivingSpeedThreshold(kmh)", highlight: false, note: "Speed above which (with ignition on) → isDriving. Default 5." },
      { name: ".on('update', vehicles)", highlight: true, note: "Each fires with the merged, derived snapshot" },
    ],
    gotchas: [
      { type: "tip",  text: "LogRecord (GetFeed) is updated more frequently than DeviceStatusInfo — Geotab recommends it for higher-fidelity tracking." },
      { type: "info", text: "Bearing is computed via atan2 between consecutive LogRecords. It's null on the first observation per device, then holds steady when stationary." },
      { type: "warn", text: "isDriving depends on ignition state — call .withIgnition() unless a speed-only heuristic is fine for your use case." },
      { type: "info", text: "5s poll uses ~12/min of the 60/min GetFeed limit on LogRecord. Hard floor 1000 ms; below 2000 ms emits a console warning." },
      { type: "info", text: "Group filtering isn't a builder yet. Pre-resolve device IDs via sdk.call('Get', { typeName: 'Device', search: { groups: [{ id }] } }) and pass them via .forDevices()." },
    ],
    code: `const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');
const sdk = new GeotabSDK({ /* ... */ });

const tracker = sdk.realtimeTracker()
  .withDiagnostics([Diagnostics.FUEL_LEVEL])
  .withIgnition()             // recommended
  .withDriverAttribution()    // recommended
  .withFaults()
  .pollEvery(5_000);          // business default

tracker.on('update', vehicles => {
  for (const v of vehicles) {
    console.log(v.device.name);
    console.log(v.location.bearing);  // computed, may be null on first fix
    console.log(v.location.speed);    // null if invalid-speed sentinel
    console.log(v.isDriving);         // from ignition + speed
    console.log(v.driver?.name);      // from DriverChange
    console.log(v.ignition?.value);   // raw ignition reading
    console.log(v.diagnostics[Diagnostics.FUEL_LEVEL]?.value);
    console.log(v.faults);
  }
});
tracker.on('error', err => console.error(err));

await tracker.start();
// ... later:
tracker.stop();`,
  },
  {
    id: "history", label: "Historical query", icon: "ti-route",
    tagline: "GPS + diagnostics + faults + trips — composed, auto-paginated",
    primaryObject: "HistoryQuery", method: "sdk.history() / sdk.historyMany()",
    accentColor: "var(--accent-blue-fg)", accentBg: "var(--accent-blue-bg)", accentBorder: "var(--accent-blue-border)",
    fields: [
      { name: "deviceId", highlight: false, note: "Geotab device ID" },
      { name: "from / to", highlight: false, note: "Date objects bounding the time range" },
      { name: "include.gps", highlight: false, note: "LogRecord GPS trail (default true)" },
      { name: "include.trips", highlight: false, note: "Completed Trip records" },
      { name: "include.faults", highlight: false, note: "FaultData for the window" },
      { name: "include.diagnostics", highlight: false, note: "Array of Diagnostics.* IDs — StatusData per type" },
      { name: "computeBearing", highlight: true, note: "Add bearing to GPS points (LogRecord lacks it natively)" },
    ],
    gotchas: [
      { type: "tip",  text: "Everything is fetched in a single multiCall, then aligned for you." },
      { type: "info", text: "GPS is auto-paginated when the result hits the 50,000 limit. No manual paging code." },
      { type: "tip",  text: "Use historyMany([ids], options) for multiple devices in parallel — each gets its own multiCall." },
    ],
    code: `const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');
const sdk = new GeotabSDK({ /* ... */ });

const data = await sdk.history({
  deviceId: 'b1',
  from: new Date('2024-01-15T00:00:00Z'),
  to:   new Date('2024-01-15T23:59:59Z'),
  include: {
    gps:         true,
    trips:       true,
    faults:      true,
    diagnostics: [Diagnostics.FUEL_LEVEL, Diagnostics.AUX_INPUT_1],
  },
  computeBearing: true,
});

data.gps.forEach(p => console.log(p.latitude, p.longitude, p.bearing));
data.trips.forEach(t => console.log(t.distance, t.maxSpeed));
data.faults.forEach(f => console.log(f.faultState, f.diagnostic?.name));
data.diagnostics[Diagnostics.FUEL_LEVEL]; // StatusData[]

// Parallel across vehicles
const results = await sdk.historyMany(['b1', 'b2', 'b3'], {
  from, to, include: { gps: true, faults: true },
});`,
  },
  {
    id: "snapshot", label: "Fleet snapshot", icon: "ti-dashboard",
    tagline: "Whole-fleet point-in-time picture for dashboards",
    primaryObject: "FleetSnapshot", method: "sdk.fleetSnapshot()",
    accentColor: "var(--accent-amber-fg)", accentBg: "var(--accent-amber-bg)", accentBorder: "var(--accent-amber-border)",
    fields: [
      { name: "include.devices", highlight: false, note: "Device list with names and groups" },
      { name: "include.liveStatus", highlight: false, note: "DeviceStatusInfo — location, bearing, driver, isDriving" },
      { name: "include.activeFaults", highlight: false, note: "Active DTCs per vehicle" },
      { name: "include.diagnostics", highlight: false, note: "Latest StatusData per Diagnostic ID per vehicle" },
      { name: "include.recentTrips", highlight: false, note: "N most recent trips per vehicle (last 7 days)" },
      { name: "groupIds", highlight: false, note: "Partial today: filters Device + liveStatus only. activeFaults / diagnostics / recentTrips fetch fleet-wide and key back client-side." },
      { name: ".summary", highlight: true, note: "Pre-computed counts: total / driving / stopped / disconnected / withActiveFaults" },
    ],
    gotchas: [
      { type: "tip",  text: "Returns Maps keyed by deviceId for O(1) lookup. No manual joins by device." },
      { type: "info", text: ".summary is computed for you. Great for hero counters on a dashboard." },
      { type: "warn", text: "recentTrips fetches the last 7 days globally and groups client-side — heavy fleets may want a custom query." },
    ],
    code: `const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');
const sdk = new GeotabSDK({ /* ... */ });

const fleet = await sdk.fleetSnapshot({
  include: {
    devices:      true,
    liveStatus:   true,
    activeFaults: true,
    diagnostics:  [Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER],
    recentTrips:  3,
  },
  // groupIds: ['groupCompanyId'],  // optional
});

console.log(fleet.summary);
// { total: 45, driving: 12, stopped: 28, disconnected: 5, withActiveFaults: 3 }

fleet.liveStatus.get('b1').bearing;
fleet.faults.get('b1');                                  // FaultData[]
fleet.diagnostics[Diagnostics.FUEL_LEVEL].get('b1').data;
fleet.recentTrips.get('b1');                             // Trip[]`,
  },
  {
    id: "feeds", label: "Continuous sync", icon: "ti-arrows-double-ne-sw",
    tagline: "GetFeed streaming with crash-safe tokens and adaptive polling",
    primaryObject: "FeedManager", method: "sdk.feeds()",
    accentColor: "var(--accent-purple-fg)", accentBg: "var(--accent-purple-bg)", accentBorder: "var(--accent-purple-border)",
    fields: [
      { name: ".addFeed(type, opts)", highlight: false, note: "Register a stream — fromVersion to resume, fromDate to seed" },
      { name: ".on('version', token)", highlight: true, note: "FIRES BEFORE 'data' so you can persist the token — crash safety" },
      { name: ".on('data', records)", highlight: true, note: "New records arrived for this entity type" },
      { name: ".on('error', err)", highlight: false, note: "Non-fatal; the feed backs off and retries" },
      { name: ".setVersion(type, token)", highlight: false, note: "Manually set a resume token" },
      { name: ".getVersion(type)", highlight: false, note: "Read the current token (e.g. on shutdown)" },
      { name: ".start() / .stop()", highlight: false, note: "Lifecycle" },
    ],
    gotchas: [
      { type: "warn", text: "Persist the toVersion token BEFORE processing records. The SDK emits 'version' before 'data' so you can." },
      { type: "info", text: "fromDate is only used on the first call to anchor the start. The SDK drops it from subsequent calls automatically." },
      { type: "tip",  text: "Adaptive polling: immediate after a full batch (more data waiting), back off progressively when empty. No tuning needed." },
    ],
    code: `const { GeotabSDK } = require('geotab-smart-sdk');
const sdk = new GeotabSDK({ /* ... */ });

const saved = await db.loadTokens();

const feeds = sdk.feeds()
  .addFeed('LogRecord',  { fromVersion: saved.LogRecord })
  .addFeed('StatusData', { fromVersion: saved.StatusData })
  .addFeed('FaultData',  { fromDate: new Date('2024-01-15') }); // first run only

// CRITICAL: save the token BEFORE processing
feeds.on('version', (type, token)   => db.saveToken(type, token));
feeds.on('data',    (type, records) => db.insert(type, records));
feeds.on('error',   (type, err)     => logger.error(type, err));

feeds.start();
// ... later:
feeds.stop();`,
  },
];

const COMPARISONS = [
  {
    title: "Session + automatic re-auth",
    raw: `const api = new GeotabApi({ ... }, { rememberMe: true });

// You catch InvalidUserException and re-auth manually:
try {
  await api.call('Get', { typeName: 'Device' });
} catch (err) {
  if (err.code === 'InvalidUserException') {
    await api.authenticate();
    return api.call('Get', { typeName: 'Device' });
  }
  throw err;
}`,
    sdk: `const sdk = new GeotabSDK({ /* ... */ });

// Session expiry is handled inside .call() / .multiCall().
// You just write the call.
await sdk.call('Get', { typeName: 'Device' });`,
    win: "No InvalidUserException loop. No re-auth branching in your code.",
  },
  {
    title: "Live tracking with diagnostics + faults",
    raw: `// Poll DeviceStatusInfo + StatusData(fuel) + FaultData + merge by device.id
setInterval(async () => {
  const [statuses, fuel, faults] = await api.multiCall([
    ['Get', { typeName: 'DeviceStatusInfo', search: {} }],
    ['Get', { typeName: 'StatusData',
              search: { diagnosticSearch: { id: 'DiagnosticFuelLevelId' } } }],
    ['Get', { typeName: 'FaultData',
              search: { faultStates: ['Active'] } }],
  ]);
  const fuelByDev = new Map();
  for (const r of fuel) {
    if (!fuelByDev.has(r.device.id) ||
        new Date(r.dateTime) > new Date(fuelByDev.get(r.device.id).dateTime))
      fuelByDev.set(r.device.id, r);
  }
  const faultsByDev = new Map();
  for (const f of faults) {
    (faultsByDev.get(f.device.id) ?? faultsByDev.set(f.device.id, []).get(f.device.id))
      .push(f);
  }
  // ... finally, walk statuses[]  and stitch everything together
}, 5000);`,
    sdk: `sdk.liveTracker()
  .withDiagnostics([Diagnostics.FUEL_LEVEL])
  .withFaults()
  .pollEvery(5000)
  .on('update', vehicles => {
    // already merged — v.diagnostics[id].value and v.faults[]
  })
  .start();`,
    win: "Fluent builder. Merging, latest-value per device, and fault grouping are built in.",
  },
  {
    title: "GetFeed with crash-safe token rotation",
    raw: `let fromVersion = await db.loadToken('LogRecord');

async function poll() {
  const { data, toVersion } = await api.call('GetFeed', {
    typeName: 'LogRecord', fromVersion, resultsLimit: 50000,
  });
  // Easy to forget: save the token BEFORE processing
  await db.saveToken('LogRecord', toVersion);
  fromVersion = toVersion;
  await process(data);
  // Your own adaptive interval logic:
  const next = data.length >= 50000 ? 0
            : data.length === 0     ? Math.min(prev * 2, 30000)
                                    : 1000;
  setTimeout(poll, next);
}
poll();`,
    sdk: `const feeds = sdk.feeds()
  .addFeed('LogRecord', { fromVersion: await db.loadToken('LogRecord') });

feeds.on('version', (t, token) => db.saveToken(t, token)); // BEFORE data
feeds.on('data',    (t, records) => process(records));
feeds.on('error',   (t, err) => logger.error(t, err));

feeds.start();`,
    win: "Token saved before data event. Adaptive backoff and error backoff handled internally.",
  },
  {
    title: "Historical GPS + fuel level (paginated)",
    raw: `// 1) multiCall LogRecord + StatusData(fuel)
const [page1, fuel] = await api.multiCall([
  ['Get', { typeName: 'LogRecord',
            search: { deviceSearch: { id: 'b1' }, fromDate, toDate },
            resultsLimit: 50000 }],
  ['Get', { typeName: 'StatusData',
            search: { deviceSearch: { id: 'b1' },
                      diagnosticSearch: { id: 'DiagnosticFuelLevelId' },
                      fromDate, toDate } }],
]);

// 2) If LogRecord came back full, page until exhausted...
let all = [...page1];
while (all.length % 50000 === 0 && all.length > 0) {
  const more = await api.call('Get', { typeName: 'LogRecord',
    search: { deviceSearch: { id: 'b1' },
              fromDate: all[all.length - 1].dateTime, toDate } });
  if (!more.length) break;
  all.push(...more.slice(1));
  if (more.length < 50000) break;
}
// 3) Compute bearing yourself, atan2 from consecutive points...`,
    sdk: `const data = await sdk.history({
  deviceId: 'b1', from, to,
  include: { gps: true, diagnostics: [Diagnostics.FUEL_LEVEL] },
  computeBearing: true,
});

data.gps;                            // paginated, with .bearing
data.diagnostics[Diagnostics.FUEL_LEVEL]; // StatusData[]`,
    win: "One call. Auto-pagination. Bearing computed for you.",
  },
  {
    title: "Resolve device names across many lookups",
    raw: `// Load devices once...
const devices = await api.call('Get', { typeName: 'Device' });
const byId = new Map(devices.map(d => [d.id, d]));

// ... and remember to refresh after a while
let loadedAt = Date.now();
function name(id) {
  if (Date.now() - loadedAt > 3600_000) { /* refresh somehow */ }
  return byId.get(id)?.name;
}`,
    sdk: `await sdk.connect({ cacheDevices: true });

// EntityCache (default 1h TTL) is used internally by liveTracker,
// history, fleetSnapshot. Hydrated device names show up automatically.`,
    win: "TTL cache built in. Used internally by helpers — names just appear.",
  },
];

const DIAGNOSTICS = [
  {
    group: "Aux / digital inputs (binary)",
    rows: [
      ["AUX_INPUT_1", "DiagnosticGoInputStatusId",  "0 / 1"],
      ["AUX_INPUT_2", "DiagnosticGoInputStatus2Id", "0 / 1"],
      ["AUX_INPUT_3", "DiagnosticGoInputStatus3Id", "0 / 1"],
      ["AUX_INPUT_4", "DiagnosticGoInputStatus4Id", "0 / 1"],
      ["AUX_INPUT_5", "DiagnosticGoInputStatus5Id", "0 / 1"],
      ["AUX_INPUT_6", "DiagnosticGoInputStatus6Id", "0 / 1"],
    ],
  },
  {
    group: "Engine & powertrain",
    rows: [
      ["ENGINE_HOURS",      "DiagnosticEngineHoursAdjustmentId",        "seconds — / 3600 = h"],
      ["ODOMETER",          "DiagnosticOdometerAdjustmentId",           "metres — / 1000 = km"],
      ["ENGINE_RPM",        "DiagnosticEngineSpeedId",                  "RPM"],
      ["ENGINE_SPEED",      "DiagnosticEngineRoadSpeedId",              "km/h (road speed)"],
      ["THROTTLE_POSITION", "DiagnosticThrottlePositionId",             "%"],
      ["ENGINE_LOAD",       "DiagnosticEngineLoadId",                   "%"],
      ["COOLANT_TEMP",      "DiagnosticEngineCoolantTemperatureId",     "°C"],
      ["OIL_TEMP",          "DiagnosticTransmissionOilTemperatureId",   "°C"],
      ["OIL_PRESSURE",      "DiagnosticOilPressureId",                  "kPa"],
    ],
  },
  {
    group: "Fuel",
    rows: [
      ["FUEL_LEVEL", "DiagnosticFuelLevelId",      "%"],
      ["FUEL_USED",  "DiagnosticFuelUsedId",       "L"],
      ["FUEL_RATE",  "DiagnosticEngineFuelRateId", "L/h"],
    ],
  },
  {
    group: "Electric vehicle",
    rows: [
      ["EV_STATE_OF_CHARGE", "DiagnosticStateOfChargeId",     "%"],
      ["EV_BATTERY_TEMP",    "DiagnosticBatteryTemperatureId", "°C"],
    ],
  },
  {
    group: "Driver behaviour (binary)",
    rows: [
      ["HARSH_BRAKING", "DiagnosticHarshBrakingId",      "0 / 1"],
      ["HARSH_ACCEL",   "DiagnosticHarshAccelerationId", "0 / 1"],
      ["SEAT_BELT",     "DiagnosticSeatBeltId",          "0 = fastened, 1 = unfastened"],
    ],
  },
  {
    group: "Vehicle power",
    rows: [
      ["BATTERY_VOLTAGE", "DiagnosticVehicleBatteryVoltageId", "V"],
      ["IGNITION",        "DiagnosticIgnitionId",              "0 / 1"],
    ],
  },
];

const DIAGNOSTIC_GROUPS = [
  { name: "FLEET_BASICS",  items: ["ODOMETER", "FUEL_LEVEL", "ENGINE_HOURS"] },
  { name: "AUX_INPUTS",    items: ["AUX_INPUT_1", "AUX_INPUT_2", "AUX_INPUT_3", "AUX_INPUT_4"] },
  { name: "ENGINE_HEALTH", items: ["ENGINE_RPM", "COOLANT_TEMP", "OIL_TEMP", "OIL_PRESSURE"] },
  { name: "DRIVER_SAFETY", items: ["HARSH_BRAKING", "HARSH_ACCEL", "SEAT_BELT"] },
  { name: "EV",            items: ["EV_STATE_OF_CHARGE", "EV_BATTERY_TEMP"] },
];

const HELPER_MATRIX = [
  { capability: "Current location",         liveTracker: "✓ live (DSI snapshot)", realtimeTracker: "✓ every GPS fix",       history: "—",                       fleetSnapshot: "✓ liveStatus",  feeds: "—" },
  { capability: "Bearing (heading)",        liveTracker: "✓ native",              realtimeTracker: "✓ computed (atan2)",    history: "computeBearing",          fleetSnapshot: "✓ liveStatus",  feeds: "—" },
  { capability: "Current speed",            liveTracker: "✓",                     realtimeTracker: "✓ from LogRecord",      history: "✓ per LogRecord",         fleetSnapshot: "✓ liveStatus",  feeds: "—" },
  { capability: "High-fidelity tracking",   liveTracker: "—",                     realtimeTracker: "✓ per device fix",      history: "—",                       fleetSnapshot: "—",             feeds: "—" },
  { capability: "isDriving",                liveTracker: "✓ native",              realtimeTracker: "✓ ignition + speed",    history: "—",                       fleetSnapshot: "✓ liveStatus",  feeds: "—" },
  { capability: "Ignition state",           liveTracker: "—",                     realtimeTracker: ".withIgnition()",       history: "—",                       fleetSnapshot: "—",             feeds: "StatusData" },
  { capability: "Driver attribution",       liveTracker: "✓ current",             realtimeTracker: ".withDriverAttribution()", history: "—",                    fleetSnapshot: "✓ liveStatus",  feeds: "—" },
  { capability: "GPS trail (historical)",   liveTracker: "—",                     realtimeTracker: "—",                     history: "✓ paginated",             fleetSnapshot: "—",             feeds: "LogRecord" },
  { capability: "Active faults / DTCs",     liveTracker: ".withFaults()",         realtimeTracker: ".withFaults()",         history: "include.faults",          fleetSnapshot: "activeFaults",  feeds: "FaultData" },
  { capability: "Diagnostics / sensors",    liveTracker: ".withDiagnostics()",    realtimeTracker: ".withDiagnostics()",    history: "include.diagnostics",     fleetSnapshot: "diagnostics",   feeds: "StatusData" },
  { capability: "Trips",                    liveTracker: "—",                     realtimeTracker: "—",                     history: "include.trips",           fleetSnapshot: "recentTrips",   feeds: "Trip" },
  { capability: "Fleet summary counts",     liveTracker: "—",                     realtimeTracker: "—",                     history: "—",                       fleetSnapshot: "✓ .summary",    feeds: "—" },
  { capability: "Continuous sync",          liveTracker: "—",                     realtimeTracker: "—",                     history: "—",                       fleetSnapshot: "—",             feeds: "✓ adaptive" },
  { capability: "Filter by group",          liveTracker: "via forDevices",        realtimeTracker: "via forDevices",        history: "via historyMany",         fleetSnapshot: "groupIds (partial)", feeds: "—" },
  { capability: "Device names hydrated",    liveTracker: "✓",                     realtimeTracker: "✓",                     history: "—",                       fleetSnapshot: "via cache",     feeds: "—" },
  { capability: "Connectivity state",       liveTracker: "✓ isConnected",         realtimeTracker: "✓ from recency",        history: "—",                       fleetSnapshot: "✓ summary",     feeds: "—" },
];

const CHEAT_SECTIONS = [
  {
    title: "Construction & lifecycle",
    code: `const sdk = new GeotabSDK({
  username, password, database,
  server,           // optional, default 'my.geotab.com'
}, {
  cacheTtlMs,       // optional, default 1h
});

await sdk.connect({ cacheDevices?, cacheDiagnostics? });`,
  },
  {
    title: "Raw access (escape hatch)",
    code: `await sdk.call(method, params);
await sdk.multiCall([['method', params], ...]);
// Auto re-auth + rate-limit retry under the hood.`,
  },
  {
    title: "Live tracker (DeviceStatusInfo)",
    code: `const tracker = sdk.liveTracker()
  .withDiagnostics([ids])  .withFaults()
  .forDevices([ids])       .pollEvery(ms)
  .on('update', vehicles => { /* ... */ })
  .on('error',  err      => { /* ... */ });
await tracker.start();
tracker.stop();

// vehicles[i]:
//   { device:{id,name,serialNumber},
//     location:{latitude,longitude,bearing,speed},
//     isDriving, isConnected, driver, activeAlerts,
//     currentStateDuration, dateTime,
//     diagnostics:{ [id]:{value,dateTime} }, faults:[] }`,
  },
  {
    title: "Realtime tracker (LogRecord)",
    code: `const tracker = sdk.realtimeTracker()
  .withDiagnostics([ids])
  .withIgnition()             // recommended
  .withDriverAttribution()    // recommended
  .withFaults()
  .forDevices([ids])
  .pollEvery(5_000)           // default; floor 1000ms; warn < 2000ms
  .drivingSpeedThreshold(5)   // km/h
  .on('update', vehicles => { /* ... */ })
  .on('error',  err      => { /* ... */ });
await tracker.start();
tracker.stop();

// vehicles[i]: LiveTracker shape +
//   { ignition:{value,dateTime}|null, source:'logrecord' }
// bearing computed via atan2 between consecutive LogRecords (null at first fix)`,
  },
  {
    title: "Historical query",
    code: `const data = await sdk.history({
  deviceId, from, to,
  include: { gps?, trips?, faults?, diagnostics?: [ids] },
  computeBearing?
});
// → { deviceId, period, gps, trips, faults, diagnostics:{ [id]: StatusData[] } }

const results = await sdk.historyMany([ids], options);`,
  },
  {
    title: "Fleet snapshot",
    code: `const fleet = await sdk.fleetSnapshot({
  include: { devices?, liveStatus?, activeFaults?,
             diagnostics?: [ids], recentTrips?: N },
  groupIds?
});
// → { devices, liveStatus: Map, faults: Map,
//     diagnostics: { [id]: Map }, recentTrips: Map,
//     summary: { total, driving, stopped,
//                disconnected, withActiveFaults } }`,
  },
  {
    title: "Feeds (GetFeed streaming)",
    code: `const feeds = sdk.feeds()
  .addFeed(type, { fromVersion?, fromDate?, resultsLimit?, search? })
  .on('version', (type, token)   => /* persist BEFORE 'data' */)
  .on('data',    (type, records) => /* process */)
  .on('error',   (type, err)     => /* log; loop continues */);
feeds.start();  feeds.stop();
feeds.setVersion(type, token);  feeds.getVersion(type);`,
  },
  {
    title: "Errors",
    code: `try {
  await sdk.call('Get', { typeName: 'Device' });
} catch (err) {
  err.code;     // 'InvalidUserException' | 'OverLimitException' | ...
  err.context;  // 'Get' | 'multiCall' | ...
  err.raw;      // original mg-api-js error
}`,
  },
];

const SYSTEM_PROMPT = `You are an expert on the geotab-smart-sdk Node.js package. The SDK wraps mg-api-js with use-case-driven helpers.

Surface:
- new GeotabSDK({ username, password, database, server? }, { cacheTtlMs? })
- sdk.connect({ cacheDevices?, cacheDiagnostics? }) — idempotent; safe to call multiple times
- sdk.call(method, params), sdk.multiCall([[method, params], ...]) — auto re-auth + rate-limit retry
- sdk.liveTracker() — DeviceStatusInfo-based. Fluent: .withDiagnostics([ids]), .withFaults(), .forDevices([ids]), .pollEvery(ms), .start(), .stop(). Events: 'update' (vehicles), 'error' (err). Each poll is a single multiCall. Use for dashboards / one-snapshot-per-vehicle.
- sdk.realtimeTracker() — LogRecord (GetFeed)-based. Same fluent surface plus .withIgnition(), .withDriverAttribution(), .drivingSpeedThreshold(kmh), .startingFrom(date). Default pollEvery(5000); hard floor 1000ms; soft warning < 2000ms. Bearing computed via atan2 between consecutive LogRecord points (null on the first observation per device, holds steady when stationary). isDriving = ignition-on AND speed > threshold (or speed-only if ignition unknown). Driver field tracked via DriverChange (type 'Driver'). Use for high-fidelity / every-fix tracking.
- sdk.history({ deviceId, from, to, include: { gps?, trips?, faults?, diagnostics?: [ids] }, computeBearing? }) — single multiCall, auto-paginated GPS.
- sdk.historyMany([ids], options) — parallel.
- sdk.fleetSnapshot({ include: { devices?, liveStatus?, activeFaults?, diagnostics?: [ids], recentTrips?: N }, groupIds? }) — returns Maps + pre-computed summary.
- sdk.feeds() — FeedManager. .addFeed(type, { fromVersion?, fromDate?, resultsLimit?, search? }). Events: 'version' (fires BEFORE 'data' — persist tokens first), 'data', 'error'. .setVersion / .getVersion / .start / .stop.
- Diagnostics.*: FUEL_LEVEL, ODOMETER, ENGINE_HOURS, ENGINE_RPM, ENGINE_SPEED, AUX_INPUT_1..6, FUEL_RATE, BATTERY_VOLTAGE, COOLANT_TEMP, OIL_TEMP, OIL_PRESSURE, EV_STATE_OF_CHARGE, EV_BATTERY_TEMP, HARSH_BRAKING, HARSH_ACCEL, SEAT_BELT, THROTTLE_POSITION, ENGINE_LOAD, IGNITION.
- DiagnosticGroups: FLEET_BASICS, AUX_INPUTS, ENGINE_HEALTH, DRIVER_SAFETY, EV.
- DiagnosticLabels: reverse lookup ID → human label.

Behaviors to highlight when answering:
- Session expiry handled transparently (no InvalidUserException loop).
- OverLimitException caught, Retry-After honored, retried once.
- LiveTracker uses DeviceStatusInfo so bearing is always available.
- HistoryQuery auto-paginates GPS at the 50,000 limit and computes bearing from consecutive points.
- FeedManager emits 'version' BEFORE 'data' so tokens persist before processing — crash-safe.
- EntityCache (1h TTL) used for Device, Diagnostic, etc.

Errors surface as err.code, err.context, err.raw. Be concise; give JavaScript code in geotab-smart-sdk style unless the user explicitly asks for raw mg-api-js.`;

function CopyBtn({ id, text, copiedId, onCopy }) {
  const active = copiedId === id;
  return (
    <button
      onClick={() => onCopy(id, text)}
      style={{
        position: "absolute", top: 10, right: 10,
        background: active ? "#0F6E56" : "rgba(255,255,255,0.1)",
        color: active ? "#fff" : "rgba(255,255,255,0.7)",
        border: "0.5px solid rgba(255,255,255,0.2)",
        borderRadius: 6, padding: "4px 10px",
        fontSize: 12, cursor: "pointer", transition: "all 0.2s",
        fontFamily: "var(--font-mono)",
      }}
    >
      <i className={`ti ${active ? "ti-check" : "ti-copy"}`} style={{ marginRight: 4 }} aria-hidden="true" />
      {active ? "copied" : "copy"}
    </button>
  );
}

function CodeBlock({ code, id, copiedId, onCopy }) {
  return (
    <div style={{ position: "relative", marginTop: 12 }}>
      <pre style={{
        background: "#0f1117", color: "#e2e8f0",
        borderRadius: 8, padding: 14,
        fontSize: 12.5, lineHeight: 1.65, overflowX: "auto",
        fontFamily: "var(--font-mono)", margin: 0,
        border: "0.5px solid rgba(255,255,255,0.08)",
      }}>
        <code>{code}</code>
      </pre>
      <CopyBtn id={id} text={code} copiedId={copiedId} onCopy={onCopy} />
    </div>
  );
}

function Badge({ children, color, bg }) {
  return (
    <span style={{
      background: bg, color: color,
      fontSize: 11, fontWeight: 500, padding: "2px 8px",
      borderRadius: 4, fontFamily: "var(--font-mono)",
    }}>
      {children}
    </span>
  );
}

function MatrixCell({ val }) {
  if (val === "—") {
    return <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>—</span>;
  }
  if (val.startsWith("✓")) {
    return <span style={{ color: "var(--accent-green-fg)", fontWeight: 500, fontSize: 13 }}>{val}</span>;
  }
  return <code style={{ color: "var(--color-text-secondary)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{val}</code>;
}

function GotchaIcon({ type }) {
  const map = {
    warn: { icon: "ti-alert-triangle", color: "var(--accent-amber-fg)" },
    info: { icon: "ti-info-circle",    color: "var(--accent-blue-fg)" },
    tip:  { icon: "ti-bulb",           color: "var(--accent-green-fg)" },
  };
  const m = map[type] || map.info;
  return <i className={`ti ${m.icon}`} style={{ color: m.color, fontSize: 14, marginTop: 1, flexShrink: 0 }} aria-hidden="true" />;
}

export default function GeotabSmartSdkInspector() {
  const [tab, setTab] = useState("usecases");
  const [caseId, setCaseId] = useState("setup");
  const [msgs, setMsgs] = useState([{
    role: "assistant",
    content: "Hi! Ask me anything about geotab-smart-sdk — which helper to use, how to wire up feeds, named diagnostics, error handling, or migration from raw mg-api-js.",
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [cmpIdx, setCmpIdx] = useState(0);
  const chatRef = useRef(null);

  const activeCase = CASES.find(c => c.id === caseId);

  function copyCode(id, text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  async function sendMsg() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim() };
    const next = [...msgs, userMsg];
    setMsgs(next); setInput(""); setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: SYSTEM_PROMPT, messages: next }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "Error getting response.";
      setMsgs([...next, { role: "assistant", content: text }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: "Error: " + e.message }]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs]);

  const tabs = [
    { id: "usecases",  label: "Use cases",    icon: "ti-template" },
    { id: "helpermap", label: "Helper map",   icon: "ti-table" },
    { id: "vsraw",     label: "vs raw API",   icon: "ti-arrows-right-left" },
    { id: "diags",     label: "Diagnostics",  icon: "ti-gauge" },
    { id: "cheat",     label: "Cheat sheet",  icon: "ti-list-details" },
    { id: "ask",       label: "Ask Claude",   icon: "ti-message-circle" },
  ];

  const tabStyle = (id) => ({
    display: "flex", alignItems: "center", gap: 6,
    padding: "8px 14px", borderRadius: 6, cursor: "pointer",
    fontSize: 13.5, fontWeight: tab === id ? 500 : 400,
    background: tab === id ? "var(--color-background-primary)" : "transparent",
    color: tab === id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
    border: tab === id ? "0.5px solid var(--color-border-secondary)" : "0.5px solid transparent",
    transition: "all 0.15s", userSelect: "none",
  });

  return (
    <div className="geotab-inspector" style={{ fontFamily: "var(--font-sans)", minHeight: 640 }}>
      <h2 className="sr-only">geotab-smart-sdk Inspector — use-case driven reference for the SDK</h2>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 14, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "#0F6E56", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="ti ti-sparkles" style={{ color: "#fff", fontSize: 18 }} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-primary)" }}>geotab-smart-sdk Inspector</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Use-case driven reference · v1.0.0</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <a
            href="https://www.npmjs.com/package/geotab-smart-sdk"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
          >
            <i className="ti ti-brand-npm" aria-hidden="true" />npm
          </a>
          <a
            href="https://developers.geotab.com/myGeotab/apiReference/methods/"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
          >
            <i className="ti ti-external-link" aria-hidden="true" />Geotab docs
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap", background: "var(--color-background-secondary)", padding: 4, borderRadius: 8 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(t.id)}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />{t.label}
          </button>
        ))}
      </div>

      {/* ── Use cases ─────────────────────────────────────────────────────── */}
      {tab === "usecases" && (
        <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: 16, minHeight: 500 }}>
          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {CASES.map(c => (
              <button
                key={c.id}
                onClick={() => setCaseId(c.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 12px", borderRadius: 7, cursor: "pointer", textAlign: "left",
                  background: caseId === c.id ? c.accentBg : "transparent",
                  color: caseId === c.id ? c.accentColor : "var(--color-text-secondary)",
                  border: `0.5px solid ${caseId === c.id ? c.accentBorder : "transparent"}`,
                  fontSize: 13, fontWeight: caseId === c.id ? 500 : 400, transition: "all 0.15s",
                }}
              >
                <i className={`ti ${c.icon}`} style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          {/* Detail */}
          {activeCase && (
            <div>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>{activeCase.label}</div>
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 2 }}>{activeCase.tagline}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Badge color={activeCase.accentColor} bg={activeCase.accentBg}>{activeCase.primaryObject}</Badge>
                  <Badge color="var(--color-text-secondary)" bg="var(--color-background-secondary)">{activeCase.method}</Badge>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>What you configure</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {activeCase.fields.map((f, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "7px 10px", borderRadius: 6,
                      background: f.highlight ? activeCase.accentBg : "var(--color-background-secondary)",
                      border: f.highlight ? `0.5px solid ${activeCase.accentBorder}` : "0.5px solid transparent",
                    }}>
                      <code style={{
                        fontSize: 12.5, fontFamily: "var(--font-mono)",
                        color: f.highlight ? activeCase.accentColor : "var(--color-text-primary)",
                        fontWeight: f.highlight ? 500 : 400,
                        minWidth: 220, flexShrink: 0,
                      }}>{f.name}</code>
                      <span style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>{f.note}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Gotchas & tips</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activeCase.gotchas.map((g, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", background: "var(--color-background-secondary)", borderRadius: 6 }}>
                      <GotchaIcon type={g.type} />
                      <span style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5 }}>{g.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Code snippet</div>
                <CodeBlock code={activeCase.code} id={`sdk-case-${activeCase.id}`} copiedId={copiedId} onCopy={copyCode} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Helper map ────────────────────────────────────────────────────── */}
      {tab === "helpermap" && (
        <div>
          <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
            Which SDK helper produces which data? Use this when you're staring at the four entry points and trying to pick one.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Capability", "liveTracker", "realtimeTracker", "history", "fleetSnapshot", "feeds"].map((h, i) => (
                    <th key={h} style={{
                      padding: "8px 10px", textAlign: "left", fontSize: 12,
                      fontWeight: 500, color: "var(--color-text-secondary)",
                      background: "var(--color-background-secondary)",
                      borderBottom: "0.5px solid var(--color-border-tertiary)",
                      fontFamily: i > 0 ? "var(--font-mono)" : "var(--font-sans)",
                      whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HELPER_MATRIX.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "9px 10px", fontSize: 13, color: "var(--color-text-primary)" }}>{row.capability}</td>
                    <td style={{ padding: "9px 10px" }}><MatrixCell val={row.liveTracker} /></td>
                    <td style={{ padding: "9px 10px" }}><MatrixCell val={row.realtimeTracker} /></td>
                    <td style={{ padding: "9px 10px" }}><MatrixCell val={row.history} /></td>
                    <td style={{ padding: "9px 10px" }}><MatrixCell val={row.fleetSnapshot} /></td>
                    <td style={{ padding: "9px 10px" }}><MatrixCell val={row.feeds} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "var(--accent-green-fg)" }}>✓ — supported directly</div>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>— — not available; use a different helper</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>method / option — supported via this config</div>
          </div>
          <div style={{
            marginTop: 18, padding: "12px 14px",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <i className="ti ti-info-circle" style={{ color: "var(--accent-blue-fg)", fontSize: 16, marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              Need an entity type not covered above? Drop down to <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>sdk.call()</code> or <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>sdk.multiCall()</code> — auto re-auth and rate-limit retry still apply. See the <strong style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>Cheat sheet</strong> tab.
            </div>
          </div>
        </div>
      )}

      {/* ── vs raw API ────────────────────────────────────────────────────── */}
      {tab === "vsraw" && (
        <div>
          <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
            The same task expressed in raw <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>mg-api-js</code> and in <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>geotab-smart-sdk</code>. The SDK never hides the underlying API — it just collapses the boilerplate you'd otherwise write yourself.
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {COMPARISONS.map((c, i) => (
              <button
                key={i}
                onClick={() => setCmpIdx(i)}
                style={{
                  padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                  background: cmpIdx === i ? "#0F6E56" : "var(--color-background-secondary)",
                  color: cmpIdx === i ? "#fff" : "var(--color-text-secondary)",
                  border: `0.5px solid ${cmpIdx === i ? "#0F6E56" : "var(--color-border-tertiary)"}`,
                  fontWeight: cmpIdx === i ? 500 : 400,
                }}
              >
                {c.title}
              </button>
            ))}
          </div>

          {(() => {
            const c = COMPARISONS[cmpIdx];
            return (
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>{c.title}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 14, lineHeight: 1.6 }}>
                  <i className="ti ti-bulb" style={{ color: "var(--accent-green-fg)", fontSize: 14, marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                  <span><b style={{ fontWeight: 500 }}>SDK win:</b> {c.win}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Raw mg-api-js</div>
                    <CodeBlock code={c.raw} id={`cmp-raw-${cmpIdx}`} copiedId={copiedId} onCopy={copyCode} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--accent-green-fg)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>geotab-smart-sdk</div>
                    <CodeBlock code={c.sdk} id={`cmp-sdk-${cmpIdx}`} copiedId={copiedId} onCopy={copyCode} />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Diagnostics ───────────────────────────────────────────────────── */}
      {tab === "diags" && (
        <div>
          <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
            Named constants for the Geotab Diagnostic IDs you'll use most. Import from <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>geotab-smart-sdk</code>:
          </div>
          <CodeBlock
            code={`const { Diagnostics, DiagnosticGroups, DiagnosticLabels } = require('geotab-smart-sdk');\n\nDiagnostics.FUEL_LEVEL;  // 'DiagnosticFuelLevelId'\nDiagnosticGroups.FLEET_BASICS;  // [ODOMETER, FUEL_LEVEL, ENGINE_HOURS]\nDiagnosticLabels[Diagnostics.FUEL_LEVEL];  // 'fuel level'`}
            id="diags-import"
            copiedId={copiedId}
            onCopy={copyCode}
          />

          {DIAGNOSTICS.map((group, gi) => (
            <div key={gi} style={{ marginTop: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{group.group}</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Constant", "Geotab ID", "Units"].map(h => (
                        <th key={h} style={{
                          padding: "8px 10px", textAlign: "left", fontSize: 12,
                          fontWeight: 500, color: "var(--color-text-secondary)",
                          background: "var(--color-background-secondary)",
                          borderBottom: "0.5px solid var(--color-border-tertiary)",
                          whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(([name, id, units], ri) => (
                      <tr key={ri} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                        <td style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--accent-green-fg)", fontWeight: 500 }}>{name}</td>
                        <td style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>{id}</td>
                        <td style={{ padding: "9px 10px", fontSize: 12.5, color: "var(--color-text-secondary)" }}>{units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 26 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 10 }}>Pre-built groups</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {DIAGNOSTIC_GROUPS.map((g, i) => (
                <div key={i} style={{
                  display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
                  padding: "8px 10px", background: "var(--color-background-secondary)", borderRadius: 6,
                }}>
                  <code style={{
                    fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 500,
                    color: "var(--accent-green-fg)", minWidth: 150,
                  }}>
                    DiagnosticGroups.{g.name}
                  </code>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>
                    [{g.items.join(", ")}]
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Cheat sheet ───────────────────────────────────────────────────── */}
      {tab === "cheat" && (
        <div>
          <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
            One-page reference. Optional arguments are marked with <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>?</code>.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 14 }}>
            {CHEAT_SECTIONS.map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  {s.title}
                </div>
                <CodeBlock code={s.code} id={`cheat-${i}`} copiedId={copiedId} onCopy={copyCode} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Ask Claude ────────────────────────────────────────────────────── */}
      {tab === "ask" && (
        <div style={{ display: "flex", flexDirection: "column", height: 480 }}>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
            Ask anything about <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>geotab-smart-sdk</code> — which helper to use, how to wire up feeds, diagnostic constants, error handling, or migration from raw mg-api-js.
          </div>

          {msgs.length <= 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                "How do I migrate from raw mg-api-js to the SDK?",
                "What's the right way to handle GetFeed token persistence?",
                "How do I get the active fault codes for one vehicle?",
                "How do I add a custom diagnostic ID not in Diagnostics.*?",
              ].map(q => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  style={{
                    padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                    fontSize: 12.5, background: "var(--color-background-secondary)",
                    color: "var(--color-text-secondary)",
                    border: "0.5px solid var(--color-border-secondary)",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div ref={chatRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 8 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "82%",
                background: m.role === "user" ? "#0F6E56" : "var(--color-background-secondary)",
                color: m.role === "user" ? "#fff" : "var(--color-text-primary)",
                borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                padding: "10px 14px", fontSize: 13.5, lineHeight: 1.65,
                border: m.role === "assistant" ? "0.5px solid var(--color-border-tertiary)" : "none",
                whiteSpace: "pre-wrap",
              }}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: "flex-start", background: "var(--color-background-secondary)", borderRadius: "12px 12px 12px 4px", padding: "10px 14px", border: "0.5px solid var(--color-border-tertiary)" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {[0, 1, 2].map(j => (
                    <div key={j} style={{
                      width: 6, height: 6, borderRadius: "50%", background: "#0F6E56",
                      animation: `geotab-bounce 1s ${j * 0.15}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 12 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMsg()}
              placeholder="Ask about geotab-smart-sdk…"
              aria-label="Ask about geotab-smart-sdk"
              style={{
                flex: 1, fontSize: 13.5, padding: "9px 12px", borderRadius: 8,
                background: "var(--color-background-primary)",
                color: "var(--color-text-primary)",
                border: "0.5px solid var(--color-border-secondary)",
                fontFamily: "var(--font-sans)", boxSizing: "border-box", outline: "none",
              }}
            />
            <button
              onClick={sendMsg}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              style={{
                padding: "9px 16px", borderRadius: 8,
                cursor: (loading || !input.trim()) ? "not-allowed" : "pointer",
                background: loading ? "var(--color-background-secondary)" : "#0F6E56",
                color: loading ? "var(--color-text-secondary)" : "#fff",
                border: "0.5px solid " + (loading ? "var(--color-border-secondary)" : "#0F6E56"),
                fontSize: 13.5, fontWeight: 500,
                opacity: (!input.trim() || loading) ? 0.5 : 1,
              }}
            >
              <i className="ti ti-send" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <style>{`
        .geotab-inspector {
          --accent-green-fg:      #0F6E56;
          --accent-green-bg:      #E1F5EE;
          --accent-green-border:  #0F6E5644;
          --accent-blue-fg:       #185FA5;
          --accent-blue-bg:       #E6F1FB;
          --accent-blue-border:   #185FA544;
          --accent-amber-fg:      #854F0B;
          --accent-amber-bg:      #FAEEDA;
          --accent-amber-border:  #854F0B44;
          --accent-red-fg:        #A32D2D;
          --accent-red-bg:        #FCEBEB;
          --accent-red-border:    #A32D2D44;
          --accent-purple-fg:     #534AB7;
          --accent-purple-bg:     #EEEDFE;
          --accent-purple-border: #534AB744;
        }
        @media (prefers-color-scheme: dark) {
          .geotab-inspector {
            --accent-green-fg:      #5EE0B7;
            --accent-green-bg:      rgba(94, 224, 183, 0.10);
            --accent-green-border:  rgba(94, 224, 183, 0.35);
            --accent-blue-fg:       #7BB6F2;
            --accent-blue-bg:       rgba(123, 182, 242, 0.10);
            --accent-blue-border:   rgba(123, 182, 242, 0.35);
            --accent-amber-fg:      #E5B26B;
            --accent-amber-bg:      rgba(229, 178, 107, 0.10);
            --accent-amber-border:  rgba(229, 178, 107, 0.35);
            --accent-red-fg:        #F08A8A;
            --accent-red-bg:        rgba(240, 138, 138, 0.10);
            --accent-red-border:    rgba(240, 138, 138, 0.35);
            --accent-purple-fg:     #A8A0F5;
            --accent-purple-bg:     rgba(168, 160, 245, 0.10);
            --accent-purple-border: rgba(168, 160, 245, 0.35);
          }
        }
        @keyframes geotab-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%           { transform: scale(1);   opacity: 1;   }
        }
        .geotab-inspector button { font-family: var(--font-sans); }
        .geotab-inspector .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
      `}</style>
    </div>
  );
}
