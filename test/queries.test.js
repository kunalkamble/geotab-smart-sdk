'use strict';
/**
 * HistoryQuery + FleetSnapshot tests.
 *
 * Covers both input-shape (what we send) and output-processing (how we
 * stitch the response into a useful object). The output checks specifically
 * guard against Geotab silently returning more rows than the requested
 * group filter should produce — see trackers.test.js for the same pattern.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../src');

// ─── HistoryQuery — input validation ────────────────────────────────────────

test('history() rejects missing required args', async () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  await assert.rejects(() => inst.history({ from: new Date(), to: new Date() }), /deviceId/i);
  await assert.rejects(() => inst.history({ deviceId: 'b1' }), /from/i);
});

test('historyByGroups exists and validates input', async () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  assert.equal(typeof inst.historyByGroups, 'function');
  await assert.rejects(
    () => inst.historyByGroups([], { from: new Date(), to: new Date() }),
    /groupIds/i,
  );
  await assert.rejects(
    () => inst.historyByGroups(['groupCompanyId'], {}),
    /from|to/i,
  );
});

test('historyByGroups resolves groups → devices, then fans out to historyMany', async () => {
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
  assert.equal(seen.multiCalls.length, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].deviceId, 'b1');
  assert.equal(result[1].deviceId, 'b2');
});

test('historyByGroups returns [] when group has no devices', async () => {
  const fakeSession = {
    call:      async () => [],
    multiCall: async () => { throw new Error('multiCall should not run for empty groups'); },
  };
  const hq = new sdk.HistoryQuery(fakeSession, {});
  const result = await hq.fetchByGroups(['groupCompanyId'], { from: new Date(), to: new Date() });
  assert.deepEqual(result, []);
});

// ─── HistoryQuery — pagination ──────────────────────────────────────────────

test('HistoryQuery._paginate dedupes by id across page boundaries', async () => {
  const hq = new sdk.HistoryQuery({}, {});
  const PAGE = 50_000;

  // Last 3 records of page 1 share the boundary dateTime — this exercises
  // the dedup-by-id path that the older slice(1) approach lost.
  const firstPage = Array.from({ length: PAGE }, (_, i) => ({
    id: 'a' + i,
    dateTime: i >= PAGE - 3 ? '2024-01-01T00:00:05.000Z' : '2024-01-01T00:00:00.000Z',
  }));

  // Page 2 starts with the same three boundary ids, plus two genuinely new records.
  const secondPage = [
    { id: 'a' + (PAGE - 3), dateTime: '2024-01-01T00:00:05.000Z' },
    { id: 'a' + (PAGE - 2), dateTime: '2024-01-01T00:00:05.000Z' },
    { id: 'a' + (PAGE - 1), dateTime: '2024-01-01T00:00:05.000Z' },
    { id: 'b1', dateTime: '2024-01-01T00:00:06.000Z' },
    { id: 'b2', dateTime: '2024-01-01T00:00:07.000Z' },
  ];

  const merged = await hq._paginate(firstPage, async () => secondPage);
  assert.equal(merged.length, PAGE + 2);
  assert.equal(merged[merged.length - 1].id, 'b2');
  assert.equal(merged[merged.length - 2].id, 'b1');
});

test('HistoryQuery._paginate breaks safely on an all-duplicates page', async () => {
  const hq = new sdk.HistoryQuery({}, {});
  const PAGE = 50_000;

  const firstPage = Array.from({ length: PAGE }, (_, i) => ({
    id: 'a' + i,
    dateTime: '2024-01-01T00:00:00.000Z',
  }));
  // Page 2 is entirely duplicates — must NOT loop forever.
  const secondPage = firstPage.slice(0, 5);

  const merged = await hq._paginate(firstPage, async () => secondPage);
  assert.equal(merged.length, PAGE, 'no new records should have been added');
});

// ─── FleetSnapshot — input shape ────────────────────────────────────────────

test('FleetSnapshot.groupIds propagates to every entity call', async () => {
  let captured = null;
  const fakeSession = {
    multiCall: async (calls) => { captured = calls; return calls.map(() => []); },
  };
  const fakeCache = { set: () => {}, getAll: () => null };

  const snapshot = new sdk.FleetSnapshot(fakeSession, {}, fakeCache);
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

  assert.ok(captured);
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

test('FleetSnapshot omits group filter when groupIds is empty', async () => {
  let captured = null;
  const fakeSession = {
    multiCall: async (calls) => { captured = calls; return calls.map(() => []); },
  };
  const fakeCache = { set: () => {}, getAll: () => null };

  const snapshot = new sdk.FleetSnapshot(fakeSession, {}, fakeCache);
  await snapshot.fetch({ include: { liveStatus: true, activeFaults: true } });

  for (const [, params] of captured) {
    assert.equal(params.search.groups, undefined);
    assert.equal(params.search.deviceSearch?.groups, undefined);
  }
});

// ─── FleetSnapshot — output processing ──────────────────────────────────────

test('FleetSnapshot._assemble filters out-of-group entries across all output maps', () => {
  // Simulates Geotab returning b2 (out of group) in liveStatus / faults /
  // diagnostics despite our server-side filter — the client must strip them.
  const devices = [
    { id: 'b1', name: 'Truck-1', groups: [{ id: 'groupCompanyId' }] },
    { id: 'b2', name: 'Truck-2', groups: [{ id: 'groupOther' }] },
  ];
  // The cache is "set" via setter when role==='devices', so we let _assemble
  // populate it from the fake results. Provide getAll that reads back.
  const cacheStore = new Map();
  const cache = {
    set: (key, arr) => {
      if (key !== 'Device') return;
      cacheStore.clear();
      for (const d of arr) cacheStore.set(d.id, d);
    },
    getAll: (key) => key === 'Device' ? cacheStore : null,
  };

  const fs = new sdk.FleetSnapshot({}, {}, cache);

  // results match the order of callMap below.
  const results = [
    devices,                                                                                          // [0] devices
    [{ device: { id: 'b1' }, isDriving: true, isDeviceCommunicating: true, latitude: 1, longitude: 1 },
     { device: { id: 'b2' }, isDriving: false, isDeviceCommunicating: true, latitude: 2, longitude: 2 }],  // [1] liveStatus
    [{ device: { id: 'b1' }, data: 50, dateTime: '2024-01-01T00:00:00Z' },
     { device: { id: 'b2' }, data: 75, dateTime: '2024-01-01T00:00:00Z' }],                            // [2] diagnostic
    [{ device: { id: 'b1' }, faultState: 'Active' },
     { device: { id: 'b2' }, faultState: 'Active' }],                                                   // [3] faults
  ];
  const callMap = {
    0: 'devices',
    1: 'liveStatus',
    2: { type: 'diagnostic', diagId: sdk.Diagnostics.FUEL_LEVEL },
    3: 'faults',
  };

  const out = fs._assemble(results, callMap, ['groupCompanyId']);

  assert.equal(out.liveStatus.size, 1, 'liveStatus should be filtered to just b1');
  assert.ok(out.liveStatus.has('b1'));
  assert.equal(out.faults.size, 1, 'faults should be filtered to just b1');
  assert.equal(out.diagnostics[sdk.Diagnostics.FUEL_LEVEL].size, 1, 'diagnostic map filtered');

  // summary counts must reflect the filtered fleet.
  assert.equal(out.summary.driving, 1);
  assert.equal(out.summary.stopped, 0);
});

test('FleetSnapshot._assemble keeps everything when groupIds is empty', () => {
  const cache = {
    set:    () => {},
    getAll: () => null,
  };
  const fs = new sdk.FleetSnapshot({}, {}, cache);
  const results = [
    [{ device: { id: 'b1' }, isDriving: true, isDeviceCommunicating: true },
     { device: { id: 'b2' }, isDriving: false, isDeviceCommunicating: true }],
  ];
  const callMap = { 0: 'liveStatus' };
  const out = fs._assemble(results, callMap, []);
  assert.equal(out.liveStatus.size, 2);
});
