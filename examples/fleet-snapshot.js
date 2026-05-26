'use strict';
/**
 * Example: Fleet-wide snapshot — everything you need for a dashboard load in one call.
 *
 * Without multiCall this would require 5+ separate HTTP requests.
 * With fleetSnapshot() it's a single round-trip.
 */

const { GeotabSDK, Diagnostics } = require('../src');

const sdk = new GeotabSDK({
  username: process.env.GEOTAB_USER,
  password: process.env.GEOTAB_PASS,
  database: process.env.GEOTAB_DB,
  server:   process.env.GEOTAB_SERVER || 'my.geotab.com',
});

async function main() {
  console.log('Loading fleet dashboard...\n');
  // Explicit connect so auth errors surface here rather than inside fleetSnapshot.
  await sdk.connect({ cacheDevices: true });

  const fleet = await sdk.fleetSnapshot({
    include: {
      devices:      true,
      liveStatus:   true,    // DeviceStatusInfo — location, bearing, driver
      activeFaults: true,    // current DTCs per vehicle
      diagnostics:  [
        Diagnostics.FUEL_LEVEL,
        Diagnostics.ODOMETER,
      ],
      recentTrips: 3,         // last 3 trips per vehicle
    },
    // groupIds: ['groupCompanyId'],   // optional — scope to specific groups
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const s = fleet.summary;
  console.log('Fleet Summary');
  console.log('─────────────────────────────');
  console.log(`Total vehicles  : ${s.total}`);
  console.log(`Driving         : ${s.driving}`);
  console.log(`Stopped         : ${s.stopped}`);
  console.log(`Disconnected    : ${s.disconnected}`);
  console.log(`With DTC faults : ${s.withActiveFaults}`);
  console.log();

  // ── Per-vehicle detail ────────────────────────────────────────────────────
  for (const device of fleet.devices.slice(0, 5)) { // show first 5
    const status = fleet.liveStatus.get(device.id);
    const faults = fleet.faults.get(device.id) ?? [];
    const fuel   = fleet.diagnostics[Diagnostics.FUEL_LEVEL]?.get(device.id);
    const odo    = fleet.diagnostics[Diagnostics.ODOMETER]?.get(device.id);
    const trips  = fleet.recentTrips.get(device.id) ?? [];

    console.log(`${device.name}`);
    if (status) {
      console.log(`  ${status.isDriving ? '🚗 Driving' : '🅿️  Stopped'} at ${status.latitude?.toFixed(4)}, ${status.longitude?.toFixed(4)} | bearing ${status.bearing}°`);
    }
    if (fuel) console.log(`  Fuel: ${fuel.data?.toFixed(1)}%`);
    if (odo)  console.log(`  Odometer: ${(odo.data / 1000).toFixed(0)} km`);
    if (faults.length > 0) {
      console.log(`  ⚠️  ${faults.length} active fault(s):`);
      faults.forEach(f => console.log(`     - ${f.diagnostic?.name ?? f.diagnostic?.id}`));
    }
    if (trips.length > 0) {
      console.log(`  Last trip: ${trips[0].start} → ${trips[0].stop} (${trips[0].distance?.toFixed(1)} km)`);
    }
    console.log();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
