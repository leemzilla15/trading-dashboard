/**
 * biasEngine.js
 *
 * Determines market bias using a two-timeframe confluence model.
 *
 * HIGHER TIMEFRAME (1H):
 *   - EMA 9/21/50 alignment
 *   - Swing structure (HH/HL vs LH/LL)
 *   - Price position relative to key EMAs
 *   - Structure breaks (ChoCH)
 *   - Active FVG zones nearby
 *
 * LOWER TIMEFRAME (15M):
 *   - EMA 9/21 alignment (confirmation layer)
 *   - Most recent FVGs (entry context)
 *   - Swing structure
 *
 * OUTPUT:
 *   htfBias:      'bullish' | 'bearish' | 'neutral'
 *   ltfBias:      'bullish' | 'bearish' | 'neutral'
 *   confluenceBias: aligned result of both
 *   biasStrength:  1–5
 *   keyLevels:    { resistance[], support[] }
 *   activeSetups: description of what the technicals are saying
 */

const {
  emaAlignment,
  detectSwings,
  detectFVGs,
  atr,
  detectStructureBreak,
} = require('./technicalEngine');

// ── HTF Bias (1H) ─────────────────────────────────────────────────────────────

function analyseHTF(candles1H) {
  if (!candles1H || candles1H.length < 55) {
    return {
      bias: 'neutral',
      strength: 0,
      reason: 'Insufficient 1H data',
      ema: null,
      swings: null,
      fvgs: null,
      structureBreak: null,
      atr14: null,
    };
  }

  const emaData       = emaAlignment(candles1H);
  const swings        = detectSwings(candles1H, 3, 8);
  const fvgs          = detectFVGs(candles1H, 30);
  const structBreak   = detectStructureBreak(candles1H, swings);
  const atr14         = atr(candles1H, 14);

  // ── Score the HTF signals ─────────────────────────────────────────────────
  let bullPoints = 0;
  let bearPoints = 0;
  const reasons  = [];

  // 1. EMA alignment (weight: 3)
  if      (emaData.bias === 'bullish') { bullPoints += emaData.strength; reasons.push(`1H EMA stack bullish (${emaData.bullScore}/3 conditions)`); }
  else if (emaData.bias === 'bearish') { bearPoints += emaData.strength; reasons.push(`1H EMA stack bearish (${emaData.bearScore}/3 conditions)`); }
  else                                  { reasons.push('1H EMA mixed — no structural edge'); }

  // 2. Swing structure (weight: 2)
  const struct = swings.structure;
  if      (struct === 'bullish_structure') { bullPoints += 2; reasons.push('1H: Higher Highs + Higher Lows (bullish structure)'); }
  else if (struct === 'bearish_structure') { bearPoints += 2; reasons.push('1H: Lower Highs + Lower Lows (bearish structure)'); }
  else if (struct === 'consolidation')     { reasons.push('1H: Range compression — breakout pending'); }
  else if (struct === 'expansion')         { reasons.push('1H: Range expanding — increased volatility'); }

  // 3. Structure break / ChoCH (weight: 2)
  if (structBreak.type === 'bullish_break') {
    bullPoints += 2;
    reasons.push(`1H: Broke above swing high at ${structBreak.level} — bullish ChoCH`);
  } else if (structBreak.type === 'bearish_break') {
    bearPoints += 2;
    reasons.push(`1H: Broke below swing low at ${structBreak.level} — bearish ChoCH`);
  }

  // 4. Active FVG near price (weight: 1)
  const nearBullFVG = fvgs.bullish.find(f => f.nearPrice);
  const nearBearFVG = fvgs.bearish.find(f => f.nearPrice);
  if (nearBullFVG) { bullPoints += 1; reasons.push(`1H: Price near bullish FVG (${nearBullFVG.bottom}–${nearBullFVG.top})`); }
  if (nearBearFVG) { bearPoints += 1; reasons.push(`1H: Price near bearish FVG (${nearBearFVG.bottom}–${nearBearFVG.top})`); }

  const total = bullPoints + bearPoints;
  let bias;
  if      (bullPoints > bearPoints + 1) bias = 'bullish';
  else if (bearPoints > bullPoints + 1) bias = 'bearish';
  else                                   bias = 'neutral';

  // Strength 1–5 normalised
  const dominantScore = Math.max(bullPoints, bearPoints);
  const strength      = Math.min(5, Math.max(1, Math.round(dominantScore / 1.6)));

  return { bias, strength, bullPoints, bearPoints, reasons, ema: emaData, swings, fvgs, structureBreak: structBreak, atr14 };
}

// ── LTF Bias (15M) ────────────────────────────────────────────────────────────

