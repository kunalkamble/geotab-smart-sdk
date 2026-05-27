import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { snapToRoads as osrmSnap } from './osrmMatch.js';

// Fixed palette of dark, high-contrast colours used for per-device history
// trails when multiple devices are queried at once. Picked to stay readable
// against light street tiles, dark satellite tiles, and dark-mode tiles
// (we tone the latter via filter on .leaflet-tile in styles.css). Hashing
// the device id into the palette keeps a vehicle's colour stable across
// re-renders — random per render would flicker on every update.
const DEVICE_COLORS = [
  '#0A4D3D',   // forest green
  '#6B1F1F',   // burgundy
  '#15366B',   // navy
  '#312E5C',   // indigo
  '#8B3A0E',   // burnt orange
  '#4A4F0A',   // olive
  '#5C1E4B',   // plum
  '#0B4A4F',   // teal
];
function deviceColor(id) {
  if (!id) return DEVICE_COLORS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return DEVICE_COLORS[h % DEVICE_COLORS.length];
}

// Custom DivIcon so we don't have to deal with Leaflet's default-marker
// bundler path issues. Filled circle + inset arrow gives strong contrast
// against any map tile (light streets, dark satellite, busy urban). The
// hard-coded dark colours are deliberate — theme variables can drift to
// light values and the marker has to stay readable in both light and dark.
function vehicleIcon({ bearing, isDriving, isOffline, color }) {
  // Explicit `color` (history mode, per-device palette) wins over the
  // driving/idle/offline traffic-light fill (live & realtime modes).
  const fill = color || (isOffline ? '#1f2937' : (isDriving ? '#0A4D3D' : '#5A2E00'));
  const html = `
    <div class="map-marker" style="--rot: ${bearing ?? 0}deg;">
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
        <circle cx="14" cy="14" r="12" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
        <path fill="#ffffff" d="M14 5 L21 22 L14 18 L7 22 Z"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'map-marker-wrap',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function trailPointIcon(color) {
  const fill = color || '#0A4D3D';
  return L.divIcon({
    html: `<div class="trail-dot" style="background:${fill}"></div>`,
    className: 'map-marker-wrap',
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
}

export default function DataMap({ rows, mode, trails, snapToRoads }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const lineRef = useRef(null);
  // Per-device polyline refs for the live/realtime breadcrumb trails. Held
  // separately from the single `lineRef` (which is for the history trail)
  // so we can detach them independently when rows change.
  const trailLinesRef = useRef([]);
  // We only auto-fit the map ONCE per tracking session — the very first
  // update that produces vehicle positions. Every subsequent poll just
  // refreshes markers/trails so the user's manual zoom/pan stays put.
  // The flag resets when rows goes empty (Stop, Disconnect, mode switch)
  // so the next session gets a fresh initial framing.
  const didFitRef = useRef(false);
  // Each render of the snap-to-roads effect runs async OSRM calls. We
  // bump this token at the start of every effect so stale in-flight
  // responses (from a previous effect run) can recognise they're stale
  // and skip mutating layers that may already have been removed.
  const snapTokenRef = useRef(0);

  // Initialise map once.
  // We deliberately use the SVG renderer (Leaflet's default) rather than
  // preferCanvas:true. The canvas renderer can throw "Cannot read properties
  // of undefined (reading 'clearRect')" when React StrictMode double-mounts
  // the component in dev — an internal tile/render callback resolves after
  // map.remove() has nulled the canvas context. SVG layers detach cleanly.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [39.5, -98.35],   // default to roughly mid-USA
      zoom: 4,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Refresh markers whenever rows change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // After map.remove() the container is detached from the DOM; skip if so.
    const container = map.getContainer?.();
    if (!container || !container.isConnected) return;

    // Clear previous overlays. Wrap in try/catch in case a previous render's
    // overlay refs point at layers whose parent map has been torn down.
    markersRef.current.forEach((m) => { try { m.remove(); } catch {} });
    markersRef.current = [];
    if (lineRef.current) {
      try { lineRef.current.remove(); } catch {}
      lineRef.current = null;
    }
    trailLinesRef.current.forEach((l) => { try { l.remove(); } catch {} });
    trailLinesRef.current = [];

    // Bump the snap token so any OSRM requests still in flight from the
    // previous effect run no-op when they resolve.
    snapTokenRef.current += 1;
    const myToken = snapTokenRef.current;
    // List of { line, latlngs } pairs gathered during the synchronous
    // draw below — we snap each one async after the markers are placed.
    const snapTargets = [];

    const positions = rows
      .filter(r => r.location && typeof r.location.latitude === 'number' && typeof r.location.longitude === 'number')
      .map(r => ({
        lat: r.location.latitude,
        lng: r.location.longitude,
        bearing: r.location.bearing,
        speed: r.location.speed,
        name: r.device?.name ?? r.device?.id ?? '(unknown)',
        id: r.device?.id,
        isDriving: r.isDriving,
        isOffline: r.isConnected === false,
        dateTime: r.dateTime,
      }));

    if (positions.length === 0) {
      // Empty → arm the "fit on next non-empty update" flag so a Stop/Start
      // cycle frames the new data, but a quiet poll in the middle of a
      // session doesn't reset what the user is looking at.
      didFitRef.current = false;
      return;
    }

    if (mode === 'history') {
      // Group rows by device so we can draw one independent trail per
      // vehicle. Each device gets a stable colour from the palette.
      const byDevice = new Map();
      for (const p of positions) {
        const list = byDevice.get(p.id) || [];
        list.push(p);
        byDevice.set(p.id, list);
      }

      const allLatlngs = [];
      for (const [deviceId, pts] of byDevice) {
        const color   = deviceColor(deviceId);
        const latlngs = pts.map(p => [p.lat, p.lng]);
        allLatlngs.push(...latlngs);
        // One coloured polyline per device.
        const line = L.polyline(latlngs, {
          color,
          weight: 4,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        trailLinesRef.current.push(line);
        snapTargets.push({ line, latlngs });

        // Sample markers along the trail + a vehicle marker at the head.
        const step = Math.max(1, Math.floor(pts.length / 60));
        pts.forEach((p, i) => {
          if (i !== pts.length - 1 && i % step !== 0) return;
          const isLast = i === pts.length - 1;
          const icon = isLast
            ? vehicleIcon({ bearing: p.bearing, isDriving: true, isOffline: false, color })
            : trailPointIcon(color);
          const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
          marker.bindPopup(`<strong>${p.name}</strong><br/>${fmtTime(p.dateTime)}<br/>${fmtSpeed(p.speed)} · ${fmtBearing(p.bearing)}`);
          markersRef.current.push(marker);
        });
      }

      if (allLatlngs.length > 0 && !didFitRef.current) {
        map.fitBounds(L.latLngBounds(allLatlngs), { padding: [30, 30] });
        didFitRef.current = true;
      }
    } else {
      // Live / fleet snapshot — one marker per vehicle.
      // For live + realtime modes we also draw a breadcrumb trail per device
      // from the `trails` map: a polyline of recent positions ending at
      // (but not duplicating) the current marker.
      const showTrails = (mode === 'live' || mode === 'realtime') && trails && trails.size > 0;
      if (showTrails) {
        for (const p of positions) {
          const trail = trails.get(p.id);
          if (!trail || trail.length < 2) continue;
          const latlngs = trail.map(t => [t.lat, t.lng]);
          const line = L.polyline(latlngs, {
            color: '#0A4D3D',
            weight: 3,
            opacity: 0.85,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(map);
          trailLinesRef.current.push(line);
          snapTargets.push({ line, latlngs });
        }
      }

      positions.forEach((p) => {
        const marker = L.marker([p.lat, p.lng], {
          icon: vehicleIcon({ bearing: p.bearing, isDriving: p.isDriving, isOffline: p.isOffline }),
        }).addTo(map);
        marker.bindPopup(`
          <strong>${p.name}</strong><br/>
          ${fmtSpeed(p.speed)} · ${fmtBearing(p.bearing)}<br/>
          ${p.isOffline ? 'Offline' : (p.isDriving ? 'Driving' : 'Idle')}
          ${p.dateTime ? '<br/><span style="opacity:.6">' + fmtTime(p.dateTime) + '</span>' : ''}
        `);
        markersRef.current.push(marker);
      });

      if (!didFitRef.current) {
        if (positions.length === 1) {
          map.setView([positions[0].lat, positions[0].lng], 14);
        } else {
          const bounds = L.latLngBounds(positions.map(p => [p.lat, p.lng]));
          map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
        }
        didFitRef.current = true;
      }
    }
    // ── OSRM snap-to-roads (optional, demo only) ─────────────────────
    // Raw polylines were already drawn synchronously above so the user
    // sees something immediately. If the toggle is on, we then fetch the
    // matched geometry per polyline and `setLatLngs` to swap it in. The
    // snap token guards against stale responses arriving after the next
    // effect run has cleared the layers.
    if (snapToRoads && snapTargets.length > 0) {
      const controller = new AbortController();
      (async () => {
        for (const target of snapTargets) {
          if (myToken !== snapTokenRef.current) return;
          try {
            const matched = await osrmSnap(target.latlngs, controller.signal);
            if (myToken !== snapTokenRef.current) return;
            if (!matched) continue;            // OSRM gave up; keep raw line
            if (!target.line._map) continue;   // line was removed mid-flight
            target.line.setLatLngs(matched);
          } catch (err) {
            if (err.name === 'AbortError') return;
            // Network/OSRM error — leave the raw line in place.
          }
        }
      })();
      return () => controller.abort();
    }
  }, [rows, mode, trails, snapToRoads]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-container" />
      <div className="map-legend">
        <span><i className="ti ti-circle-filled" style={{ color: '#0A4D3D' }} /> Driving</span>
        <span><i className="ti ti-circle-filled" style={{ color: '#5A2E00' }} /> Idle</span>
        <span><i className="ti ti-circle-filled" style={{ color: '#1f2937' }} /> Offline</span>
      </div>
    </div>
  );
}

function fmtSpeed(s) {
  return typeof s === 'number' ? s.toFixed(1) + ' km/h' : '— km/h';
}
function fmtBearing(b) {
  return typeof b === 'number' ? b.toFixed(0) + '°' : '— heading';
}
function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleString();
}
