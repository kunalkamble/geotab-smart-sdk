import { useState, useRef, useEffect } from "react";

const CASES = [
  {
    id: "live", label: "Live vehicle location", icon: "ti-map-pin",
    tagline: "Position, bearing & driver — right now",
    primaryObject: "DeviceStatusInfo", method: "Get / GetFeed",
    accentColor: "var(--accent-green-fg)", accentBg: "var(--accent-green-bg)", accentBorder: "var(--accent-green-border)",
    fields: [
      { name: "Latitude / Longitude", highlight: false, note: "Current coordinates" },
      { name: "Bearing", highlight: true, note: "Heading in degrees 0-360 — ONLY in this object" },
      { name: "Speed", highlight: false, note: "Current km/h" },
      { name: "IsDriving", highlight: false, note: "Boolean — is the vehicle moving right now?" },
      { name: "IsDeviceCommunicating", highlight: false, note: "True if device has checked in recently" },
      { name: "Driver", highlight: false, note: "Currently identified driver object" },
      { name: "ExceptionEvents", highlight: false, note: "Currently active alert rules" },
      { name: "StatusData", highlight: false, note: "Latest diagnostic snapshots (fuel, inputs…)" },
    ],
    gotchas: [
      { type: "warn", text: "Bearing ONLY exists here — LogRecord does NOT have it. Many devs miss this." },
      { type: "info", text: "Returns one latest snapshot per vehicle, not a time series." },
      { type: "tip",  text: "Use GetFeed(DeviceStatusInfo) to stream real-time position updates efficiently." },
    ],
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

(async () => {
  await api.authenticate();

  // ✅ DeviceStatusInfo — live location with bearing
  const statuses = await api.call('Get', {
    typeName: 'DeviceStatusInfo',
    search: {}  // or filter by groups: [{ id: 'GroupCompanyId' }]
  });

  // What you get per vehicle:
  // status.latitude, status.longitude  → position
  // status.bearing                     → heading (0-360°) ← unique to this object
  // status.speed                       → current speed km/h
  // status.isDriving                   → true if moving
  // status.driver.id                   → driver if identified
  // status.isDeviceCommunicating       → connectivity status

  // ❌ Avoid using LogRecord for live tracking
  //    It has no bearing and no isDriving state
})();`,
  },
  {
    id: "history", label: "Historical GPS trail", icon: "ti-route",
    tagline: "GPS points over a time range",
    primaryObject: "LogRecord", method: "Get / GetFeed",
    accentColor: "var(--accent-blue-fg)", accentBg: "var(--accent-blue-bg)", accentBorder: "var(--accent-blue-border)",
    fields: [
      { name: "DateTime", highlight: false, note: "UTC timestamp of each GPS fix" },
      { name: "Latitude / Longitude", highlight: false, note: "Position at that moment" },
      { name: "Speed", highlight: true, note: "km/h — can be -1 (InvalidSpeed), always validate" },
      { name: "Device", highlight: false, note: "Reference to the vehicle" },
    ],
    gotchas: [
      { type: "warn", text: "No bearing — calculate from consecutive points using atan2 if needed." },
      { type: "warn", text: "Speed can be -1 (InvalidSpeed) — always check before using in calculations." },
      { type: "info", text: "Max 50,000 records per request. Paginate with fromDate offsets for long ranges." },
      { type: "tip",  text: "For continuous sync, use GetFeed — it uses version tokens instead of date ranges." },
    ],
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

// Compute bearing from consecutive points (no built-in field):
function calcBearing(p1, p2) {
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
  const lat1 = p1.latitude * Math.PI / 180;
  const lat2 = p2.latitude * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

(async () => {
  await api.authenticate();

  // Get historical GPS for a vehicle and date range
  const gps = await api.call('Get', {
    typeName: 'LogRecord',
    search: {
      deviceSearch: { id: 'b1' },
      fromDate: '2024-01-15T00:00:00.000Z',
      toDate:   '2024-01-15T23:59:59.000Z'
    },
    resultsLimit: 50000  // hard max
  });

  // Continuous streaming via GetFeed:
  let fromVersion = null;
  const feed = await api.call('GetFeed', {
    typeName: 'LogRecord', fromVersion, resultsLimit: 50000
  });
  fromVersion = feed.toVersion; // save this for next poll
})();`,
  },
  {
    id: "diagnostics", label: "Diagnostics & sensor data", icon: "ti-settings-2",
    tagline: "Odometer, fuel, aux inputs, engine hours",
    primaryObject: "StatusData", method: "Get / GetFeed",
    accentColor: "var(--accent-amber-fg)", accentBg: "var(--accent-amber-bg)", accentBorder: "var(--accent-amber-border)",
    fields: [
      { name: "DateTime", highlight: false, note: "When this reading was recorded" },
      { name: "Data", highlight: true, note: "The sensor value — units depend entirely on the Diagnostic" },
      { name: "Device", highlight: false, note: "The vehicle" },
      { name: "Diagnostic", highlight: false, note: "Defines what 'Data' means — ALWAYS filter by this" },
    ],
    gotchas: [
      { type: "warn", text: "Always filter by diagnosticSearch ID — without it you get every sensor value ever recorded." },
      { type: "info", text: "Aux input 1 = DiagnosticGoInputStatusId (value 0 or 1)." },
      { type: "info", text: "Aux inputs 2/3/4 = DiagnosticGoInputStatus2Id, 3Id, 4Id." },
      { type: "tip",  text: "DeviceStatusInfo.StatusData gives a snapshot of latest values — use that for dashboards." },
    ],
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

// Common Diagnostic IDs:
// DiagnosticGoInputStatusId          → Aux input 1  (0=off, 1=on)
// DiagnosticGoInputStatus2Id         → Aux input 2
// DiagnosticGoInputStatus3Id         → Aux input 3
// DiagnosticGoInputStatus4Id         → Aux input 4
// DiagnosticOdometerAdjustmentId     → Odometer (metres)
// DiagnosticEngineHoursAdjustmentId  → Engine hours (seconds)
// DiagnosticFuelLevelId              → Fuel level (%)

(async () => {
  await api.authenticate();

  // Get aux input 1 state for all vehicles
  const auxData = await api.call('Get', {
    typeName: 'StatusData',
    search: {
      diagnosticSearch: { id: 'DiagnosticGoInputStatusId' },
      fromDate: new Date(Date.now() - 3_600_000).toISOString()
    }
  });
  // auxData[i].data === 1 → input ON
  // auxData[i].data === 0 → input OFF

  // Get latest odometer for a specific vehicle
  const odo = await api.call('Get', {
    typeName: 'StatusData',
    search: {
      deviceSearch: { id: 'b1' },
      diagnosticSearch: { id: 'DiagnosticOdometerAdjustmentId' }
    },
    resultsLimit: 1
  });
  // odo[0].data / 1000 → km
})();`,
  },
  {
    id: "faults", label: "Fault codes (DTCs)", icon: "ti-alert-hexagon",
    tagline: "OBD-II / J1939 fault codes and DTCs",
    primaryObject: "FaultData", method: "Get / GetFeed",
    accentColor: "var(--accent-red-fg)", accentBg: "var(--accent-red-bg)", accentBorder: "var(--accent-red-border)",
    fields: [
      { name: "DateTime", highlight: false, note: "When the fault was triggered" },
      { name: "FaultState", highlight: true, note: "Active | Pending | NotActive — filter by this" },
      { name: "Diagnostic", highlight: false, note: "Fault definition: name, code, source" },
      { name: "FailureMode", highlight: false, note: "J1939 FMI / OBD SPN context" },
      { name: "AmberWarningLamp", highlight: false, note: "True if MIL (malfunction indicator lamp) is on" },
      { name: "Count", highlight: false, note: "Occurrence count for this fault" },
    ],
    gotchas: [
      { type: "tip",  text: "Filter faultStates: ['Active'] to show only current faults — not historical ones." },
      { type: "info", text: "diagnostic.name gives the human-readable description; diagnostic.code is the numeric code." },
      { type: "warn", text: "GetFeed(FaultData) only filters by FromDate — DeviceSearch is ignored in feed mode." },
    ],
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

(async () => {
  await api.authenticate();

  // Get active fault codes for a vehicle
  const faults = await api.call('Get', {
    typeName: 'FaultData',
    search: {
      deviceSearch: { id: 'b1' },
      faultStates: ['Active']  // Active | Pending | NotActive
    }
  });

  // faults[i].diagnostic.name   → "Engine Coolant Temperature"
  // faults[i].diagnostic.code   → 110
  // faults[i].faultState        → 'Active'
  // faults[i].amberWarningLamp  → true (MIL on)
  // faults[i].count             → 3 (occurred 3 times)

  // Real-time fault monitoring via GetFeed:
  let fromVersion = null;
  const feed = await api.call('GetFeed', {
    typeName: 'FaultData', fromVersion
  });
  fromVersion = feed.toVersion;
})();`,
  },
  {
    id: "trips", label: "Trip history", icon: "ti-car",
    tagline: "Completed trips: start/stop, distance, driver",
    primaryObject: "Trip", method: "Get / GetFeed",
    accentColor: "var(--accent-purple-fg)", accentBg: "var(--accent-purple-bg)", accentBorder: "var(--accent-purple-border)",
    fields: [
      { name: "Start / Stop", highlight: false, note: "Trip timestamps in UTC" },
      { name: "Distance", highlight: false, note: "km driven for this trip" },
      { name: "MaxSpeed / AverageSpeed", highlight: false, note: "km/h" },
      { name: "Driver", highlight: false, note: "Driver identified for this trip" },
      { name: "StartLatitude/Longitude", highlight: false, note: "Origin coordinates" },
      { name: "StopLatitude/Longitude", highlight: false, note: "Destination coordinates" },
    ],
    gotchas: [
      { type: "warn", text: "Trips only finalize when the vehicle fully stops — no in-progress trips via Get." },
      { type: "warn", text: "GetFeed(Trip) ignores DeviceSearch — you'll get all trips for the database." },
      { type: "tip",  text: "Trip has start/end coords only. Query LogRecord with trip times for the full GPS path." },
    ],
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

(async () => {
  await api.authenticate();

  // Get last 10 trips for a vehicle
  const trips = await api.call('Get', {
    typeName: 'Trip',
    search: {
      deviceSearch: { id: 'b1' },
      fromDate: new Date(Date.now() - 7 * 86_400_000).toISOString()
    },
    resultsLimit: 10
  });
  // trips[i].distance       → km
  // trips[i].maxSpeed       → peak km/h
  // trips[i].driver.id      → driver ID
  // trips[i].start / .stop  → ISO datetime strings

  // Get full GPS path for a specific trip:
  const path = await api.call('Get', {
    typeName: 'LogRecord',
    search: {
      deviceSearch: { id: trips[0].device.id },
      fromDate: trips[0].start,
      toDate:   trips[0].stop
    }
  });
})();`,
  },
];

const FIELD_MATRIX = [
  { field: "Latitude / Longitude", lr: "✓", dsi: "✓ live", sd: "—", fd: "—", tr: "start + stop" },
  { field: "Bearing (heading)", lr: "—", dsi: "✓ only here", sd: "—", fd: "—", tr: "—" },
  { field: "Speed", lr: "✓ hist.", dsi: "✓ live", sd: "—", fd: "—", tr: "max / avg" },
  { field: "Is driving", lr: "—", dsi: "✓", sd: "—", fd: "—", tr: "—" },
  { field: "Driver", lr: "—", dsi: "✓ current", sd: "—", fd: "—", tr: "✓ per trip" },
  { field: "Engine hours", lr: "—", dsi: "—", sd: "DiagnosticEngineHoursAdjustmentId", fd: "—", tr: "—" },
  { field: "Odometer", lr: "—", dsi: "—", sd: "DiagnosticOdometerAdjustmentId", fd: "—", tr: "✓ calc" },
  { field: "Fuel level", lr: "—", dsi: "—", sd: "DiagnosticFuelLevelId", fd: "—", tr: "—" },
  { field: "Aux inputs (1-4)", lr: "—", dsi: "—", sd: "DiagnosticGoInputStatus[1-4]Id", fd: "—", tr: "—" },
  { field: "Active faults / DTCs", lr: "—", dsi: "—", sd: "—", fd: "✓ FaultState", tr: "—" },
  { field: "Active alert rules", lr: "—", dsi: "✓", sd: "—", fd: "—", tr: "—" },
  { field: "Historical GPS points", lr: "✓", dsi: "—", sd: "—", fd: "—", tr: "—" },
  { field: "Trip distance", lr: "—", dsi: "—", sd: "—", fd: "—", tr: "✓" },
  { field: "Comm. status", lr: "—", dsi: "✓ IsDeviceComm...", sd: "—", fd: "—", tr: "—" },
];

const MULTICALL_EXAMPLES = [
  {
    title: "Fleet dashboard snapshot",
    desc: "Load devices + live status + groups in a single HTTP request",
    savings: "3 → 1",
    when: "Any time you need data from multiple entity types simultaneously",
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

(async () => {
  await api.authenticate();

  // Without multiCall: 3 HTTP requests, 3× latency
  // With multiCall: 1 HTTP request, parallel execution on server
  const [devices, statuses, groups] = await api.multiCall([
    ['Get', { typeName: 'Device', search: {} }],
    ['Get', { typeName: 'DeviceStatusInfo', search: {} }],
    ['Get', { typeName: 'Group', search: {} }]
  ]);

  // Results return in the same order as the calls.
  // Merge device list with live status:
  const statusById = Object.fromEntries(
    statuses.map(s => [s.device.id, s])
  );
  const fleet = devices.map(d => ({
    ...d,
    live: statusById[d.id]   // attach live data
  }));
})();`,
  },
  {
    title: "Vehicle detail page",
    desc: "Everything about one vehicle: device info, live status, active faults, recent trips",
    savings: "4 → 1",
    when: "Opening a vehicle detail page — you need several entity types at once",
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

(async () => {
  await api.authenticate();
  const id = 'b1';  // vehicle ID

  const [device, status, faults, trips] = await api.multiCall([
    ['Get', { typeName: 'Device',
              search: { id } }],
    ['Get', { typeName: 'DeviceStatusInfo',
              search: { deviceSearch: { id } } }],
    ['Get', { typeName: 'FaultData',
              search: { deviceSearch: { id }, faultStates: ['Active'] } }],
    ['Get', { typeName: 'Trip',
              search: { deviceSearch: { id } },
              resultsLimit: 5 }]
  ]);

  // device[0]  → device object with name, serial, groups
  // status[0]  → live bearing, speed, driver, isDriving
  // faults     → active DTC list
  // trips      → 5 most recent completed trips
})();`,
  },
  {
    title: "Diagnostics snapshot for fleet",
    desc: "Fetch multiple diagnostic types for all vehicles at once",
    savings: "3 → 1",
    when: "Building a fleet health dashboard with multiple sensor readings",
    code: `const GeotabApi = require('mg-api-js');

const api = new GeotabApi({
  credentials: {
    userName: process.env.GEOTAB_USER,
    password: process.env.GEOTAB_PASS,
    database: process.env.GEOTAB_DB,
  },
  path: 'my.geotab.com',
}, { rememberMe: true });

(async () => {
  await api.authenticate();

  const [odometers, fuelLevels, auxInputs] = await api.multiCall([
    ['Get', {
      typeName: 'StatusData',
      search: {
        diagnosticSearch: { id: 'DiagnosticOdometerAdjustmentId' }
      }
    }],
    ['Get', {
      typeName: 'StatusData',
      search: {
        diagnosticSearch: { id: 'DiagnosticFuelLevelId' }
      }
    }],
    ['Get', {
      typeName: 'StatusData',
      search: {
        diagnosticSearch: { id: 'DiagnosticGoInputStatusId' }
      }
    }]
  ]);

  // odometers[i].data / 1000  → km
  // fuelLevels[i].data        → % (0-100)
  // auxInputs[i].data         → 0 or 1
})();`,
  },
];

const RATE_LIMITS = [
  { obj: "DeviceStatusInfo", get: "900/min", getFeed: "60/min", note: "Ideal for polling live fleet" },
  { obj: "LogRecord",        get: "1000/min", getFeed: "60/min", note: "Heavy — paginate carefully" },
  { obj: "StatusData",       get: "1000/min", getFeed: "60/min", note: "Filter by Diagnostic always" },
  { obj: "FaultData",        get: "1000/min", getFeed: "60/min", note: "— " },
  { obj: "Trip",             get: "1000/min", getFeed: "60/min", note: "GetFeed ignores DeviceSearch" },
];

const SYSTEM_PROMPT = `You are a Geotab MyGeotab API expert. Help developers understand and use the Geotab API correctly.

Core facts:
- DeviceStatusInfo: Current state of a vehicle. Properties: Bearing (heading in degrees), Latitude, Longitude, Speed, IsDriving, IsDeviceCommunicating, Driver, ExceptionEvents, StatusData. ONE record per vehicle — the latest snapshot. Bearing is ONLY available here, not in LogRecord.
- LogRecord: Historical GPS points. Properties: DateTime, Latitude, Longitude, Speed (may be -1/InvalidSpeed), Device. NO bearing field. Max 50,000 per request. Use GetFeed with version tokens for continuous sync.
- StatusData: Diagnostic/sensor data. Must ALWAYS filter by diagnosticSearch ID or you get massive data. Key IDs: DiagnosticGoInputStatusId (aux input 1, value 0 or 1), DiagnosticGoInputStatus2Id/3Id/4Id (aux 2-4), DiagnosticOdometerAdjustmentId (metres), DiagnosticEngineHoursAdjustmentId (seconds), DiagnosticFuelLevelId (%).
- FaultData: Fault codes/DTCs. Properties: FaultState (Active/Pending/NotActive), Diagnostic (name, code), FailureMode, AmberWarningLamp, Count. Filter by faultStates to show only active faults.
- Trip: Completed trips only (no in-progress). Properties: Start, Stop, Distance (km), MaxSpeed, AverageSpeed, Driver, StartLatitude/Longitude, StopLatitude/Longitude. GetFeed(Trip) ignores DeviceSearch.
- multiCall: Batch multiple API calls in one HTTP request. Pass array of [method, params] tuples. Results return in same order.
- GetFeed vs Get: GetFeed uses version tokens (fromVersion → toVersion), max 50,000, ideal for continuous sync. Get uses date ranges, flexible search, for one-off queries.
- Rate limits: DeviceStatusInfo Get 900/min, LogRecord Get 1000/min, GetFeed 60/min for all types.
- mg-api-node: Node.js SDK. api.call(method, params) or api.callAsync for promises. api.multiCall for batching.

Be concise, give JavaScript code examples. Highlight gotchas clearly.`;

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
        fontFamily: "var(--font-mono)"
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
        border: "0.5px solid rgba(255,255,255,0.08)"
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
      borderRadius: 4, fontFamily: "var(--font-mono)"
    }}>
      {children}
    </span>
  );
}

function GotchaIcon({ type }) {
  const map = { warn: { icon: "ti-alert-triangle", color: "#854F0B" }, info: { icon: "ti-info-circle", color: "#185FA5" }, tip: { icon: "ti-bulb", color: "#0F6E56" } };
  const m = map[type] || map.info;
  return <i className={`ti ${m.icon}`} style={{ color: m.color, fontSize: 14, marginTop: 1, flexShrink: 0 }} aria-hidden="true" />;
}

function CellVal({ val }) {
  if (val === "—") return <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>—</span>;
  if (val.startsWith("✓")) return <span style={{ color: "#0F6E56", fontWeight: 500, fontSize: 13 }}>{val}</span>;
  return <span style={{ color: "var(--color-text-secondary)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{val}</span>;
}

export default function GeotabInspector() {
  const [tab, setTab] = useState("usecases");
  const [caseId, setCaseId] = useState("live");
  const [msgs, setMsgs] = useState([{ role: "assistant", content: "Hi! Ask me anything about the Geotab API — which object to use, how to get a specific field, multicall patterns, rate limits, or any gotchas you've run into." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [mcExample, setMcExample] = useState(0);
  const chatRef = useRef(null);

  const activeCase = CASES.find(c => c.id === caseId);

  function copyCode(id, text) {
    navigator.clipboard.writeText(text).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
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

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [msgs]);

  const tabs = [
    { id: "usecases", label: "Use cases", icon: "ti-template" },
    { id: "fieldmap", label: "Field map", icon: "ti-table" },
    { id: "multicall", label: "Multicall", icon: "ti-stack-2" },
    { id: "ratelimits", label: "Rate limits", icon: "ti-gauge" },
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
      <h2 className="sr-only">Geotab API Inspector — use-case driven reference for MyGeotab API developers</h2>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 14, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "#0F6E56", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="ti ti-truck" style={{ color: "#fff", fontSize: 18 }} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, color: "var(--color-text-primary)" }}>Geotab API Inspector</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Use-case driven reference · MyGeotab SDK</div>
        </div>
        <a href="https://developers.geotab.com/myGeotab/apiReference/methods/" target="_blank" rel="noreferrer"
          style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          <i className="ti ti-external-link" aria-hidden="true" />Official docs
        </a>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap", background: "var(--color-background-secondary)", padding: 4, borderRadius: 8 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(t.id)}>
            <i className={`ti ${t.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />{t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Use Cases ─────────────────────────────────────────────── */}
      {tab === "usecases" && (
        <div className="inspector-usecases-grid" style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, minHeight: 500 }}>
          {/* Sidebar */}
          <div className="inspector-case-sidebar" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {CASES.map(c => (
              <button key={c.id} onClick={() => setCaseId(c.id)} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 12px", borderRadius: 7, cursor: "pointer", textAlign: "left",
                background: caseId === c.id ? c.accentBg : "transparent",
                color: caseId === c.id ? c.accentColor : "var(--color-text-secondary)",
                border: `0.5px solid ${caseId === c.id ? c.accentBorder : "transparent"}`,
                fontSize: 13, fontWeight: caseId === c.id ? 500 : 400, transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}>
                <i className={`ti ${c.icon}`} style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true" />
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          {/* Main detail */}
          {activeCase && (
            <div>
              {/* Header */}
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

              {/* Fields */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Fields available</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {activeCase.fields.map((f, i) => (
                    <div key={i} className="inspector-field-row" style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "7px 10px", borderRadius: 6,
                      background: f.highlight ? activeCase.accentBg : "var(--color-background-secondary)",
                      border: f.highlight ? `0.5px solid ${activeCase.accentBorder}` : "0.5px solid transparent",
                    }}>
                      <code style={{ fontSize: 12.5, fontFamily: "var(--font-mono)", color: f.highlight ? activeCase.accentColor : "var(--color-text-primary)", fontWeight: f.highlight ? 500 : 400, minWidth: 200, flexShrink: 0 }}>{f.name}</code>
                      <span style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>{f.note}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Gotchas */}
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

              {/* Code */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Code snippet</div>
                <CodeBlock code={activeCase.code} id={`case-${activeCase.id}`} copiedId={copiedId} onCopy={copyCode} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Field Map ─────────────────────────────────────────────── */}
      {tab === "fieldmap" && (
        <div>
          <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
            Which API object contains which field? Use this to avoid fetching the wrong entity type.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Field", "LogRecord", "DeviceStatusInfo", "StatusData", "FaultData", "Trip"].map((h, i) => (
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
                {FIELD_MATRIX.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "9px 10px", fontSize: 13, color: "var(--color-text-primary)", fontWeight: 400 }}>{row.field}</td>
                    <td style={{ padding: "9px 10px" }}><CellVal val={row.lr} /></td>
                    <td style={{ padding: "9px 10px" }}><CellVal val={row.dsi} /></td>
                    <td style={{ padding: "9px 10px" }}><CellVal val={row.sd} /></td>
                    <td style={{ padding: "9px 10px" }}><CellVal val={row.fd} /></td>
                    <td style={{ padding: "9px 10px" }}><CellVal val={row.tr} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { color: "#0F6E56", label: "✓ — field is present" },
              { color: "var(--color-text-tertiary)", label: "— — not available" },
              { color: "var(--color-text-secondary)", label: "ID/note — requires filter or special handling" },
            ].map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: l.color }}>{l.label}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Multicall ─────────────────────────────────────────────── */}
      {tab === "multicall" && (
        <div>
          {/* Explainer */}
          <div style={{ background: "var(--color-background-secondary)", borderRadius: 10, padding: "14px 16px", marginBottom: 18, border: "0.5px solid var(--color-border-tertiary)" }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8, color: "var(--color-text-primary)" }}>What is multiCall?</div>
            <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              multiCall bundles multiple API calls into a single HTTP request. The server executes them in parallel and returns all results at once. This dramatically reduces latency — especially important when you need data from several entity types to render a single screen.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {[
                { icon: "ti-bolt", label: "Lower latency", desc: "One round-trip instead of N" },
                { icon: "ti-server", label: "Server-side parallel", desc: "Calls run simultaneously" },
                { icon: "ti-gauge", label: "Rate limit friendly", desc: "Counts as N calls, not 1" },
              ].map((f, i) => (
                <div key={i} style={{ background: "var(--color-background-primary)", borderRadius: 8, padding: "10px 12px", border: "0.5px solid var(--color-border-tertiary)" }}>
                  <i className={`ti ${f.icon}`} style={{ fontSize: 18, color: "#0F6E56", marginBottom: 6, display: "block" }} aria-hidden="true" />
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Example selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {MULTICALL_EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => setMcExample(i)} style={{
                padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                background: mcExample === i ? "#0F6E56" : "var(--color-background-secondary)",
                color: mcExample === i ? "#fff" : "var(--color-text-secondary)",
                border: `0.5px solid ${mcExample === i ? "#0F6E56" : "var(--color-border-tertiary)"}`,
                fontWeight: mcExample === i ? 500 : 400,
              }}>
                {ex.title}
              </button>
            ))}
          </div>

          {/* Active example */}
          {(() => {
            const ex = MULTICALL_EXAMPLES[mcExample];
            return (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>{ex.title}</div>
                  <Badge color="#0F6E56" bg="#E1F5EE">{ex.savings} requests</Badge>
                </div>
                <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginBottom: 6 }}>{ex.desc}</div>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <i className="ti ti-bulb" style={{ color: "#0F6E56", fontSize: 14, marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                  <span><b style={{ fontWeight: 500 }}>When to use:</b> {ex.when}</span>
                </div>
                <CodeBlock code={ex.code} id={`mc-${mcExample}`} copiedId={copiedId} onCopy={copyCode} />
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Tab: Rate Limits ────────────────────────────────────────────── */}
      {tab === "ratelimits" && (
        <div>
          <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginBottom: 16, lineHeight: 1.6 }}>
            Rate limits are per entity type and per method. Hitting limits throws an OverLimitException. Plan your polling strategy accordingly.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Entity type", "Get limit", "GetFeed limit", "Notes"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RATE_LIMITS.map((r, i) => (
                <tr key={i} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                  <td style={{ padding: "9px 10px", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>{r.obj}</td>
                  <td style={{ padding: "9px 10px" }}><Badge color="#185FA5" bg="#E6F1FB">{r.get}</Badge></td>
                  <td style={{ padding: "9px 10px" }}><Badge color="#854F0B" bg="#FAEEDA">{r.getFeed}</Badge></td>
                  <td style={{ padding: "9px 10px", fontSize: 12.5, color: "var(--color-text-secondary)" }}>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 10 }}>Best practices</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { type: "tip", text: "Use GetFeed with version tokens for continuous sync — it's designed for polling and handles pagination automatically." },
                { type: "tip", text: "Use multiCall to batch requests — reduces HTTP overhead without helping rate limits per se." },
                { type: "warn", text: "GetFeed has a 60/min limit regardless of entity type. Spread polls out to 1/sec max." },
                { type: "info", text: "GetFeed has a 180-second server timeout per request. Large datasets must use fromVersion pagination." },
              ].map((g, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", background: "var(--color-background-secondary)", borderRadius: 6 }}>
                  <GotchaIcon type={g.type} />
                  <span style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5 }}>{g.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Ask Claude ─────────────────────────────────────────────── */}
      {tab === "ask" && (
        <div style={{ display: "flex", flexDirection: "column", height: 480 }}>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
            Ask anything about Geotab API — which object to use, how to fetch a specific data point, multicall patterns, error handling, or SDK usage.
          </div>

          {/* Suggested questions */}
          {msgs.length <= 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                "How do I get bearing for a vehicle?",
                "When should I use GetFeed vs Get?",
                "How do I get aux input state for all devices?",
                "How do I set up multiCall with mg-api-node?",
              ].map(q => (
                <button key={q} onClick={() => { setInput(q); }} style={{
                  padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                  fontSize: 12.5, background: "var(--color-background-secondary)",
                  color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-secondary)",
                }}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
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

          {/* Input */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 12 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMsg()}
              placeholder="Ask about the Geotab API…"
              aria-label="Ask about the Geotab API"
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
