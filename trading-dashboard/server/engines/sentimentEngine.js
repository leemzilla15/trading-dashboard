/**
 * sentimentEngine.js — v2
 * Score: 0-100
 * Components: Volatility (33) + Trend (33) + News (34)
 */

function scoreVolatility(vix) {
  const MAX = 33;
  if (!vix || vix.price === null) return { score: 17, label: 'Unknown', detail: 'VIX unavailable', max: MAX };
  const v = vix.price;
  let score, label;
  if      (v < 12) { score = 33; label = 'Very Calm'; }
  else if (v < 15) { score = 30; label = 'Calm'; }
  else if (v < 18) { score = 25; label = 'Moderate'; }
  else if (v < 20) { score = 20; label = 'Slightly Elevated'; }
  else if (v < 25) { score = 14; label = 'Elevated'; }
  else if (v < 30) { score = 8;  label = 'High'; }
  else             { score = 2;  label = 'Extreme'; }
  // Rising VIX penalty
  if (vix.changePct > 10 && v > 18) score = Math.max(0, score - 3);
  return { score, label, detail: `VIX ${v.toFixed(2)} — ${vix.regime || ''}`, max: MAX };
}

function scoreTrend(futures, levels) {
  const MAX = 33;
  const es = futures && futures.ES;
  if (!es || es.price === null) return { score: 17, label: 'Unknown', detail: 'ES data unavailable', max: MAX };

  const pct = es.changePct || 0;
  let score, label;
  if      (pct >  1.0) { score = 33; label = 'Strong Bull'; }
  else if (pct >  0.5) { score = 28; label = 'Bullish'; }
  else if (pct >  0.2) { score = 23; label = 'Mildly Bull'; }
  else if (pct >  0.0) { score = 19; label = 'Flat/Bull'; }
  else if (pct > -0.2) { score = 15; label = 'Flat/Bear'; }
  else if (pct > -0.5) { score = 10; label = 'Mildly Bear'; }
  else if (pct > -1.0) { score = 6;  label = 'Bearish'; }
  else                 { score = 2;  label = 'Strong Bear'; }

  // Chop penalty — if market is in tight range, reduce trend score
  if (levels && levels.isChoppy) {
    score = Math.max(2, score - 6);
    label = label + ' (Choppy)';
  }

  const sign = pct >= 0 ? '+' : '';
  return {
    score,
    label,
    detail: `ES ${sign}${pct.toFixed(2)}% ${levels && levels.isChoppy ? '— CHOPPY CONDITIONS' : ''}`,
    max: MAX,
    choppy: !!(levels && levels.isChoppy)
  };
}

function scoreNews(news) {
  const MAX = 34;
  if (!news || !Array.isArray(news.events)) return { score: 17, label: 'Unknown', detail: 'News unavailable', max: MAX };

  const events = news.events;
  const imminent = events.filter(e => e.minutesUntil !== null && Math.abs(e.minutesUntil) <= 30);
  const upcoming = events.filter(e => e.minutesUntil !== null && e.minutesUntil > 30 && e.minutesUntil <= 120);

  let score = MAX;
  score -= imminent.length * 12;
  score -= upcoming.length * 4;
  score = Math.max(2, score);

  const label = imminent.length > 0 ? 'News Risk' : upcoming.length > 0 ? 'Watch' : 'Clear';
  return {
    score,
    label,
    detail: `${imminent.length} imminent / ${upcoming.length} upcoming high-impact USD events`,
    imminentCount: imminent.length,
    upcomingCount: upcoming.length,
    max: MAX
  };
}

function sentimentLabel(total) {
  if (total >= 80) return 'Strongly Bullish';
  if (total >= 65) return 'Bullish';
  if (total >= 50) return 'Neutral';
  if (total >= 35) return 'Bearish';
  return 'Strongly Bearish';
}

function sentimentColor(total) {
  if (total >= 65) return '#22c55e';
  if (total >= 50) return '#eab308';
  if (total >= 35) return '#f97316';
  return '#ef4444';
}

function calculateSentiment({ vix, futures, news, levels }) {
  const volatility = scoreVolatility(vix);
  const trend = scoreTrend(futures, levels);
  const newsClear = scoreNews(news);
  const total = volatility.score + trend.score + newsClear.score;
  return {
    total,
    max: 100,
    label: sentimentLabel(total),
    color: sentimentColor(total),
    components: { volatility, trend, news: newsClear },
    lastUpdated: new Date().toISOString()
  };
}

module.exports = { calculateSentiment };
