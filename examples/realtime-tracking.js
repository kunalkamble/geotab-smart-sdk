'use strict';
/**
 * Example: High-fidelity live tracking via LogRecord.
 *
 * Every 5 seconds this fetches:
 *   - GetFeed(LogRecord) — every GPS fix since the last poll
 *   - Get(StatusData) for DiagnosticIgnitionId (current ignition state)
 *   - Get(StatusData) for fuel level (and any other diagnostics you add)
 *   - Get(FaultData) for active DTCs
 *   - Get(DriverChange) delta — to keep the current-driver map up to date
 *
 * Bearing is computed via atan2 between consecutive LogRecord points.
 * isDriving is derived from ignition (when known) + speed threshold.
 * The driver field is sourced from DriverChange (type 'Driver').
 *
 * Use this when you need every device fix (smooth map animation, geofencing,
 * driving-event detection). For "current snapshot per vehicle for a dashboard,"
 * sdk.liveTracker() (DeviceStatusInfo) is cheaper and simpler.
 */

const { GeotabSDK, Diagnostics } = require('../src');

const sdk = new GeotabSDK({
  username: process.env.GEOTAB_USER,
  password: process.env.GEOTAB_PASS,
  database: process.env.GEOTAB_DB,
  server:   process.env.GEOTAB_SERVER || 'my.geotab.com',
});

async function main() {
  console.log('Connecting to MyGeotab...');
  await sdk.connect({ cacheDevices: true });
  console.log('Connected. Starting realtime tracker.\n');

  const tracker = sdk.realtimeTracker()
    .withDiagnostics([
      Diagnostics.FUEL_LEVEL,
      Diagnostics.ODOMETER,
    ])
    .withIgnition()
    .withDriverAttribution()
    .withFaults()
    // .forGroups(['groupCompanyId'])  // optional — server-side + cache-based filter
    .pollEvery(5_000);

  tracker.on('update', vehicles => {
    console.log(`[${new Date().toISOString()}] ${vehicles.length} vehicle(s):`);
    for (const v of vehicles) {
      const speed   = v.location.speed   != null ? `${v.location.speed.toFixed(1)} km/h` : 'n/a';
      const bearing = v.location.bearing != null ? `${v.location.bearing.toFixed(0)}°`   : 'n/a';
      const ign     = v.ignition ? (v.ignition.value ? 'on' : 'off') : 'unknown';
      const drv     = v.driver?.name || v.driver?.id || '—';
      const fuel    = v.diagnostics[Diagnostics.FUEL_LEVEL]?.value;

      console.log(
        `  ${v.device.name.padEnd(18)} ` +
        `${v.location.latitude.toFixed(5)}, ${v.location.longitude.toFixed(5)} ` +
        `bearing=${bearing.padEnd(5)} speed=${speed.padEnd(10)} ` +
        `ign=${ign.padEnd(7)} driving=${String(v.isDriving).padEnd(5)} ` +
        `driver=${String(drv).padEnd(18)} ` +
        `fuel=${fuel != null ? fuel + '%' : 'n/a'}`
      );
      if (v.faults.length) {
        console.log(`    ⚠ ${v.faults.length} active fault(s)`);
      }
    }
    console.log();
  });

  tracker.on('error', err => console.error('[tracker] error:', err.message));

  await tracker.start();

  process.on('SIGINT', () => {
    console.log('\nStopping tracker...');
    tracker.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
