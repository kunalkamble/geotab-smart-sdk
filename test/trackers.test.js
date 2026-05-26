'use strict';
/**
 * LiveTracker + RealtimeTracker tests.
 *
 * Two test categories per tracker:
 *   1. Input shape — what _buildCalls() sends to MyGeotab.
 *   2. Output processing — what _mergeResults / _merge produce from a
 *      hand-crafted response. The second category is the one that catches
 *      the "Geotab silently ignored our server-side filter" class of bug
 *      (see https://github.com/.../README — "Filtering by group").
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../src');

// ─── LiveTracker — fluent builder ───────────────────────────────────────────

test('LiveTracker builder chains and exposes lifecycle methods', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const t = inst.liveTracker()
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

// ─── LiveTracker — input shape ──────────────────────────────────────────────

test('LiveTracker.forGroups propagates to DSI, StatusData, FaultData', () => {
  const t = new sdk.LiveTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL]).withFaults().forGroups(['groupCompanyId']);
  const calls = t._buildCalls();

  const dsi = calls.find(([, p]) => p.typeName === 'DeviceStatusInfo');
  const sd  = calls.find(([, p]) => p.typeName === 'StatusData');
  const fd  = calls.find(([, p]) => p.typeName === 'FaultData');

  assert.deepEqual(dsi[1].search.groups,              [{ id: 'groupCompanyId' }]);
  assert.deepEqual(sd[1].search.deviceSearch?.groups, [{ id: 'groupCompanyId' }]);
  assert.deepEqual(fd[1].search.deviceSearch?.groups, [{ id: 'groupCompanyId' }]);
  assert.deepEqual(sd[1].search.diagnosticSearch,     { id: sdk.Diagnostics.FUEL_LEVEL });
  assert.deepEqual(fd[1].search.faultStates,          ['Active']);
});

test('LiveTracker without forGroups produces no group filter', () => {
  const t = new sdk.LiveTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL]).withFaults();
  const calls = t._buildCalls();
  for (const [, p] of calls) {
    assert.equal(p.search.groups, undefined);
    assert.equal(p.search.deviceSearch?.groups, undefined);
  }
});

// ─── LiveTracker — output processing ────────────────────────────────────────

test('LiveTracker filters DSI client-side by group when device cache is warm', () => {
  // Defense against Geotab silently ignoring `DeviceStatusInfo.search.groups`.
  const cache = {
    getAll: () => new Map([
      ['b1', { id: 'b1', name: 'Truck-1', groups: [{ id: 'groupCompanyId' }] }],
      ['b2', { id: 'b2', name: 'Truck-2', groups: [{ id: 'groupOther' }] }],
    ]),
  };
  const t = new sdk.LiveTracker({}, {}, cache);
  t.forGroups(['groupCompanyId']);

  const merged = t._mergeResults([
    [
      { device: { id: 'b1', name: 'Truck-1' }, latitude: 1, longitude: 1, bearing: 90, speed: 10, isDriving: true, isDeviceCommunicating: true, dateTime: '2024-01-01T00:00:00Z' },
      { device: { id: 'b2', name: 'Truck-2' }, latitude: 2, longitude: 2, bearing: 180, speed: 0, isDriving: false, isDeviceCommunicating: true, dateTime: '2024-01-01T00:00:00Z' },
    ],
  ]);
  assert.equal(merged.length, 1, 'should keep only b1 (in groupCompanyId)');
  assert.equal(merged[0].device.id, 'b1');
});

test('LiveTracker without forGroups returns all DSI results', () => {
  const cache = { getAll: () => null };
  const t = new sdk.LiveTracker({}, {}, cache);
  const merged = t._mergeResults([
    [
      { device: { id: 'b1' }, latitude: 1, longitude: 1, dateTime: '2024-01-01T00:00:00Z' },
      { device: { id: 'b2' }, latitude: 2, longitude: 2, dateTime: '2024-01-01T00:00:00Z' },
    ],
  ]);
  assert.equal(merged.length, 2);
});

test('LiveTracker.forDevices alone (no forGroups) filters DSI by device id', () => {
  const cache = { getAll: () => null };
  const t = new sdk.LiveTracker({}, {}, cache);
  t.forDevices(['b1']);
  const merged = t._mergeResults([
    [
      { device: { id: 'b1' }, latitude: 1, longitude: 1, dateTime: '2024-01-01T00:00:00Z' },
      { device: { id: 'b2' }, latitude: 2, longitude: 2, dateTime: '2024-01-01T00:00:00Z' },
    ],
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].device.id, 'b1');
});

// ─── RealtimeTracker — fluent builder ───────────────────────────────────────

test('RealtimeTracker builder chains and exposes derived-field config', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const t = inst.realtimeTracker()
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

test('RealtimeTracker.pollEvery floors at 1000 ms', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  // Suppress the soft-warning console output during the test.
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const t = inst.realtimeTracker().pollEvery(100);
    assert.equal(t._pollMs, 1000);
  } finally {
    console.warn = originalWarn;
  }
});

// ─── RealtimeTracker — input shape ──────────────────────────────────────────

test('RealtimeTracker.forGroups propagates server-side and NOT to LogRecord', () => {
  const t = new sdk.RealtimeTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL])
    .withIgnition()
    .withDriverAttribution()
    .withFaults()
    .forGroups(['groupCompanyId']);
  const wrapped = t._buildCalls();
  const find = (role) => wrapped.find(w => w.role === role)?.call?.[1];

  const lr = find('logrecord');
  assert.equal(lr.search?.deviceSearch, undefined, 'LogRecord must have no deviceSearch');
  assert.equal(lr.search?.groups,        undefined, 'LogRecord must have no top-level groups');

  const ig = find('ignition');
  assert.deepEqual(ig.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);
  assert.deepEqual(ig.search.diagnosticSearch,    { id: sdk.Diagnostics.IGNITION });

  const diag = wrapped.find(w => w.role === 'diagnostic' && w.diagId === sdk.Diagnostics.FUEL_LEVEL).call[1];
  assert.deepEqual(diag.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);

  const fd = find('faults');
  assert.deepEqual(fd.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);
  assert.deepEqual(fd.search.faultStates,         ['Active']);

  const dc = find('driverchange');
  assert.deepEqual(dc.search.deviceSearch.groups, [{ id: 'groupCompanyId' }]);
  assert.equal(dc.search.type, 'Driver');
});

test('RealtimeTracker without forGroups omits server-side filters', () => {
  const t = new sdk.RealtimeTracker({}, {}, { getAll: () => null });
  t.withDiagnostics([sdk.Diagnostics.FUEL_LEVEL])
    .withIgnition()
    .withDriverAttribution()
    .withFaults();
  for (const w of t._buildCalls()) {
    assert.equal(w.call[1].search?.deviceSearch?.groups, undefined);
  }
});

// ─── RealtimeTracker — output processing ────────────────────────────────────

test('RealtimeTracker._merge filters LogRecord stream by group via device cache', () => {
  // GetFeed(LogRecord) can't carry a server-side filter, so the merge
  // function has to drop out-of-group devices on the client.
  const cache = {
    getAll: () => new Map([
      ['b1', { id: 'b1', name: 'Truck-1', groups: [{ id: 'groupCompanyId' }] }],
      ['b2', { id: 'b2', name: 'Truck-2', groups: [{ id: 'groupOther' }] }],
    ]),
    isFresh: () => true,
  };
  const t = new sdk.RealtimeTracker({}, {}, cache);
  t.forGroups(['groupCompanyId']);

  const calls = t._buildCalls();
  const results = calls.map(() => []);
  // LogRecord GetFeed returns BOTH vehicles; client must filter to b1 only.
  results[0] = {
    data: [
      { device: { id: 'b1' }, latitude: 1, longitude: 1, speed: 20, dateTime: '2024-01-01T00:00:00Z' },
      { device: { id: 'b2' }, latitude: 2, longitude: 2, speed: 30, dateTime: '2024-01-01T00:00:00Z' },
    ],
    toVersion: 'v1',
  };

  const vehicles = t._merge(results, calls);
  assert.equal(vehicles.length, 1, 'should keep only b1 (in groupCompanyId)');
  assert.equal(vehicles[0].device.id, 'b1');
  assert.equal(vehicles[0].source,    'logrecord');
});

test('RealtimeTracker._merge with no forGroups returns every vehicle in the LogRecord stream', () => {
  const cache = {
    getAll: () => new Map([
      ['b1', { id: 'b1', name: 'Truck-1' }],
      ['b2', { id: 'b2', name: 'Truck-2' }],
    ]),
    isFresh: () => true,
  };
  const t = new sdk.RealtimeTracker({}, {}, cache);
  const calls = t._buildCalls();
  const results = calls.map(() => []);
  results[0] = {
    data: [
      { device: { id: 'b1' }, latitude: 1, longitude: 1, speed: 20, dateTime: '2024-01-01T00:00:00Z' },
      { device: { id: 'b2' }, latitude: 2, longitude: 2, speed: 30, dateTime: '2024-01-01T00:00:00Z' },
    ],
    toVersion: 'v1',
  };
  const vehicles = t._merge(results, calls);
  assert.equal(vehicles.length, 2);
});

test('RealtimeTracker._merge computes bearing between consecutive observations', () => {
  const cache = {
    getAll: () => new Map([['b1', { id: 'b1', name: 'Truck-1' }]]),
    isFresh: () => true,
  };
  const t = new sdk.RealtimeTracker({}, {}, cache);

  // First poll: no prior point ⇒ bearing should be null.
  const calls1 = t._buildCalls();
  const r1 = calls1.map(() => []);
  r1[0] = { data: [{ device: { id: 'b1' }, latitude: 40, longitude: -74, speed: 0, dateTime: '2024-01-01T00:00:00Z' }], toVersion: 'v1' };
  const out1 = t._merge(r1, calls1);
  assert.equal(out1.length, 1);
  assert.equal(out1[0].location.bearing, null);

  // Second poll: moved north — bearing should be ~0 degrees.
  const calls2 = t._buildCalls();
  const r2 = calls2.map(() => []);
  r2[0] = { data: [{ device: { id: 'b1' }, latitude: 41, longitude: -74, speed: 50, dateTime: '2024-01-01T00:01:00Z' }], toVersion: 'v2' };
  const out2 = t._merge(r2, calls2);
  assert.equal(out2.length, 1);
  // Allow some floating-point tolerance.
  assert.ok(Math.abs(out2[0].location.bearing - 0) < 1, `expected bearing ~0°, got ${out2[0].location.bearing}`);
});
