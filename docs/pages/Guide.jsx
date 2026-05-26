/**
 * Long-form prose reference for the SDK. Cross-cutting concepts
 * (authentication, group filtering, error handling, etc.) live here.
 * Per-helper details and runnable use-cases live in the Smart SDK
 * Inspector — this Guide links there rather than duplicating.
 */

import { useState } from 'react';

const SECTIONS = [
  { id: 'install',     label: 'Install & quick start',     icon: 'ti-download' },
  { id: 'sessions',    label: 'Authentication & sessions', icon: 'ti-key' },
  { id: 'helpers',     label: 'Helpers at a glance',       icon: 'ti-tools' },
  { id: 'groups',      label: 'Filtering by group',        icon: 'ti-filter' },
  { id: 'readonly',    label: 'Read-only mode',            icon: 'ti-lock' },
  { id: 'lifecycle',   label: 'Errors & rate limits',      icon: 'ti-alert-triangle' },
  { id: 'raw',         label: 'Raw API access',            icon: 'ti-terminal-2' },
  { id: 'getfeed',     label: 'GetFeed rules',             icon: 'ti-arrows-double-ne-sw' },
  { id: 'testing',     label: 'Testing',                   icon: 'ti-test-pipe' },
  { id: 'structure',   label: 'Project structure',         icon: 'ti-folders' },
];

function Code({ children }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers / insecure contexts — clipboard API unavailable.
      // The user can still select + copy manually, so we silently no-op.
    }
  }

  return (
    <div className="guide-code-wrap">
      <pre className="guide-code"><code>{children}</code></pre>
      <button
        type="button"
        className={`guide-code-copy ${copied ? 'copied' : ''}`}
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
      >
        <i className={`ti ${copied ? 'ti-check' : 'ti-copy'}`} aria-hidden="true" />
        <span>{copied ? 'copied' : 'copy'}</span>
      </button>
    </div>
  );
}

