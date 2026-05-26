# geotab-smart-sdk

[![npm](https://img.shields.io/npm/v/geotab-smart-sdk?color=cb3837&logo=npm)](https://www.npmjs.com/package/geotab-smart-sdk)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d?logo=node.js&logoColor=white)](#requirements)
[![Tests](https://img.shields.io/badge/tests-87%20passing-43853d)](https://kunalkamble.github.io/geotab-smart-sdk/#/guide)
[![Coverage](https://img.shields.io/badge/coverage-84%25-97ca00)](https://kunalkamble.github.io/geotab-smart-sdk/#/guide)
[![Docs](https://img.shields.io/badge/docs-live-0F6E56)](https://kunalkamble.github.io/geotab-smart-sdk/)
[![CI](https://github.com/kunalkamble/geotab-smart-sdk/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/kunalkamble/geotab-smart-sdk/actions/workflows/deploy-docs.yml)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-e91e63?logo=github-sponsors&logoColor=white)](https://github.com/sponsors/kunalkamble)

A smart, composable Node.js SDK for the [MyGeotab API](https://geotab.github.io/sdk/), built on top of [`mg-api-js`](https://www.npmjs.com/package/mg-api-js). Adaptive feeds, named diagnostics, two complementary trackers, group filtering, and a sandboxed playground — without locking you out of raw `call()` / `multiCall()`.

> **Looking for the full guide, comparisons, or an interactive playground?**
> → **[kunalkamble.github.io/geotab-smart-sdk](https://kunalkamble.github.io/geotab-smart-sdk/)**

---

## Install

```bash
npm install geotab-smart-sdk
```

Requires **Node.js ≥ 20**. The peer `mg-api-js` is installed automatically.

---

## Quick start

```js
const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');

const sdk = new GeotabSDK({
  username: 'user@company.com',
  password: 'secret',
  database: 'my_company',
});

await sdk.connect({ cacheDevices: true });

// Live tracking with bearing + fuel level — one multiCall per 5s poll
const tracker = sdk.liveTracker()
  .withDiagnostics([Diagnostics.FUEL_LEVEL])
  .withFaults()
  .pollEvery(5_000);

tracker.on('update', (vehicles) => {
  for (const v of vehicles) {
    console.log(v.device.name, v.location.bearing, v.diagnostics);
  }
});

await tracker.start();
```

---

## What's in the box

| Helper | Purpose |
|---|---|
| `sdk.liveTracker()` | Real-time tracking via `DeviceStatusInfo` (bearing/driver native) |
| `sdk.realtimeTracker()` | High-fidelity tracking via `LogRecord` GetFeed (derives bearing/isDriving) |
| `sdk.history()` / `historyMany()` / `historyByGroups()` | Historical GPS + diagnostics + faults + trips |
| `sdk.fleetSnapshot()` | Whole-fleet point-in-time picture with pre-computed summary |
| `sdk.feeds()` | Adaptive `GetFeed` streaming with crash-safe version tokens |
| `sdk.call()` / `sdk.multiCall()` | Direct API access — auto re-auth + rate-limit retry |
| `Diagnostics.*`, `DiagnosticGroups.*` | Named constants so you never type `'DiagnosticFuelLevelId'` again |

Plus: session persistence (skip the password on resume), `readOnly: true` mode for sandboxed UIs, group filtering across every helper, and a `RateLimiter` that honors `Retry-After`.

---

## Full documentation

Everything is on the live docs site:

- **[Guide](https://kunalkamble.github.io/geotab-smart-sdk/#/guide)** — prose reference: setup, sessions, group filtering, errors, GetFeed rules, testing
- **[Smart SDK Inspector](https://kunalkamble.github.io/geotab-smart-sdk/#/smart-sdk)** — interactive use cases, helper map, cheat sheet, side-by-side vs raw API
- **[Raw API Inspector](https://kunalkamble.github.io/geotab-smart-sdk/#/raw-api)** — entity-level reference for `mg-api-js` users
- **[Compare](https://kunalkamble.github.io/geotab-smart-sdk/#/compare)** — feature-by-feature comparison with raw `mg-api-js`
- **[Playground](https://kunalkamble.github.io/geotab-smart-sdk/#/playground)** — exercise the SDK against your fleet with credentials you supply; runs in `readOnly` mode by policy

---

## Examples

Runnable Node examples live in [`examples/`](examples/). Each reads credentials from `process.env`:

```bash
export GEOTAB_USER='user@company.com'
export GEOTAB_PASS='secret'
export GEOTAB_DB='my_company'

node examples/live-tracking.js
node examples/realtime-tracking.js
node examples/historical-gps-diagnostics.js
node examples/fleet-snapshot.js
node examples/continuous-feed-sync.js
```

---

## Requirements

- **Node.js ≥ 20** (uses `node:test` + built-in coverage)
- A valid MyGeotab account
- For high-volume `GetFeed`, a **root-group service account** is recommended

---

## Testing

```bash
npm test               # spec reporter
npm run test:watch     # dev loop
npm run test:coverage  # 84% lines, 81% branches, 76% functions
```

87 tests across 8 files using Node 20's built-in test runner — zero test-framework dependencies. CI gates the docs deploy on tests + lint.

---

## Sponsor

If this SDK has saved you time, consider [sponsoring on GitHub](https://github.com/sponsors/kunalkamble) — open source, MIT licensed, maintained on personal time. A star on the repo is honestly just as appreciated. See the [Sponsor page](https://kunalkamble.github.io/geotab-smart-sdk/#/sponsor) for ways to help.

---

## License

MIT — see [LICENSE](LICENSE).
