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
