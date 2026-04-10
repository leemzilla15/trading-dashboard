/**
 * tradingDayEngine.js — v2
 * Score: 1-10
 * Labels: Good Day to Trade / Caution / Avoid Trading
 */

function getSessionInfo() {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false });
  const parts = etStr.split(':');
  const hourET = parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60;
  const dayET = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });

  if (dayET === 'Sat' || dayET === 'Sun') {
    return { score: 0, session: 'Weekend', detail: 'Market closed', hourET, isWeekend: true };
  }

  let score, session, detail;
  if      (hourET >= 9.5  && hourET < 11)   { score = 1.5; session = 'NY Open';           detail = 'Prime window — best liquidity and momentum'; }
  else if (hourET >= 8    && hourET < 9.5)   { score = 1.2; session = 'Pre-Market';        detail = 'Building toward open — watch for gap direction'; }
  else if (hourET >= 13   && hourET < 15)    { score = 1.0; session = 'NY Afternoon';      detail = 'Secondary window — trend continuation plays'; }
  else if (hourET >= 3    && hourET < 5)     { score = 1.0; session = 'London Open';       detail = 'Good liquidity, early trend formation'; }
  else if (hourET >= 11   && hourET < 13)    { score = 0.2; session = 'Midday Chop';       detail = 'Low liquidity lunch — avoid new positions'; }
  else if (hourET >= 15   && hourET < 16.5)  { score = 0.6; session = 'Market Close';      detail = 'Late session — position squaring, be cautious'; }
  else if (hourET >= 18   && hourET < 24)    { score = 0.4; session = 'Futures Evening';   detail = 'Futures open — light volume, gap monitoring'; }
  else                                        { score = 0.3; session = 'Overnight/Asia';   detail = 'Low volume session — avoid unless Asia play'; }

  // Compute next session
  let nextSession, minsToNext;
  if      (hourET < 3)    { nextSession = 'London Open';  minsToNext = Math.round((3 - hourET) * 60); }
  else if (hourET < 8)    { nextSession = 'Pre-Market';   minsToNext = Math.round((8 - hourET) * 60); }
  else if (hourET < 9.5)  { nextSession = 'NY Open';      minsToNext = Math.round((9.5 - hourET) * 60); }
  else if (hourET < 13)   { nextSession = 'NY Afternoon'; minsToNext = Math.round((13 - hourET) * 60); }
  else if (hourET < 18)   { nextSession = 'Futures Open'; minsToNext = Math.round((18 - hourET) * 60); }
  else                    { nextSession = 'London Open';  minsToNext = Math.round((27 - hourET) * 60); }

  return { score, session, detail, hourET: parseFloat(hourET.toFixed(2)), nextSession, minsToNext };
}

function scoreVIX(vix) {
  const MAX = 2.0;
  const v = vix && vix.price;
  if (!v) return { score: 1.0, max: MAX, label: 'Unknown', detail: 'VIX unavailable' };

  let score, label;
  if      (v < 12) { score = 2.0; label = 'Ideal'; }
  else if (v < 15) { score = 1.9; label = 'Very Calm'; }
  else if (v < 18) { score = 1.6; label = 'Calm'; }
  else if (v < 20) { score = 1.3; label = 'Moderate'; }
  else if (v < 23) { score = 1.0; label = 'Elevated'; }
  else if (v < 27) { score = 0.6; label = 'High'; }
  else if (v < 32) { score = 0.3; label = 'Very High'; }
  else             { score = 0.0; label = 'Extreme'; }

  if (vix.changePct > 15) score = Math.max(0, score - 0.4);
  return { score: parseFloat(score.toFixed(2)), max: MAX, label, detail: `VIX ${v.toFixed(2)} (${vix.changePct >= 0 ? '+' : ''}${(vix.changePct || 0).toFixed(1)}%)`, vixValue: v };
}

