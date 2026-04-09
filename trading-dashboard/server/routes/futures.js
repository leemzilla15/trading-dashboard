/**
 * GET /api/futures
 *
 * Returns normalised quotes for ES, NQ, YM futures.
 * Cache TTL: 30 seconds.
 *
 * Response shape:
 * {
 *   success: true,
 *   stale:   false,
 *   data: {
 *     ES: { symbol, price, change, changePct, high, low, open, previousClose, volume, marketState, lastUpdated },
 *     NQ: { ... },
 *     YM: { ... }
 *   }
 * }
 */

const express           = require('express');
const router            = express.Router();
const { getFuturesQuotes } = require('../services/yahooFinance');
const fetchWithFallback  = require('../services/fetchWithFallback');
const cache              = require('../cache');

const CACHE_KEY = 'futures';
const TTL_MS    = 30_000; // 30 s

router.get('/', async (_req, res) => {
  try {
    const result = await fetchWithFallback(
      () => getFuturesQuotes(),
      null,        // no secondary source — yahoo-finance2 handles retries internally
      CACHE_KEY,
      cache,
      TTL_MS,
    );

    // Pull metadata flags out before sending data
    const { _cached, _stale, _staleAgeSeconds, ...data } = result;

    return res.json({
      success: true,
      cached:  !!_cached,
      stale:   !!_stale,
      staleAgeSeconds: _staleAgeSeconds ?? null,
      data,
    });
  } catch (err) {
    console.error('[/api/futures]', err.message);
    return res.status(503).json({
      success: false,
      error:   'Futures data temporarily unavailable',
      message: err.message,
    });
  }
});

module.exports = router;
