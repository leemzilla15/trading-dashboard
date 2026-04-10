/**
 * GET /api/levels
 *
 * Returns overnight session key levels for ES futures,
 * derived from yesterday's daily OHLC bar via Yahoo Finance.
 * Cache TTL: 60 seconds (levels are static within the session).
 *
 * Response shape:
 * {
 *   success: true,
 *   stale:   false,
 *   data: {
 *     symbol,          // "ES"
 *     high,            // yesterday's high
 *     low,             // yesterday's low
 *     midpoint,        // (high + low) / 2
 *     range,           // high - low (points)
 *     positionInRange, // 0–100 — where today's open sits inside the range
 *     date,            // YYYY-MM-DD of the reference bar
 *     lastUpdated
 *   }
 * }
 */

const express                 = require('express');
const router                  = express.Router();
const { getOvernightLevels }  = require('../services/finnhub');
const fetchWithFallback        = require('../services/fetchWithFallback');
const cache                    = require('../cache');

const CACHE_KEY = 'levels';
const TTL_MS    = 60_000; // 60 s

router.get('/', async (_req, res) => {
  // Optional: allow the client to request a different symbol, default ES
  const symbol = 'ES=F';

  try {
    const result = await fetchWithFallback(
      () => getOvernightLevels(symbol),
      null,
      CACHE_KEY,
      cache,
      TTL_MS,
    );

    const { _cached, _stale, _staleAgeSeconds, ...data } = result;

    return res.json({
      success: true,
      cached:  !!_cached,
      stale:   !!_stale,
      staleAgeSeconds: _staleAgeSeconds ?? null,
      data,
    });
  } catch (err) {
    console.error('[/api/levels]', err.message);
    return res.status(503).json({
      success: false,
      error:   'Overnight levels data temporarily unavailable',
      message: err.message,
    });
  }
});

module.exports = router;
