import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Custom DivIcon so we don't have to deal with Leaflet's default-marker
// bundler path issues. A simple SVG arrow rotates by bearing.
function vehicleIcon({ bearing, isDriving, isOffline }) {
  const color = isOffline ? '#888' : (isDriving ? 'var(--accent-green-fg, #0F6E56)' : 'var(--accent-amber-fg, #854F0B)');
  const html = `
    <div class="map-marker" style="--rot: ${bearing ?? 0}deg; color: ${color};">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="currentColor" d="M12 2 L19 20 L12 16 L5 20 Z"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'map-marker-wrap',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function trailPointIcon() {
  return L.divIcon({
    html: '<div class="trail-dot"></div>',
    className: 'map-marker-wrap',
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });
}

export default function DataMap({ rows, mode }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const lineRef = useRef(null);

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

    if (positions.length === 0) return;

    if (mode === 'history') {
      // Draw the trail
      const latlngs = positions.map(p => [p.lat, p.lng]);
      lineRef.current = L.polyline(latlngs, {
        color: '#5EE0B7',
        weight: 3,
        opacity: 0.7,
      }).addTo(map);

      // Add a tiny marker every Nth point so we don't drown
      const step = Math.max(1, Math.floor(positions.length / 80));
      positions.forEach((p, i) => {
        if (i !== positions.length - 1 && i % step !== 0) return;
        const isLast = i === positions.length - 1;
        const icon = isLast
          ? vehicleIcon({ bearing: p.bearing, isDriving: true, isOffline: false })
          : trailPointIcon();
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
        marker.bindPopup(`<strong>${p.name}</strong><br/>${fmtTime(p.dateTime)}<br/>${fmtSpeed(p.speed)} · ${fmtBearing(p.bearing)}`);
        markersRef.current.push(marker);
      });

      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    } else {
      // Live / fleet snapshot — one marker per vehicle
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

      if (positions.length === 1) {
        map.setView([positions[0].lat, positions[0].lng], 14);
      } else {
        const bounds = L.latLngBounds(positions.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      }
    }
  }, [rows, mode]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-container" />
      <div className="map-legend">
        <span><i className="ti ti-square-filled" style={{ color: 'var(--accent-green-fg)' }} /> Driving</span>
        <span><i className="ti ti-square-filled" style={{ color: 'var(--accent-amber-fg)' }} /> Idle</span>
        <span><i className="ti ti-square-filled" style={{ color: '#888' }} /> Offline</span>
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
