import { useState, useMemo } from 'react';
import { Diagnostics } from 'geotab-smart-sdk';

// ─── Helper catalogue ───────────────────────────────────────────────────────
// Every public SDK helper that lives behind a fluent / options-based API.
// The form on the right-hand side is rendered per `kind` so the metadata
// stays declarative — adding a new helper means adding an entry here plus
// (if needed) a new branch in renderForHelper().
const HELPERS = [
  {
    id: 'liveTracker',
    label: 'Live tracker',
    method: 'sdk.liveTracker()',
    icon: 'ti-map-pin',
    tagline: 'DeviceStatusInfo snapshot — one record per vehicle per poll.',
  },
  {
    id: 'realtimeTracker',
    label: 'Realtime tracker',
    method: 'sdk.realtimeTracker()',
    icon: 'ti-broadcast',
    tagline: 'LogRecord stream — every GPS fix, with derived bearing & isDriving.',
  },
  {
    id: 'history',
    label: 'Historical query',
    method: 'sdk.history() / .historyMany() / .historyByGroups()',
    icon: 'ti-route',
    tagline: 'GPS + diagnostics + faults over a time range.',
  },
  {
    id: 'fleetSnapshot',
    label: 'Fleet snapshot',
    method: 'sdk.fleetSnapshot()',
    icon: 'ti-dashboard',
    tagline: 'Whole-fleet picture in one round-trip, with a pre-computed summary.',
  },
  {
    id: 'feeds',
    label: 'Continuous sync',
    method: 'sdk.feeds()',
    icon: 'ti-arrows-double-ne-sw',
    tagline: 'Adaptive GetFeed streaming with version tokens.',
  },
];

// Diagnostics are pulled live from the SDK so the picker stays in sync if
// new constants are added. The "label" is the JS identifier (Diagnostics.X)
// so the code generator can emit it verbatim.
const DIAGNOSTIC_OPTIONS = Object.entries(Diagnostics)
  .map(([key, value]) => ({ key, value }))
  .sort((a, b) => a.key.localeCompare(b.key));

// Default form state per helper. Kept in one object so switching helpers
// preserves what you typed under another.
function defaultConfig() {
  return {
    liveTracker: {
      diagnostics: [],   // array of Diagnostics keys (e.g. ['FUEL_LEVEL'])
      faults: false,
      devices: '',       // comma-separated text
      groups: '',
      pollEvery: 5000,
    },
    realtimeTracker: {
      diagnostics: [],
      ignition: true,
      driver: true,
      faults: false,
      devices: '',
      groups: '',
      pollEvery: 5000,
      speedThreshold: 5,
    },
    history: {
      subMode: 'single',          // 'single' | 'many' | 'groups'
      deviceId: 'b1',
      deviceIds: 'b1, b2',
      groupIds: 'groupCompanyId',
      from: '2024-01-15T00:00:00Z',
      to:   '2024-01-15T23:59:59Z',
      gps: true,
      trips: false,
      faults: false,
      diagnostics: [],
      computeBearing: true,
    },
    fleetSnapshot: {
      devices: true,
      liveStatus: true,
      activeFaults: false,
      diagnostics: [],
      recentTrips: 0,             // 0 = not included
      groupIds: '',
    },
    feeds: {
      feeds: [{ type: 'LogRecord', source: 'fromVersion', value: '' }],
    },
  };
}

// ─── Code generation ────────────────────────────────────────────────────────
// Each generator returns a complete runnable Node snippet. Wrappers (the
// require + async main + .catch) live in `wrap()` so per-helper builders
// stay focused on the helper-specific lines.
function csvToArray(s) {
  return s.split(',').map(x => x.trim()).filter(Boolean);
}
function arrayLiteral(items) {
  // Diagnostics IDs are emitted as `Diagnostics.KEY` (not string literals).
  // String IDs (devices, groups) are quoted.
  return '[' + items.join(', ') + ']';
}
function quoted(arr) {
  return arr.map(x => `'${x}'`);
}
function diagList(keys) {
  return keys.map(k => `Diagnostics.${k}`);
}

