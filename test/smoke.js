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

check('GeotabSDK requires password OR sessionId', () => {
  assert.throws(
    () => new sdk.GeotabSDK({ username: 'u', database: 'd' }),
    /password|sessionId/i,
  );
});

check('GeotabSDK accepts sessionId-only credentials (no password)', () => {
  const inst = new sdk.GeotabSDK({
    username: 'u', database: 'd', sessionId: 'abc123', server: 'my.geotab.com',
  });
  assert.equal(typeof inst.call, 'function');
  // getSession returns null until connect() succeeds
  assert.equal(inst.getSession(), null);
});

const instance = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });

check('GeotabSDK instance exposes call / multiCall / connect / getSession', () => {
  assert.equal(typeof instance.call, 'function');
  assert.equal(typeof instance.multiCall, 'function');
  assert.equal(typeof instance.connect, 'function');
  assert.equal(typeof instance.getSession, 'function');
  assert.equal(instance.getSession(), null);  // pre-connect: no session yet
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
    .forGroups(['groupCompanyId'])
    .pollEvery(5000);
  assert.ok(t instanceof sdk.LiveTracker);
  assert.equal(typeof t.start, 'function');
  assert.equal(typeof t.stop, 'function');
  assert.equal(typeof t.forGroups, 'function');
});

check('LiveTracker.forGroups propagates to DSI, StatusData, FaultData', () => {
  const t = new sdk.LiveTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL]).withFaults().forGroups(['groupCompanyId']);
  const calls = t._buildCalls();

  const dsi = calls.find(([, p]) => p.typeName === 'DeviceStatusInfo');
  const sd  = calls.find(([, p]) => p.typeName === 'StatusData');
  const fd  = calls.find(([, p]) => p.typeName === 'FaultData');

  assert.deepEqual(dsi[1].search.groups,             [{ id: 'groupCompanyId' }]);
  assert.deepEqual(sd[1].search.deviceSearch?.groups, [{ id: 'groupCompanyId' }]);
  assert.deepEqual(fd[1].search.deviceSearch?.groups, [{ id: 'groupCompanyId' }]);

  // Diagnostic + fault state filters must remain intact alongside the group filter
  assert.deepEqual(sd[1].search.diagnosticSearch, { id: sdk.Diagnostics.FUEL_LEVEL });
  assert.deepEqual(fd[1].search.faultStates, ['Active']);
});

check('LiveTracker without forGroups produces no group filter', () => {
  const t = new sdk.LiveTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL]).withFaults();
  const calls = t._buildCalls();
  for (const [, p] of calls) {
    assert.equal(p.search.groups, undefined);
    assert.equal(p.search.deviceSearch?.groups, undefined);
  }
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

check('RealtimeTracker.forGroups propagates server-side and NOT to LogRecord', () => {
  const t = new sdk.RealtimeTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL])
    .withIgnition()
    .withDriverAttribution()
    .withFaults()
    .forGroups(['groupCompanyId']);
  const wrapped = t._buildCalls();
  const find = (role) => wrapped.find(w => w.role === role)?.call?.[1];

  // LogRecord (GetFeed) — must NOT carry a group filter
  const lr = find('logrecord');
  assert.equal(lr.search?.deviceSearch, undefined, 'LogRecord must have no deviceSearch');
  assert.equal(lr.search?.groups, undefined, 'LogRecord must have no top-level groups');

  // Get-based calls — must all carry deviceSearch.groups, alongside their own filters
  const ig = find('ignition');
  assert.deepEqual(ig.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);
  assert.deepEqual(ig.search.diagnosticSearch, { id: sdk.Diagnostics.IGNITION });

  const diag = wrapped.find(w => w.role === 'diagnostic' && w.diagId === sdk.Diagnostics.FUEL_LEVEL).call[1];
  assert.deepEqual(diag.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);

  const fd = find('faults');
  assert.deepEqual(fd.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);
  assert.deepEqual(fd.search.faultStates, ['Active']);

  const dc = find('driverchange');
  assert.deepEqual(dc.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);
  assert.equal(dc.search.type, 'Driver');
});

check('RealtimeTracker without forGroups omits server-side filters', () => {
  const t = new sdk.RealtimeTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL])
    .withIgnition()
    .withDriverAttribution()
    .withFaults();
  const wrapped = t._buildCalls();
  for (const w of wrapped) {
    const params = w.call[1];
    assert.equal(params.search?.deviceSearch?.groups, undefined,
      `${w.role}: should have no deviceSearch.groups`);
  }
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

check('historyByGroups exists and validates input', async () => {
  assert.equal(typeof instance.historyByGroups, 'function');
  await assert.rejects(
    () => instance.historyByGroups([], { from: new Date(), to: new Date() }),
    /groupIds/i,
  );
  await assert.rejects(
    () => instance.historyByGroups(['groupCompanyId'], {}),
    /from|to/i,
  );
});