function scoreChop(levels, futures) {
  const MAX = 1.0;
  if (!levels) return { score: 0.5, max: MAX, label: 'Unknown', detail: 'Level data unavailable' };

  let score = MAX;
  const details = [];

  // ATR compression check
  if (levels.atr14 && levels.todayRange) {
    const ratio = levels.todayRange / levels.atr14;
    if (ratio < 0.4) {
      score -= 0.6;
      details.push(`Extreme ATR compression (${ratio.toFixed(1)}x) — very choppy`);
    } else if (ratio < 0.6) {
      score -= 0.3;
      details.push(`ATR compression (${ratio.toFixed(1)}x) — choppy conditions`);
    } else if (ratio > 1.2) {
      details.push(`Good range expansion (${ratio.toFixed(1)}x ATR) — trending`);
    } else {
      details.push(`Normal range (${ratio.toFixed(1)}x ATR)`);
    }
  }

  // Tight intraday range check
  if (futures && futures.ES && futures.ES.high && futures.ES.low && futures.ES.price) {
    const intradayRange = futures.ES.high - futures.ES.low;
    if (intradayRange < 10) {
      score -= 0.3;
      details.push(`Tight intraday range (${intradayRange.toFixed(0)} pts) — low momentum`);
    } else if (intradayRange > 30) {
      details.push(`Wide intraday range (${intradayRange.toFixed(0)} pts) — good momentum`);
    }
  }

  score = Math.min(MAX, Math.max(0, score));
  const label = score >= 0.8 ? 'Trending' : score >= 0.5 ? 'Mixed' : 'Choppy';
  return { score: parseFloat(score.toFixed(2)), max: MAX, label, detail: details.join('; ') || 'Checking range conditions', isChoppy: score < 0.5 };
}

function scoreTrend(bias) {
  const MAX = 2.0;
  if (!bias || !bias.htf) return { score: 1.0, max: MAX, label: 'No Data', detail: 'Technical analysis unavailable' };
  const htf = bias.htf;
  let score = 0;
  const details = [];
  const ema = htf.ema;
  if (ema && ema.aligned && ema.bias !== 'neutral') {
    score += 1.0;
    details.push(`1H EMAs fully aligned ${ema.bias}`);
  } else if (ema && ema.strength >= 2) {
    score += 0.6;
    details.push(`1H EMA partially aligned (${ema.strength}/3)`);
  } else {
    score += 0.2;
    details.push('1H EMAs mixed');
  }
  if (ema && ema.ema50Slope === 'rising'  && ema.bias === 'bullish') { score += 0.5; details.push('EMA50 rising'); }
  if (ema && ema.ema50Slope === 'falling' && ema.bias === 'bearish') { score += 0.5; details.push('EMA50 falling'); }
  if      (htf.structure === 'bullish_structure') { score += 0.5; details.push('HH+HL structure'); }
  else if (htf.structure === 'bearish_structure') { score += 0.5; details.push('LH+LL structure'); }
  else if (htf.structure === 'consolidation')     { score -= 0.2; details.push('Consolidating'); }
  score = Math.min(MAX, Math.max(0, score));
  const label = score >= 1.6 ? 'Clear' : score >= 1.0 ? 'Moderate' : score >= 0.5 ? 'Weak' : 'Choppy';
  return { score: parseFloat(score.toFixed(2)), max: MAX, label, detail: details.join('; ') };
}

function scoreConfluence(bias) {
  const MAX = 2.0;
  if (!bias) return { score: 1.0, max: MAX, label: 'No Data', detail: 'Bias unavailable' };
  const { confluence, aligned, htf, ltf } = bias;
  let score = 0;
  const details = [];
  if      (aligned && confluence === 'strong')    { score = 2.0; details.push(`Both TFs agree: ${bias.bias}`); }
  else if (confluence === 'moderate')              { score = 1.4; details.push(`HTF ${htf && htf.bias} — LTF neutral`); }
  else if (confluence === 'weak')                  { score = 1.0; details.push(`HTF neutral, LTF ${ltf && ltf.bias}`); }
  else if (confluence === 'conflicting')           { score = 0.4; details.push(`HTF vs LTF conflict — stand aside`); }
  else                                             { score = 1.0; details.push('Insufficient data'); }
  const sb = bias.htf && bias.htf.structureBreak;
  if (sb && sb.type !== 'none' && sb.type) { score = Math.min(MAX, score + 0.3); details.push(`Structure break: ${sb.type}`); }
  return { score: parseFloat(score.toFixed(2)), max: MAX, label: confluence === 'strong' ? 'Aligned' : confluence === 'conflicting' ? 'Conflicting' : 'Partial', detail: details.join('; '), htfBias: htf && htf.bias, ltfBias: ltf && ltf.bias };
}

