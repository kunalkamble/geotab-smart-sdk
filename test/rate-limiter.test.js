'use strict';
/**
 * Unit tests for RateLimiter — handles Geotab's OverLimitException by
 * reading Retry-After (or parsing the error message), waiting, and
 * retrying the call once. Wrapping is invisible to consumers.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const RateLimiter = require('../src/core/RateLimiter');

test('waitTime() is 0 when nothing is registered', () => {
  const rl = new RateLimiter();
  assert.equal(rl.waitTime('LogRecord'), 0);
});

test('waitTime() reports the remaining block duration after registerLimit', () => {
  const rl = new RateLimiter();
  rl.registerLimit('LogRecord', { retryAfter: 2 });   // 2 seconds → 2000 ms
  const w = rl.waitTime('LogRecord');
  // Should be roughly 2000 ms, give or take a few ms for execution overhead.
  assert.ok(w > 1500 && w <= 2000, `expected ~2000ms wait, got ${w}`);
});

test('registerLimit() reads err.retryAfter (seconds) when present', () => {
  const rl = new RateLimiter();
  rl.registerLimit('Device', { retryAfter: 5 });
  const entry = rl._blocked.get('Device');
  assert.equal(entry.retryAfterMs, 5000);
});

test('registerLimit() parses "per Nm" / "per Ns" from the error message', () => {
  const rl = new RateLimiter();
  rl.registerLimit('LogRecord', { message: 'OverLimitException: Maximum admitted 60 per 1m' });
  assert.equal(rl._blocked.get('LogRecord').retryAfterMs, 60_000);

  rl.registerLimit('Device', { message: 'OverLimitException: rate per 30s exceeded' });
  assert.equal(rl._blocked.get('Device').retryAfterMs, 30_000);
});

test('registerLimit() falls back to a 60s default when nothing parses', () => {
  const rl = new RateLimiter();
  rl.registerLimit('FaultData', { message: 'completely unrelated error' });
  assert.equal(rl._blocked.get('FaultData').retryAfterMs, 60_000);
});

test('clear() removes a per-entity block', () => {
  const rl = new RateLimiter();
  rl.registerLimit('LogRecord', { retryAfter: 5 });
  assert.ok(rl.waitTime('LogRecord') > 0);
  rl.clear('LogRecord');
  assert.equal(rl.waitTime('LogRecord'), 0);
});

test('_isRateLimitError detects OverLimitException by code and message', () => {
  const rl = new RateLimiter();
  assert.equal(rl._isRateLimitError({ code: 'OverLimitException' }),                       true);
  assert.equal(rl._isRateLimitError({ message: 'OverLimitException: too many calls' }),     true);
  assert.equal(rl._isRateLimitError({ message: 'rate limit hit' }),                         true);
  assert.equal(rl._isRateLimitError({ message: 'quota exceeded for the user' }),            true);

  assert.equal(rl._isRateLimitError({ message: 'InvalidUserException' }), false);
  assert.equal(rl._isRateLimitError({ message: 'something else' }),       false);
  assert.equal(rl._isRateLimitError({}),                                  false);
});

test('withRetry() returns immediately when the call succeeds', async () => {
  const rl = new RateLimiter();
  let attempts = 0;
  const result = await rl.withRetry('Device', async () => {
    attempts++;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 1);
});

test('withRetry() retries once after a rate-limit error then succeeds', async () => {
  const rl = new RateLimiter();
  let attempts = 0;
  const result = await rl.withRetry('LogRecord', async () => {
    attempts++;
    if (attempts === 1) {
      const err = new Error('OverLimitException: Maximum admitted 60 per 0s');
      // retryAfter: 0 keeps the test fast — we don't actually want to wait
      err.retryAfter = 0;
      throw err;
    }
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('withRetry() re-throws non-rate-limit errors without retrying', async () => {
  const rl = new RateLimiter();
  let attempts = 0;
  await assert.rejects(
    () => rl.withRetry('Device', async () => {
      attempts++;
      throw new Error('InvalidUserException: session expired');
    }),
    /InvalidUserException/,
  );
  assert.equal(attempts, 1);
});

test('withRetry() clears the block on success', async () => {
  const rl = new RateLimiter();
  rl.registerLimit('Device', { retryAfter: 0 });   // pre-registered, will pass through
  await rl.withRetry('Device', async () => 'ok');
  assert.equal(rl.waitTime('Device'), 0, 'block should be cleared after success');
});
