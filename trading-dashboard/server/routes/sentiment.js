/**
 * GET /api/sentiment
 *
 * The composed "brains" endpoint.
 * Gathers futures, VIX, news, and levels in parallel (from cache when possible),
 * then runs both the sentimentEngine and ratingEngine.
 *
 * This is the one endpoint the client polls to get the complete picture
 * for the sentiment panel and trade/no-trade badge.
 *
 * Response shape:
 * {
 *   success: true,
 *   data: {
 *     sentiment: {
 *       total, max, label, color,
 *       components: { volatility, trend, news }
 *     },
 *     rating: {
 *       rating, color, emoji, score,
 *       reasons, warnings, summary
 *     },
 *     inputs: { futuresAvailable, vixAvailable, newsAvailable, levelsAvailable },
 *     lastUpdated
 *   }
 * }
 */

const express = require('express');
const router  = express.Router();

const cache            = require('../cache');
const fetchWithFallback = require('../services/fetchWithFallback');
const { getFuturesQuotes, getVIX, getOvernightLevels } = require('../services/finnhub');
const { getHighImpactNews }  = require('../services/forexFactory');
const { calculateSentiment } = require('../engines/sentimentEngine');
const { calculateRating }    = require('../engines/ratingEngine');

router.get('/', async (_req, res) => {
  // Fetch all four data sources concurrently.
  // allSettled so a single failure doesn't abort everything.
  const [futuresR, vixR, newsR, levelsR] = await Promise.allSettled([
    fetchWithFallback(() => getFuturesQuotes(), null, 'futures', cache, 30_000),
    fetchWithFallback(() => getVIX(),           null, 'vix',     cache, 30_000),
    fetchWithFallback(() => getHighImpactNews(), null, 'news',    cache, 300_000),
    fetchWithFallback(() => getOvernightLevels('ES=F'), null, 'levels', cache, 60_000),
  ]);

  const futures = futuresR.status === 'fulfilled' ? futuresR.value  : null;
  const vix     = vixR.status     === 'fulfilled' ? vixR.value      : null;
  const news    = newsR.status    === 'fulfilled' ? newsR.value      : { events: [] };
  const levels  = levelsR.status  === 'fulfilled' ? levelsR.value    : null;

  try {
    const sentiment = calculateSentiment({ vix, futures, news });
    const rating    = calculateRating({ sentiment, vix, news, levels });

    return res.json({
      success: true,
      data: {
        sentiment,
        rating,
        inputs: {
          futuresAvailable: futures !== null,
          vixAvailable:     vix     !== null,
          newsAvailable:    news    !== null,
          levelsAvailable:  levels  !== null,
        },
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[/api/sentiment]', err.message);
    return res.status(503).json({
      success: false,
      error:   'Sentiment computation failed',
      message: err.message,
    });
  }
});

module.exports = router;
