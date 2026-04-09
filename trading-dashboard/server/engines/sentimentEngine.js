/**
 * sentimentEngine.js
 *
 * Pure function — no I/O, no external calls.
 * Takes live data objects, returns a composite sentiment score 0–100.
 *
 * Score composition:
 *   Volatility   (max 33)  — VIX level
 *   Trend        (max 33)  — ES % change from previous close
 *   News Clarity (max 34)  — High-impact events proximity
 *
 * High score  → calm, trending, no news risk  → favorable for trading
 * Low score   → volatile, choppy, news risk   → stay out
 */

// ── Sub-scorers ───────────────────────────────────────────────────────────────

function scoreVolatility(vix) {
  const MAX = 33;

  if (!vix || vix.price === null) {
    return { score: Math.round(MAX / 2), label: 'Unknown', detail: 'VIX unavailable', max: MAX };
  }

  const v = vix.price;
  let score, label;

  if      (v < 12) { score = 33; label = 'Very Calm';         }
  else if (v < 15) { score = 30; label = 'Calm';              }
  else if (v < 18) { score = 25; label = 'Moderate';          }
  else if (v < 20) { score = 20; label = 'Slightly Elevated'; }
  else if (v < 25) { score = 14; label = 'Elevated';          }
  else if (v < 30) { score =  8; label = 'High';              }
  else             { score =  2; label = 'Extreme';            }

  return {
    score,
    label,
    detail: `VIX ${v.toFixed(2)} — ${vix.regime ?? ''}`,
    max: MAX,
  };
}

function scoreTrend(futures) {
  const MAX = 33;
  const es  = futures?.ES;

  if (!es || es.price === null) {
    return { score: Math.round(MAX / 2), label: 'Unknown', detail: 'ES data unavailable', max: MAX };
  }

  const pct          = es.changePct ?? 0;
  const abovePrevClose = es.previousClose && es.price > es.previousClose;
  let score, label;

  if      (pct >  1.0) { score = 33; label = 'Strong Bull'; }
  else if (pct >  0.5) { score = 28; label = 'Bullish';     }
  else if (pct >  0.2) { score = 23; label = 'Mildly Bull'; }
  else if (pct >  0.0) { score = 19; label = 'Flat / Bull'; }
  else if (pct > -0.2) { score = 15; label = 'Flat / Bear'; }
  else if (pct > -0.5) { score = 10; label = 'Mildly Bear'; }
  else if (pct > -1.0) { score =  6; label = 'Bearish';     }
  else                 { score =  2; label = 'Strong Bear';  }

  const sign   = pct >= 0 ? '+' : '';
  const above  = abovePrevClose ? '↑ above prev close' : '↓ below prev close';
  return {
    score,
    label,
    detail: `ES ${sign}${pct.toFixed(2)}% (${above})`,
    max: MAX,
  };
}

function scoreNews(news) {
  const MAX = 34;

  if (!news || !Array.isArray(news.events)) {
    return { score: Math.round(MAX / 2), label: 'Unknown', detail: 'News feed unavailable', max: MAX };
  }

  const events   = news.events;
  const imminent = events.filter(e => e.minutesUntil !== null && Math.abs(e.minutesUntil) <= 30);
  const upcoming = events.filter(e => e.minutesUntil !== null && e.minutesUntil >  30 && e.minutesUntil <= 120);

  // Start at max and penalise
  let score = MAX;
  score -= imminent.length * 10;   // heavy: imminent = don't trade
  score -= upcoming.length *  4;   // moderate: upcoming = size down
  score  = Math.max(2, score);     // floor

  const label = imminent.length > 0
    ? 'News Risk'
    : upcoming.length > 0
      ? 'Watch'
      : 'Clear';

  return {
    score,
    label,
    detail: `${imminent.length} imminent / ${upcoming.length} upcoming high-impact USD events`,
    imminentCount: imminent.length,
    upcomingCount: upcoming.length,
    max: MAX,
  };
}

// ── Label + colour helpers ────────────────────────────────────────────────────

function sentimentLabel(total) {
  if (total >= 80) return 'Strongly Bullish';
  if (total >= 65) return 'Bullish';
  if (total >= 50) return 'Neutral';
  if (total >= 35) return 'Bearish';
  return 'Strongly Bearish';
}

function sentimentColor(total) {
  if (total >= 65) return '#22c55e'; // green-500
  if (total >= 50) return '#eab308'; // yellow-500
  if (total >= 35) return '#f97316'; // orange-500
  return '#ef4444';                  // red-500
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * @param {{ vix: object, futures: object, news: object }} inputs
 * @returns {{ total: number, label: string, color: string, components: object }}
 */
function calculateSentiment({ vix, futures, news }) {
  const volatility = scoreVolatility(vix);
  const trend      = scoreTrend(futures);
  const newsClear  = scoreNews(news);

  const total = volatility.score + trend.score + newsClear.score;

  return {
    total,
    max:    100,
    label:  sentimentLabel(total),
    color:  sentimentColor(total),
    components: { volatility, trend, news: newsClear },
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = { calculateSentiment };
