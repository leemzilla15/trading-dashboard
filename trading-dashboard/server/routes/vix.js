const express = require('express');
const router = express.Router();
const { getVIX } = require('../services/finnhub');
const fetchWithFallback = require('../services/fetchWithFallback');
const cache = require('../cache');

const CACHE_KEY = 'vix';
const TTL_MS = 30_000;

router.get('/', async (_req, res) => {
  try {
    const result = await fetchWithFallback(
      () => getVIX(),
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
    return res.status(503).json({ success: false, error: 'VIX data unavailable', message: err.message });
  }
});

module.exports = router;
