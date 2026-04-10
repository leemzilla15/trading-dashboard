/**
 * GET /api/analysis
 *
 * The technical analysis and trading day score endpoint.
 * This is the most computation-heavy route — it fetches intraday candles
 * and runs all three new engines.
 *
 * Cache TTL: 60 seconds (candle data doesn't need to be sub-second)
 *
 * Response shape:
 * {
 *   success: true,
 *   data: {
 *     tradingDay: {
 *       score,      // 1.0–10.0
 *       label,      // "Good Day to Trade" | "Caution" | "Avoid Trading"
 *       emoji,
 *       color,
 *       description,
 *       categories: { volatility, trend, confluence, news, session, setup },
 *       vetoes[],
 *     },
 *     bias: {
 *       bias,           // 'bullish' | 'bearish' | 'neutral'
 *       confluence,     // 'strong' | 'moderate' | 'weak' | 'conflicting'
 *       htf: { bias, strength, reasons[], ema, structure, fvgCount, atr14 },
 *       ltf: { bias, strength, reasons[], ema, structure, fvgCount },
 *       keyLevels: { resistance[], support[] },
 *       distToResistance,
 *       distToSupport,
 *     },
 *     candles: {
 *       oneHour:    { count, latest },
 *       fifteenMin: { count, latest },
 *     }
 *   }
 * }
 */

const express              = require('express');
const router               = express.Router();
const cache                = require('../cache');
const fetchWithFallback    = require('../services/fetchWithFallback');
const { get1HCandles, get15MCandles } = require('../services/priceHistory');
const { determineBias }    = require('../engines/biasEngine');
const { scoreTradingDay }  = require('../engines/tradingDayEngine');
const { getVIX }           = require('../services/finnhub');
const { getHighImpactNews } = require('../services/forexFactory');

const CACHE_KEY = 'analysis';
const TTL_MS    = 60_000; // 60s — candles don't change second to second

router.get('/', async (_req, res) => {
  try {
    const result = await fetchWithFallback(
      async () => {
        // All fetches in parallel
        const [c1H, c15M, vixData, newsData] = await Promise.allSettled([
          get1HCandles('ES=F',  12),
          get15MCandles('ES=F',  5),
          getVIX(),
          getHighImpactNews(),
        ]);

        const candles1H  = c1H.status  === 'fulfilled' ? c1H.value  : [];
        const candles15M = c15M.status === 'fulfilled' ? c15M.value : [];
        const vix        = vixData.status   === 'fulfilled' ? vixData.value   : null;
        const news       = newsData.status  === 'fulfilled' ? newsData.value  : { events: [] };

        // Run bias engine
        const bias = determineBias({ candles1H, candles15M });

        // Run trading day engine
        const tradingDay = scoreTradingDay({ vix, news, bias });

        return {
          tradingDay,
          bias,
          candles: {
            oneHour:    { count: candles1H.length,  latest: candles1H[candles1H.length   - 1] ?? null },
            fifteenMin: { count: candles15M.length, latest: candles15M[candles15M.length - 1] ?? null },
          },
        };
      },
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
    console.error('[/api/analysis]', err.message);
    return res.status(503).json({
      success: false,
      error:   'Technical analysis temporarily unavailable',
      message: err.message,
    });
  }
});

module.exports = router;
