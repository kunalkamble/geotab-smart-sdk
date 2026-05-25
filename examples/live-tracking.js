'use strict';
/**
 * Example: Live vehicle tracking enriched with diagnostics and fault codes.
 *
 * Every 5 seconds this fetches:
 *   - DeviceStatusInfo (lat, lng, BEARING, speed, isDriving, driver)
 *   - StatusData for fuel level and aux input 1 (via multiCall — 1 HTTP request total)
 *   - FaultData for active DTCs
 *
 * This is the pattern to replace the common mistake of fetching LogRecord
 * for "live" data and wondering why bearing isn't available.
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
  console.log('Connected. Starting live tracker.\n');

  const tracker = sdk.liveTracker()
    .withDiagnostics([
      Diagnostics.FUEL_LEVEL,     // fuel %
      Diagnostics.AUX_INPUT_1,    // door sensor / PTO / any aux 1
      Diagnostics.ODOMETER,       // metres → divide by 1000 for km
    ])
    .withFaults()
    .pollEvery(5_000);            // 5 second polling interval

  tracker.on('update', (vehicles) => {
    console.clear();
    console.log(`Fleet update — ${new Date().toISOString()}\n`);

    for (const v of vehicles) {
      const loc  = v.location;
      const fuel = v.diagnostics[Diagnostics.FUEL_LEVEL];
      const aux1 = v.diagnostics[Diagnostics.AUX_INPUT_1];
      const odo  = v.diagnostics[Diagnostics.ODOMETER];

      console.log(`── ${v.device.name} (${v.device.id})`);
      console.log(`   Position : ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`);
      console.log(`   Bearing  : ${loc.bearing}°`);             // ← bearing from DeviceStatusInfo
      console.log(`   Speed    : ${loc.speed} km/h`);
      console.log(`   Status   : ${v.isDriving ? '🚗 Driving' : '🅿️  Stopped'}`);
      console.log(`   Connected: ${v.isConnected ? 'Yes' : 'No'}`);

      if (v.driver) {
        console.log(`   Driver   : ${v.driver.name ?? v.driver.id}`);
      }

      if (fuel)  console.log(`   Fuel     : ${fuel.value.toFixed(1)}%`);
      if (aux1)  console.log(`   Aux 1    : ${aux1.value === 1 ? 'ON' : 'off'}`);
      if (odo)   console.log(`   Odometer : ${(odo.value / 1000).toFixed(0)} km`);

      if (v.faults.length > 0) {
        console.log(`   ⚠️  Faults : ${v.faults.length} active`);
        for (const f of v.faults) {
          console.log(`     - ${f.diagnostic?.name ?? f.diagnostic?.id}`);
        }
      }

      console.log();
    }
  });

  tracker.on('error', (err) => {
    console.error('Tracker error:', err.message);
  });

  await tracker.start();
}

main().catch(err => { console.error(err); process.exit(1); });