function analyseLTF(candles15M) {
  if (!candles15M || candles15M.length < 25) {
    return { bias: 'neutral', strength: 0, reason: 'Insufficient 15M data', ema: null, fvgs: null };
  }

  const emaData = emaAlignment(candles15M);
  const swings  = detectSwings(candles15M, 2, 6);
  const fvgs    = detectFVGs(candles15M, 20);

  const reasons = [];
  let bullPoints = 0;
  let bearPoints = 0;

  if      (emaData.bias === 'bullish') { bullPoints += 2; reasons.push(`15M EMA bullish (${emaData.bullScore}/3)`); }
  else if (emaData.bias === 'bearish') { bearPoints += 2; reasons.push(`15M EMA bearish (${emaData.bearScore}/3)`); }

  const struct = swings.structure;
  if      (struct === 'bullish_structure') { bullPoints += 1; reasons.push('15M: HH+HL structure'); }
  else if (struct === 'bearish_structure') { bearPoints += 1; reasons.push('15M: LH+LL structure'); }

  const nearBullFVG = fvgs.bullish.find(f => f.nearPrice);
  const nearBearFVG = fvgs.bearish.find(f => f.nearPrice);
  if (nearBullFVG) { bullPoints += 1; reasons.push(`15M: Near demand FVG (${nearBullFVG.bottom}–${nearBullFVG.top})`); }
  if (nearBearFVG) { bearPoints += 1; reasons.push(`15M: Near supply FVG (${nearBearFVG.bottom}–${nearBearFVG.top})`); }

  let bias;
  if      (bullPoints > bearPoints) bias = 'bullish';
  else if (bearPoints > bullPoints) bias = 'bearish';
  else                               bias = 'neutral';

  const strength = Math.min(5, Math.max(1, Math.max(bullPoints, bearPoints)));

  return { bias, strength, bullPoints, bearPoints, reasons, ema: emaData, swings, fvgs };
}

// ── Key Levels ────────────────────────────────────────────────────────────────

/**
 * Extract actionable support/resistance from swing points and FVGs.
 */
function extractKeyLevels(htf, currentPrice) {
  const resistance = [];
  const support    = [];

  // Swing highs → resistance
  if (htf.swings?.highs) {
    htf.swings.highs.slice(-4).forEach(s => {
      if (s.price > currentPrice) resistance.push({ price: s.price, type: 'Swing High', tf: '1H' });
    });
  }

  // Swing lows → support
  if (htf.swings?.lows) {
    htf.swings.lows.slice(-4).forEach(s => {
      if (s.price < currentPrice) support.push({ price: s.price, type: 'Swing Low', tf: '1H' });
    });
  }

  // FVGs → zones
  if (htf.fvgs?.bearish) {
    htf.fvgs.bearish.filter(f => !f.mitigated && f.bottom > currentPrice).forEach(f => {
      resistance.push({ price: f.midpoint, type: 'Bearish FVG', tf: '1H', zone: [f.bottom, f.top] });
    });
  }
  if (htf.fvgs?.bullish) {
    htf.fvgs.bullish.filter(f => !f.mitigated && f.top < currentPrice).forEach(f => {
      support.push({ price: f.midpoint, type: 'Bullish FVG', tf: '1H', zone: [f.bottom, f.top] });
    });
  }

  // Sort: resistance ascending (nearest first), support descending (nearest first)
  resistance.sort((a, b) => a.price - b.price);
  support.sort((a, b) => b.price - a.price);

  return { resistance: resistance.slice(0, 5), support: support.slice(0, 5) };
}

// ── Confluence ────────────────────────────────────────────────────────────────

function confluenceBias(htfBias, ltfBias) {
  if (htfBias === ltfBias) return { bias: htfBias, confluence: 'strong', aligned: true };
  if (htfBias === 'neutral') return { bias: ltfBias, confluence: 'weak', aligned: false };
  if (ltfBias === 'neutral') return { bias: htfBias, confluence: 'moderate', aligned: false };
  // Conflicting — HTF wins
  return { bias: htfBias, confluence: 'conflicting', aligned: false };
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * @param {{ candles1H: array, candles15M: array }} input
 */
function determineBias({ candles1H, candles15M }) {
  const htf = analyseHTF(candles1H);
  const ltf = analyseLTF(candles15M);

  const currentPrice = candles1H?.length
    ? candles1H[candles1H.length - 1].close
    : null;

  const { bias, confluence, aligned } = confluenceBias(htf.bias, ltf.bias);
  const keyLevels = currentPrice ? extractKeyLevels(htf, currentPrice) : { resistance: [], support: [] };

  // Nearest support/resistance distance as % of price
  let distToResistance = null;
  let distToSupport    = null;
  if (currentPrice && keyLevels.resistance[0]) {
    distToResistance = parseFloat(((keyLevels.resistance[0].price - currentPrice) / currentPrice * 100).toFixed(2));
  }
  if (currentPrice && keyLevels.support[0]) {
    distToSupport = parseFloat(((currentPrice - keyLevels.support[0].price) / currentPrice * 100).toFixed(2));
  }

  return {
    bias,
    confluence,
    aligned,
    htf: {
      bias:     htf.bias,
      strength: htf.strength,
      reasons:  htf.reasons,
      ema:      htf.ema,
      structure: htf.swings?.structure ?? 'undefined',
      fvgCount: { bullish: htf.fvgs?.bullish?.length ?? 0, bearish: htf.fvgs?.bearish?.length ?? 0 },
      atr14:    htf.atr14,
      structureBreak: htf.structureBreak,
    },
    ltf: {
      bias:     ltf.bias,
      strength: ltf.strength,
      reasons:  ltf.reasons,
      ema:      ltf.ema,
      structure: ltf.swings?.structure ?? 'undefined',
      fvgCount: { bullish: ltf.fvgs?.bullish?.length ?? 0, bearish: ltf.fvgs?.bearish?.length ?? 0 },
    },
    keyLevels,
    distToResistance,
    distToSupport,
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = { determineBias };
