'use strict';
/**
 * GeotabSDK surface tests — construction, options, lifecycle events,
 * session persistence, read-only mode, connect() warm-ups.
 *
 * Run via `node --test` from the project root, or `npm test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../src');

// ─── Construction & exports ─────────────────────────────────────────────────

test('public exports are present', () => {
  for (const name of [
    'GeotabSDK',
    'Diagnostics', 'DiagnosticLabels', 'DiagnosticGroups',
    'LiveTracker', 'RealtimeTracker', 'FeedManager',
    'HistoryQuery', 'FleetSnapshot',
  ]) {
    assert.ok(sdk[name], `missing export: ${name}`);
  }
});

test('GeotabSDK constructor rejects missing credentials', () => {
  assert.throws(() => new sdk.GeotabSDK({}), /username/i);
  assert.throws(() => new sdk.GeotabSDK({ username: 'u', password: 'p' }), /database/i);
});

test('GeotabSDK requires password OR sessionId', () => {
  assert.throws(
    () => new sdk.GeotabSDK({ username: 'u', database: 'd' }),
    /password|sessionId/i,
  );
});

test('GeotabSDK accepts sessionId-only credentials (no password)', () => {
  const inst = new sdk.GeotabSDK({
    username: 'u', database: 'd', sessionId: 'abc123', server: 'my.geotab.com',
  });
  assert.equal(typeof inst.call, 'function');
  assert.equal(inst.getSession(), null);
});

test('GeotabSDK instance exposes call / multiCall / connect / getSession', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  assert.equal(typeof inst.call, 'function');
  assert.equal(typeof inst.multiCall, 'function');
  assert.equal(typeof inst.connect, 'function');
  assert.equal(typeof inst.getSession, 'function');
  assert.equal(inst.getSession(), null);
});

test('factory methods return the right classes', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  assert.ok(inst.liveTracker()     instanceof sdk.LiveTracker);
  assert.ok(inst.realtimeTracker() instanceof sdk.RealtimeTracker);
  assert.ok(inst.feeds()           instanceof sdk.FeedManager);
});

// ─── EventEmitter inheritance ───────────────────────────────────────────────

test('GeotabSDK extends EventEmitter — sdk.on listeners actually fire', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  let connectedCalls = 0;
  let authCalls      = 0;
  inst.on('connected',     () => { connectedCalls++; });
  inst.on('authenticated', () => { authCalls++; });

  inst._session.emit('session:connected',     { database: 'd', server: 'my.geotab.com' });
  inst._session.emit('session:authenticated', { sessionId: 'abc', userName: 'u', database: 'd', server: 'my.geotab.com' });

  assert.equal(connectedCalls, 1);
  assert.equal(authCalls,      1);
});

// ─── Connect() warm-up options ──────────────────────────────────────────────

test('connect({ cacheGroups }) scopes the device cache fetch', async () => {
  const captured = [];
  const fakeSession = {
    on: () => {},
    connect: async () => {},
    call: async (method, params) => { captured.push({ method, params }); return []; },
  };
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  inst._session = fakeSession;

  await inst.connect({ cacheGroups: ['groupCompanyId'] });

  const deviceCall = captured.find(c => c.params.typeName === 'Device');
  assert.ok(deviceCall, 'Device fetch should occur (cacheGroups implies cacheDevices)');
  assert.deepEqual(deviceCall.params.search.groups, [{ id: 'groupCompanyId' }]);
});

test('connect({ cacheDevices: true }) without cacheGroups uses empty search', async () => {
  const captured = [];
  const fakeSession = {
    on: () => {},
    connect: async () => {},
    call: async (method, params) => { captured.push({ method, params }); return []; },
  };
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  inst._session = fakeSession;

  await inst.connect({ cacheDevices: true });

  const deviceCall = captured.find(c => c.params.typeName === 'Device');
  assert.deepEqual(deviceCall.params.search, {});
});

test('connect() with no cache options performs no Get calls', async () => {
  const captured = [];
  const fakeSession = {
    on: () => {},
    connect: async () => {},
    call: async (method, params) => { captured.push({ method, params }); return []; },
  };
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  inst._session = fakeSession;

  await inst.connect();

  assert.equal(captured.length, 0);
});

// ─── Read-only mode ─────────────────────────────────────────────────────────

function makeReadOnly() {
  const ro = new sdk.GeotabSDK(
    { username: 'u', password: 'p', database: 'd' },
    { readOnly: true },
  );
  ro._session._api = {
    call:         async () => null,
    multiCall:    async () => [],
    authenticate: async () => null,
    getSession:   async () => null,
  };
  ro._session._authenticated = true;
  return ro;
}

test('readOnly mode rejects writes via .call()', async () => {
  const ro = makeReadOnly();
  await assert.rejects(() => ro.call('Set',          { typeName: 'Group' }),  /readOnly/i);
  await assert.rejects(() => ro.call('Add',          { typeName: 'Device' }), /readOnly/i);
  await assert.rejects(() => ro.call('Remove',       { typeName: 'Device' }), /readOnly/i);
  await assert.rejects(() => ro.call('ExecuteEdit',  {}),                      /readOnly/i);
});

test('readOnly mode rejects writes inside .multiCall()', async () => {
  const ro = makeReadOnly();
  await assert.rejects(
    () => ro.multiCall([['Get', {}], ['Set', { typeName: 'Group' }]]),
    /readOnly/i,
  );
});

test('readOnly mode allows Get / GetFeed / GetCountOf', async () => {
  const ro = makeReadOnly();
  await ro.call('Get',        { typeName: 'Device' });
  await ro.call('GetFeed',    { typeName: 'LogRecord' });
  await ro.call('GetCountOf', { typeName: 'Device' });
  await ro.multiCall([['Get', {}], ['GetFeed', {}]]);
});

test('readOnly allowlist is case-insensitive on the Get prefix', async () => {
  const ro = makeReadOnly();
  await ro.call('Get',     { typeName: 'Device' });
  await ro.call('GET',     { typeName: 'Device' });
  await ro.call('get',     { typeName: 'Device' });
  await ro.call('GetFeed', { typeName: 'LogRecord' });
  await assert.rejects(() => ro.call('Set', { typeName: 'Group' }), /readOnly/i);
  await assert.rejects(() => ro.call('SET', { typeName: 'Group' }), /readOnly/i);
  await assert.rejects(() => ro.call('set', { typeName: 'Group' }), /readOnly/i);
});

test('default (no readOnly) allows any method — SDK stays fully capable', async () => {
  const open = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  open._session._api = {
    call: async () => null, multiCall: async () => [], authenticate: async () => null, getSession: async () => null,
  };
  open._session._authenticated = true;
  await open.call('Set', { typeName: 'Group' });
  await open.call('Add', { typeName: 'Device' });
});