function wrap(imports, body) {
  return `const { ${imports} } = require('geotab-smart-sdk');

const sdk = new GeotabSDK({
  username: process.env.GEOTAB_USER,
  password: process.env.GEOTAB_PASS,
  database: process.env.GEOTAB_DB,
});

async function main() {
  await sdk.connect({ cacheDevices: true });

${body}
}

main().catch((err) => { console.error(err); process.exit(1); });`;
}

function genLiveTracker(c) {
  const calls = [];
  if (c.diagnostics.length) calls.push(`    .withDiagnostics(${arrayLiteral(diagList(c.diagnostics))})`);
  if (c.faults)             calls.push(`    .withFaults()`);
  const devs = csvToArray(c.devices);
  const grps = csvToArray(c.groups);
  if (devs.length) calls.push(`    .forDevices(${arrayLiteral(quoted(devs))})`);
  if (grps.length) calls.push(`    .forGroups(${arrayLiteral(quoted(grps))})`);
  if (c.pollEvery && c.pollEvery !== 5000) calls.push(`    .pollEvery(${c.pollEvery})`);

  const imports = c.diagnostics.length ? 'GeotabSDK, Diagnostics' : 'GeotabSDK';
  const chain = calls.length ? '\n' + calls.join('\n') : '';
  return wrap(imports,
`  const tracker = sdk.liveTracker()${chain};

  tracker.on('update', (vehicles) => {
    for (const v of vehicles) {
      console.log(v.device.name, v.location?.bearing, v.isDriving);
    }
  });
  tracker.on('error', (err) => console.error(err));

  await tracker.start();
  // tracker.stop();`);
}

function genRealtimeTracker(c) {
  const calls = [];
  if (c.diagnostics.length) calls.push(`    .withDiagnostics(${arrayLiteral(diagList(c.diagnostics))})`);
  if (c.ignition)           calls.push(`    .withIgnition()`);
  if (c.driver)             calls.push(`    .withDriverAttribution()`);
  if (c.faults)             calls.push(`    .withFaults()`);
  const devs = csvToArray(c.devices);
  const grps = csvToArray(c.groups);
  if (devs.length) calls.push(`    .forDevices(${arrayLiteral(quoted(devs))})`);
  if (grps.length) calls.push(`    .forGroups(${arrayLiteral(quoted(grps))})`);
  if (c.pollEvery && c.pollEvery !== 5000) calls.push(`    .pollEvery(${c.pollEvery})`);
  if (c.speedThreshold !== 5) calls.push(`    .drivingSpeedThreshold(${c.speedThreshold})`);

  const imports = c.diagnostics.length ? 'GeotabSDK, Diagnostics' : 'GeotabSDK';
  const chain = calls.length ? '\n' + calls.join('\n') : '';
  return wrap(imports,
`  const tracker = sdk.realtimeTracker()${chain};

  tracker.on('update', (vehicles) => {
    for (const v of vehicles) {
      console.log(v.device.name, v.location?.latitude, v.location?.longitude);
    }
  });
  tracker.on('error', (err) => console.error(err));

  await tracker.start();
  // tracker.stop();`);
}

