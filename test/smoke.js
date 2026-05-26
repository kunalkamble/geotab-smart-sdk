'use strict';
/**
 * Smoke test — verifies the SDK loads cleanly, the public surface is intact,
 * helpers can be instantiated, and fluent builders chain.
 *
 * No network calls. Safe to run in CI without credentials.
 */

const assert = require('node:assert/strict');
const sdk = require('../src');

let passed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('geotab-smart-sdk smoke test\n');

check('public exports are present', () => {
  const expected = [
    'GeotabSDK',
    'Diagnostics', 'DiagnosticLabels', 'DiagnosticGroups',
    'LiveTracker', 'RealtimeTracker', 'FeedManager',
    'HistoryQuery', 'FleetSnapshot',
  ];
  for (const name of expected) {
    assert.ok(sdk[name], `missing export: ${name}`);
  }
});

check('GeotabSDK constructor rejects missing credentials', () => {
  assert.throws(() => new sdk.GeotabSDK({}), /username/i);
  assert.throws(() => new sdk.GeotabSDK({ username: 'u', password: 'p' }), /database/i);
});

const instance = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });

check('GeotabSDK instance exposes call / multiCall / connect', () => {
  assert.equal(typeof instance.call, 'function');
  assert.equal(typeof instance.multiCall, 'function');
  assert.equal(typeof instance.connect, 'function');
});

check('factory methods return the right classes', () => {
  assert.ok(instance.liveTracker() instanceof sdk.LiveTracker);
  assert.ok(instance.realtimeTracker() instanceof sdk.RealtimeTracker);
  assert.ok(instance.feeds() instanceof sdk.FeedManager);
});

check('Diagnostic constants match Geotab KnownIds', () => {
  assert.equal(sdk.Diagnostics.FUEL_LEVEL,    'DiagnosticFuelLevelId');
  assert.equal(sdk.Diagnostics.ODOMETER,      'DiagnosticOdometerAdjustmentId');
  assert.equal(sdk.Diagnostics.ENGINE_RPM,    'DiagnosticEngineSpeedId');
  assert.equal(sdk.Diagnostics.ENGINE_SPEED,  'DiagnosticEngineRoadSpeedId');
  assert.equal(sdk.Diagnostics.IGNITION,      'DiagnosticIgnitionId');
  assert.equal(sdk.Diagnostics.AUX_INPUT_1,   'DiagnosticGoInputStatusId');
});

check('DiagnosticGroups expose expected arrays', () => {
  assert.ok(Array.isArray(sdk.DiagnosticGroups.FLEET_BASICS));
  assert.ok(sdk.DiagnosticGroups.FLEET_BASICS.includes(sdk.Diagnostics.FUEL_LEVEL));
  assert.ok(Array.isArray(sdk.DiagnosticGroups.AUX_INPUTS));
  assert.ok(sdk.DiagnosticGroups.AUX_INPUTS.length >= 4);
});

check('DiagnosticLabels provides reverse lookup', () => {
  assert.ok(sdk.DiagnosticLabels[sdk.Diagnostics.FUEL_LEVEL]);
});

check('LiveTracker builder chains and start() exists', () => {
  const t = instance.liveTracker()
    .withDiagnostics([sdk.Diagnostics.FUEL_LEVEL])
    .withFaults()
    .forDevices(['b1'])
    .pollEvery(5000);
  assert.ok(t instanceof sdk.LiveTracker);
  assert.equal(typeof t.start, 'function');
  assert.equal(typeof t.stop, 'function');
});

check('RealtimeTracker builder chains and exposes derived-field config', () => {
  const t = instance.realtimeTracker()
    .withDiagnostics([sdk.Diagnostics.FUEL_LEVEL])
    .withIgnition()
    .withDriverAttribution()
    .withFaults()
    .pollEvery(5000)
    .drivingSpeedThreshold(5);
  assert.ok(t instanceof sdk.RealtimeTracker);
  assert.equal(typeof t.start, 'function');
  assert.equal(typeof t.stop, 'function');
});

check('RealtimeTracker.pollEvery floors at 1000 ms', () => {
  const t = instance.realtimeTracker().pollEvery(100);
  assert.equal(t._pollMs, 1000);
});

check('FeedManager builder + version helpers', () => {
  const feeds = instance.feeds();
  const chained = feeds.addFeed('LogRecord');
  assert.equal(chained, feeds);
  assert.equal(feeds.getVersion('LogRecord'), null);
  feeds.setVersion('LogRecord', 'abc');
  assert.equal(feeds.getVersion('LogRecord'), 'abc');
});

check('HistoryQuery rejects missing required args', async () => {
  await assert.rejects(() => instance.history({ from: new Date(), to: new Date() }), /deviceId/i);
  await assert.rejects(() => instance.history({ deviceId: 'b1' }), /from/i);
});

check('FleetSnapshot.groupIds propagates to every entity call', async () => {
  let captured = null;
  const fakeSession = {
    multiCall: async (calls) => { captured = calls; return calls.map(() => []); },
  };
  const fakeRateLimiter = { withRetry: (_, fn) => fn() };
  const fakeCache = { set: () => {}, getAll: () => null };

  const snapshot = new sdk.FleetSnapshot(fakeSession, fakeRateLimiter, fakeCache);
  await snapshot.fetch({
    include: {
      devices:      true,
      liveStatus:   true,
      activeFaults: true,
      diagnostics:  [sdk.Diagnostics.FUEL_LEVEL],
      recentTrips:  3,
    },
    groupIds: ['groupCompanyId'],
  });

  assert.ok(captured, 'multiCall should have been invoked');

  for (const [method, params] of captured) {
    assert.equal(method, 'Get');
    const { typeName, search } = params;
    if (typeName === 'Device' || typeName === 'DeviceStatusInfo') {
      assert.deepEqual(search.groups, [{ id: 'groupCompanyId' }],
        `${typeName} should have search.groups`);
    } else {
      assert.deepEqual(search.deviceSearch?.groups, [{ id: 'groupCompanyId' }],
        `${typeName} should have search.deviceSearch.groups`);
    }
  }
});

check('FleetSnapshot omits group filter when groupIds is empty', async () => {
  let captured = null;
  const fakeSession = {
    multiCall: async (calls) => { captured = calls; return calls.map(() => []); },
  };
  const fakeCache = { set: () => {}, getAll: () => null };

  const snapshot = new sdk.FleetSnapshot(fakeSession, {}, fakeCache);
  await snapshot.fetch({ include: { liveStatus: true, activeFaults: true } });

  for (const [, params] of captured) {
    assert.equal(params.search.groups, undefined, 'no top-level groups');
    assert.equal(params.search.deviceSearch?.groups, undefined, 'no nested groups');
  }
});

const total = passed + (process.exitCode === 1 ? 1 : 0); // best-effort total
if (process.exitCode === 1) {
  console.error(`\n✗ smoke test failed (${passed} of ${total} checks passed)`);
} else {
  console.log(`\n✓ smoke test passed (${passed} checks)`);
}
