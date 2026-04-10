const express = require('express');
const router  = express.Router();
const cache   = require('../cache');
const fetchWithFallback = require('../services/fetchWithFallback');
const { get1HCandles, get15MCandles } = require('../services/priceHistory');
const { determineBias }   = require('../engines/biasEngine');
const { scoreTradingDay } = require('../engines/tradingDayEngine');
const { getVIX, getOvernightLevels, getFuturesQuotes } = require('../services/finnhub');
const { getHighImpactNews } = require('../services/forexFactory');

router.get('/', async (_req, res) => {
  try {
    const result = await fetchWithFallback(
      async () => {
        const [c1H, c15M, vixData, newsData, levelsData, futuresData] = await Promise.allSettled([
          get1HCandles('ES=F', 12),
          get15MCandles('ES=F', 5),
          getVIX(),
          getHighImpactNews(),
          getOvernightLevels(),
          getFuturesQuotes(),
        ]);

        const candles1H  = c1H.status    === 'fulfilled' ? c1H.value    : [];
        const candles15M = c15M.status   === 'fulfilled' ? c15M.value   : [];
        const vix        = vixData.status === 'fulfilled' ? vixData.value : null;
        const news       = newsData.status === 'fulfilled' ? newsData.value : { events: [] };
        const levels     = levelsData.status === 'fulfilled' ? levelsData.value : null;
        const futures    = futuresData.status === 'fulfilled' ? futuresData.value : null;

        const bias = determineBias({ candles1H, candles15M });
        const tradingDay = scoreTradingDay({ vix, news, bias, levels, futures });

        return {
          tradingDay,
          bias,
          chop: {
            isChoppy: levels && levels.isChoppy,
            atr14: levels && levels.atr14,
            todayRange: levels && levels.todayRange,
            avgRange5: levels && levels.avgRange5,
          },
          candles: {
            oneHour:    { count: candles1H.length,  latest: candles1H[candles1H.length - 1] || null },
            fifteenMin: { count: candles15M.length, latest: candles15M[candles15M.length - 1] || null },
          }
        };
      },
      null, 'analysis', cache, 60_000
    );

    const { _cached, _stale, _staleAgeSeconds, ...data } = result;
    return res.json({ success: true, cached: !!_cached, stale: !!_stale, data });
  } catch (err) {
    return res.status(503).json({ success: false, error: 'Analysis unavailable', message: err.message });
  }
});

module.exports = router;
