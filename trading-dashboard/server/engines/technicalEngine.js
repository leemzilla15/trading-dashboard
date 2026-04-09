/**
 * technicalEngine.js
 *
 * Pure calculation functions. No I/O. Takes candle arrays, returns derived data.
 *
 * Functions exposed:
 *   ema(closes, period)              → number[]
 *   emaAlignment(candles)            → { bias, ema9, ema21, ema50, aligned }
 *   detectSwings(candles, lookback)  → { highs[], lows[], structure }
 *   detectFVGs(candles, maxAge)      → { bullish[], bearish[] }
 *   atr(candles, period)             → number   (Average True Range)
 *   priceVsEma(price, emaVal)        → 'above' | 'below' | 'inside'
 *
 * All candle arrays are expected as: [{open,high,low,close,time}, ...]
 * sorted oldest → newest (index 0 = oldest).
 */

// ── EMA ───────────────────────────────────────────────────────────────────────

/**
 * Calculate Exponential Moving Average.
 * Returns an array the same length as `closes`, with null for
 * positions before enough data exists.
 */
function ema(closes, period) {
  if (!closes || closes.length < period) return closes.map(() => null);

  const k      = 2 / (period + 1);
  const result = new Array(closes.length).fill(null);

  // Seed with simple average of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = parseFloat((sum / period).toFixed(4));

  for (let i = period; i < closes.length; i++) {
    result[i] = parseFloat(((closes[i] - result[i - 1]) * k + result[i - 1]).toFixed(4));
  }
  return result;
}

/**
 * EMA alignment analysis — the single most important structure read.
 *
 * Returns:
 *   bias:     'bullish' | 'bearish' | 'neutral'
 *   aligned:  true if all three EMAs are stacked in order
 *   strength: 0–3 (how many of 3 conditions are met)
 *   ema9/21/50: current (last bar) values
 */
function emaAlignment(candles) {
  if (!candles || candles.length < 51) {
    return { bias: 'neutral', aligned: false, strength: 0, ema9: null, ema21: null, ema50: null };
  }

  const closes = candles.map(c => c.close);
  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);

  const last = candles.length - 1;
  const price = closes[last];
  const v9  = e9[last];
  const v21 = e21[last];
  const v50 = e50[last];

  if (!v9 || !v21 || !v50) {
    return { bias: 'neutral', aligned: false, strength: 0, ema9: v9, ema21: v21, ema50: v50 };
  }

  // Count bullish conditions
  const bullConditions = [
    price > v50,   // price above long-term
    v9 > v21,      // short > medium
    v21 > v50,     // medium > long
  ];
  const bearConditions = [
    price < v50,
    v9 < v21,
    v21 < v50,
  ];

  const bullScore = bullConditions.filter(Boolean).length;
  const bearScore = bearConditions.filter(Boolean).length;

  let bias;
  if      (bullScore === 3) bias = 'bullish';
  else if (bearScore === 3) bias = 'bearish';
  else if (bullScore >= 2)  bias = 'bullish';  // 2/3 = lean bullish
  else if (bearScore >= 2)  bias = 'bearish';
  else                      bias = 'neutral';

  const aligned   = bullScore === 3 || bearScore === 3;
  const strength  = Math.max(bullScore, bearScore);

  // EMA slope (last 3 bars) — is it still moving in the bias direction?
  const e50Slope = v50 - e50[last - 3 < 0 ? 0 : last - 3];
  const slopeDir = e50Slope > 0 ? 'rising' : e50Slope < 0 ? 'falling' : 'flat';

  return {
    bias,
    aligned,
    strength,
    bullScore,
    bearScore,
    ema9:  parseFloat(v9.toFixed(2)),
    ema21: parseFloat(v21.toFixed(2)),
    ema50: parseFloat(v50.toFixed(2)),
    ema50Slope: slopeDir,
    price: parseFloat(price.toFixed(2)),
  };
}

// ── Swing Highs / Lows ────────────────────────────────────────────────────────

/**
 * Detect swing highs and lows using a n-bar fractal.
 * A swing high at bar[i]: bar[i].high is the highest in the window
 *   [i-lookback … i+lookback].
 * A swing low at bar[i]: bar[i].low is the lowest in the same window.
 *
 * We skip the last `lookback` bars because they don't have enough
 * right-side confirmation yet.
 *
 * Returns the last N confirmed swings and a structural label.
 */
function detectSwings(candles, lookback = 3, maxSwings = 10) {
  if (!candles || candles.length < lookback * 2 + 1) {
    return { highs: [], lows: [], structure: 'insufficient_data' };
  }

  const highs = [];
  const lows  = [];

  // Stop before the last `lookback` bars (no right confirmation)
  const end = candles.length - lookback;

  for (let i = lookback; i < end; i++) {
    const c = candles[i];

    // Check swing high
    let isSwingHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].high >= c.high) { isSwingHigh = false; break; }
    }
    if (isSwingHigh) highs.push({ price: c.high, time: c.time, index: i });

    // Check swing low
    let isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].low <= c.low) { isSwingLow = false; break; }
    }
    if (isSwingLow) lows.push({ price: c.low, time: c.time, index: i });
  }

  // Keep only the most recent N swings
  const recentHighs = highs.slice(-maxSwings);
  const recentLows  = lows.slice(-maxSwings);

  // ── Market structure ──────────────────────────────────────────────────────
  // Require at least 2 of each to classify
  const structure = classifyStructure(recentHighs, recentLows);

  return { highs: recentHighs, lows: recentLows, structure };
}

/**
 * Classify market structure from arrays of swing points.
 *
 * Bullish: HH + HL  (higher highs, higher lows)
 * Bearish: LH + LL  (lower highs, lower lows)
 * Ranging: mixed
 */
