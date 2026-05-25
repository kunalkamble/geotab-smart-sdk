'use strict';
/**
 * Example: Historical GPS trail + diagnostics + faults in one call.
 *
 * Demonstrates how to correlate LogRecord (GPS) with StatusData (fuel, aux)
 * and FaultData across the same time window — all fetched via a single multiCall.
 *
 * This replaces the common pattern of making 3-4 separate API calls
 * and manually joining results by timestamp.
 */

const { GeotabSDK, Diagnostics } = require('../src');

const sdk = new GeotabSDK({
  username: process.env.GEOTAB_USER,
  password: process.env.GEOTAB_PASS,
  database: process.env.GEOTAB_DB,
});

async function main() {
  // ── Yesterday's full day ─────────────────────────────────────────────────
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 1);

  const to = new Date(from);
  to.setHours(23, 59, 59, 999);

  console.log(`Fetching history for ${from.toDateString()}...\n`);

  const history = await sdk.history({
    deviceId: 'b1',     // replace with your device ID
    from,
    to,
    include: {
      gps:  true,
      trips: true,
      faults: true,
      diagnostics: [
        Diagnostics.FUEL_LEVEL,
        Diagnostics.AUX_INPUT_1,
        Diagnostics.ENGINE_HOURS,
      ],
    },
    computeBearing: true,  // bearing computed from consecutive GPS points
  });

  // ── GPS trail ────────────────────────────────────────────────────────────
  console.log(`GPS points : ${history.gps.length}`);
  if (history.gps.length > 0) {
    const first = history.gps[0];
    const last  = history.gps[history.gps.length - 1];
    console.log(`  From: ${first.dateTime}  →  ${first.latitude.toFixed(4)}, ${first.longitude.toFixed(4)}`);
    console.log(`  To  : ${last.dateTime}   →  ${last.latitude.toFixed(4)}, ${last.longitude.toFixed(4)}`);
    console.log(`  Bearing on first point: ${first.bearing?.toFixed(1) ?? 'n/a'}°`);
  }

  // ── Trips ────────────────────────────────────────────────────────────────
  console.log(`\nTrips      : ${history.trips.length}`);
  for (const trip of history.trips) {
    const dur = Math.round((new Date(trip.stop) - new Date(trip.start)) / 60_000);
    console.log(`  ${trip.start} → ${trip.stop} | ${trip.distance?.toFixed(1)} km | ${dur} min | max ${trip.maxSpeed} km/h`);
  }

  // ── Faults ───────────────────────────────────────────────────────────────
  console.log(`\nFaults     : ${history.faults.length}`);
  for (const f of history.faults) {
    console.log(`  [${f.faultState}] ${f.diagnostic?.name ?? f.diagnostic?.id}`);
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────
  const fuelRecords = history.diagnostics[Diagnostics.FUEL_LEVEL] ?? [];
  const aux1Records = history.diagnostics[Diagnostics.AUX_INPUT_1] ?? [];
  const ehRecords   = history.diagnostics[Diagnostics.ENGINE_HOURS] ?? [];

  console.log(`\nDiagnostics:`);
  console.log(`  Fuel readings    : ${fuelRecords.length}`);
  console.log(`  Aux input events : ${aux1Records.length}`);
  console.log(`  Engine hours pts : ${ehRecords.length}`);

  if (fuelRecords.length >= 2) {
    const startFuel = fuelRecords[0].data;
    const endFuel   = fuelRecords[fuelRecords.length - 1].data;
    console.log(`  Fuel: ${startFuel.toFixed(1)}% → ${endFuel.toFixed(1)}% (used ${(startFuel - endFuel).toFixed(1)}%)`);
  }

  // ── Multi-device example ─────────────────────────────────────────────────
  console.log('\n── Multi-device history (parallel fetch) ──');
  const fleetHistory = await sdk.historyMany(['b1', 'b2', 'b3'], {
    from,
    to,
    include: { gps: true, faults: true },
  });

  for (const dh of fleetHistory) {
    console.log(`  Device ${dh.deviceId}: ${dh.gps.length} GPS pts, ${dh.faults.length} faults`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
