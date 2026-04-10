const express = require('express');
const router  = express.Router();
const cache   = require('../cache');
const fetchWithFallback  = require('../services/fetchWithFallback');
const { getFuturesQuotes, getVIX, getOvernightLevels } = require('../services/finnhub');
const { getHighImpactNews }  = require('../services/forexFactory');
const { calculateSentiment } = require('../engines/sentimentEngine');
const { calculateRating }    = require('../engines/ratingEngine');

router.get('/', async (_req, res) => {
  const [futuresR, vixR, newsR, levelsR] = await Promise.allSettled([
    fetchWithFallback(() => getFuturesQuotes(),         null, 'futures', cache, 30_000),
    fetchWithFallback(() => getVIX(),                   null, 'vix',     cache, 30_000),
    fetchWithFallback(() => getHighImpactNews(),        null, 'news',    cache, 300_000),
    fetchWithFallback(() => getOvernightLevels(),       null, 'levels',  cache, 60_000),
  ]);

  const futures = futuresR.status === 'fulfilled' ? futuresR.value : null;
  const vix     = vixR.status     === 'fulfilled' ? vixR.value     : null;
  const news    = newsR.status    === 'fulfilled' ? newsR.value     : { events: [] };
  const levels  = levelsR.status  === 'fulfilled' ? levelsR.value  : null;

  try {
    const sentiment = calculateSentiment({ vix, futures, news, levels });
    const rating    = calculateRating({ sentiment, vix, news, levels });
    return res.json({
      success: true,
      data: { sentiment, rating, inputs: { futuresAvailable: !!futures, vixAvailable: !!vix, newsAvailable: !!news, levelsAvailable: !!levels }, lastUpdated: new Date().toISOString() }
    });
  } catch (err) {
    return res.status(503).json({ success: false, error: 'Sentiment computation failed', message: err.message });
  }
});

module.exports = router;
