/**
 * tradingDayEngine.js
 *
 * The master scoring engine. Produces a tradability score from 1–10
 * and a clear human label.
 *
 * SCORING CATEGORIES (total = 10):
 * ┌─────────────────────────────────────────────────────┬──────────┐
 * │ Category                                            │ Max pts  │
 * ├─────────────────────────────────────────────────────┼──────────┤
 * │ 1. VIX / Volatility environment                     │   2.0    │
 * │ 2. Trend clarity  (1H EMA structure)                │   2.0    │
 * │ 3. HTF + LTF bias confluence                        │   2.0    │
 * │ 4. News risk window                                 │   1.5    │
 * │ 5. Session timing (NY open / London / overlap)      │   1.5    │
 * │ 6. Structural setup quality (FVG + swing levels)    │   1.0    │
 * └─────────────────────────────────────────────────────┴──────────┘
 *
 * Labels:
 *   8.0–10.0  → "Good Day to Trade"   (conditions aligned, take setups)
 *   5.0–7.9   → "Caution"             (trade selectively, smaller size)
 *   1.0–4.9   → "Avoid Trading"       (environment against you)
 *
 * Hard vetoes — these immediately cap the score regardless of other signals:
 *   • VIX > 35                 → cap at 3.0 (Avoid)
 *   • Imminent high-impact news → cap at 4.5 (Avoid)
 *   • Both timeframes conflicting bias → cap at 6.5
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const ET_SESSIONS = {
  // [start_hour, end_hour] in 24h Eastern Time
  LONDON_OPEN:    [3,  5  ],  // 3:00–5:00 AM ET
  LONDON_NY_OVERLAP: [8, 11],  // 8:00–11:00 AM ET  ← best window
  NY_OPEN:        [9.5, 11],  // 9:30–11:00 AM ET
  NY_AFTERNOON:   [13, 15 ],  // 1:00–3:00 PM ET    ← secondary window
  DEAD_ZONE:      [11, 13 ],  // 11:00 AM–1:00 PM ET (lunch chop)
  CLOSE:          [15, 16.5], // 3:00–4:30 PM ET
};

const LABEL_MAP = {
  GOOD:   { label: 'Good Day to Trade', emoji: '✅', color: '#22c55e', description: 'Conditions are well-aligned. Market structure, volatility, and timing support high-probability setups.' },
  CAUTION:{ label: 'Caution',           emoji: '⚠️', color: '#f59e0b', description: 'Mixed conditions. Trade selectively with reduced size. Wait for clean confirmation before entries.' },
  AVOID:  { label: 'Avoid Trading',     emoji: '🚫', color: '#ef4444', description: 'Conditions are unfavorable. Forcing trades in this environment leads to poor outcomes.' },
};

// ── Session timing ────────────────────────────────────────────────────────────

function getSessionScore() {
  // Current time in Eastern Time
  const now    = new Date();
  const etStr  = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false });
  const [hStr, mStr] = etStr.split(':');
  const hourET = parseInt(hStr, 10) + parseInt(mStr, 10) / 60;

  // Weekend check
  const dayET = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  if (dayET === 'Sat' || dayET === 'Sun') {
    return { score: 0, session: 'Weekend', detail: 'Market closed — no trading', hourET };
  }

  let score, session, detail;

  if (hourET >= ET_SESSIONS.LONDON_NY_OVERLAP[0] && hourET < ET_SESSIONS.LONDON_NY_OVERLAP[1]) {
    score   = 1.5;
    session = 'London/NY Overlap';
    detail  = 'Prime session — maximum liquidity and institutional participation';
  } else if (hourET >= ET_SESSIONS.LONDON_OPEN[0] && hourET < ET_SESSIONS.LONDON_OPEN[1]) {
    score   = 1.1;
    session = 'London Open';
    detail  = 'Good liquidity, early trend formation';
  } else if (hourET >= ET_SESSIONS.NY_AFTERNOON[0] && hourET < ET_SESSIONS.NY_AFTERNOON[1]) {
    score   = 1.0;
    session = 'NY Afternoon';
    detail  = 'Secondary window — watch for trend continuation or reversal';
  } else if (hourET >= ET_SESSIONS.CLOSE[0] && hourET < ET_SESSIONS.CLOSE[1]) {
    score   = 0.7;
    session = 'Market Close';
    detail  = 'Late session — low conviction moves, position squaring';
  } else if (hourET >= ET_SESSIONS.DEAD_ZONE[0] && hourET < ET_SESSIONS.DEAD_ZONE[1]) {
    score   = 0.2;
    session = 'Midday Chop';
    detail  = 'Low liquidity lunch period — chop, false breakouts, avoid new positions';
  } else if (hourET >= 0 && hourET < 3) {
    score   = 0.3;
    session = 'Overnight / Asia';
    detail  = 'Low-volume Asian session — avoid unless playing Asia range';
  } else {
    score   = 0.5;
    session = 'Pre-Market';
    detail  = 'Building toward open — monitor for gaps and early bias';
  }

  return { score, session, detail, hourET: parseFloat(hourET.toFixed(2)) };
}

// ── Category scorers ──────────────────────────────────────────────────────────

function scoreVIX(vix) {
  const MAX = 2.0;
  const v   = vix?.price ?? null;

  if (v === null) return { score: 1.0, max: MAX, label: 'Unknown', detail: 'VIX unavailable — defaulting to neutral' };

  let score, label;
  if      (v < 12) { score = 2.0; label = 'Ideal';           }
  else if (v < 15) { score = 1.9; label = 'Very Calm';        }
  else if (v < 18) { score = 1.6; label = 'Calm';             }
  else if (v < 20) { score = 1.3; label = 'Moderate';         }
  else if (v < 23) { score = 1.0; label = 'Slightly Elevated';}
  else if (v < 27) { score = 0.6; label = 'Elevated';         }
  else if (v < 32) { score = 0.3; label = 'High';             }
  else if (v < 40) { score = 0.1; label = 'Extreme';          }
  else             { score = 0.0; label = 'Crisis';            }

  // VIX trend adjustment: rising VIX is worse than stable VIX at same level
  const vixChange = vix.changePct ?? 0;
  if (vixChange > 10 && v > 20) score = Math.max(0, score - 0.3);
  if (vixChange > 20)            score = Math.max(0, score - 0.5);

  return {
    score: parseFloat(score.toFixed(2)),
    max:   MAX,
    label,
    detail: `VIX ${v.toFixed(2)} (${vixChange >= 0 ? '+' : ''}${vixChange?.toFixed(1) ?? '?'}% today) — ${vix.regime ?? ''}`,
    vixValue: v,
  };
}

function scoreTrendClarity(bias) {
  const MAX  = 2.0;
  const htf  = bias?.htf;

  if (!htf) return { score: 1.0, max: MAX, label: 'No Data', detail: 'Technical analysis unavailable' };

  let score = 0;
  const details = [];

  // EMA alignment quality
  const ema = htf.ema;
  if (ema?.aligned && ema?.bias !== 'neutral') {
    score += 1.0;
    details.push(`1H EMAs fully stacked ${ema.bias}`);
  } else if (ema?.strength >= 2) {
    score += 0.6;
    details.push(`1H EMA partially aligned (${ema.strength}/3)`);
  } else {
    score += 0.2;
    details.push('1H EMAs mixed or conflicting');
  }

  // EMA 50 slope gives momentum context
  if (ema?.ema50Slope === 'rising'  && ema.bias === 'bullish') { score += 0.5; details.push('EMA50 rising — momentum confirmed'); }
  if (ema?.ema50Slope === 'falling' && ema.bias === 'bearish') { score += 0.5; details.push('EMA50 falling — momentum confirmed'); }
  if (ema?.ema50Slope === 'flat')                               { details.push('EMA50 flat — ranging market'); }

  // Structure quality
  if      (htf.structure === 'bullish_structure') { score += 0.5; details.push('1H: HH+HL market structure intact'); }
  else if (htf.structure === 'bearish_structure') { score += 0.5; details.push('1H: LH+LL market structure intact'); }
  else if (htf.structure === 'consolidation')     { score -= 0.2; details.push('1H: Consolidating — unclear direction'); }

  score = Math.min(MAX, Math.max(0, score));

  const label = score >= 1.6 ? 'Clear'
              : score >= 1.0 ? 'Moderate'
              : score >= 0.5 ? 'Weak'
              : 'Choppy';

  return { score: parseFloat(score.toFixed(2)), max: MAX, label, detail: details.join('; ') };
}

function scoreConfluence(bias) {
  const MAX = 2.0;

  if (!bias) return { score: 1.0, max: MAX, label: 'No Data', detail: 'Bias data unavailable' };

  const { confluence, aligned, htf, ltf } = bias;
  let score = 0;
  const details = [];

  if (aligned && confluence === 'strong') {
    score = 2.0;
    details.push(`Both timeframes agree: ${bias.bias}`);
  } else if (confluence === 'moderate') {
    score = 1.4;
    details.push(`HTF ${htf.bias} — LTF neutral (moderate edge)`);
  } else if (confluence === 'weak') {
    score = 1.0;
    details.push(`HTF neutral, LTF ${ltf.bias} — context lacking`);
  } else if (confluence === 'conflicting') {
    score = 0.4;
    details.push(`⚠️ HTF ${htf.bias} vs LTF ${ltf.bias} — timeframes conflict, stand aside`);
  }

  // Structure break bonus
  const sb = bias.htf?.structureBreak;
  if (sb?.type !== 'none' && sb?.type) {
    score = Math.min(MAX, score + 0.3);
    details.push(`Structure break detected: ${sb.type} at ${sb.level}`);
  }

  return {
    score: parseFloat(score.toFixed(2)),
    max:   MAX,
    label: confluence === 'strong' ? 'Aligned' : confluence === 'conflicting' ? 'Conflicting' : 'Partial',
    detail: details.join('; '),
    htfBias: htf?.bias,
    ltfBias: ltf?.bias,
  };
}

function scoreNewsRisk(news) {
  const MAX    = 1.5;
  const events = news?.events ?? [];

  const imminentEvents = events.filter(e => e.minutesUntil != null && Math.abs(e.minutesUntil) <= 20);
  const soonEvents     = events.filter(e => e.minutesUntil != null && e.minutesUntil > 20  && e.minutesUntil <= 45);
  const upcomingEvents = events.filter(e => e.minutesUntil != null && e.minutesUntil > 45  && e.minutesUntil <= 120);

  let score = MAX;

  score -= imminentEvents.length * 0.75;  // high penalty: imminent
  score -= soonEvents.length     * 0.40;  // medium: within 45 min
  score -= upcomingEvents.length * 0.15;  // light: within 2 hrs

  score = Math.max(0, score);

  const label = imminentEvents.length > 0 ? 'High Risk'
              : soonEvents.length     > 0 ? 'Moderate Risk'
              : upcomingEvents.length > 0 ? 'Low Risk'
              : 'Clear';

  const names = imminentEvents.concat(soonEvents).slice(0, 2).map(e => e.title).join(', ');
  const detail = imminentEvents.length > 0
    ? `AVOID: ${names} in <20 min`
    : soonEvents.length > 0
      ? `Watch: ${names} within 45 min`
      : upcomingEvents.length > 0
        ? `${upcomingEvents.length} event(s) in next 2 hrs — be aware`
        : 'No high-impact events nearby — clear to trade';

  return {
    score: parseFloat(score.toFixed(2)),
    max:   MAX,
    label,
    detail,
    imminentCount: imminentEvents.length,
    soonCount:     soonEvents.length,
    upcomingCount: upcomingEvents.length,
  };
}

function scoreSetupQuality(bias) {
  const MAX = 1.0;

  if (!bias) return { score: 0.5, max: MAX, label: 'Unknown', detail: 'No structural data' };

  let score = 0;
  const details = [];

  // Active unmitigated FVGs = there are zones to trade from
  const htfBullFVGs = bias.htf?.fvgCount?.bullish ?? 0;
  const htfBearFVGs = bias.htf?.fvgCount?.bearish ?? 0;
  const ltfBullFVGs = bias.ltf?.fvgCount?.bullish ?? 0;
  const ltfBearFVGs = bias.ltf?.fvgCount?.bearish ?? 0;

  const totalActiveFVGs = htfBullFVGs + htfBearFVGs + ltfBullFVGs + ltfBearFVGs;

  if (totalActiveFVGs >= 3) {
    score += 0.5;
    details.push(`${totalActiveFVGs} active FVG zones present (strong imbalance environment)`);
  } else if (totalActiveFVGs >= 1) {
    score += 0.3;
    details.push(`${totalActiveFVGs} FVG zone(s) present`);
  } else {
    details.push('No active FVG zones — price in balanced territory');
  }

  // Distance to nearest key level — if too close to resistance/support, risk/reward is poor
  const dRes = bias.distToResistance;
  const dSup = bias.distToSupport;

  if (dRes !== null && dSup !== null) {
    const rrRatio = dRes / (dSup || 0.0001);
    if (rrRatio >= 2.0) {
      score += 0.5;
      details.push(`Good R:R positioning — ${dSup?.toFixed(2)}% to support, ${dRes?.toFixed(2)}% to resistance`);
    } else if (rrRatio >= 1.0) {
      score += 0.3;
      details.push(`Acceptable positioning — R:R ~${rrRatio.toFixed(1)}:1`);
    } else {
      details.push(`Poor R:R — price closer to resistance than support`);
    }
  }

  score = Math.min(MAX, score);
  const label = score >= 0.8 ? 'Strong' : score >= 0.5 ? 'Moderate' : 'Weak';

  return { score: parseFloat(score.toFixed(2)), max: MAX, label, detail: details.join('; ') };
}

// ── Hard Vetoes ───────────────────────────────────────────────────────────────

function applyVetoes(rawScore, vix, news, bias) {
  const vetoes  = [];
  let   cap     = 10;

  if (vix?.price >= 35) {
    cap = Math.min(cap, 3.0);
    vetoes.push(`VETO: VIX ${vix.price.toFixed(1)} ≥ 35 — extreme market stress, do not trade`);
  }

  const imminentNews = (news?.events ?? []).filter(e => e.minutesUntil != null && Math.abs(e.minutesUntil) <= 15);
  if (imminentNews.length > 0) {
    cap = Math.min(cap, 4.0);
    vetoes.push(`VETO: ${imminentNews.map(e => e.title).join(', ')} in <15 min — stand aside`);
  }

  if (bias?.confluence === 'conflicting') {
    cap = Math.min(cap, 6.0);
    vetoes.push(`CAP: HTF vs LTF bias conflict — score capped at 6.0`);
  }

  const finalScore = Math.min(rawScore, cap);
  return { finalScore: parseFloat(finalScore.toFixed(1)), vetoes, wasCapped: finalScore < rawScore };
}

// ── Label lookup ──────────────────────────────────────────────────────────────

function getLabel(score) {
  if (score >= 8.0) return LABEL_MAP.GOOD;
  if (score >= 5.0) return LABEL_MAP.CAUTION;
  return LABEL_MAP.AVOID;
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * @param {{ vix, news, bias }} inputs
 * @returns {{ score, label, emoji, color, description, categories, vetoes, lastUpdated }}
 */
function scoreTradingDay({ vix, news, bias }) {
  const session   = getSessionScore();
  const volScore  = scoreVIX(vix);
  const trendScore = scoreTrendClarity(bias);
  const confScore  = scoreConfluence(bias);
  const newsScore  = scoreNewsRisk(news);
  const setupScore = scoreSetupQuality(bias);

  // Sum raw score
  const raw = volScore.score
            + trendScore.score
            + confScore.score
            + newsScore.score
            + session.score
            + setupScore.score;

  const rawRounded = parseFloat(raw.toFixed(1));

  // Apply hard vetoes / caps
  const { finalScore, vetoes, wasCapped } = applyVetoes(rawRounded, vix, news, bias);

  const meta = getLabel(finalScore);

  return {
    score:       finalScore,
    rawScore:    rawRounded,
    wasCapped,
    label:       meta.label,
    emoji:       meta.emoji,
    color:       meta.color,
    description: meta.description,
    categories: {
      volatility: volScore,
      trend:      trendScore,
      confluence: confScore,
      news:       newsScore,
      session,
      setup:      setupScore,
    },
    vetoes,
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = { scoreTradingDay };
