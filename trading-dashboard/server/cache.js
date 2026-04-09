/**
 * cache.js — Simple TTL in-memory cache
 *
 * Design decisions:
 *  - Expired entries are NOT deleted. They stay as stale fallback data
 *    so if an API is down we still return the last known good value.
 *  - Each entry tracks cachedAt so callers can show a "stale since X" label.
 */

class TTLCache {
  constructor() {
    /** @type {Map<string, {value: any, expiresAt: number, cachedAt: number}>} */
    this.store = new Map();
  }

  /**
   * Store a value with a TTL.
   * @param {string} key
   * @param {any}    value
   * @param {number} ttlMs   — milliseconds until the entry is considered stale
   */
  set(key, value, ttlMs) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      cachedAt:  Date.now(),
    });
  }

  /**
   * Retrieve an entry.
   * Returns null if the key has never been set.
   * Returns the entry + { stale: true/false } otherwise.
   * @param {string} key
   * @returns {{ value: any, cachedAt: number, stale: boolean } | null}
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    const stale = Date.now() > entry.expiresAt;
    return { value: entry.value, cachedAt: entry.cachedAt, stale };
  }

  /** Always returns the stored entry (even expired), or null. */
  getStale(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return { value: entry.value, cachedAt: entry.cachedAt, stale: true };
  }

  /** Check if a *fresh* (non-stale) entry exists. */
  hasFresh(key) {
    const entry = this.store.get(key);
    return entry ? Date.now() <= entry.expiresAt : false;
  }

  delete(key) {
    this.store.delete(key);
  }

  /** Clear every cached entry — useful for testing. */
  flush() {
    this.store.clear();
  }
}

// Export a singleton so all routes share the same cache.
module.exports = new TTLCache();