export default function Guide({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('install');

  return (
    <div className="page-guide">
      <p className="page-lede">
        Prose reference for <code>geotab-smart-sdk</code>. The{' '}
        <button className="link-button" onClick={() => onNavigate('smart-sdk')}>
          Smart SDK inspector
        </button>{' '}
        covers each helper interactively; this guide is for cross-cutting
        topics like authentication, error handling, and group filtering.
      </p>

      <nav className="guide-tabs" role="tablist" aria-label="Guide sections">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            role="tab"
            aria-selected={activeTab === s.id}
            className={`guide-tab ${activeTab === s.id ? 'active' : ''}`}
            onClick={() => setActiveTab(s.id)}
          >
            <i className={`ti ${s.icon}`} aria-hidden="true" />
            <span>{s.label}</span>
          </button>
        ))}
      </nav>

      {/* ─── Install & quick start ─────────────────────────────────────── */}
      {activeTab === 'install' && (
      <section id="install" className="guide-section">
        <h2>Install & quick start</h2>
        <Code>{`npm install geotab-smart-sdk`}</Code>
        <p>
          Construct an SDK, connect, and you're ready. The same pattern works in Node, Deno,
          and modern browsers (no Node built-ins required at runtime).
        </p>
        <Code>{`const { GeotabSDK, Diagnostics } = require('geotab-smart-sdk');

const sdk = new GeotabSDK({
  username: 'user@company.com',
  password: 'secret',
  database: 'my_company',
  server:   'my.geotab.com',   // optional — defaults to my.geotab.com
});

(async () => {
  // Fail fast on bad credentials, warm device cache up front.
  await sdk.connect({ cacheDevices: true });

  // Then use any helper:
  const fleet = await sdk.fleetSnapshot({ include: { liveStatus: true } });
  console.log(fleet.summary);
})();`}</Code>
      </section>
      )}

      {/* ─── Sessions ──────────────────────────────────────────────────── */}
      {activeTab === 'sessions' && (
      <section id="sessions" className="guide-section">
        <h2>Authentication & sessions</h2>

        <p>
          <strong>TL;DR — you don't need to manage anything.</strong>{' '}
          Construct an SDK with your credentials, call <code>connect()</code>, and forget about it.
          The SDK keeps the session alive, refreshes it when MyGeotab expires it,
          and retries the failed call for you. The rest of this section is only
          relevant if your process restarts often and you want to skip the password
          on each restart.
        </p>

        <h3>The simple case (covers ~90% of apps)</h3>
        <Code>{`const { GeotabSDK } = require('geotab-smart-sdk');

const sdk = new GeotabSDK({
  username: 'user@company.com',
  password: 'secret',
  database: 'my_company',
});

(async () => {
  await sdk.connect();

  // Every call from here on reuses the same session automatically.
  // No re-auth code, no token plumbing, no second SDK instance.
  await sdk.call('Get', { typeName: 'Device' });
  await sdk.call('Get', { typeName: 'DeviceStatusInfo' });
})();`}</Code>
        <p>
          One SDK, one <code>connect()</code>, then call whatever you need for the
          life of the process. If MyGeotab returns <code>InvalidUserException</code>{' '}
          on a later call (sessions expire after 14 days), the SDK re-authenticates
          with the password you already gave it and retries the call. You never see
          the expiry.
        </p>

        <h3>When you need session persistence</h3>
        <p>
          The 14-day session is useful if your <em>process</em> restarts frequently —
          a CLI tool you run repeatedly, a desktop app that reconnects on launch,
          a serverless function. Skip the password roundtrip on each restart by
          persisting the sessionId from one run, then constructing the next run's
          SDK with it. <strong>The two snippets below run in separate process executions —
          not back-to-back.</strong>
        </p>
        <Code>{`// ─── Run #1: authenticate normally, then save the session ─────────
const { GeotabSDK } = require('geotab-smart-sdk');

const sdk = new GeotabSDK({ username, password, database });

(async () => {
  await sdk.connect();
  const session = sdk.getSession();
  // → { sessionId, userName, database, server }

  await saveSomewhere(session);  // see "Where to store it" below
})();`}</Code>
        <Code>{`// ─── Run #2 (any time within 14 days): resume without the password ─
const { GeotabSDK } = require('geotab-smart-sdk');

(async () => {
  const session = await loadSomewhere();

  const sdk = new GeotabSDK({
    userName:  session.userName,
    database:  session.database,
    sessionId: session.sessionId,   // password not required
    server:    session.server,
  });

  await sdk.connect();             // no password roundtrip
  await sdk.call('Get', { typeName: 'Device' });
})();`}</Code>
        <p>
          If the saved sessionId has expired, <code>sdk.connect()</code> throws{' '}
          <code>InvalidUserException</code>. Catch it and prompt the user for a
          fresh password — or, simpler, always supply both <code>password</code> and{' '}
          <code>sessionId</code>: mg-api-js tries the session first and silently
          falls back to the password if it's stale.
        </p>
        <p>
          For long-running processes that you also want to checkpoint as the session
          refreshes mid-run, listen for the <code>authenticated</code> event:
        </p>
        <Code>{`sdk.on('authenticated', (session) => saveSomewhere(session));`}</Code>

        <h3>Where to store it</h3>
        <p>
          The <code>sessionId</code> is a <strong>bearer credential</strong> — anyone who
          reads it can call the API as the user for up to 14 days. It's safer than
          a password (revocable, time-bound), but still a secret. Pick a store
          that matches your threat model:
        </p>
        <table className="guide-table">
          <thead>
            <tr><th>Context</th><th>Where to put it</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Personal CLI / scripts</td>
              <td>File under <code>~/.config/yourapp/</code>, <code>chmod 0600</code></td>
            </tr>
            <tr>
              <td>Browser app (first-party)</td>
              <td><code>localStorage</code> — same trust boundary as a cookie</td>
            </tr>
            <tr>
              <td>Desktop app</td>
              <td>OS keychain — <code>keytar</code> on Node, <code>safeStorage</code> in Electron</td>
            </tr>
            <tr>
              <td>Server / multi-tenant</td>
              <td>Encrypted DB column, Redis with auth, or a secrets manager — <em>never</em> plaintext on disk</td>
            </tr>
            <tr>
              <td>Lambda / serverless</td>
              <td>Don't persist between invocations — let the SDK re-auth from a password held in a secrets manager, or centralize sessions in a shared store</td>
            </tr>
          </tbody>
        </table>
        <p>
          One firm rule: <strong>never persist the password the same way you persist the sessionId.</strong>{' '}
          A leaked sessionId expires; a leaked password doesn't.
        </p>
      </section>
      )}

      {/* ─── Helpers at a glance ───────────────────────────────────────── */}
      {activeTab === 'helpers' && (
      <section id="helpers" className="guide-section">
        <h2>Helpers at a glance</h2>
        <p>
          Five use-case helpers cover the common patterns; each is documented
          in depth in the{' '}
          <button className="link-button" onClick={() => onNavigate('smart-sdk')}>
            Smart SDK inspector
          </button>.
        </p>
        <table className="guide-table">
          <thead>
            <tr><th>Helper</th><th>What it does</th><th>Use it for</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>sdk.liveTracker()</code></td>
              <td>Polls <code>DeviceStatusInfo</code> — one record per vehicle with bearing/driver/isDriving native</td>
              <td>Dashboards, "current state per vehicle"</td>
            </tr>
            <tr>
              <td><code>sdk.realtimeTracker()</code></td>
              <td>Polls <code>LogRecord</code> via GetFeed — every GPS fix; bearing & isDriving derived</td>
              <td>Map animation, geofencing, per-fix workflows</td>
            </tr>
            <tr>
              <td><code>sdk.history(opts)</code></td>
              <td>Historical GPS + diagnostics + faults + trips for one device, one composed multiCall</td>
              <td>Trip playback, day-of analysis</td>
            </tr>
            <tr>
              <td><code>sdk.fleetSnapshot(opts)</code></td>
              <td>Whole-fleet point-in-time snapshot with pre-computed summary</td>
              <td>Dashboard initial load, reports</td>
            </tr>
            <tr>
              <td><code>sdk.feeds()</code></td>
              <td>Adaptive <code>GetFeed</code> streaming with crash-safe version tokens</td>
              <td>Continuous sync to your own DB</td>
            </tr>
          </tbody>
        </table>
        <p>
          For anything the helpers don't cover, <code>sdk.call(method, params)</code> and
          {' '}<code>sdk.multiCall([...])</code> stay available as escape hatches with the same
          auto re-auth + rate-limit retry behavior.
        </p>
      </section>
      )}

      {/* ─── Group filtering ───────────────────────────────────────────── */}
      {activeTab === 'groups' && (
      <section id="groups" className="guide-section">
        <h2>Filtering by group</h2>
        <p>
          Every helper supports filtering by Geotab group ID — useful for
          large fleets where your app only operates on one division.
        </p>
        <table className="guide-table">
          <thead>
            <tr><th>Helper</th><th>Surface</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>sdk.liveTracker()</code></td>
              <td><code>.forGroups([ids])</code> — server-side on DSI / StatusData / FaultData, with client-side fallback when Geotab's server filter is unreliable</td>
            </tr>
            <tr>
              <td><code>sdk.realtimeTracker()</code></td>
              <td><code>.forGroups([ids])</code> — server-side on StatusData / FaultData / DriverChange, client-side on LogRecord (GetFeed can't filter)</td>
            </tr>
            <tr>
              <td><code>sdk.fleetSnapshot({'{ groupIds }'})</code></td>
              <td>Applied to every entity in the snapshot. The summary counts reflect the filtered fleet.</td>
            </tr>
            <tr>
              <td><code>sdk.historyByGroups([ids], options)</code></td>
              <td>Resolves groups → device list (one <code>Get(Device)</code> call), then delegates to <code>historyMany</code>.</td>
            </tr>
            <tr>
              <td><code>sdk.connect({'{ cacheGroups: [ids] }'})</code></td>
              <td>Scopes the device cache to specific groups at startup. Implies <code>cacheDevices</code>.</td>
            </tr>
          </tbody>
        </table>
        <Code>{`(async () => {
  // Cache scoping at connect time.
  await sdk.connect({ cacheGroups: ['groupCompanyId'] });

  // Trackers fire-and-forget — .start() is synchronous.
  sdk.liveTracker().forGroups(['groupCompanyId']).start();
  sdk.realtimeTracker().forGroups(['groupCompanyId']).start();

  // Fleet snapshot scoped to a group.
  const fleet = await sdk.fleetSnapshot({
    groupIds: ['groupCompanyId'],
    include: { liveStatus: true },
  });

  // History across every device in the group.
  const histories = await sdk.historyByGroups(['groupCompanyId'], {
    from: new Date(Date.now() - 24 * 60 * 60 * 1000),
    to:   new Date(),
    include: { gps: true, faults: true },
  });
})();`}</Code>
        <p>
          The SDK does <em>not</em> blindly trust Geotab's server-side group filter on
          {' '}<code>DeviceStatusInfo</code>/<code>StatusData</code>/<code>FaultData</code> —
          some tenants silently ignore it. When a device cache is available
          (warmed by <code>connect({'{ cacheDevices: true }'})</code>), the SDK
          double-checks group membership on the client to guarantee correct results.
        </p>
      </section>
      )}

      {/* ─── Read-only mode ────────────────────────────────────────────── */}
      {activeTab === 'readonly' && (
      <section id="readonly" className="guide-section">
        <h2>Read-only mode</h2>
        <p>
          The SDK by default forwards any JSON-RPC method you pass to
          {' '}<code>sdk.call()</code> or <code>sdk.multiCall()</code> — including
          mutations (<code>Set</code>, <code>Add</code>, <code>Remove</code>,
          {' '}<code>Execute*</code>). For sandboxed UIs or demos that must never
          mutate fleet data, opt into read-only mode:
        </p>
        <Code>{`const { GeotabSDK } = require('geotab-smart-sdk');

const sdk = new GeotabSDK(
  { username, password, database },
  { readOnly: true }
);

(async () => {
  await sdk.connect();
  await sdk.call('Get', { typeName: 'Device' });   // ✓ allowed
  await sdk.call('Set', { typeName: 'Group' });    // ✗ throws ReadOnlyViolation
})();`}</Code>
        <p>
          The check is a <code>Get*</code> allowlist applied <strong>before</strong> the
          HTTP request leaves the process. It covers <code>Get</code>, <code>GetFeed</code>,
          {' '}<code>GetCountOf</code>, <code>GetFeedCountOf</code>, <code>GetSession</code>,
          {' '}<code>GetVersion</code>, and any future <code>Get*</code>-prefixed method
          (case-insensitive). The thrown error carries
          {' '}<code>code: 'ReadOnlyViolation'</code> and <code>method</code> so callers
          can surface it cleanly.
        </p>
        <p>
          All built-in helpers (<code>liveTracker</code>, <code>realtimeTracker</code>,
          {' '}<code>history</code>, <code>fleetSnapshot</code>, <code>feeds</code>,
          {' '}<code>connect</code>) only issue <code>Get*</code> calls, so they work
          transparently in read-only mode.
        </p>
      </section>
      )}

      {/* ─── Lifecycle ─────────────────────────────────────────────────── */}
      {activeTab === 'lifecycle' && (
      <section id="lifecycle" className="guide-section">
        <h2>Errors & rate limits</h2>
        <p>
          <strong>Session expiry</strong> is handled transparently — the SDK detects
          {' '}<code>InvalidUserException</code> and re-authenticates before retrying. Your
          {' '}<code>call()</code>/<code>multiCall()</code> succeed without you doing anything.
        </p>
        <p>
          <strong>Rate limits</strong>: the internal <code>RateLimiter</code> catches Geotab's
          {' '}<code>OverLimitException</code>, honors the API's <code>Retry-After</code>, and
          retries once. All built-in helpers are wrapped automatically.
        </p>
        <p>
          <strong>Error shape</strong>: errors thrown by <code>sdk.call</code> / <code>sdk.multiCall</code> carry:
        </p>
        <Code>{`(async () => {
  try {
    await sdk.call('Get', { typeName: 'Device' });
  } catch (err) {
    err.code;     // e.g. 'OverLimitException', 'InvalidUserException', 'ReadOnlyViolation'
    err.context;  // 'Get', 'multiCall', etc.
    err.raw;      // original error from mg-api-js
  }
})();`}</Code>
        <p>
          For <code>LiveTracker</code> / <code>RealtimeTracker</code> / <code>FeedManager</code>,
          subscribe to the <code>'error'</code> event — these are non-fatal and the loop keeps
          running on the next tick.
        </p>
      </section>
      )}

      {/* ─── Raw API ───────────────────────────────────────────────────── */}
      {activeTab === 'raw' && (
      <section id="raw" className="guide-section">
        <h2>Raw API access</h2>
        <p>
          The SDK never hides the underlying API. Reach for <code>call()</code> or
          {' '}<code>multiCall()</code> whenever the helpers don't cover what you need:
        </p>
        <Code>{`(async () => {
  // Single call
  const devices = await sdk.call('Get', { typeName: 'Device', search: {} });

  // multiCall — order-preserving
  const [devs, statuses] = await sdk.multiCall([
    ['Get', { typeName: 'Device',           search: {} }],
    ['Get', { typeName: 'DeviceStatusInfo', search: {} }],
  ]);
})();`}</Code>
        <p>
          Use the{' '}
          <button className="link-button" onClick={() => onNavigate('raw-api')}>
            Raw API inspector
          </button>{' '}
          if you're not sure which entity carries which field — it's a field-by-field map
          of <code>LogRecord</code> / <code>DeviceStatusInfo</code> / <code>StatusData</code>
          {' '}/ <code>FaultData</code> / <code>Trip</code> with the common gotchas annotated.
        </p>
      </section>
      )}

      {/* ─── GetFeed rules ─────────────────────────────────────────────── */}
      {activeTab === 'getfeed' && (
      <section id="getfeed" className="guide-section">
        <h2>GetFeed: critical rules from Geotab docs</h2>
        <ol>
          <li>
            <strong>Save <code>toVersion</code> before processing.</strong> If you process records then crash, you lose them on restart.
          </li>
          <li>
            <strong><code>fromDate</code> is used once only</strong> — on the very first call to anchor your starting position. Never use it again.
          </li>
          <li>
            <strong>Use a root-group service account.</strong> Scoped users make <code>GetFeed</code> significantly slower and can hit the 180s timeout.
          </li>
          <li>
            <strong>Don't filter inside <code>GetFeed</code>.</strong> Pass filtering to <code>Get</code> instead. The only accepted <code>search</code> parameter in <code>GetFeed</code> is <code>fromDate</code> on the initial seed call.
          </li>
          <li>
            <strong>Poll adaptively</strong> — immediately after a full batch (50k records), back off progressively when empty.
          </li>
        </ol>
        <p>
          <code>FeedManager</code> enforces all five — see{' '}
          <button className="link-button" onClick={() => onNavigate('smart-sdk')}>Smart SDK → Feeds</button>
          {' '}for the runnable pattern.
        </p>
      </section>
      )}

      {/* ─── Testing ───────────────────────────────────────────────────── */}
      {activeTab === 'testing' && (
      <section id="testing" className="guide-section">
        <h2>Testing</h2>
        <p>
          The SDK ships <strong>89 unit tests</strong> across 8 files using Node 20's
          built-in <code>node:test</code> runner — <em>zero test-framework dependencies</em>.
          Latest coverage: <strong>84% lines / 80% branches / 75% functions</strong>.
          CI gates the docs deploy on tests + lint.
        </p>
        <Code>{`npm test               # spec reporter
npm run test:watch     # rerun on file change
npm run test:coverage  # built-in coverage report`}</Code>
        <p>
          Requires <strong>Node.js ≥ 20</strong> — earlier versions don't ship
          {' '}<code>node:test</code> with the experimental coverage flag we rely on.
        </p>
      </section>
      )}

      {/* ─── Project structure ─────────────────────────────────────────── */}
      {activeTab === 'structure' && (
      <section id="structure" className="guide-section">
        <h2>Project structure</h2>
        <Code>{`geotab-smart-sdk/
├── src/
│   ├── index.js                # Public entry point
│   ├── GeotabSDK.js            # Main class — liveTracker(), history(), feeds(), ...
│   ├── core/
│   │   ├── Session.js          # Auth + auto re-auth + read-only guard
│   │   ├── RateLimiter.js      # OverLimitException + Retry-After backoff
│   │   └── EventEmitter.js     # Minimal, bundler-friendly EE (no Node 'events' dep)
│   ├── constants/Diagnostics.js
│   ├── cache/EntityCache.js
│   ├── feeds/FeedManager.js    # GetFeed streaming + version tokens
│   ├── trackers/
│   │   ├── LiveTracker.js      # DeviceStatusInfo snapshot tracking
│   │   └── RealtimeTracker.js  # LogRecord high-fidelity tracking
│   └── queries/
│       ├── HistoryQuery.js
│       └── FleetSnapshot.js
├── examples/                   # Runnable Node examples
└── test/                       # node:test unit tests (not shipped to npm)`}</Code>
        <p>
          Only <code>src/</code>, <code>examples/</code>, <code>README.md</code>, and
          {' '}<code>LICENSE</code> ship to npm — the <code>docs/</code> site,
          {' '}<code>test/</code> directory, and tooling stay in the repo.
        </p>
      </section>
      )}

      <div className="guide-cta">
        <button className="btn btn-primary" onClick={() => onNavigate('playground')}>
          <i className="ti ti-flask" aria-hidden="true" />
          Try it in the Playground
        </button>
        <button className="btn btn-ghost" onClick={() => onNavigate('smart-sdk')}>
          <i className="ti ti-code" aria-hidden="true" />
          Open the Smart SDK Inspector
        </button>
      </div>
    </div>
  );
}
