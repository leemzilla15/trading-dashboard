/**
 * fetchWithFallback.js
 *
 * Wraps any async data-fetch with a three-tier reliability strategy:
 *   1. Fresh cache  — return immediately (no external call)
 *   2. Primary fn   — call primary data source
 *   3. Backup fn    — if primary throws, try backup
 *   4. Stale cache  — if both sources fail, return last known good value
 *                     with { _stale: true } so the UI can warn the user
 *
 * @param {() => Promise<any>}        primaryFn   — primary data source
 * @param {(() => Promise<any>)|null} backupFn    — optional backup source
 * @param {string}                    cacheKey
 * @param {import('../cache')}        cache       — TTLCache singleton
 * @param {number}                    ttlMs       — cache lifetime in ms
 * @returns {Promise<any>}
 */
async function fetchWithFallback(primaryFn, backupFn, cacheKey, cache, ttlMs = 30_000) {
  // ── 1. Serve fresh cache ──────────────────────────────────────────────────
  const cached = cache.get(cacheKey);
  if (cached && !cached.stale) {
    return { ...cached.value, _cached: true, _stale: false };
  }

  // ── 2. Try primary ────────────────────────────────────────────────────────
  try {
    const data = await primaryFn();
    cache.set(cacheKey, data, ttlMs);
    return { ...data, _cached: false, _stale: false };
  } catch (primaryErr) {
    console.warn(`[FALLBACK] Primary failed for "${cacheKey}": ${primaryErr.message}`);
  }

  // ── 3. Try backup ─────────────────────────────────────────────────────────
  if (typeof backupFn === 'function') {
    try {
      const data = await backupFn();
      cache.set(cacheKey, data, ttlMs);
      return { ...data, _cached: false, _stale: false };
    } catch (backupErr) {
      console.warn(`[FALLBACK] Backup also failed for "${cacheKey}": ${backupErr.message}`);
    }
  }

  // ── 4. Return stale cache ─────────────────────────────────────────────────
  const stale = cache.getStale(cacheKey);
  if (stale) {
    const ageSeconds = Math.round((Date.now() - stale.cachedAt) / 1000);
    console.warn(`[FALLBACK] Returning stale data for "${cacheKey}" (${ageSeconds}s old)`);
    return { ...stale.value, _cached: true, _stale: true, _staleAgeSeconds: ageSeconds };
  }

  // ── Nothing worked ────────────────────────────────────────────────────────
  throw new Error(`All data sources failed for "${cacheKey}" and no cached fallback exists.`);
}

module.exports = fetchWithFallback;
