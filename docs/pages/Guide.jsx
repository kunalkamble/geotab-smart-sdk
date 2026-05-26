/**
 * Long-form prose reference for the SDK. Cross-cutting concepts
 * (authentication, group filtering, error handling, etc.) live here.
 * Per-helper details and runnable use-cases live in the Smart SDK
 * Inspector — this Guide links there rather than duplicating.
 */

const SECTIONS = [
  { id: 'install',     label: 'Install & quick start' },
  { id: 'sessions',    label: 'Authentication & sessions' },
  { id: 'helpers',     label: 'Helpers at a glance' },
  { id: 'groups',      label: 'Filtering by group' },
  { id: 'readonly',    label: 'Read-only mode' },
  { id: 'lifecycle',   label: 'Errors & rate limits' },
  { id: 'raw',         label: 'Raw API access' },
  { id: 'getfeed',     label: 'GetFeed rules' },
  { id: 'testing',     label: 'Testing' },
  { id: 'structure',   label: 'Project structure' },
];

function Code({ children }) {
  return (
    <pre className="guide-code"><code>{children}</code></pre>
  );
}

export default function Guide({ onNavigate }) {
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

      <nav className="guide-toc">
        {SECTIONS.map(s => (
          <a key={s.id} href={`#${s.id}`}>{s.label}</a>
        ))}
      </nav>

      {/* ─── Install & quick start ─────────────────────────────────────── */}
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

// Fail fast on bad credentials, warm device cache up front.
await sdk.connect({ cacheDevices: true });

// Then use any helper:
const fleet = await sdk.fleetSnapshot({ include: { liveStatus: true } });`}</Code>
      </section>

      {/* ─── Sessions ──────────────────────────────────────────────────── */}
      <section id="sessions" className="guide-section">
        <h2>Authentication & sessions</h2>
        <p>
          On <code>connect()</code> the SDK calls MyGeotab's <code>Authenticate</code> method,
          stores the resulting <strong>session ID</strong>, and re-uses it for every subsequent
          call. A session is valid for up to <strong>14 days</strong> — capture it once and skip
          the password on later runs.
        </p>
        <Code>{`// First run — sign in with a password, then save the session
const sdk = new GeotabSDK({ username, password, database });
await sdk.connect();
const session = sdk.getSession();   // { sessionId, userName, database, server }
fs.writeFileSync('session.json', JSON.stringify(session));

// Next run — resume without the password
const saved = JSON.parse(fs.readFileSync('session.json', 'utf8'));
const sdk2 = new GeotabSDK({
  username:  saved.userName,
  database:  saved.database,
  sessionId: saved.sessionId,
  server:    saved.server,
});
await sdk2.connect();`}</Code>
        <p>
          If the saved <code>sessionId</code> has expired, <code>connect()</code> throws
          {' '}<code>InvalidUserException</code>. Catch it and prompt for a fresh password.
          When both <code>password</code> and <code>sessionId</code> are supplied,
          {' '}<code>mg-api-js</code> tries the session first and falls back to the password.
        </p>
        <p>
          For long-running processes, listen for the <code>authenticated</code> event and
          persist the session every time it refreshes:
        </p>
        <Code>{`sdk.on('authenticated', (session) => persist(session));`}</Code>
      </section>

      {/* ─── Helpers at a glance ───────────────────────────────────────── */}
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

      {/* ─── Group filtering ───────────────────────────────────────────── */}
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
        <Code>{`// Trackers + snapshot
sdk.liveTracker().forGroups(['groupCompanyId']).start();
sdk.realtimeTracker().forGroups(['groupCompanyId']).start();
await sdk.fleetSnapshot({ groupIds: ['groupCompanyId'], include: {...} });

// History across an entire group
const histories = await sdk.historyByGroups(['groupCompanyId'], {
  from, to, include: { gps: true, faults: true },
});

// Cache scoping at connect time
await sdk.connect({ cacheGroups: ['groupCompanyId'] });`}</Code>
        <p>
          The SDK does <em>not</em> blindly trust Geotab's server-side group filter on
          {' '}<code>DeviceStatusInfo</code>/<code>StatusData</code>/<code>FaultData</code> —
          some tenants silently ignore it. When a device cache is available
          (warmed by <code>connect({'{ cacheDevices: true }'})</code>), the SDK
          double-checks group membership on the client to guarantee correct results.
        </p>
      </section>

      {/* ─── Read-only mode ────────────────────────────────────────────── */}
      <section id="readonly" className="guide-section">
        <h2>Read-only mode</h2>
        <p>
          The SDK by default forwards any JSON-RPC method you pass to
          {' '}<code>sdk.call()</code> or <code>sdk.multiCall()</code> — including
          mutations (<code>Set</code>, <code>Add</code>, <code>Remove</code>,
          {' '}<code>Execute*</code>). For sandboxed UIs or demos that must never
          mutate fleet data, opt into read-only mode:
        </p>
        <Code>{`const sdk = new GeotabSDK(
  { username, password, database },
  { readOnly: true }
);

await sdk.call('Get', { typeName: 'Device' });   // ✓ allowed
await sdk.call('Set', { typeName: 'Group' });    // ✗ throws ReadOnlyViolation`}</Code>
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

      {/* ─── Lifecycle ─────────────────────────────────────────────────── */}
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
        <Code>{`try {
  await sdk.call('Get', { typeName: 'Device' });
} catch (err) {
  err.code;     // e.g. 'OverLimitException', 'InvalidUserException', 'ReadOnlyViolation'
  err.context;  // 'Get', 'multiCall', etc.
  err.raw;      // original error from mg-api-js
}`}</Code>
        <p>
          For <code>LiveTracker</code> / <code>RealtimeTracker</code> / <code>FeedManager</code>,
          subscribe to the <code>'error'</code> event — these are non-fatal and the loop keeps
          running on the next tick.
        </p>
      </section>

      {/* ─── Raw API ───────────────────────────────────────────────────── */}
      <section id="raw" className="guide-section">
        <h2>Raw API access</h2>
        <p>
          The SDK never hides the underlying API. Reach for <code>call()</code> or
          {' '}<code>multiCall()</code> whenever the helpers don't cover what you need:
        </p>
        <Code>{`// Single call
const devices = await sdk.call('Get', { typeName: 'Device', search: {} });

// multiCall — order-preserving
const [devices, statuses] = await sdk.multiCall([
  ['Get', { typeName: 'Device',           search: {} }],
  ['Get', { typeName: 'DeviceStatusInfo', search: {} }],
]);`}</Code>
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

      {/* ─── GetFeed rules ─────────────────────────────────────────────── */}
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

      {/* ─── Testing ───────────────────────────────────────────────────── */}
      <section id="testing" className="guide-section">
        <h2>Testing</h2>
        <p>
          The SDK ships <strong>43 unit tests</strong> across five files using Node 20's
          built-in test runner — <em>zero test-framework dependencies</em>. Latest coverage:
          {' '}78% lines / 74% branches / 58% functions. CI gates the docs deploy on tests + lint.
        </p>
        <Code>{`npm test               # spec reporter, ~75 ms
npm run test:watch     # rerun on file change
npm run test:coverage  # built-in coverage report`}</Code>
      </section>

      {/* ─── Project structure ─────────────────────────────────────────── */}
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
