import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GeotabSDK, Diagnostics } from 'geotab-smart-sdk';
import DataMap from './DataMap.jsx';

// Cap per-device breadcrumb trail length. At a 5s poll that's roughly the
// last 4 minutes of movement, which is enough context without flooding
// long-lived sessions or slow devices.
const TRAIL_LIMIT = 50;

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

// We persist the *sessionId* from a successful auth — never the password.
// A MyGeotab session is valid for up to 14 days, so this lets the Playground
// auto-reconnect across page reloads without touching credentials again.
//
// ─── About the obfuscation ─────────────────────────────────────────────
// We obfuscate the stored JSON with a per-origin random key kept alongside
// the session. This is NOT cryptographic protection — anyone with
// JS-execution access (XSS, an installed malicious extension, devtools
// access on the same machine) can trivially read both halves and decode.
// What it DOES prevent is casual exposure: DevTools "Application →
// Storage" inspection, accidental screenshots, support-bundle dumps,
// shared browser profiles. The sessionId no longer sits in plaintext.
// Treating this as "real" encryption would be security theatre — for that
// you'd need a user-supplied passphrase that lives only in memory.
const SESSION_STORAGE_KEY = 'geotab-playground-session';
const SESSION_KEY_KEY     = 'geotab-playground-session-key';

function getOrCreateObfKey(persist) {
  const store = persist ? localStorage : sessionStorage;
  let key = store.getItem(SESSION_KEY_KEY);
  if (!key) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    key = btoa(String.fromCharCode(...bytes));
    store.setItem(SESSION_KEY_KEY, key);
  }
  return key;
}

function xorWithKey(input, keyB64) {
  const keyBytes = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input.charCodeAt(i) ^ keyBytes[i % keyBytes.length];
  }
  return out;
}

function obfuscate(plaintext, keyB64) {
  const xored = xorWithKey(plaintext, keyB64);
  return btoa(String.fromCharCode(...xored));
}

function deobfuscate(cipherB64, keyB64) {
  const xored = atob(cipherB64);
  const out   = xorWithKey(xored, keyB64);
  return new TextDecoder().decode(out);
}

function loadStoredSession() {
  // Try localStorage first (persisted "keep me signed in"), fall back to
  // sessionStorage (tab-scoped). The matching key has to come from the
  // same store as the payload or decoding will produce garbage.
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(SESSION_STORAGE_KEY);
      const key = store.getItem(SESSION_KEY_KEY);
      if (!raw || !key) continue;
      // Tolerate a one-time migration from older plain-JSON payloads so
      // existing users don't suddenly get logged out by this change.
      if (raw.trim().startsWith('{')) {
        return JSON.parse(raw);
      }
      return JSON.parse(deobfuscate(raw, key));
    } catch { /* try the next store */ }
  }
  return null;
}

function saveStoredSession(session, persist) {
  try {
    const store      = persist ? localStorage : sessionStorage;
    const otherStore = persist ? sessionStorage : localStorage;
    const key        = getOrCreateObfKey(persist);
    store.setItem(SESSION_STORAGE_KEY, obfuscate(JSON.stringify(session), key));
    // Make sure the other store doesn't keep a stale copy.
    otherStore.removeItem(SESSION_STORAGE_KEY);
    otherStore.removeItem(SESSION_KEY_KEY);
  } catch {}
}

function clearStoredSession() {
  try {
    for (const store of [sessionStorage, localStorage]) {
      store.removeItem(SESSION_STORAGE_KEY);
      store.removeItem(SESSION_KEY_KEY);
    }
  } catch {}
}

