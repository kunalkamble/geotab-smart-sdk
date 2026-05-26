'use strict';
/**
 * Unit tests for EntityCache — the in-memory TTL cache the SDK uses to
 * hydrate device names (and any other entity type a consumer wants to cache).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EntityCache = require('../src/cache/EntityCache');

test('default TTL is 1 hour', () => {
  const cache = new EntityCache();
  assert.equal(cache._ttlMs, 60 * 60 * 1000);
});

test('custom TTL via options', () => {
  const cache = new EntityCache({ ttlMs: 5000 });
  assert.equal(cache._ttlMs, 5000);
});

test('set() then get() returns the entity', () => {
  const cache = new EntityCache({ ttlMs: 10_000 });
  cache.set('Device', [
    { id: 'b1', name: 'Truck-1' },
    { id: 'b2', name: 'Truck-2' },
  ]);
  assert.deepEqual(cache.get('Device', 'b1'), { id: 'b1', name: 'Truck-1' });
  assert.deepEqual(cache.get('Device', 'b2'), { id: 'b2', name: 'Truck-2' });
  assert.equal(cache.get('Device', 'unknown'), undefined);
});

test('get() returns undefined for an unknown entityType', () => {
  const cache = new EntityCache();
  assert.equal(cache.get('Nothing', 'x'), undefined);
});

test('getAll() returns a Map of entities for a type', () => {
  const cache = new EntityCache({ ttlMs: 10_000 });
  cache.set('Device', [{ id: 'b1', name: 'Truck-1' }]);
  const all = cache.getAll('Device');
  assert.ok(all instanceof Map);
  assert.equal(all.size, 1);
  assert.deepEqual(all.get('b1'), { id: 'b1', name: 'Truck-1' });
});

test('isFresh() reports false for missing or stale stores', () => {
  const cache = new EntityCache({ ttlMs: 1 }); // 1ms — guaranteed stale
  assert.equal(cache.isFresh('Device'), false);
  cache.set('Device', [{ id: 'b1' }]);
  // Wait past the TTL and it should be stale again.
  return new Promise((resolve) => setTimeout(() => {
    assert.equal(cache.isFresh('Device'), false);
    assert.equal(cache.get('Device', 'b1'), undefined);
    assert.equal(cache.getAll('Device'), null);
    resolve();
  }, 10));
});

test('isFresh() reports true while within TTL', () => {
  const cache = new EntityCache({ ttlMs: 60_000 });
  cache.set('Device', [{ id: 'b1' }]);
  assert.equal(cache.isFresh('Device'), true);
});

test('set() silently skips entries without an id', () => {
  const cache = new EntityCache({ ttlMs: 10_000 });
  cache.set('Device', [
    { id: 'b1', name: 'Truck-1' },
    { name: 'No-Id-Entry' },
    null,                 // not really realistic but defensive
  ].filter(Boolean));
  const all = cache.getAll('Device');
  assert.equal(all.size, 1);
});

test('invalidate() removes a store', () => {
  const cache = new EntityCache({ ttlMs: 10_000 });
  cache.set('Device', [{ id: 'b1' }]);
  cache.invalidate('Device');
  assert.equal(cache.isFresh('Device'), false);
  assert.equal(cache.get('Device', 'b1'), undefined);
});

test('ensure() calls the loader when not fresh and caches the result', async () => {
  const cache = new EntityCache({ ttlMs: 60_000 });
  let calls = 0;
  const map = await cache.ensure('Device', async () => {
    calls++;
    return [{ id: 'b1', name: 'Truck-1' }];
  });
  assert.equal(calls, 1);
  assert.ok(map instanceof Map);
  assert.deepEqual(map.get('b1'), { id: 'b1', name: 'Truck-1' });

  // Second call within TTL — loader should NOT run again.
  await cache.ensure('Device', async () => { calls++; return []; });
  assert.equal(calls, 1, 'loader should not run when cache is fresh');
});

test('resolve() hydrates {id} stubs against the cache; passes stubs through when not cached', () => {
  const cache = new EntityCache({ ttlMs: 10_000 });
  cache.set('Device', [{ id: 'b1', name: 'Truck-1' }]);
  const resolved = cache.resolve('Device', [{ id: 'b1' }, { id: 'unknown' }]);
  assert.deepEqual(resolved[0], { id: 'b1', name: 'Truck-1' });
  // Unknown id → returned as-is (the stub) rather than dropped.
  assert.deepEqual(resolved[1], { id: 'unknown' });
});

test('resolve() returns refs unchanged when the type has never been cached', () => {
  const cache = new EntityCache();
  const refs = [{ id: 'a' }, { id: 'b' }];
  assert.equal(cache.resolve('Device', refs), refs);
});