function genHistory(c) {
  const include = [];
  if (c.gps)            include.push('    gps:         true');
  if (c.trips)          include.push('    trips:       true');
  if (c.faults)         include.push('    faults:      true');
  if (c.diagnostics.length) {
    include.push(`    diagnostics: ${arrayLiteral(diagList(c.diagnostics))}`);
  }
  const includeBlock = include.length ? `\n${include.join(',\n')},\n  ` : '';
  const bearing = c.computeBearing ? ',\n    computeBearing: true' : '';
  const imports = c.diagnostics.length ? 'GeotabSDK, Diagnostics' : 'GeotabSDK';

  const fromTo = `    from: new Date('${c.from}'),
    to:   new Date('${c.to}'),`;

  if (c.subMode === 'single') {
    return wrap(imports,
`  const data = await sdk.history({
    deviceId: '${c.deviceId || 'b1'}',
${fromTo}
    include: {${includeBlock}}${bearing}
  });

  console.log(\`\${data.gps.length} GPS points\`);`);
  }
  if (c.subMode === 'many') {
    const ids = csvToArray(c.deviceIds);
    return wrap(imports,
`  const results = await sdk.historyMany(${arrayLiteral(quoted(ids.length ? ids : ['b1', 'b2']))}, {
${fromTo}
    include: {${includeBlock}}${bearing}
  });

  for (const r of results) {
    console.log(r.deviceId, r.gps.length);
  }`);
  }
  // subMode === 'groups'
  const ids = csvToArray(c.groupIds);
  return wrap(imports,
`  const results = await sdk.historyByGroups(${arrayLiteral(quoted(ids.length ? ids : ['groupCompanyId']))}, {
${fromTo}
    include: {${includeBlock}}${bearing}
  });

  for (const r of results) {
    console.log(r.deviceId, r.gps.length);
  }`);
}

function genFleetSnapshot(c) {
  const include = [];
  if (c.devices)      include.push('    devices:      true');
  if (c.liveStatus)   include.push('    liveStatus:   true');
  if (c.activeFaults) include.push('    activeFaults: true');
  if (c.diagnostics.length) {
    include.push(`    diagnostics:  ${arrayLiteral(diagList(c.diagnostics))}`);
  }
  if (c.recentTrips > 0) include.push(`    recentTrips:  ${c.recentTrips}`);
  const includeBlock = include.length ? `\n${include.join(',\n')},\n  ` : '';
  const grps = csvToArray(c.groupIds);
  const groupLine = grps.length ? `,\n    groupIds: ${arrayLiteral(quoted(grps))}` : '';
  const imports = c.diagnostics.length ? 'GeotabSDK, Diagnostics' : 'GeotabSDK';

  return wrap(imports,
`  const fleet = await sdk.fleetSnapshot({
    include: {${includeBlock}}${groupLine}
  });

  console.log(fleet.summary);`);
}

function genFeeds(c) {
  const adds = c.feeds.filter(f => f.type).map(f => {
    if (f.source === 'fromDate') {
      const dateStr = f.value || '2024-01-15';
      return `    .addFeed('${f.type}', { fromDate: new Date('${dateStr}') })`;
    }
    const v = f.value ? `'${f.value}'` : 'null';
    return `    .addFeed('${f.type}', { fromVersion: ${v} })`;
  });
  const chain = adds.length ? '\n' + adds.join('\n') : '';

  return wrap('GeotabSDK',
`  const feeds = sdk.feeds()${chain};

  // Persist the token BEFORE processing — that's the crash-safety contract.
  feeds.on('version', (type, token)   => persistToken(type, token));
  feeds.on('data',    (type, records) => processRecords(type, records));
  feeds.on('error',   (type, err)     => console.error(type, err));

  feeds.start();
  // feeds.stop();`);
}

function generateCode(helperId, config) {
  const c = config[helperId];
  switch (helperId) {
    case 'liveTracker':     return genLiveTracker(c);
    case 'realtimeTracker': return genRealtimeTracker(c);
    case 'history':         return genHistory(c);
    case 'fleetSnapshot':   return genFleetSnapshot(c);
    case 'feeds':           return genFeeds(c);
    default:                return '';
  }
}

// ─── Reusable form atoms ────────────────────────────────────────────────────
function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="qb-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="qb-toggle-label">
        <span className="qb-toggle-name">{label}</span>
        {hint && <span className="qb-toggle-hint">{hint}</span>}
      </span>
    </label>
  );
}

