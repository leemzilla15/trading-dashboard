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
    return res.status(503).json({ success: false, error: 'Levels data unavailable', message: err.message });
  }
});

module.exports = router;
