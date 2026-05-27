// OSRM map-matching helper for the Playground.
//
// Sends an array of lat/lng points to OSRM's public demo server and gets
// back a snapped-to-road polyline. Strictly demo-only — OSRM's public
// endpoint is rate-limited and not allowed for production use. Real
// applications should either self-host OSRM or use a commercial service
// (Mapbox / Google Roads / GraphHopper).
//
// Caching: matches are keyed by a stable hash of the input coordinates so
// the same trail isn't re-fetched on every 5-second poll. Cache lives at
// module scope; cleared on a hard reload, which is exactly what we want.

const ENDPOINT = 'https://router.project-osrm.org/match/v1/driving';
// OSRM's public demo accepts up to 100 coords per request — we cap below
// that to leave headroom. Trails are already capped at 50 points in
// Playground so this matters mostly for long History queries.
const MAX_POINTS_PER_REQUEST = 90;
// Per-point GPS error budget in metres. 25m is reasonable for consumer GPS
// with urban canyon multipath; smaller forces OSRM to give up on noisy
// fixes, larger lets it match the wrong road.
const RADIUS_METERS = 25;

const cache = new Map();

function keyFor(points) {
  // Hash to 6 decimals (~10 cm) so jittery GPS doesn't bust the cache on
  // every poll while preserving enough precision to actually identify a
  // route. Length-suffix prevents prefix collisions.
  let h = '';
  for (const [lat, lng] of points) {
    h += `${lat.toFixed(6)},${lng.toFixed(6)};`;
  }
  return `${points.length}|${h}`;
}

// Drop points that are too close together — OSRM struggles with duplicates
// and gains nothing from sub-metre noise.
function dedupe(points) {
  const out = [];
  let last = null;
  for (const p of points) {
    if (!last || Math.abs(p[0] - last[0]) > 1e-5 || Math.abs(p[1] - last[1]) > 1e-5) {
      out.push(p);
      last = p;
    }
  }
  return out;
}

async function matchChunk(points, signal) {
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const radii  = points.map(() => RADIUS_METERS).join(';');
  const url = `${ENDPOINT}/${coords}?geometries=geojson&overview=full&radiuses=${radii}&gaps=split`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok' || !Array.isArray(json.matchings)) {
    throw new Error(`OSRM ${json.code || 'no matchings'}`);
  }
  // OSRM may split the route into multiple matchings if there's a gap —
  // join them in order. Each matching's geometry.coordinates is [lng,lat]
  // pairs; flip to Leaflet's [lat,lng].
  const out = [];
  for (const m of json.matchings) {
    const coords = m.geometry?.coordinates || [];
    for (const [lng, lat] of coords) out.push([lat, lng]);
  }
  return out;
}

/**
 * Snap a polyline of [lat,lng] points to roads via OSRM. Returns the
 * matched [lat,lng] array, or null if matching failed entirely (caller
 * should fall back to raw points).
 *
 * @param {Array<[number, number]>} points
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<[number, number]> | null>}
 */
export async function snapToRoads(points, signal) {
  const cleaned = dedupe(points || []);
  if (cleaned.length < 2) return null;

  const key = keyFor(cleaned);
  if (cache.has(key)) return cache.get(key);

  try {
    let matched = [];
    // Chunk long inputs (mainly History queries). Each chunk overlaps the
    // last point of the previous one so the joined polyline is continuous.
    for (let i = 0; i < cleaned.length; i += MAX_POINTS_PER_REQUEST - 1) {
      const slice = cleaned.slice(i, i + MAX_POINTS_PER_REQUEST);
      if (slice.length < 2) break;
      const seg = await matchChunk(slice, signal);
      // De-dup overlap at the join.
      if (matched.length > 0 && seg.length > 0) seg.shift();
      matched.push(...seg);
    }
    const result = matched.length >= 2 ? matched : null;
    cache.set(key, result);
    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Cache the failure too — short-circuits noisy retries when a tenant
    // sits in an OSM-poor region or hits rate limits.
    cache.set(key, null);
    return null;
  }
}

export function clearMatchCache() {
  cache.clear();
}
