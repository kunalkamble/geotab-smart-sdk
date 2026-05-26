import { useState, useEffect, useRef } from 'react';
import { GeotabSDK, Diagnostics } from 'geotab-smart-sdk';
import DataMap from './DataMap.jsx';

const MODES = [
  {
    id: 'realtime',
    label: 'Realtime tracker',
    icon: 'ti-broadcast',
    description: 'Every GPS fix via LogRecord. Bearing/isDriving/driver derived.',
    polling: true,
  },
  {
    id: 'live',
    label: 'Live tracker (DSI)',
    icon: 'ti-map-pin',
    description: 'DeviceStatusInfo snapshot — one record per vehicle, server-aggregated.',
    polling: true,
  },
  {
    id: 'snapshot',
    label: 'Fleet snapshot',
    icon: 'ti-dashboard',
    description: 'One-shot picture of the whole fleet. Returns Maps + a pre-computed summary.',
    polling: false,
  },
  {
    id: 'history',
    label: 'Historical query',
    icon: 'ti-route',
    description: 'GPS + diagnostics + faults for a single device over a time range.',
    polling: false,
  },
];

const STORAGE_KEY = 'geotab-playground-creds';

function loadCreds() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCreds(creds, remember) {
  try {
    const store = remember ? localStorage : sessionStorage;
    store.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch {}
}

function clearStoredCreds() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export default function Playground() {
  const [sdk, setSdk] = useState(null);
  const [creds, setCreds] = useState(() => loadCreds() ?? {
    username: '',
    password: '',
    database: '',
    server:   'my.geotab.com',
  });
  const [remember, setRemember]   = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError]         = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [mode, setMode]           = useState('realtime');
  const [running, setRunning]     = useState(false);
  const [vehicles, setVehicles]   = useState([]);
  const [view, setView]           = useState('table');
  const [historyDeviceId, setHistoryDeviceId] = useState('');
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 16);
  });
  const [historyTo, setHistoryTo] = useState(() => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 16);
  });
  const trackerRef = useRef(null);

  // Clean up active tracker on unmount or mode change
  useEffect(() => () => stopTracker(), []);

  // Esc key closes the modal
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  function stopTracker() {
    if (trackerRef.current && typeof trackerRef.current.stop === 'function') {
      try { trackerRef.current.stop(); } catch {}
    }
    trackerRef.current = null;
  }

  async function handleConnect(e) {
    e.preventDefault();
    setError(null);
    setConnecting(true);
    try {
      const instance = new GeotabSDK({
        username: creds.username,
        password: creds.password,
        database: creds.database,
        server:   creds.server || 'my.geotab.com',
      });
      await instance.connect({ cacheDevices: true });
      saveCreds(creds, remember);
      setSdk(instance);
      setModalOpen(false);
    } catch (err) {
      setError(prettyError(err));
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    stopTracker();
    setSdk(null);
    setVehicles([]);
    setRunning(false);
    setError(null);
    if (!remember) clearStoredCreds();
  }

  async function startMode() {
    if (!sdk) return;
    stopTracker();
    setError(null);
    setVehicles([]);

    try {
      if (mode === 'realtime') {
        const t = sdk.realtimeTracker()
          .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER])
          .withIgnition()
          .withDriverAttribution()
          .withFaults()
          .pollEvery(5000);
        t.on('update', (vs) => setVehicles(vs));
        t.on('error',  (err) => setError(prettyError(err)));
        trackerRef.current = t;
        setRunning(true);
        await t.start();
      } else if (mode === 'live') {
        const t = sdk.liveTracker()
          .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER])
          .withFaults()
          .pollEvery(5000);
        t.on('update', (vs) => setVehicles(vs));
        t.on('error',  (err) => setError(prettyError(err)));
        trackerRef.current = t;
        setRunning(true);
        await t.start();
      } else if (mode === 'snapshot') {
        setRunning(true);
        const fleet = await sdk.fleetSnapshot({
          include: {
            devices:      true,
            liveStatus:   true,
            activeFaults: true,
            diagnostics:  [Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER],
          },
        });
        setVehicles(snapshotToRows(fleet));
        setRunning(false);
      } else if (mode === 'history') {
        if (!historyDeviceId.trim()) {
          setError('Enter a device ID (e.g. "b1")');
          return;
        }
        setRunning(true);
        const result = await sdk.history({
          deviceId: historyDeviceId.trim(),
          from: new Date(historyFrom),
          to:   new Date(historyTo),
          include: {
            gps:         true,
            faults:      true,
            diagnostics: [Diagnostics.FUEL_LEVEL],
          },
          computeBearing: true,
        });
        setVehicles(historyToRows(result));
        setRunning(false);
      }
    } catch (err) {
      setError(prettyError(err));
      setRunning(false);
    }
  }

  function stop() {
    stopTracker();
    setRunning(false);
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  const activeMode = MODES.find(m => m.id === mode);

  return (
    <div className={`page-playground ${sdk ? 'connected' : ''}`}>
      {sdk && (
        <div className="playground-toolbar">
          <p className="connection-line">
            <i className="ti ti-circle-check" aria-hidden="true" />
            Connected to <code>{creds.server}</code> · database <code>{creds.database}</code>
          </p>
          <button className="btn btn-ghost" onClick={disconnect}>
            <i className="ti ti-logout" aria-hidden="true" /> Disconnect
          </button>
        </div>
      )}

      {!sdk && (
        <div className="playground-empty">
          <div className="playground-empty-icon">
            <i className="ti ti-plug-off" aria-hidden="true" />
          </div>
          <h3>No active connection</h3>
          <p>
            Enter your MyGeotab credentials to start exploring the SDK. Credentials
            stay in your browser — never sent anywhere except your Geotab server.
          </p>
          <button className="btn btn-primary" onClick={() => { setError(null); setModalOpen(true); }}>
            <i className="ti ti-plug" aria-hidden="true" /> Add Connection
          </button>
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => !connecting && setModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Connect to MyGeotab" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Connect to MyGeotab</h2>
              <button
                className="modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
                disabled={connecting}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleConnect}>
              <div className="form-grid">
                <label>
                  <span>Username</span>
                  <input
                    type="email"
                    placeholder="user@company.com"
                    value={creds.username}
                    onChange={(e) => setCreds({ ...creds, username: e.target.value })}
                    required
                    autoComplete="username"
                    autoFocus
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    value={creds.password}
                    onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  <span>Database</span>
                  <input
                    type="text"
                    placeholder="my_company"
                    value={creds.database}
                    onChange={(e) => setCreds({ ...creds, database: e.target.value })}
                    required
                  />
                </label>
                <label>
                  <span>Server</span>
                  <input
                    type="text"
                    value={creds.server}
                    onChange={(e) => setCreds({ ...creds, server: e.target.value })}
                    placeholder="my.geotab.com"
                  />
                </label>
              </div>

              <label className="remember-row">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Remember on this device (uses localStorage)</span>
              </label>

              {error && (
                <div className="form-error">
                  <i className="ti ti-alert-triangle" aria-hidden="true" /> {error}
                </div>
              )}

              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)} disabled={connecting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={connecting}>
                  {connecting ? (
                    <><i className="ti ti-loader-2 spin" aria-hidden="true" /> Connecting…</>
                  ) : (
                    <><i className="ti ti-plug" aria-hidden="true" /> Connect</>
                  )}
                </button>
              </div>

              <div className="security-note">
                <i className="ti ti-shield" aria-hidden="true" />
                <div>
                  <strong>Use a test account.</strong> This page runs entirely in your
                  browser — no proxy — and your credentials are stored locally. Do not
                  enter shared production credentials.
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {sdk && (<>
      <section className="mode-picker">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode-card ${mode === m.id ? 'active' : ''}`}
            onClick={() => { stop(); setMode(m.id); setVehicles([]); }}
            disabled={running && mode !== m.id}
          >
            <i className={`ti ${m.icon}`} aria-hidden="true" />
            <div className="mode-card-text">
              <div className="mode-card-label">{m.label}</div>
              <div className="mode-card-desc">{m.description}</div>
            </div>
          </button>
        ))}
      </section>

      {mode === 'history' && (
        <section className="history-form">
          <label>
            <span>Device ID</span>
            <input
              type="text"
              placeholder="b1"
              value={historyDeviceId}
              onChange={(e) => setHistoryDeviceId(e.target.value)}
            />
          </label>
          <label>
            <span>From</span>
            <input
              type="datetime-local"
              value={historyFrom}
              onChange={(e) => setHistoryFrom(e.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="datetime-local"
              value={historyTo}
              onChange={(e) => setHistoryTo(e.target.value)}
            />
          </label>
        </section>
      )}

      <section className="run-bar">
        {!running ? (
          <button className="btn btn-primary" onClick={startMode}>
            <i className="ti ti-player-play" aria-hidden="true" />
            {activeMode.polling ? `Start ${activeMode.label}` : `Run ${activeMode.label}`}
          </button>
        ) : (
          <button className="btn btn-danger" onClick={stop}>
            <i className="ti ti-player-stop" aria-hidden="true" /> Stop
          </button>
        )}
        <div className="view-toggle">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
            <i className="ti ti-table" aria-hidden="true" /> Table
          </button>
          <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            <i className="ti ti-map" aria-hidden="true" /> Map
          </button>
        </div>
        <div className="run-status">
          {vehicles.length > 0
            ? <>{vehicles.length} {mode === 'history' ? 'point(s)' : 'vehicle(s)'}</>
            : running ? 'Waiting for first update…' : 'No data yet'}
          {running && activeMode.polling && (
            <span className="run-indicator" title="Polling every 5s">
              <i className="ti ti-circle-dot-filled" aria-hidden="true" />
            </span>
          )}
        </div>
      </section>

      {error && (
        <div className="form-error">
          <i className="ti ti-alert-triangle" aria-hidden="true" /> {error}
        </div>
      )}

      <section className="data-view">
        {view === 'table' ? (
          <DataTable rows={vehicles} mode={mode} />
        ) : (
          <DataMap rows={vehicles} mode={mode} />
        )}
      </section>
      </>)}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function prettyError(err) {
  const msg = (err && (err.message || err.toString())) || String(err);
  if (/Failed to fetch|Network/i.test(msg)) {
    return `${msg} — likely a CORS issue. Geotab's API generally allows browser calls, but if your server enforces stricter CORS you may need a proxy.`;
  }
  if (/InvalidUserException/i.test(msg)) {
    return 'Invalid credentials. Double-check username, password, and database.';
  }
  return msg;
}

function snapshotToRows(fleet) {
  const rows = [];
  for (const dev of fleet.devices) {
    const live = fleet.liveStatus.get(dev.id);
    const faults = fleet.faults.get(dev.id) || [];
    rows.push({
      device:    { id: dev.id, name: dev.name },
      location:  live ? { latitude: live.latitude, longitude: live.longitude, bearing: live.bearing, speed: live.speed } : null,
      isDriving: live?.isDriving ?? false,
      isConnected: live?.isDeviceCommunicating ?? false,
      driver: live?.driver?.id ? { id: live.driver.id, name: live.driver.name } : null,
      faults: faults,
      dateTime: live?.dateTime,
    });
  }
  return rows;
}

function historyToRows(result) {
  const rows = (result.gps || []).map((p, i) => ({
    device:   { id: result.deviceId, name: result.deviceId },
    location: { latitude: p.latitude, longitude: p.longitude, bearing: p.bearing, speed: p.speed },
    dateTime: p.dateTime,
    index: i,
  }));
  return rows;
}

// ─── Table view ─────────────────────────────────────────────────────────────

function DataTable({ rows, mode }) {
  if (rows.length === 0) {
    return <div className="empty-state"><i className="ti ti-database-off" aria-hidden="true" /> No data yet — start a mode above.</div>;
  }

  if (mode === 'history') {
    return (
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>#</th><th>Time</th><th>Lat / Lon</th><th>Bearing</th><th>Speed (km/h)</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index}>
                <td>{r.index + 1}</td>
                <td>{fmtTime(r.dateTime)}</td>
                <td className="mono">{fmtCoord(r.location?.latitude)}, {fmtCoord(r.location?.longitude)}</td>
                <td>{r.location?.bearing != null ? r.location.bearing.toFixed(0) + '°' : '—'}</td>
                <td>{r.location?.speed != null ? r.location.speed.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Lat / Lon</th>
            <th>Bearing</th>
            <th>Speed</th>
            <th>State</th>
            <th>Driver</th>
            <th>Faults</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.device.id}>
              <td><strong>{r.device.name}</strong> <span className="dim">{r.device.id}</span></td>
              <td className="mono">{fmtCoord(r.location?.latitude)}, {fmtCoord(r.location?.longitude)}</td>
              <td>{r.location?.bearing != null ? r.location.bearing.toFixed(0) + '°' : '—'}</td>
              <td>{r.location?.speed != null ? r.location.speed.toFixed(1) + ' km/h' : '—'}</td>
              <td>
                {r.isDriving ? <span className="badge badge-green">Driving</span>
                  : r.isConnected === false ? <span className="badge badge-gray">Offline</span>
                  : <span className="badge badge-amber">Idle</span>}
              </td>
              <td>{r.driver?.name || r.driver?.id || '—'}</td>
              <td>{r.faults?.length > 0
                ? <span className="badge badge-red">{r.faults.length}</span>
                : <span className="dim">0</span>}</td>
              <td className="dim">{fmtTime(r.dateTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtCoord(n) {
  return typeof n === 'number' ? n.toFixed(5) : '—';
}
function fmtTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d) ? '—' : d.toLocaleTimeString();
}