check('historyByGroups resolves groups → devices, then fans out to historyMany', async () => {
  const seen = { deviceQuery: null, multiCalls: [] };
  const fakeSession = {
    call: async (method, params) => {
      if (params.typeName === 'Device') {
        seen.deviceQuery = params;
        return [{ id: 'b1' }, { id: 'b2' }];
      }
      throw new Error('unexpected call: ' + params.typeName);
    },
    multiCall: async (calls) => {
      seen.multiCalls.push(calls);
      return calls.map(() => []);
    },
  };

  const hq = new sdk.HistoryQuery(fakeSession, {});
  const result = await hq.fetchByGroups(['groupCompanyId'], {
    from: new Date('2024-01-15T00:00:00Z'),
    to:   new Date('2024-01-16T00:00:00Z'),
    include: { gps: true },
  });

  assert.deepEqual(seen.deviceQuery.search.groups, [{ id: 'groupCompanyId' }]);
  assert.equal(seen.multiCalls.length, 2,         'one multiCall per resolved device');
  assert.equal(result.length, 2);
  assert.equal(result[0].deviceId, 'b1');
  assert.equal(result[1].deviceId, 'b2');
});

check('connect({ cacheGroups }) scopes the device cache fetch', async () => {
  const captured = [];
  const fakeSession = {
    on: () => {},
    connect: async () => {},
    call: async (method, params) => { captured.push({ method, params }); return []; },
  };
  const sdk2 = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  sdk2._session = fakeSession;

  await sdk2.connect({ cacheGroups: ['groupCompanyId'] });

  const deviceCall = captured.find(c => c.params.typeName === 'Device');
  assert.ok(deviceCall, 'Device fetch should occur (cacheGroups implies cacheDevices)');
  assert.deepEqual(deviceCall.params.search.groups, [{ id: 'groupCompanyId' }]);
});

check('connect({ cacheDevices: true }) without cacheGroups uses empty search', async () => {
  const captured = [];
  const fakeSession = {
    on: () => {},
    connect: async () => {},
    call: async (method, params) => { captured.push({ method, params }); return []; },
  };
  const sdk2 = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  sdk2._session = fakeSession;

  await sdk2.connect({ cacheDevices: true });

  const deviceCall = captured.find(c => c.params.typeName === 'Device');
  assert.deepEqual(deviceCall.params.search, {});
});

check('connect() with no cache options performs no Get calls', async () => {
  const captured = [];
  const fakeSession = {
    on: () => {},
    connect: async () => {},
    call: async (method, params) => { captured.push({ method, params }); return []; },
  };
  const sdk2 = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  sdk2._session = fakeSession;

  await sdk2.connect();

  assert.equal(captured.length, 0, 'no Get calls should be made');
});

check('historyByGroups returns [] when group has no devices', async () => {
  const fakeSession = {
    call: async () => [],
    multiCall: async () => { throw new Error('multiCall should not run for empty groups'); },
  };
  const hq = new sdk.HistoryQuery(fakeSession, {});
  const result = await hq.fetchByGroups(['groupCompanyId'], {
    from: new Date(), to: new Date(),
  });
  assert.deepEqual(result, []);
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

// ─── Read-only mode ─────────────────────────────────────────────────────────

function makeReadOnly() {
  const ro = new sdk.GeotabSDK(
    { username: 'u', password: 'p', database: 'd' },
    { readOnly: true },
  );
  // Replace _api with a no-op so that any call that *does* pass our guard
  // doesn't try to hit the network.
  ro._session._api = {
    call:          async () => null,
    multiCall:     async () => [],
    authenticate:  async () => null,
    getSession:    async () => null,
  };
  ro._session._authenticated = true;
  return ro;
}

check('readOnly mode rejects writes via .call()', async () => {
  const ro = makeReadOnly();
  await assert.rejects(() => ro.call('Set',    { typeName: 'Group' }),  /readOnly/i);
  await assert.rejects(() => ro.call('Add',    { typeName: 'Device' }), /readOnly/i);
  await assert.rejects(() => ro.call('Remove', { typeName: 'Device' }), /readOnly/i);
  await assert.rejects(() => ro.call('ExecuteEdit', {}),                 /readOnly/i);
});

check('readOnly mode rejects writes inside .multiCall()', async () => {
  const ro = makeReadOnly();
  await assert.rejects(
    () => ro.multiCall([['Get', {}], ['Set', { typeName: 'Group' }]]),
    /readOnly/i,
  );
});

check('readOnly mode allows Get / GetFeed / GetCountOf', async () => {
  const ro = makeReadOnly();
  await ro.call('Get',          { typeName: 'Device' });
  await ro.call('GetFeed',      { typeName: 'LogRecord' });
  await ro.call('GetCountOf',   { typeName: 'Device' });
  await ro.multiCall([['Get', {}], ['GetFeed', {}]]);
});

check('default (no readOnly) allows any method — SDK stays fully capable', async () => {
  const open = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  open._session._api = {
    call: async () => null, multiCall: async () => [], authenticate: async () => null, getSession: async () => null,
  };
  open._session._authenticated = true;
  await open.call('Set', { typeName: 'Group' });
  await open.call('Add', { typeName: 'Device' });
});

const total = passed + (process.exitCode === 1 ? 1 : 0); // best-effort total
if (process.exitCode === 1) {
  console.error(`\n✗ smoke test failed (${passed} of ${total} checks passed)`);
} else {
  console.log(`\n✓ smoke test passed (${passed} checks)`);
}
