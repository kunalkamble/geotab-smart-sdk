'use strict';
/**
 * Unit tests for the SDK's minimal EventEmitter — shipped as a replacement
 * for Node's `events` module so the SDK behaves identically across Node,
 * bundlers, and browser polyfills. Keep parity with Node's API surface.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('../src/core/EventEmitter');

test('on() registers a listener and emit() invokes it with args', () => {
  const ee = new EventEmitter();
  const calls = [];
  ee.on('hello', (a, b) => calls.push([a, b]));
  const fired = ee.emit('hello', 1, 2);
  assert.equal(fired, true);
  assert.deepEqual(calls, [[1, 2]]);
});

test('on() returns this so it chains', () => {
  const ee = new EventEmitter();
  const ret = ee.on('a', () => {});
  assert.equal(ret, ee);
});

test('on() rejects non-function listeners', () => {
  const ee = new EventEmitter();
  assert.throws(() => ee.on('x', null),         /listener must be a function/);
  assert.throws(() => ee.on('x', 'not a fn'),   /listener must be a function/);
  assert.throws(() => ee.on('x', {}),           /listener must be a function/);
});

test('emit() with no listeners returns false (non-error events)', () => {
  const ee = new EventEmitter();
  assert.equal(ee.emit('nothing'), false);
});

test('emit() invokes multiple listeners in registration order', () => {
  const ee = new EventEmitter();
  const order = [];
  ee.on('go', () => order.push('first'));
  ee.on('go', () => order.push('second'));
  ee.on('go', () => order.push('third'));
  ee.emit('go');
  assert.deepEqual(order, ['first', 'second', 'third']);
});

test('once() fires exactly once then auto-removes', () => {
  const ee = new EventEmitter();
  let n = 0;
  ee.once('once-event', () => { n++; });
  ee.emit('once-event');
  ee.emit('once-event');
  ee.emit('once-event');
  assert.equal(n, 1);
  assert.equal(ee.listenerCount('once-event'), 0);
});

test('off() removes a specific listener (alias: removeListener)', () => {
  const ee = new EventEmitter();
  const a = () => {};
  const b = () => {};
  ee.on('event', a);
  ee.on('event', b);
  ee.off('event', a);
  assert.equal(ee.listenerCount('event'), 1);
  // removeListener is the Node-compatible alias
  ee.removeListener('event', b);
  assert.equal(ee.listenerCount('event'), 0);
});

test('off() is a no-op for unknown listeners', () => {
  const ee = new EventEmitter();
  ee.on('event', () => {});
  // Shouldn't throw or affect existing listeners.
  ee.off('event',   () => {});
  ee.off('unknown', () => {});
  assert.equal(ee.listenerCount('event'), 1);
});

test('removeAllListeners(event) clears only that event', () => {
  const ee = new EventEmitter();
  ee.on('a', () => {});
  ee.on('a', () => {});
  ee.on('b', () => {});
  ee.removeAllListeners('a');
  assert.equal(ee.listenerCount('a'), 0);
  assert.equal(ee.listenerCount('b'), 1);
});

test('removeAllListeners() with no arg clears everything', () => {
  const ee = new EventEmitter();
  ee.on('a', () => {});
  ee.on('b', () => {});
  ee.removeAllListeners();
  assert.equal(ee.listenerCount('a'), 0);
  assert.equal(ee.listenerCount('b'), 0);
});

test('listeners() returns a snapshot — mutating it does not affect internal state', () => {
  const ee = new EventEmitter();
  const fn = () => {};
  ee.on('x', fn);
  const arr = ee.listeners('x');
  arr.length = 0;
  assert.equal(ee.listenerCount('x'), 1);
});

test('emit("error") with no listener throws', () => {
  const ee = new EventEmitter();
  assert.throws(() => ee.emit('error', new Error('boom')), /boom/);
});

test('emit("error") with a listener does NOT throw — listener handles it', () => {
  const ee = new EventEmitter();
  const captured = [];
  ee.on('error', (err) => captured.push(err.message));
  ee.emit('error', new Error('handled'));
  assert.deepEqual(captured, ['handled']);
});

test('a thrown error inside a listener is re-emitted as "error" (Node parity)', () => {
  const ee = new EventEmitter();
  const errors = [];
  ee.on('error', (err) => errors.push(err.message));
  ee.on('data', () => { throw new Error('bad listener'); });
  ee.emit('data');
  assert.deepEqual(errors, ['bad listener']);
});

test('listeners added during emit are NOT invoked on the current emit', () => {
  const ee = new EventEmitter();
  const calls = [];
  ee.on('x', () => {
    calls.push('original');
    ee.on('x', () => calls.push('added-during-emit'));
  });
  ee.emit('x');
  // Only the original listener fires this round.
  assert.deepEqual(calls, ['original']);
});
