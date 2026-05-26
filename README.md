# geotab-smart-sdk

A smart, composable Node.js SDK for the [MyGeotab API](https://geotab.github.io/sdk/), built on top of [`mg-api-js`](https://www.npmjs.com/package/mg-api-js).

`geotab-smart-sdk` doesn't hide the underlying API — it answers the questions that slow developers down the first time they touch MyGeotab:

- *Which object has bearing?* (Not `LogRecord` — it's `DeviceStatusInfo`.)
- *How do I get live location **and** fuel level in one round-trip?*
- *How do I set up `GetFeed` without losing records on restart?*
- *What on earth is `DiagnosticGoInputStatusId`?*

It ships use-case helpers (`liveTracker`, `history`, `fleetSnapshot`, `feeds`), named diagnostic constants, automatic session and rate-limit handling, and an `EntityCache` — without locking you out of the raw `call()` / `multiCall()` when you need them.

> **Note on `mg-api-node`:** the older `mg-api-node` package was archived by Geotab in August 2023. This SDK builds on the modern, Geotab-maintained replacement, [`mg-api-js`](https://www.npmjs.com/package/mg-api-js).

---

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Use cases](#use-cases)
  - [1. Live vehicle tracking](#1-live-vehicle-tracking-with-bearing--diagnostics)
  - [2. Historical GPS + diagnostics + faults](#2-historical-gps--diagnostics--faults)
  - [3. Fleet snapshot (dashboard load)](#3-fleet-snapshot-dashboard-load)
  - [4. Continuous data sync via GetFeed](#4-continuous-data-sync-via-getfeed)
- [Diagnostic constants](#diagnostic-constants)
- [API reference](#api-reference)
- [Lifecycle, errors, and rate limits](#lifecycle-errors-and-rate-limits)
- [Raw API access](#raw-api-access)
- [What this SDK handles for you](#what-this-sdk-handles-for-you)
- [GetFeed: critical rules from Geotab docs](#getfeed-critical-rules-from-geotab-docs)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Examples](#examples)
- [Roadmap](#roadmap)
- [License](#license)

---

## Installation

```bash
npm install geotab-smart-sdk
```

Peer dependency `mg-api-js` is installed automatically.

---

## Quick start

```js
const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');

const sdk = new GeotabSDK({
  username: 'user@company.com',
  password: 'secret',
  database: 'my_company',
  server:   'my.geotab.com',   // optional — defaults to my.geotab.com
});

// Fail fast on bad credentials, warm device cache up front.
await sdk.connect({ cacheDevices: true });

// You're ready: liveTracker(), history(), fleetSnapshot(), feeds(),
// or just sdk.call() / sdk.multiCall() for anything else.
```

---

## Use cases

### 1. Live vehicle tracking (with bearing + diagnostics)

There are **two trackers**. Pick based on fidelity vs cost:

| Helper | Source | Update granularity | Best for |
|---|---|---|---|
| `sdk.liveTracker()` | `DeviceStatusInfo` (snapshot per vehicle) | Server-aggregated; lower frequency, all fields native | Dashboards, "current state per vehicle" |
| `sdk.realtimeTracker()` | `LogRecord` (GetFeed) + companions | Every GPS fix the device emits; bearing/driver/isDriving derived | Map animation, geofencing, per-fix workflows |

#### 1a. `sdk.liveTracker()` — DeviceStatusInfo snapshot

`DeviceStatusInfo` is the **only** Geotab object that carries `Bearing` natively. `liveTracker()` uses it and enriches each snapshot with diagnostics and active fault codes in a single `multiCall`.

```js
const tracker = sdk.liveTracker()
  .withDiagnostics([
    Diagnostics.FUEL_LEVEL,    // %
    Diagnostics.AUX_INPUT_1,   // 0 or 1
    Diagnostics.ODOMETER,      // metres → /1000 for km
  ])
  .withFaults()                // include active DTCs
  .forDevices(['b1', 'b2'])    // optional — all devices if omitted
  .pollEvery(5_000);           // ms (min 1000)

tracker.on('update', (vehicles) => {
  for (const v of vehicles) {
    console.log(v.device.name);
    console.log(v.location.bearing);            // heading in degrees
    console.log(v.isDriving, v.isConnected);
    console.log(v.driver?.name);
    console.log(v.activeAlerts);                // ExceptionEvent[]
    console.log(v.diagnostics[Diagnostics.FUEL_LEVEL]?.value);
    console.log(v.faults);                      // FaultData[] when .withFaults()
  }
});

tracker.on('error', (err) => console.error('[tracker]', err));

await tracker.start();
// ... later:
tracker.stop();
```

**Per-vehicle shape emitted by `update`:**

```ts
{
  device:               { id, name, serialNumber },
  location:             { latitude, longitude, bearing, speed },
  isDriving:            boolean,
  isConnected:          boolean,
  driver:               { id, name } | null,
  activeAlerts:         ExceptionEvent[],
  currentStateDuration: string,
  dateTime:             string,
  diagnostics:          { [diagnosticId]: { value, dateTime } },
  faults:               FaultData[],
}
```

Each poll batches `DeviceStatusInfo + StatusData × N + FaultData` into **one** `multiCall`. No extra HTTP round-trips.

#### 1b. `sdk.realtimeTracker()` — LogRecord (every device fix)

Geotab themselves recommend `LogRecord` for higher-fidelity tracking — it updates more often than `DeviceStatusInfo`, just with fewer native fields. `realtimeTracker()` uses it as the position source and derives the missing fields:

- **Bearing** via `atan2` between consecutive `LogRecord` points (null on the first observation per device; held steady when stationary).
- **`isDriving`** from `DiagnosticIgnitionId` (`StatusData`) combined with a speed threshold (default 5 km/h).
- **Driver** from `DriverChange` (`type: 'Driver'`) — the SDK keeps a per-device map updated incrementally.

```js
const tracker = sdk.realtimeTracker()
  .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER])
  .withIgnition()             // recommended — required for accurate isDriving
  .withDriverAttribution()    // recommended — populates v.driver
  .withFaults()
  .pollEvery(5_000);          // default; floor 1000 ms; warns < 2000 ms

tracker.on('update', (vehicles) => {
  for (const v of vehicles) {
    console.log(v.location.bearing);       // computed; null on first fix
    console.log(v.isDriving);              // from ignition + speed
    console.log(v.driver?.name);           // from DriverChange
    console.log(v.ignition?.value);        // raw ignition reading
    console.log(v.diagnostics[Diagnostics.FUEL_LEVEL]?.value);
  }
});

await tracker.start();
tracker.stop();
```

**Vehicle shape** is the same as `liveTracker` plus `ignition: { value, dateTime } | null` and `source: 'logrecord'`.

**Rate-limit budget at the default 5s poll:** ~12 LogRecord GetFeed calls/min (limit 60/min) and ~12·N StatusData Get calls/min (limit ~1000/min, where N is the number of requested diagnostics plus ignition). Hard floor is 1000 ms; below 2000 ms emits a console warning.

See [`examples/realtime-tracking.js`](examples/realtime-tracking.js) for a runnable demo.

---

### 2. Historical GPS + diagnostics + faults

```js
const history = await sdk.history({
  deviceId: 'b1',
  from: new Date('2024-01-15T00:00:00Z'),
  to:   new Date('2024-01-15T23:59:59Z'),
  include: {
    gps:         true,
    trips:       true,
    faults:      true,
    diagnostics: [Diagnostics.FUEL_LEVEL, Diagnostics.AUX_INPUT_1],
  },
  computeBearing: true,   // atan2 from consecutive GPS points
});

history.gps.forEach(p   => console.log(p.latitude, p.longitude, p.bearing, p.speed));
history.trips.forEach(t => console.log(t.distance, t.maxSpeed));
history.faults.forEach(f => console.log(f.faultState, f.diagnostic?.name));
history.diagnostics[Diagnostics.FUEL_LEVEL];  // StatusData[] for fuel
```

Everything is fetched in a **single `multiCall`** and paginates automatically when GPS exceeds 50,000 records.

**Multiple devices in parallel:**

```js
const results = await sdk.historyMany(['b1', 'b2', 'b3'], {
  from, to,
  include: { gps: true, faults: true },
});
// results: HistoryResult[] — one per device, same order as input
```

---

### 3. Fleet snapshot (dashboard load)

One-shot picture of the whole fleet — perfect for dashboards and reports.

```js
const fleet = await sdk.fleetSnapshot({
  include: {
    devices:      true,
    liveStatus:   true,
    activeFaults: true,
    diagnostics:  [Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER],
    recentTrips:  5,
  },
  groupIds: ['groupCompanyId'],   // optional — restrict to specific groups
});

console.log(fleet.summary);
// { total: 45, driving: 12, stopped: 28, disconnected: 5, withActiveFaults: 3 }

fleet.liveStatus.get('b1').bearing;                              // heading
fleet.faults.get('b1');                                          // active DTCs
fleet.diagnostics[Diagnostics.FUEL_LEVEL].get('b1').data;        // fuel %
fleet.recentTrips.get('b1');                                     // last N trips
```

**Returned shape:**

```ts
{
  devices:     Device[],
  liveStatus:  Map<deviceId, DeviceStatusInfo>,
  faults:      Map<deviceId, FaultData[]>,
  diagnostics: { [diagnosticId]: Map<deviceId, StatusData> },
  recentTrips: Map<deviceId, Trip[]>,
  summary: {
    total:            number,
    driving:          number,
    stopped:          number,
    disconnected:     number,
    withActiveFaults: number,
  }
}
```

---

### 4. Continuous data sync via `GetFeed`

For high-volume sync to your own store. The `FeedManager` handles token rotation and adaptive polling for you.

```js
const feeds = sdk.feeds()
  .addFeed('LogRecord',  { fromVersion: savedTokens.LogRecord  })
  .addFeed('StatusData', { fromVersion: savedTokens.StatusData })
  .addFeed('FaultData',  { fromDate: new Date('2024-01-15')   }); // first run only

// CRITICAL: save the token BEFORE processing. If you process then crash,
// those records are lost on restart.
feeds.on('version', (entityType, token)   => db.saveToken(entityType, token));
feeds.on('data',    (entityType, records) => db.insert(entityType, records));
feeds.on('error',   (entityType, err)     => logger.error(entityType, err));

feeds.start();
// ... later:
feeds.stop();
```

**Adaptive polling behaviour:**

| Last batch | Next poll |
|---|---|
| Full (50,000 records) | Immediate — more data is waiting |
| Partial | Min interval (1s) |
| Empty | Progressive back-off, up to 30s |
| Error | Exponential back-off, up to 30s |

`feeds.setVersion(type, token)` / `feeds.getVersion(type)` let you persist and resume tokens manually.

---

## Diagnostic constants

```js
const { Diagnostics, DiagnosticLabels, DiagnosticGroups } = require('geotab-smart-sdk');
```

### Individual constants

```js
// Aux / digital inputs (binary)
Diagnostics.AUX_INPUT_1   // 'DiagnosticGoInputStatusId'
Diagnostics.AUX_INPUT_2   // ...
// AUX_INPUT_3 … AUX_INPUT_6

// Engine & powertrain
Diagnostics.ENGINE_HOURS       // seconds — divide by 3600 for hours
Diagnostics.ODOMETER           // metres   — divide by 1000 for km
Diagnostics.ENGINE_RPM         // RPM
Diagnostics.THROTTLE_POSITION  // %
Diagnostics.ENGINE_LOAD        // %
Diagnostics.COOLANT_TEMP       // °C
Diagnostics.OIL_TEMP           // °C
Diagnostics.OIL_PRESSURE       // kPa

// Fuel
Diagnostics.FUEL_LEVEL         // %
Diagnostics.FUEL_USED          // L
Diagnostics.FUEL_RATE          // L/h

// EV
Diagnostics.EV_STATE_OF_CHARGE // %
Diagnostics.EV_BATTERY_TEMP    // °C

// Driver behaviour (binary events)
Diagnostics.HARSH_BRAKING
Diagnostics.HARSH_ACCEL
Diagnostics.SEAT_BELT

// Vehicle power
Diagnostics.BATTERY_VOLTAGE    // V
Diagnostics.IGNITION           // binary
```

### Pre-built groups

```js
DiagnosticGroups.FLEET_BASICS   // [ODOMETER, FUEL_LEVEL, ENGINE_HOURS]
DiagnosticGroups.AUX_INPUTS     // [AUX_INPUT_1 … AUX_INPUT_4]
DiagnosticGroups.ENGINE_HEALTH  // [ENGINE_RPM, COOLANT_TEMP, OIL_TEMP, OIL_PRESSURE]
DiagnosticGroups.DRIVER_SAFETY  // [HARSH_BRAKING, HARSH_ACCEL, SEAT_BELT]
DiagnosticGroups.EV             // [EV_STATE_OF_CHARGE, EV_BATTERY_TEMP]
```

### Reverse lookup

```js
DiagnosticLabels['DiagnosticFuelLevelId'];  // 'fuel level'
```

---

## API reference

### `new GeotabSDK(credentials, [options])`

| Field | Type | Description |
|---|---|---|
| `credentials.username` | `string` | **required** |
| `credentials.password` | `string` | **required** |
| `credentials.database` | `string` | **required** |
| `credentials.server`   | `string` | Defaults to `my.geotab.com` |
| `options.cacheTtlMs`   | `number` | `EntityCache` TTL. Defaults to 1 hour |

### Instance methods

| Method | Returns | Notes |
|---|---|---|
| `connect({ cacheDevices?, cacheDiagnostics? })` | `Promise<void>` | Authenticates and optionally warms caches. Safe to call multiple times. |
| `call(method, params)` | `Promise<any>` | Direct MyGeotab call with auto re-auth. |
| `multiCall(calls)` | `Promise<any[]>` | Batched calls, preserves order. |
| `liveTracker()` | `LiveTracker` | DeviceStatusInfo snapshot tracker — see [§1a](#1a-sdklivetracker--devicestatusinfo-snapshot). |
| `realtimeTracker()` | `RealtimeTracker` | LogRecord-based, high-fidelity tracker — see [§1b](#1b-sdkrealtimetracker--logrecord-every-device-fix). |
| `history(options)` | `Promise<HistoryResult>` | See [§2](#2-historical-gps--diagnostics--faults). |
| `historyMany(deviceIds, options)` | `Promise<HistoryResult[]>` | Parallel fetch. |
| `fleetSnapshot(options)` | `Promise<FleetSnapshotResult>` | See [§3](#3-fleet-snapshot-dashboard-load). |
| `feeds()` | `FeedManager` | See [§4](#4-continuous-data-sync-via-getfeed). |

### `LiveTracker` (fluent)

| Method | Returns |
|---|---|
| `.withDiagnostics(ids[])` | `this` |
| `.withFaults()` | `this` |
| `.forDevices(deviceIds[])` | `this` |
| `.pollEvery(ms)` | `this` (min 1000 ms) |
| `.start()` | `Promise<void>` |
| `.stop()` | `void` |
| `.on('update', vehicles => …)` | event |
| `.on('error',  err => …)`      | event |

### `RealtimeTracker` (fluent)

| Method | Returns / Notes |
|---|---|
| `.withDiagnostics(ids[])` | `this` |
| `.withIgnition()` | `this` — adds `DiagnosticIgnitionId` poll, enables ignition-aware `isDriving` |
| `.withDriverAttribution()` | `this` — populates `v.driver` via `DriverChange` |
| `.withFaults()` | `this` |
| `.forDevices(deviceIds[])` | `this` |
| `.pollEvery(ms)` | `this` — default 5000, floor 1000, warns < 2000 |
| `.drivingSpeedThreshold(kmh)` | `this` — default 5 |
| `.startingFrom(date)` | `this` — first-poll seed date; defaults to `now - pollMs` |
| `.start()` | `Promise<void>` |
| `.stop()` | `void` |
| `.on('update', vehicles => …)` | event — same shape as LiveTracker + `ignition` / `source: 'logrecord'` |
| `.on('error',  err => …)` | event |

### `FeedManager`

| Method | Returns |
|---|---|
| `.addFeed(entityType, { fromVersion?, fromDate?, resultsLimit?, search? })` | `this` |
| `.start()` / `.stop()` | `void` |
| `.setVersion(type, token)` | `void` |
| `.getVersion(type)` | `string \| null` |
| `.on('data',    (type, records) => …)` | event |
| `.on('version', (type, token)   => …)` | event |
| `.on('error',   (type, err)     => …)` | event |

---

## Lifecycle, errors, and rate limits

**Session expiry** — `Session` detects `InvalidUserException` and re-authenticates transparently. Your `call()` / `multiCall()` will succeed without you doing anything.

**Rate limits** — `RateLimiter` catches `OverLimitException`, honours the API's `Retry-After`, and retries once. All built-in helpers (`liveTracker`, `feeds`, etc.) are wrapped with this automatically.

**Errors you may see:**

```js
try {
  await sdk.call('Get', { typeName: 'Device' });
} catch (err) {
  err.code;     // e.g. 'OverLimitException', 'InvalidUserException'
  err.context;  // 'Get', 'multiCall', etc.
  err.raw;      // original error from mg-api-js
}
```

For `LiveTracker` / `FeedManager`, listen for the `'error'` event — these are non-fatal and the loop keeps running.

---

## Filtering by group

The Geotab API supports group-based filtering on every entity that has a device association. The SDK's coverage today is uneven — first-class support is being added one helper at a time. Here's the current state and the workaround for each.

| Helper | Group filter today | Status |
|---|---|---|
| `sdk.fleetSnapshot({ groupIds })` | ✓ Full | Applied to every entity in the snapshot: `Device` / `DeviceStatusInfo` (top-level `groups`) and `StatusData` / `FaultData` / `Trip` (nested `deviceSearch.groups`). |
| `sdk.liveTracker()` | ✓ `.forGroups([ids])` | Server-side group filter applied to `DeviceStatusInfo`, `StatusData`, and `FaultData`. Composable with `.forDevices()` — both intersect. |
| `sdk.realtimeTracker()` | Workaround | Same — pre-resolve and use `.forDevices([ids])`. |
| `sdk.history({ deviceId })` | N/A | Single device by ID. |
| `sdk.historyMany([ids], options)` | Workaround | Pre-resolve device IDs and pass them in. A `historyByGroups()` helper is planned. |
| `sdk.feeds()` (GetFeed) | Not supported | GetFeed accepts only `fromDate` per [Geotab's data feed guide](https://geotab.github.io/sdk/software/guides/data-feed/). Filter client-side via the device cache. |
| `sdk.connect({ cacheDevices })` | Not yet | Caches all devices. A `cacheGroups: [ids]` scoping option is planned. |

### Workaround: resolve devices, then call the helper

```js
// 1. Resolve the group → device IDs once
const devices = await sdk.call('Get', {
  typeName: 'Device',
  search: { groups: [{ id: 'groupCompanyId' }] },
});
const ids = devices.map(d => d.id);

// 2. Pass to whichever helper needs it
sdk.liveTracker().forDevices(ids).withFaults().pollEvery(5_000).start();

await sdk.historyMany(ids, {
  from: yesterday, to: today,
  include: { gps: true, faults: true },
});
```

The Geotab search shape varies by entity if you're writing raw `sdk.call()` code:

```js
// Device, DeviceStatusInfo — groups at the top level
{ search: { groups: [{ id: 'groupCompanyId' }] } }

// StatusData, FaultData, Trip, LogRecord — groups nested in deviceSearch
{ search: { deviceSearch: { groups: [{ id: 'groupCompanyId' }] } } }
```

---

## Raw API access

The SDK never hides the underlying API. Reach for `call()` / `multiCall()` whenever the helpers don't cover what you need:

```js
// Single call
const devices = await sdk.call('Get', { typeName: 'Device', search: {} });

// multiCall — order-preserving
const [devices, statuses] = await sdk.multiCall([
  ['Get', { typeName: 'Device',            search: {} }],
  ['Get', { typeName: 'DeviceStatusInfo',  search: {} }],
]);
```

---

## What this SDK handles for you

| Problem | Solution |
|---|---|
| Session expires mid-run | `Session` auto re-authenticates transparently |
| `OverLimitException` | `RateLimiter` reads `Retry-After`, waits, retries |
| `GetFeed` token management | `FeedManager` tracks `toVersion` per entity |
| `GetFeed` `fromDate` misuse | Sent only on first call, auto-discarded after |
| Bearing missing from `LogRecord` | `LiveTracker` uses `DeviceStatusInfo`; `HistoryQuery` computes from GPS points |
| Remembering diagnostic IDs | `Diagnostics.*` named constants + `DiagnosticGroups` |
| Multiple entity types per screen | `multiCall` batching baked into every helper |
| `LogRecord` pagination (>50k rows) | `HistoryQuery` paginates automatically |
| Device name resolution | `EntityCache` pre-loads devices; lookups are O(1) |

---

## `GetFeed`: critical rules from Geotab docs

1. **Save `toVersion` *before* processing.** If you process records then crash, you lose them on restart.
2. **`fromDate` is used once only** — on the very first call to anchor your starting position. Never use it again.
3. **Use a root-group service account.** Scoped users make `GetFeed` significantly slower and can hit the 180s timeout.
4. **Don't filter inside `GetFeed`.** Pass filtering to `Get` instead. The only accepted `search` parameter in `GetFeed` is `fromDate` on the initial seed call.
5. **Poll adaptively** — immediately after a full batch (50k records), back off progressively when empty.

`FeedManager` enforces all five.

---

## Project structure

```
geotab-smart-sdk/
├── src/
│   ├── index.js                Public entry point — re-exports the SDK surface
│   ├── GeotabSDK.js            Main class: liveTracker(), history(), feeds(), ...
│   ├── core/
│   │   ├── Session.js          Auth + automatic re-auth on session expiry
│   │   └── RateLimiter.js      OverLimitException handling + Retry-After backoff
│   ├── constants/
│   │   └── Diagnostics.js      Named Diagnostic IDs, labels, and groups
│   ├── cache/
│   │   └── EntityCache.js      In-memory TTL cache (Device, Diagnostic, ...)
│   ├── feeds/
│   │   └── FeedManager.js      Adaptive GetFeed streaming + version tokens
│   ├── trackers/
│   │   └── LiveTracker.js      Live fleet tracking (DeviceStatusInfo + enrichment)
│   └── queries/
│       ├── HistoryQuery.js     Historical GPS + diagnostics + faults (paginated)
│       └── FleetSnapshot.js    Fleet-wide one-shot multiCall snapshot
└── examples/
    ├── live-tracking.js
    ├── historical-gps-diagnostics.js
    ├── fleet-snapshot.js
    └── continuous-feed-sync.js
```

---

## Requirements

- **Node.js ≥ 14**
- A valid MyGeotab account (username, password, database)
- For high-volume `GetFeed` usage, a **root-group service account** is strongly recommended

---

## Examples

Runnable examples live in [`examples/`](examples/). Each reads credentials from the environment:

```bash
export GEOTAB_USER='user@company.com'
export GEOTAB_PASS='secret'
export GEOTAB_DB='my_company'

node examples/live-tracking.js
node examples/historical-gps-diagnostics.js
node examples/fleet-snapshot.js
node examples/continuous-feed-sync.js
```

---

## Roadmap

- TypeScript type declarations — not shipped yet; PRs welcome
- Optional WebSocket-based live updates when Geotab releases a public push API
- Additional named diagnostic constants for the long tail of Geotab IDs

Contributions and issue reports are welcome.

---

## License

MIT