export default function Playground() {
  const [sdk, setSdk] = useState(null);
  // Pre-fill the modal with the stored session's userName/database/server
  // (the sessionId is used for auto-resume below, not shown in the form).
  const stored = loadStoredSession();
  const [creds, setCreds] = useState({
    username: stored?.userName ?? '',
    password: '',
    database: stored?.database ?? '',
    server:   stored?.server   ?? 'my.geotab.com',
  });
  const [remember, setRemember]   = useState(!!stored);
  const [connecting, setConnecting] = useState(false);
  const [error, setError]         = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [resuming, setResuming]   = useState(!!stored?.sessionId);

  const [mode, setMode]           = useState('realtime');
  const [running, setRunning]     = useState(false);
  const [vehicles, setVehicles]   = useState([]);
  // Breadcrumb trail per device — Map<deviceId, [{lat,lng,bearing,dateTime}, ...]>.
  // Appended on every tracker 'update' and capped at TRAIL_LIMIT points.
  // Cleared on start/stop, mode change, and disconnect so an old session's
  // breadcrumbs don't bleed into the next one.
  const [trails, setTrails]       = useState(() => new Map());
  const [view, setView]           = useState('map');   // map gets the spotlight by default
  // OSRM "snap to roads" is OFF by default — it depends on a rate-limited
  // public service, adds an HTTP round-trip per device per render, and
  // isn't suitable for production. The toggle is a Playground convenience.
  const [snapToRoads, setSnapToRoads] = useState(false);
  // Selected filter values — arrays of IDs. Applies to realtimeTracker /
  // liveTracker / fleetSnapshot. (history is per-device by ID, separate UI.)
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);
  // Populated from Get(Group) / Get(Device) after connect — used to drive
  // the multi-select autosuggest dropdowns.
  const [availableGroups, setAvailableGroups]   = useState([]);
  const [availableDevices, setAvailableDevices] = useState([]);
  const [historyDeviceIds, setHistoryDeviceIds] = useState([]);
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

  // Once we have an SDK, pull Groups + Devices so the filter inputs can
  // suggest real options instead of forcing the user to memorise IDs.
  // Devices are already cached by connect({ cacheDevices: true }); we still
  // hit the API for the canonical name list. Failure here is non-fatal —
  // the inputs just degrade to "no suggestions".
  useEffect(() => {
    if (!sdk) {
      setAvailableGroups([]);
      setAvailableDevices([]);
      setSelectedGroupIds([]);
      setSelectedDeviceIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [groups, devices] = await sdk.multiCall([
          ['Get', { typeName: 'Group' }],
          ['Get', { typeName: 'Device' }],
        ]);
        if (cancelled) return;
        setAvailableGroups((groups || []).map(g => ({ id: g.id, name: g.name || g.id })));
        setAvailableDevices((devices || []).map(d => ({
          id: d.id,
          name: d.name || d.serialNumber || d.id,
        })));
      } catch {
        // Swallow — inputs still work, just without autosuggest.
      }
    })();
    return () => { cancelled = true; };
  }, [sdk]);

  // Auto-resume on mount if we have a stored session.
  // A MyGeotab session is valid up to 14 days, so this lets the user pick
  // back up where they left off after a refresh / new browser tab.
  useEffect(() => {
    const session = loadStoredSession();
    if (!session?.sessionId) return;

    (async () => {
      try {
        const instance = new GeotabSDK({
          username:  session.userName,
          database:  session.database,
          sessionId: session.sessionId,
          server:    session.server,
        }, { readOnly: true });   // Playground is read-only by policy
        await instance.connect({ cacheDevices: true });
        // mg-api-js may have refreshed the sessionId — save the latest.
        const fresh = instance.getSession();
        if (fresh) saveStoredSession(fresh, true);
        setSdk(instance);
      } catch {
        // Stored session was rejected (expired, password changed, etc.) —
        // wipe it and fall through to the empty state / modal.
        clearStoredSession();
      } finally {
        setResuming(false);
      }
    })();
  }, []);

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
      }, { readOnly: true });   // Playground is read-only by policy
      await instance.connect({ cacheDevices: true });
      // Persist the *session* — never the password.
      const session = instance.getSession();
      if (session) saveStoredSession(session, remember);
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
    setTrails(new Map());
    setRunning(false);
    setError(null);
    // Always clear stored session on explicit disconnect — leaving an
    // unowned sessionId around defeats the point of pressing this button.
    clearStoredSession();
    setCreds((c) => ({ ...c, password: '' }));
  }

  async function startMode() {
    if (!sdk) return;
    stopTracker();
    setError(null);
    setVehicles([]);
    setTrails(new Map());

    const groupIds  = selectedGroupIds;
    const deviceIds = selectedDeviceIds;

    // Append each vehicle's current position to its per-device breadcrumb
    // trail. Skips dupes within ~1m so a stationary vehicle doesn't pile up
    // identical points (would look like a single chunky dot on the map).
    const onUpdate = (vs) => {
      setVehicles(vs);
      setTrails(prev => {
        const next = new Map(prev);
        for (const v of vs) {
          const loc = v.location;
          if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') continue;
          const trail = next.get(v.device.id) || [];
          const last = trail[trail.length - 1];
          if (last && Math.abs(last.lat - loc.latitude) < 1e-5 && Math.abs(last.lng - loc.longitude) < 1e-5) continue;
          trail.push({
            lat: loc.latitude,
            lng: loc.longitude,
            bearing: loc.bearing,
            dateTime: v.dateTime,
          });
          if (trail.length > TRAIL_LIMIT) trail.splice(0, trail.length - TRAIL_LIMIT);
          next.set(v.device.id, trail);
        }
        return next;
      });
    };

    try {
      if (mode === 'realtime') {
        const t = sdk.realtimeTracker()
          .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER])
          .withIgnition()
          .withDriverAttribution()
          .withFaults()
          .pollEvery(5000);
        if (groupIds.length)  t.forGroups(groupIds);
        if (deviceIds.length) t.forDevices(deviceIds);
        t.on('update', onUpdate);
        t.on('error',  (err) => setError(prettyError(err)));
        trackerRef.current = t;
        setRunning(true);
        await t.start();
      } else if (mode === 'live') {
        const t = sdk.liveTracker()
          .withDiagnostics([Diagnostics.FUEL_LEVEL, Diagnostics.ODOMETER])
          .withFaults()
          .pollEvery(5000);
        if (groupIds.length)  t.forGroups(groupIds);
        if (deviceIds.length) t.forDevices(deviceIds);
        t.on('update', onUpdate);
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
          ...(groupIds.length ? { groupIds } : {}),
        });
        setVehicles(snapshotToRows(fleet));
        setRunning(false);
      } else if (mode === 'history') {
        if (historyDeviceIds.length === 0) {
          setError('Pick at least one device from the dropdown.');
          return;
        }
        setRunning(true);
        // historyMany fans out one multiCall per device in parallel. Each
        // result.gps is already a single device's trail; we tag every row
        // with the device so the map can colour trails independently.
        const results = await sdk.historyMany(historyDeviceIds, {
          from: new Date(historyFrom),
          to:   new Date(historyTo),
          include: {
            gps:         true,
            faults:      true,
            diagnostics: [Diagnostics.FUEL_LEVEL],
          },
          computeBearing: true,
        });
        const deviceNameById = new Map(availableDevices.map(d => [d.id, d.name]));
        setVehicles(historyManyToRows(results, deviceNameById));
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

  // Render the connection info into the App's topbar slot (if present) so
  // it doesn't eat vertical space inside the page itself. Falls back
  // gracefully when the slot element isn't mounted (e.g. unit tests).
  const topbarSlot = typeof document !== 'undefined'
    ? document.getElementById('app-topbar-slot')
    : null;
  const connectionPill = sdk ? (
    <div className="topbar-connection-pill">
      <i className="ti ti-circle-check" aria-hidden="true" />
      <span className="topbar-connection-db">{creds.database || 'connected'}</span>
      <span className="topbar-connection-sep">·</span>
      <span className="topbar-connection-server">{creds.server}</span>
      <button className="topbar-connection-disconnect" onClick={disconnect} title="Disconnect">
        <i className="ti ti-logout" aria-hidden="true" />
      </button>
    </div>
  ) : null;

  return (
    <div className={`page-playground ${sdk ? 'connected' : ''}`}>
      {topbarSlot && connectionPill && createPortal(connectionPill, topbarSlot)}

      {!sdk && resuming && (
        <div className="playground-empty">
          <div className="playground-empty-icon">
            <i className="ti ti-loader-2 spin" aria-hidden="true" />
          </div>
          <h3>Resuming session…</h3>
          <p>
            Re-using a stored MyGeotab session (valid up to 14 days). If it has
            expired, you'll be prompted to sign in again.
          </p>
        </div>
      )}

      {!sdk && !resuming && (
        <div className="playground-empty">
          <div className="playground-empty-icon">
            <i className="ti ti-plug-off" aria-hidden="true" />
          </div>
          <h3>No active connection</h3>
          <p>
            Enter your MyGeotab credentials to start exploring the SDK. Your password
            is never persisted — only a session ID (if you opt in to "keep me signed in").
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
                <span>
                  Keep me signed in <span className="dim">— stores session ID (not password) for up to 14 days</span>
                </span>
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
                  browser — no proxy. The password is sent only to the MyGeotab server
                  you specify, and is <em>never persisted</em>. If you opt to stay
                  signed in, only the resulting session ID is stored locally.
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
            onClick={() => { stop(); setMode(m.id); setVehicles([]); setTrails(new Map()); }}
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

      {mode !== 'history' && (
        <section className="filter-row">
          <div className="filter-row-grid">
            <MultiSelectChips
              label="Groups"
              placeholder={availableGroups.length ? 'Type to search…' : 'Loading…'}
              options={availableGroups}
              selected={selectedGroupIds}
              onChange={setSelectedGroupIds}
            />
            {(mode === 'live' || mode === 'realtime') && (
              <MultiSelectChips
                label="Devices"
                placeholder={availableDevices.length ? 'Type to search…' : 'Loading…'}
                options={availableDevices}
                selected={selectedDeviceIds}
                onChange={setSelectedDeviceIds}
              />
            )}
          </div>
          <div className="filter-row-hint">
            Restricts the {mode === 'snapshot' ? 'snapshot' : 'tracker'} to devices in these groups
            {mode !== 'snapshot' && ' and/or these specific devices (intersected if both are set)'}.
            Leave blank to include every device you have access to.
          </div>
        </section>
      )}

      {mode === 'history' && (
        <section className="history-form">
          <div className="history-form-device">
            <MultiSelectChips
              label="Devices"
              placeholder={availableDevices.length ? 'Type to search…' : 'Loading…'}
              options={availableDevices}
              selected={historyDeviceIds}
              onChange={setHistoryDeviceIds}
            />
          </div>
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
        {view === 'map' && (
          <label
            className={`snap-toggle ${snapToRoads ? 'on' : ''}`}
            title="Snap trails to OSM road geometry via OSRM's public demo. Demo-only, rate-limited — not for production."
          >
            <input
              type="checkbox"
              checked={snapToRoads}
              onChange={(e) => setSnapToRoads(e.target.checked)}
            />
            <i className="ti ti-route" aria-hidden="true" />
            <span>Snap to roads</span>
            <span className="snap-toggle-hint">demo</span>
          </label>
        )}
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
          <DataMap rows={vehicles} mode={mode} trails={trails} snapToRoads={snapToRoads} />
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

function historyToRows(result, deviceName) {
  return (result.gps || []).map((p, i) => ({
    device:   { id: result.deviceId, name: deviceName || result.deviceId },
    location: { latitude: p.latitude, longitude: p.longitude, bearing: p.bearing, speed: p.speed },
    dateTime: p.dateTime,
    index: i,
  }));
}

// Multi-device variant — flattens N device histories into one row stream
// where every row keeps its device.id so DataMap can colour trails per
// device. Each device gets a fresh index sequence so the table view still
// shows ascending 1..N counters per vehicle rather than a global counter.
function historyManyToRows(results, deviceNameById) {
  const rows = [];
  for (const r of results || []) {
    if (!r) continue;
    rows.push(...historyToRows(r, deviceNameById?.get(r.deviceId)));
  }
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
            <tr><th>Vehicle</th><th>#</th><th>Time</th><th>Lat / Lon</th><th>Bearing</th><th>Speed (km/h)</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.device.id}-${r.index}`}>
                <td><strong>{r.device.name}</strong> <span className="dim">{r.device.id}</span></td>
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

// ─── MultiSelectChips ───────────────────────────────────────────────────────
// Tiny dependency-free combo box. Click anywhere in the chips area to focus
// the input → dropdown opens with filtered options. Click an option (or
// press Enter on the highlighted row) to add a chip; click the × on a chip
// or press Backspace in an empty input to remove the last chip.
function MultiSelectChips({ label, placeholder, options, selected, onChange, max }) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedOptions = useMemo(
    () => selected.map(id => options.find(o => o.id === id) ?? { id, name: id }),
    [selected, options],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter(o => !selectedSet.has(o.id))
      .filter(o => !q
        || o.name.toLowerCase().includes(q)
        || o.id.toLowerCase().includes(q))
      .slice(0, 50);   // cap dropdown size for large fleets
  }, [options, selectedSet, query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Reset highlighted row when the filtered list shrinks below it.
  useEffect(() => { if (active >= filtered.length) setActive(0); }, [filtered.length, active]);

  function add(id) {
    if (selectedSet.has(id)) return;
    // When `max` is set (e.g. History allows only one device) we replace
    // existing chips beyond the cap rather than silently swallow the click.
    let nextSelected = [...selected, id];
    if (max && nextSelected.length > max) nextSelected = nextSelected.slice(-max);
    onChange(nextSelected);
    setQuery('');
    inputRef.current?.focus();
  }
  function remove(id) {
    onChange(selected.filter(x => x !== id));
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter')     {
      if (open && filtered[active]) { e.preventDefault(); add(filtered[active].id); }
    }
    else if (e.key === 'Escape')    { setOpen(false); }
    else if (e.key === 'Backspace' && !query && selected.length > 0) {
      remove(selected[selected.length - 1]);
    }
  }

  return (
    <div className="ms-wrap" ref={wrapRef}>
      <div className="ms-label">{label} <span className="dim">({selected.length} selected)</span></div>
      <div
        className={`ms-control ${open ? 'open' : ''}`}
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selectedOptions.map(opt => (
          <span key={opt.id} className="ms-chip">
            {opt.name}
            <button
              type="button"
              className="ms-chip-x"
              onClick={(e) => { e.stopPropagation(); remove(opt.id); }}
              aria-label={`Remove ${opt.name}`}
            ><i className="ti ti-x" aria-hidden="true" /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="ms-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="ms-dropdown" role="listbox">
          {filtered.map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`ms-option ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => add(opt.id)}
            >
              <span className="ms-option-name">{opt.name}</span>
              <span className="ms-option-id">{opt.id}</span>
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && options.length > 0 && (
        <div className="ms-dropdown empty">No matches</div>
      )}
    </div>
  );
}