function TextField({ value, onChange, label, hint, placeholder, mono }) {
  return (
    <label className="qb-field">
      <span className="qb-field-label">{label}{hint && <span className="qb-field-hint"> — {hint}</span>}</span>
      <input
        type="text"
        className={mono ? 'mono' : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NumberField({ value, onChange, label, hint, min, step }) {
  return (
    <label className="qb-field">
      <span className="qb-field-label">{label}{hint && <span className="qb-field-hint"> — {hint}</span>}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

// Diagnostics multi-pick: search + checkboxes. Tighter than a chip combo
// because the list is finite and the keys are how they appear in code.
function DiagnosticsPicker({ selected, onChange }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return DIAGNOSTIC_OPTIONS;
    return DIAGNOSTIC_OPTIONS.filter(
      (d) => d.key.toLowerCase().includes(needle) || d.value.toLowerCase().includes(needle),
    );
  }, [q]);
  const set = new Set(selected);
  function toggle(key) {
    if (set.has(key)) onChange(selected.filter(k => k !== key));
    else onChange([...selected, key]);
  }
  return (
    <div className="qb-diag">
      <div className="qb-diag-head">
        <span className="qb-field-label">Diagnostics <span className="qb-field-hint">— {selected.length} selected</span></span>
        <input
          type="search"
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="qb-diag-list">
        {filtered.map(({ key }) => (
          <label key={key} className={`qb-diag-row ${set.has(key) ? 'on' : ''}`}>
            <input type="checkbox" checked={set.has(key)} onChange={() => toggle(key)} />
            <code>Diagnostics.{key}</code>
          </label>
        ))}
        {filtered.length === 0 && <div className="qb-diag-empty">No matches</div>}
      </div>
    </div>
  );
}

// ─── Per-helper form sections ───────────────────────────────────────────────
function LiveTrackerForm({ value, onChange }) {
  return (
    <>
      <Toggle checked={value.faults} onChange={(v) => onChange({ ...value, faults: v })}
              label=".withFaults()" hint="active DTCs per vehicle" />
      <TextField mono value={value.devices} onChange={(v) => onChange({ ...value, devices: v })}
                 label=".forDevices([ids])" hint="comma-separated" placeholder="b1, b2" />
      <TextField mono value={value.groups} onChange={(v) => onChange({ ...value, groups: v })}
                 label=".forGroups([ids])" hint="comma-separated" placeholder="groupCompanyId" />
      <NumberField value={value.pollEvery} onChange={(v) => onChange({ ...value, pollEvery: v })}
                   label=".pollEvery(ms)" hint="min 1000" min={1000} step={500} />
      <DiagnosticsPicker
        selected={value.diagnostics}
        onChange={(d) => onChange({ ...value, diagnostics: d })}
      />
    </>
  );
}

function RealtimeTrackerForm({ value, onChange }) {
  return (
    <>
      <Toggle checked={value.ignition} onChange={(v) => onChange({ ...value, ignition: v })}
              label=".withIgnition()" hint="recommended — accurate isDriving" />
      <Toggle checked={value.driver} onChange={(v) => onChange({ ...value, driver: v })}
              label=".withDriverAttribution()" hint="recommended — current driver per vehicle" />
      <Toggle checked={value.faults} onChange={(v) => onChange({ ...value, faults: v })}
              label=".withFaults()" />
      <TextField mono value={value.devices} onChange={(v) => onChange({ ...value, devices: v })}
                 label=".forDevices([ids])" hint="comma-separated" placeholder="b1, b2" />
      <TextField mono value={value.groups} onChange={(v) => onChange({ ...value, groups: v })}
                 label=".forGroups([ids])" hint="comma-separated" placeholder="groupCompanyId" />
      <NumberField value={value.pollEvery} onChange={(v) => onChange({ ...value, pollEvery: v })}
                   label=".pollEvery(ms)" hint="warns < 2000" min={1000} step={500} />
      <NumberField value={value.speedThreshold} onChange={(v) => onChange({ ...value, speedThreshold: v })}
                   label=".drivingSpeedThreshold(km/h)" hint="speed → isDriving" min={0} />
      <DiagnosticsPicker
        selected={value.diagnostics}
        onChange={(d) => onChange({ ...value, diagnostics: d })}
      />
    </>
  );
}

function HistoryForm({ value, onChange }) {
  return (
    <>
      <div className="qb-submode">
        <span className="qb-field-label">Variant</span>
        <div className="qb-submode-row">
          {[
            { id: 'single', label: 'history()', hint: 'single device' },
            { id: 'many',   label: 'historyMany()', hint: 'list of device IDs' },
            { id: 'groups', label: 'historyByGroups()', hint: 'one or more groups' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`qb-submode-btn ${value.subMode === opt.id ? 'active' : ''}`}
              onClick={() => onChange({ ...value, subMode: opt.id })}
            >
              <strong>{opt.label}</strong>
              <span>{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {value.subMode === 'single' && (
        <TextField mono value={value.deviceId} onChange={(v) => onChange({ ...value, deviceId: v })}
                   label="deviceId" placeholder="b1" />
      )}
      {value.subMode === 'many' && (
        <TextField mono value={value.deviceIds} onChange={(v) => onChange({ ...value, deviceIds: v })}
                   label="deviceIds" hint="comma-separated" placeholder="b1, b2" />
      )}
      {value.subMode === 'groups' && (
        <TextField mono value={value.groupIds} onChange={(v) => onChange({ ...value, groupIds: v })}
                   label="groupIds" hint="comma-separated" placeholder="groupCompanyId" />
      )}

      <TextField mono value={value.from} onChange={(v) => onChange({ ...value, from: v })}
                 label="from" hint="ISO datetime" placeholder="2024-01-15T00:00:00Z" />
      <TextField mono value={value.to} onChange={(v) => onChange({ ...value, to: v })}
                 label="to" hint="ISO datetime" placeholder="2024-01-15T23:59:59Z" />

      <Toggle checked={value.gps}            onChange={(v) => onChange({ ...value, gps: v })}            label="include.gps" />
      <Toggle checked={value.trips}          onChange={(v) => onChange({ ...value, trips: v })}          label="include.trips" />
      <Toggle checked={value.faults}         onChange={(v) => onChange({ ...value, faults: v })}         label="include.faults" />
      <Toggle checked={value.computeBearing} onChange={(v) => onChange({ ...value, computeBearing: v })} label="computeBearing" hint="atan2 between consecutive points" />
      <DiagnosticsPicker selected={value.diagnostics} onChange={(d) => onChange({ ...value, diagnostics: d })} />
    </>
  );
}

function FleetSnapshotForm({ value, onChange }) {
  return (
    <>
      <Toggle checked={value.devices}      onChange={(v) => onChange({ ...value, devices: v })}      label="include.devices" />
      <Toggle checked={value.liveStatus}   onChange={(v) => onChange({ ...value, liveStatus: v })}   label="include.liveStatus" hint="DSI — location, bearing, driver" />
      <Toggle checked={value.activeFaults} onChange={(v) => onChange({ ...value, activeFaults: v })} label="include.activeFaults" hint="current DTCs per vehicle" />
      <NumberField value={value.recentTrips} onChange={(v) => onChange({ ...value, recentTrips: v })}
                   label="include.recentTrips" hint="N most recent trips per vehicle, 0 to skip" min={0} />
      <TextField mono value={value.groupIds} onChange={(v) => onChange({ ...value, groupIds: v })}
                 label="groupIds" hint="optional, comma-separated" placeholder="groupCompanyId" />
      <DiagnosticsPicker selected={value.diagnostics} onChange={(d) => onChange({ ...value, diagnostics: d })} />
    </>
  );
}

const FEED_TYPES = ['LogRecord', 'StatusData', 'FaultData', 'Trip', 'Group', 'Device', 'User', 'ExceptionEvent'];

function FeedsForm({ value, onChange }) {
  function updateAt(i, patch) {
    const next = value.feeds.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange({ ...value, feeds: next });
  }
  function remove(i) { onChange({ ...value, feeds: value.feeds.filter((_, idx) => idx !== i) }); }
  function add() { onChange({ ...value, feeds: [...value.feeds, { type: 'LogRecord', source: 'fromVersion', value: '' }] }); }

  return (
    <div className="qb-feeds">
      <span className="qb-field-label">Feeds <span className="qb-field-hint">— one .addFeed() call per row</span></span>
      {value.feeds.map((f, i) => (
        <div key={i} className="qb-feed-row">
          <select value={f.type} onChange={(e) => updateAt(i, { type: e.target.value })}>
            {FEED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={f.source} onChange={(e) => updateAt(i, { source: e.target.value })}>
            <option value="fromVersion">fromVersion</option>
            <option value="fromDate">fromDate</option>
          </select>
          <input
            type="text"
            className="mono"
            placeholder={f.source === 'fromDate' ? '2024-01-15' : 'null (first run)'}
            value={f.value}
            onChange={(e) => updateAt(i, { value: e.target.value })}
          />
          <button type="button" className="qb-feed-remove" onClick={() => remove(i)} aria-label="Remove feed" disabled={value.feeds.length <= 1}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="qb-feed-add" onClick={add}>
        <i className="ti ti-plus" aria-hidden="true" /> Add feed
      </button>
    </div>
  );
}

function renderForHelper(id, config, setConfig) {
  const cur  = config[id];
  const set  = (next) => setConfig({ ...config, [id]: next });
  switch (id) {
    case 'liveTracker':     return <LiveTrackerForm value={cur} onChange={set} />;
    case 'realtimeTracker': return <RealtimeTrackerForm value={cur} onChange={set} />;
    case 'history':         return <HistoryForm value={cur} onChange={set} />;
    case 'fleetSnapshot':   return <FleetSnapshotForm value={cur} onChange={set} />;
    case 'feeds':           return <FeedsForm value={cur} onChange={set} />;
    default:                return null;
  }
}

// ─── Tiny copy button ───────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button type="button" className={`qb-copy ${copied ? 'copied' : ''}`} onClick={onCopy}>
      <i className={`ti ${copied ? 'ti-check' : 'ti-copy'}`} aria-hidden="true" />
      <span>{copied ? 'copied' : 'copy'}</span>
    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function QueryBuilder() {
  const [helperId, setHelperId] = useState('liveTracker');
  const [config, setConfig]     = useState(defaultConfig);
  const helper = HELPERS.find(h => h.id === helperId);
  const code   = useMemo(() => generateCode(helperId, config), [helperId, config]);

  return (
    <div className="qb-root">
      <nav className="qb-sidebar">
        {HELPERS.map((h) => (
          <button
            key={h.id}
            type="button"
            className={`qb-helper ${helperId === h.id ? 'active' : ''}`}
            onClick={() => setHelperId(h.id)}
          >
            <i className={`ti ${h.icon}`} aria-hidden="true" />
            <span className="qb-helper-text">
              <strong>{h.label}</strong>
              <span>{h.method}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="qb-form">
        <div className="qb-form-head">
          <div className="qb-form-title">{helper.label}</div>
          <div className="qb-form-tagline">{helper.tagline}</div>
        </div>
        <div className="qb-form-body">
          {renderForHelper(helperId, config, setConfig)}
        </div>
      </div>

      <div className="qb-output">
        <div className="qb-output-head">
          <span>Generated code</span>
          <CopyButton text={code} />
        </div>
        <pre className="qb-code"><code>{code}</code></pre>
      </div>
    </div>
  );
}
