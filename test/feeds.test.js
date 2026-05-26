'use strict';
/**
 * FeedManager tests — builder, version-token helpers, lifecycle guard.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../src');

test('FeedManager builder + version helpers', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  const chained = feeds.addFeed('LogRecord');
  assert.equal(chained, feeds, 'addFeed should return this for chaining');
  assert.equal(feeds.getVersion('LogRecord'), null);
  feeds.setVersion('LogRecord', 'abc');
  assert.equal(feeds.getVersion('LogRecord'), 'abc');
});

test('FeedManager.addFeed after start() throws', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  feeds.addFeed('LogRecord');
  // Manually flip the running flag to simulate post-start without scheduling timers.
  feeds._running = true;
  assert.throws(() => feeds.addFeed('StatusData'), /Cannot add feed/i);
});

// ─── Adaptive polling: _nextDelay ───────────────────────────────────────────
// Full batch → poll immediately (more data is waiting on the server).
// Partial   → reset to the minimum interval (1s).
// Empty     → progressive back-off, capped at the maximum (30s).

test('_nextDelay returns 0 when the last poll filled the page (more data is waiting)', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  feeds.addFeed('LogRecord');
  const feed = feeds._feeds.get('LogRecord');
  feed.resultsLimit = 50_000;
  const delay = feeds._nextDelay(feed, 50_000);
  assert.equal(delay, 0);
});

test('_nextDelay resets to MIN (1000ms) on a partial batch', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  feeds.addFeed('LogRecord');
  const feed = feeds._feeds.get('LogRecord');
  feed.resultsLimit = 50_000;
  feed.pollIntervalMs = 8000;   // assume we were backing off
  const delay = feeds._nextDelay(feed, 100);
  assert.equal(delay, 1000);
  assert.equal(feed.pollIntervalMs, 1000, 'interval state should be reset too');
});

test('_nextDelay backs off progressively on empty batches up to a max', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  feeds.addFeed('LogRecord');
  const feed = feeds._feeds.get('LogRecord');
  feed.resultsLimit = 50_000;
  feed.pollIntervalMs = 1000;

  const d1 = feeds._nextDelay(feed, 0);
  assert.equal(d1, 2000);
  const d2 = feeds._nextDelay(feed, 0);
  assert.equal(d2, 4000);
  const d3 = feeds._nextDelay(feed, 0);
  assert.equal(d3, 8000);

  // After enough empty polls, we cap at the documented 30s ceiling.
  let last;
  for (let i = 0; i < 10; i++) last = feeds._nextDelay(feed, 0);
  assert.equal(last, 30_000, 'must clamp at MAX_POLL_INTERVAL_MS (30s)');
});

// ─── _buildParams: fromVersion vs fromDate (first-seed-only) behavior ───────

test('_buildParams sends fromVersion when one is stored', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  feeds.addFeed('LogRecord', { fromVersion: 'tok-1' });
  const feed = feeds._feeds.get('LogRecord');
  const params = feeds._buildParams(feed);
  assert.equal(params.typeName,    'LogRecord');
  assert.equal(params.fromVersion, 'tok-1');
  assert.equal(params.search,      undefined);
});

test('_buildParams sends fromDate on initial seed when no version is stored', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  const seedDate = new Date('2024-01-15T00:00:00Z');
  feeds.addFeed('LogRecord', { fromDate: seedDate });
  const feed = feeds._feeds.get('LogRecord');
  const params = feeds._buildParams(feed);
  assert.equal(params.fromVersion,   undefined);
  assert.deepEqual(params.search.fromDate, seedDate);
});

test('_buildParams drops fromDate once a fromVersion is present (seeded)', () => {
  const inst = new sdk.GeotabSDK({ username: 'u', password: 'p', database: 'd' });
  const feeds = inst.feeds();
  feeds.addFeed('LogRecord', { fromDate: new Date('2024-01-15Z') });
  const feed = feeds._feeds.get('LogRecord');
  // Simulate the server having returned a toVersion → we now have a token.
  feed.fromVersion = 'tok-2';
  feed.seeded      = true;
  const params = feeds._buildParams(feed);
  // fromDate must be omitted now — Geotab's docs say to use it exactly once.
  assert.equal(params.search,      undefined);
  assert.equal(params.fromVersion, 'tok-2');
});
