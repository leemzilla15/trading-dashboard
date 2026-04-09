/**
 * GET /api/news
 *
 * Returns high-impact USD economic events within a ±4 hr window.
 * Sourced from Forex Factory's public calendar feed.
 * Cache TTL: 5 minutes (news doesn't change second-to-second).
 *
 * Response shape:
 * {
 *   success: true,
 *   stale:   false,
 *   data: {
 *     events: [
 *       { title, country, impact, date, forecast, previous, actual, minutesUntil, source }
 *     ],
 *     totalHighUSD,
 *     windowHours: { past, future },
 *     lastUpdated,
 *     source
 *   }
 * }
 *
 * minutesUntil < 0  → event already passed (within WINDOW_HOURS_PAST)
 * minutesUntil = 0  → happening right now
 * minutesUntil > 0  → upcoming
 */

const express              = require('express');
const router               = express.Router();
const { getHighImpactNews } = require('../services/forexFactory');
const fetchWithFallback     = require('../services/fetchWithFallback');
const cache                 = require('../cache');

const CACHE_KEY = 'news';
const TTL_MS    = 5 * 60_000; // 5 min

router.get('/', async (_req, res) => {
  try {
    const result = await fetchWithFallback(
      () => getHighImpactNews(),
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
    console.error('[/api/news]', err.message);
    // News failing should not hard-crash the dashboard.
    // Return a graceful empty response so sentiment can still compute.
    return res.status(200).json({
      success: false,
      cached:  false,
      stale:   true,
      error:   'News feed temporarily unavailable',
      data: {
        events: [],
        totalHighUSD: 0,
        windowHours: { past: 2, future: 4 },
        lastUpdated: new Date().toISOString(),
        source: 'none',
      },
    });
  }
});

module.exports = router;