function scoreNewsRisk(news) {
  const MAX = 1.5;
  const events = (news && news.events) || [];
  const imminent = events.filter(e => e.minutesUntil != null && Math.abs(e.minutesUntil) <= 20);
  const soon     = events.filter(e => e.minutesUntil != null && e.minutesUntil > 20  && e.minutesUntil <= 45);
  const upcoming = events.filter(e => e.minutesUntil != null && e.minutesUntil > 45  && e.minutesUntil <= 120);

  let score = MAX;
  score -= imminent.length * 0.8;
  score -= soon.length     * 0.4;
  score -= upcoming.length * 0.15;
  score = Math.max(0, score);

  const label = imminent.length > 0 ? 'High Risk' : soon.length > 0 ? 'Moderate Risk' : upcoming.length > 0 ? 'Low Risk' : 'Clear';
  const names = imminent.concat(soon).slice(0, 2).map(e => e.title).join(', ');
  const detail = imminent.length > 0
    ? `AVOID NOW: ${names} in <20 min`
    : soon.length > 0
      ? `Watch: ${names} within 45 min`
      : upcoming.length > 0
        ? `${upcoming.length} event(s) in next 2hrs`
        : 'No high-impact events nearby';

  return { score: parseFloat(score.toFixed(2)), max: MAX, label, detail, imminentCount: imminent.length, soonCount: soon.length, upcomingCount: upcoming.length };
}

function applyVetoes(rawScore, vix, news, bias, chop) {
  const vetoes = [];
  let cap = 10;
  const v = vix && vix.price;
  if (v >= 35) { cap = Math.min(cap, 3.0); vetoes.push(`VETO: VIX ${v.toFixed(1)} ≥ 35 — extreme stress, do not trade`); }
  const imminentNews = ((news && news.events) || []).filter(e => e.minutesUntil != null && Math.abs(e.minutesUntil) <= 15);
  if (imminentNews.length > 0) { cap = Math.min(cap, 3.5); vetoes.push(`VETO: ${imminentNews.map(e => e.title).join(', ')} in <15 min — stand aside`); }
  if (bias && bias.confluence === 'conflicting') { cap = Math.min(cap, 6.0); vetoes.push('CAP: HTF vs LTF conflict — max score 6.0'); }
  if (chop && chop.isChoppy) { cap = Math.min(cap, 6.5); vetoes.push('CAP: Choppy market conditions detected — max score 6.5'); }
  const finalScore = Math.min(rawScore, cap);
  return { finalScore: parseFloat(finalScore.toFixed(1)), vetoes, wasCapped: finalScore < rawScore };
}

function getLabel(score) {
  if (score >= 8.0) return { label: 'Good Day to Trade', emoji: '✅', color: '#22c55e', description: 'Conditions are well aligned. Market structure, volatility, and timing support high-probability setups.' };
  if (score >= 5.0) return { label: 'Caution',           emoji: '⚠️', color: '#f59e0b', description: 'Mixed conditions. Trade selectively with reduced size. Wait for clean confirmation.' };
  return               { label: 'Avoid Trading',         emoji: '🚫', color: '#ef4444', description: 'Conditions are unfavorable. Forcing trades in this environment leads to poor outcomes.' };
}

function scoreTradingDay({ vix, news, bias, levels, futures }) {
  const session    = getSessionInfo();
  const volScore   = scoreVIX(vix);
  const trendScore = scoreTrend(bias);
  const confScore  = scoreConfluence(bias);
  const newsScore  = scoreNewsRisk(news);
  const chopScore  = scoreChop(levels, futures);

  const raw = volScore.score + trendScore.score + confScore.score + newsScore.score + session.score + chopScore.score;
  const rawRounded = parseFloat(raw.toFixed(1));
  const { finalScore, vetoes, wasCapped } = applyVetoes(rawRounded, vix, news, bias, chopScore);
  const meta = getLabel(finalScore);

  return {
    score: finalScore,
    rawScore: rawRounded,
    wasCapped,
    label: meta.label,
    emoji: meta.emoji,
    color: meta.color,
    description: meta.description,
    categories: {
      volatility: volScore,
      trend:      trendScore,
      confluence: confScore,
      news:       newsScore,
      session,
      chop:       chopScore
    },
    vetoes,
    lastUpdated: new Date().toISOString()
  };
}

module.exports = { scoreTradingDay };
