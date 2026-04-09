/**
 * ratingEngine.js
 *
 * Pure function — no I/O.
 * Combines sentiment score, VIX, news events, and overnight levels
 * into a single actionable rating with plain-English reasons.
 *
 * Output:
 *   TRADE     — conditions are favorable, green light
 *   CAUTION   — mixed signals, reduce size / be selective
 *   NO_TRADE  — conditions are unfavorable, stand aside
 */

const THRESHOLDS = {
  TRADE:    { min: 7  },
  CAUTION:  { min: 3  },
  NO_TRADE: { min: -Infinity },
};

function getRatingMeta(score) {
  if (score >= THRESHOLDS.TRADE.min)   return { label: 'TRADE',    color: '#22c55e', emoji: '✅' };
  if (score >= THRESHOLDS.CAUTION.min) return { label: 'CAUTION',  color: '#eab308', emoji: '⚠️' };
  return                                      { label: 'NO_TRADE', color: '#ef4444', emoji: '🚫' };
}

/**
 * @param {{
 *   sentiment: object,
 *   vix:       object,
 *   news:      object,
 *   levels:    object
 * }} inputs
 */
function calculateRating({ sentiment, vix, news, levels }) {
  const reasons  = [];   // positive signals
  const warnings = [];   // negative signals
  let   score    = 0;    // 0–10 accumulator

  // ── VIX ────────────────────────────────────────────────────────────────────
  const vixPrice = vix?.price ?? null;
  if (vixPrice !== null) {
    if (vixPrice < 15) {
      score += 3;
      reasons.push(`VIX at ${vixPrice.toFixed(1)} — low-volatility environment`);
    } else if (vixPrice < 20) {
      score += 2;
      reasons.push(`VIX at ${vixPrice.toFixed(1)} — manageable volatility`);
    } else if (vixPrice < 25) {
      score += 1;
      warnings.push(`VIX at ${vixPrice.toFixed(1)} — slightly elevated, size down`);
    } else if (vixPrice < 30) {
      score -= 1;
      warnings.push(`VIX at ${vixPrice.toFixed(1)} — elevated, reduce exposure`);
    } else {
      score -= 3;
      warnings.push(`VIX at ${vixPrice.toFixed(1)} — extreme volatility, avoid new positions`);
    }
  } else {
    warnings.push('VIX data unavailable — treat as elevated');
  }

  // ── Sentiment ─────────────────────────────────────────────────────────────
  const sentTotal = sentiment?.total ?? 50;
  if (sentTotal >= 70) {
    score += 3;
    reasons.push(`Sentiment strong at ${sentTotal}/100 — all signals aligned`);
  } else if (sentTotal >= 55) {
    score += 2;
    reasons.push(`Sentiment positive at ${sentTotal}/100`);
  } else if (sentTotal >= 45) {
    score += 1;
    warnings.push(`Sentiment neutral at ${sentTotal}/100 — no clear edge`);
  } else if (sentTotal >= 35) {
    score -= 1;
    warnings.push(`Sentiment bearish at ${sentTotal}/100 — trade carefully`);
  } else {
    score -= 3;
    warnings.push(`Sentiment strongly bearish at ${sentTotal}/100 — stand aside`);
  }

  // ── News ──────────────────────────────────────────────────────────────────
  const events   = news?.events ?? [];
  const imminent = events.filter(e => e.minutesUntil !== null && Math.abs(e.minutesUntil) <= 30);
  const upcoming = events.filter(e => e.minutesUntil !== null && e.minutesUntil > 30 && e.minutesUntil <= 60);

  if (imminent.length === 0 && upcoming.length === 0) {
    score += 2;
    reasons.push('No high-impact news in the next 60 minutes');
  } else if (imminent.length === 0) {
    score += 0;
    warnings.push(`${upcoming.length} high-impact event(s) in the next hour — be cautious`);
  } else {
    score -= 3;
    const titles = imminent.map(e => e.title).slice(0, 2).join(', ');
    warnings.push(`⚠️ IMMINENT news: ${titles}`);
  }

  // ── Overnight levels ──────────────────────────────────────────────────────
  const pos = levels?.positionInRange ?? null;
  if (pos !== null) {
    if (pos >= 20 && pos <= 80) {
      score += 2;
      reasons.push(`ES price in mid-range of overnight session (${pos.toFixed(0)}% up from low)`);
    } else if (pos < 20) {
      warnings.push(`ES near overnight LOW — potential support, but watch for break`);
    } else {
      warnings.push(`ES near overnight HIGH — potential resistance zone`);
    }
  }

  // ── Build output ──────────────────────────────────────────────────────────
  const meta = getRatingMeta(score);

  return {
    rating:  meta.label,
    color:   meta.color,
    emoji:   meta.emoji,
    score,            // raw score for debugging
    reasons,
    warnings,
    summary: buildSummary(meta.label, reasons, warnings),
    lastUpdated: new Date().toISOString(),
  };
}

function buildSummary(rating, reasons, warnings) {
  const top = rating === 'TRADE'
    ? reasons[0]    ?? 'Multiple positive signals aligned.'
    : warnings[0]   ?? 'Adverse signals detected.';

  const map = {
    TRADE:    `Conditions are favorable. ${top}`,
    CAUTION:  `Mixed conditions. ${top} Reduce size and be selective.`,
    NO_TRADE: `Unfavorable conditions. ${top} Stand aside until environment improves.`,
  };
  return map[rating];
}

module.exports = { calculateRating };
