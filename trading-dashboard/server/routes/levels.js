const express = require('express');
const router = express.Router();
const { getOvernightLevels } = require('../services/finnhub');
const fetchWithFallback = require('../services/fetchWithFallback');
const cache = require('../cache');

const CACHE_KEY = 'levels';
const TTL_MS = 60_000;

router.get('/', async (_req, res) => {
  try {
    const result = await fetchWithFallback(
      () => getOvernightLevels(),
      null,
      CACHE_KEY,
      cache,
      TTL_MS,
    );
    const { _cached, _stale, _staleAgeSeconds, ...data } = result;
    return res.json({
      success: true,
      cached: !!_cached,
      stale: !!_stale,
      staleAgeSeconds: _staleAgeSeconds ?? null,
      data,
    });
  } catch (err) {
    // Return graceful empty response — levels failing should not break dashboard
    return res.json({
      success: false,
      stale: true,
      error: 'Levels data unavailable',
      data: {
        symbol: 'ES',
        high: null, low: null, midpoint: null,
        range: null, positionInRange: null,
        isChoppy: false, atr14: null, todayRange: null,
        date: null, lastUpdated: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