function classifyStructure(highs, lows) {
  if (highs.length < 2 || lows.length < 2) return 'undefined';

  const lastTwoHighs = highs.slice(-2);
  const lastTwoLows  = lows.slice(-2);

  const higherHigh  = lastTwoHighs[1].price > lastTwoHighs[0].price;
  const higherLow   = lastTwoLows[1].price  > lastTwoLows[0].price;
  const lowerHigh   = lastTwoHighs[1].price < lastTwoHighs[0].price;
  const lowerLow    = lastTwoLows[1].price  < lastTwoLows[0].price;

  if (higherHigh && higherLow) return 'bullish_structure';   // HH + HL
  if (lowerHigh  && lowerLow)  return 'bearish_structure';   // LH + LL
  if (higherHigh && lowerLow)  return 'expansion';           // expanding range
  if (lowerHigh  && higherLow) return 'consolidation';       // contracting range
  return 'neutral';
}

// ── Fair Value Gaps ───────────────────────────────────────────────────────────

/**
 * Fair Value Gap (FVG) — a 3-candle imbalance pattern.
 *
 * Bullish FVG (demand zone):
 *   candle[i-2].high < candle[i].low
 *   (gap between the top of two-candles-ago and bottom of current candle)
 *   Price should respect this zone as support.
 *
 * Bearish FVG (supply zone):
 *   candle[i-2].low > candle[i].high
 *   Price should respect this zone as resistance.
 *
 * `maxAge` — only return FVGs from the last N candles
 * FVGs are "mitigated" (filled) if price has since traded through them.
 */
function detectFVGs(candles, maxAge = 30) {
  if (!candles || candles.length < 3) return { bullish: [], bearish: [] };

  const bullish = [];
  const bearish = [];

  const start = Math.max(2, candles.length - maxAge - 2);
  const last  = candles[candles.length - 1];
  const currentPrice = last.close;

  for (let i = start + 2; i < candles.length; i++) {
    const prev2 = candles[i - 2];  // candle before the impulse
    const prev1 = candles[i - 1];  // impulse candle (ignored in gap calc)
    const curr  = candles[i];      // candle after the impulse

    // Bullish FVG: gap between high of prev2 and low of curr
    if (prev2.high < curr.low) {
      const top    = curr.low;
      const bottom = prev2.high;
      const mid    = (top + bottom) / 2;
      // Mitigated if price has since traded into the gap
      const mitigated = candles.slice(i + 1).some(c => c.low <= mid);
      const nearPrice = !mitigated && Math.abs(currentPrice - mid) / currentPrice < 0.005; // within 0.5%

      bullish.push({
        top:       parseFloat(top.toFixed(2)),
        bottom:    parseFloat(bottom.toFixed(2)),
        midpoint:  parseFloat(mid.toFixed(2)),
        time:      curr.time,
        index:     i,
        mitigated,
        nearPrice,
        sizePoints: parseFloat((top - bottom).toFixed(2)),
      });
    }

    // Bearish FVG: gap between low of prev2 and high of curr
    if (prev2.low > curr.high) {
      const top    = prev2.low;
      const bottom = curr.high;
      const mid    = (top + bottom) / 2;
      const mitigated = candles.slice(i + 1).some(c => c.high >= mid);
      const nearPrice = !mitigated && Math.abs(currentPrice - mid) / currentPrice < 0.005;

      bearish.push({
        top:       parseFloat(top.toFixed(2)),
        bottom:    parseFloat(bottom.toFixed(2)),
        midpoint:  parseFloat(mid.toFixed(2)),
        time:      curr.time,
        index:     i,
        mitigated,
        nearPrice,
        sizePoints: parseFloat((top - bottom).toFixed(2)),
      });
    }
  }

  // Return only unmitigated FVGs, most recent first
  const activeBull = bullish.filter(f => !f.mitigated).slice(-5).reverse();
  const activeBear = bearish.filter(f => !f.mitigated).slice(-5).reverse();

  return { bullish: activeBull, bearish: activeBear };
}

// ── Average True Range ────────────────────────────────────────────────────────

/**
 * ATR over `period` bars.
 * Returns the current ATR value (last bar).
 */
function atr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high  = candles[i].high;
    const low   = candles[i].low;
    const pClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - pClose), Math.abs(low - pClose)));
  }

  // Wilder's smoothing (same as traditional ATR)
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }

  return parseFloat(atrVal.toFixed(2));
}

/**
 * Where is `price` relative to `emaVal`?
 * Tolerance: within 0.1% = 'inside' (price is at the EMA)
 */
function priceVsEma(price, emaVal) {
  if (!price || !emaVal) return 'unknown';
  const pct = (price - emaVal) / emaVal;
  if (pct >  0.001) return 'above';
  if (pct < -0.001) return 'below';
  return 'inside';
}

// ── Structure break detection ─────────────────────────────────────────────────

/**
 * Check if the most recent candles broke above the last swing high
 * or below the last swing low — a Change of Character (ChoCH) signal.
 */
function detectStructureBreak(candles, swings) {
  if (!candles?.length || !swings?.highs?.length || !swings?.lows?.length) {
    return { type: 'none', level: null };
  }

  const currentClose = candles[candles.length - 1].close;
  const lastHigh     = swings.highs[swings.highs.length - 1]?.price;
  const lastLow      = swings.lows[swings.lows.length  - 1]?.price;

  if (currentClose > lastHigh) return { type: 'bullish_break', level: lastHigh };
  if (currentClose < lastLow)  return { type: 'bearish_break', level: lastLow  };
  return { type: 'none', level: null };
}

module.exports = {
  ema,
  emaAlignment,
  detectSwings,
  detectFVGs,
  atr,
  priceVsEma,
  detectStructureBreak,
  classifyStructure,
};
