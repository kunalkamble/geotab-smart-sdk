'use strict';

/**
 * EntityCache is a lightweight in-memory cache with TTL expiry.
 *
 * Why caching matters for Geotab:
 *   - StatusData records from GetFeed only carry a Diagnostic ID (not the full object).
 *   - Resolving each diagnostic via a separate Get call on every record would be wasteful.
 *   - Diagnostics, Devices, Users, and Units of Measure rarely change — cache them.
 *
 * This cache stores entities keyed by their Geotab ID and refreshes
 * the entire set when the TTL expires.
 */
class EntityCache {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs=3600000]  Time-to-live in ms. Default 1 hour.
   */
  constructor(options = {}) {
    this._ttlMs = options.ttlMs ?? 60 * 60 * 1000; // 1 hour default
    this._stores = new Map(); // entityType -> { data: Map<id, entity>, loadedAt: number }
  }

  /**
   * Get a single entity by ID. Returns undefined if not cached.
   *
   * @param {string} entityType
   * @param {string} id
   * @returns {object|undefined}
   */
  get(entityType, id) {
    const store = this._stores.get(entityType);
    if (!store || this._isStale(store)) return undefined;
    return store.data.get(id);
  }

  /**
   * Get all cached entities for a type. Returns null if stale/empty.
   *
   * @param {string} entityType
   * @returns {Map<string, object>|null}
   */
  getAll(entityType) {
    const store = this._stores.get(entityType);
    if (!store || this._isStale(store)) return null;
    return store.data;
  }

  /**
   * Check whether a cache for a given entity type is populated and fresh.
   *
   * @param {string} entityType
   * @returns {boolean}
   */
  isFresh(entityType) {
    const store = this._stores.get(entityType);
    return Boolean(store) && !this._isStale(store);
  }

  /**
   * Populate the cache for an entity type from a raw API result array.
   * Entities must have an `id` property.
   *
   * @param {string}   entityType
   * @param {object[]} entities    Array of objects with at least { id }
   */
  set(entityType, entities) {
    const data = new Map();
    for (const entity of entities) {
      if (entity.id) data.set(entity.id, entity);
    }
    this._stores.set(entityType, { data, loadedAt: Date.now() });
  }

  /**
   * Force-invalidate a cache entry so it is re-fetched on next access.
   *
   * @param {string} entityType
   */
  invalidate(entityType) {
    this._stores.delete(entityType);
  }

  /**
   * Ensure a cache is populated. If stale or missing, fetch via `loader`.
   * Loader is called with no arguments and must return Promise<object[]>.
   *
   * @param {string}   entityType
   * @param {Function} loader
   * @returns {Promise<Map<string, object>>}
   */
  async ensure(entityType, loader) {
    if (!this.isFresh(entityType)) {
      const entities = await loader();
      this.set(entityType, entities);
    }
    return this.getAll(entityType);
  }

  /**
   * Resolve an array of `{ id }` references to full objects using the cache.
   * Useful for hydrating StatusData.diagnostic, LogRecord.device, etc.
   *
   * @param {string}   entityType
   * @param {object[]} refs         Array of { id } objects
   * @returns {object[]}            Full objects (or the stub if not cached)
   */
  resolve(entityType, refs) {
    const store = this._stores.get(entityType);
    if (!store) return refs;
    return refs.map(ref => store.data.get(ref?.id) || ref);
  }

  _isStale(store) {
    return Date.now() - store.loadedAt > this._ttlMs;
  }
}

module.exports = EntityCache;
