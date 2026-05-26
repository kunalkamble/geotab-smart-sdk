'use strict';

/**
 * Minimal EventEmitter implementation used by the SDK's tracker / feed /
 * session classes.
 *
 * Why not Node's built-in `events` module: cross-bundler CJS interop is
 * inconsistent — Vite, Webpack, esbuild, and the standalone `events` npm
 * polyfill all expose slightly different shapes when consuming the
 * `require('events')` form from a CommonJS module. Shipping our own keeps
 * the SDK identical across Node, browsers (via Vite/Webpack/etc.), and
 * Deno-style ESM importers, with zero external dependencies and a stable
 * subset of Node's EventEmitter API.
 *
 * Supported API surface (matches Node):
 *   .on(event, listener)
 *   .off(event, listener)        — alias: .removeListener
 *   .once(event, listener)
 *   .emit(event, ...args)
 *   .removeAllListeners([event])
 *   .listenerCount(event)
 *   .listeners(event)
 *
 * Differences from Node:
 *   - No `newListener` / `removeListener` lifecycle events
 *   - No max-listeners warning
 *   - Listener errors are caught and re-emitted as `'error'` events
 *     (matches Node's loose convention for async emitters); if `'error'`
 *     itself has no listener, the error is re-thrown.
 */
class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    let list = this._listeners.get(event);
    if (!list) {
      list = [];
      this._listeners.set(event, list);
    }
    list.push(listener);
    return this;
  }

  off(event, listener) {
    const list = this._listeners.get(event);
    if (!list) return this;
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this._listeners.delete(event);
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  emit(event, ...args) {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) {
      // Mirror Node: unhandled 'error' is fatal.
      if (event === 'error') {
        const err = args[0] instanceof Error ? args[0] : new Error('Unhandled "error" event');
        throw err;
      }
      return false;
    }
    // Iterate a snapshot — listeners may add/remove during emit.
    for (const fn of list.slice()) {
      try {
        fn(...args);
      } catch (err) {
        if (event === 'error') throw err;
        this.emit('error', err);
      }
    }
    return true;
  }

  removeAllListeners(event) {
    if (event === undefined) {
      this._listeners.clear();
    } else {
      this._listeners.delete(event);
    }
    return this;
  }

  listenerCount(event) {
    const list = this._listeners.get(event);
    return list ? list.length : 0;
  }

  listeners(event) {
    const list = this._listeners.get(event);
    return list ? list.slice() : [];
  }
}

// Node-compatible alias
EventEmitter.prototype.removeListener = EventEmitter.prototype.off;

module.exports = EventEmitter;
