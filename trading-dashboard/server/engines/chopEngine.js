/**
 * chopEngine.js
 *
 * Detects choppy / non-trending market conditions using 1H candles.
 *
 * CHOP SIGNALS (7 independent tests):
 *
 * 1. EMA COMPRESSION
 *    The 9, 21, and 50 EMAs are all bunched within a tight % band.
 *    When EMAs converge, price has no directional pull — pure chop.
 *
 * 2. EMA CROSSOVER COUNT
 *    How many times has price crossed the 9 EMA in the last 10 bars?
 *    Trending markets: 0-1 crosses. Chopping markets: 3+ crosses.
 *
 * 3. ADX (Average Directional Index)
 *    ADX < 20 = no trend, market is ranging.
 *    ADX < 15 = extremely choppy.
 *    ADX > 25 = trending, respect the direction.
 *
 * 4. CANDLE BODY RATIO
 *    Body = |close - open|. Range = high - low.
 *    Body/Range < 0.3 = lots of wicks, indecision candles = chop.
 *    Body/Range > 0.6 = conviction candles = trend.
 *
 * 5. ATR COMPRESSION
 *    Current ATR(14) vs ATR(14) from 10 bars ago.
 *    Shrinking ATR = range contraction = chop building.
 *    Expanding ATR = breakout potential or trend.
 *
 * 6. HIGH-LOW RANGE vs AVERAGE
 *    Today's range vs 5-day average range.
 *    Below 60% of average = tight, below-average movement = chop.
 *
 * 7. EMA 50 SLOPE FLATNESS
 *    If EMA50 has moved less than 0.1% over the last 5 bars, it's flat.
 *    Flat EMA50 = no macro trend = chop environment.
 *
 * COMPOSITE SCORE: 0-100
 *   0-30:  Trending — clear directional edge
 *   31-55: Mixed — be selective, look for high-conviction setups
 *   56-75: Choppy — reduce size, widen stops or sit out
 *   76-100: Extreme chop — do not trade
 *
 * LABEL: Trending | Mixed | Choppy | Extreme Chop
 */

const { ema, atr } = require('./technicalEngine');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return null;
  return parseFloat(n.toFixed(d));
}

// ── 1. EMA Compression ───────────────────────────────────────────────────────

function scoreEMACompression(closes, e9vals, e21vals, e50vals) {
  const last = closes.length - 1;
  const v9  = e9vals[last];
  const v21 = e21vals[last];
  const v50 = e50vals[last];

  if (!v9 || !v21 || !v50) return { score: 50, label: 'Unknown', detail: 'Insufficient EMA data', ema9: null, ema21: null, ema50: null };

  // Compression = max spread between EMAs as % of price
  const price   = closes[last];
  const spread  = Math.max(v9, v21, v50) - Math.min(v9, v21, v50);
  const spreadPct = (spread / price) * 100;

  // Also check 9/21 gap specifically — that's the most sensitive
  const nearGap = Math.abs(v9 - v21) / price * 100;

  let score, label;
  if      (spreadPct < 0.05) { score = 90; label = 'Extreme compression'; }
  else if (spreadPct < 0.15) { score = 75; label = 'Heavy compression'; }
  else if (spreadPct < 0.30) { score = 55; label = 'Moderate compression'; }
  else if (spreadPct < 0.50) { score = 30; label = 'Slight spread'; }
  else if (spreadPct < 0.80) { score = 15; label = 'Good separation'; }
  else                        { score = 5;  label = 'Strong separation'; }

  return {
    score,
    label,
    detail: `EMA spread: ${spreadPct.toFixed(3)}% of price | 9/21 gap: ${nearGap.toFixed(3)}%`,
    ema9:  fmt(v9),
    ema21: fmt(v21),
    ema50: fmt(v50),
    spreadPct: fmt(spreadPct, 3),
  };
}

// ── 2. EMA Crossover Count ───────────────────────────────────────────────────

function scoreEMACrossovers(closes, e9vals, lookbackBars = 12) {
  const start = Math.max(1, closes.length - lookbackBars);
  let crossovers = 0;

  for (let i = start; i < closes.length; i++) {
    const prevAbove = closes[i - 1] > e9vals[i - 1];
    const currAbove = closes[i]     > e9vals[i];
    if (prevAbove !== currAbove && e9vals[i] !== null && e9vals[i-1] !== null) {
      crossovers++;
    }
  }

  let score, label;
  if      (crossovers === 0) { score = 5;  label = 'No crossovers — clean trend'; }
  else if (crossovers === 1) { score = 15; label = 'One crossover — likely pull-back'; }
  else if (crossovers === 2) { score = 40; label = 'Two crossovers — getting choppy'; }
  else if (crossovers === 3) { score = 65; label = 'Three crossovers — choppy'; }
  else if (crossovers === 4) { score = 80; label = 'Four crossovers — very choppy'; }
  else                        { score = 95; label = `${crossovers} crossovers — extreme chop`; }

  return {
    score,
    label,
    detail: `Price crossed 9 EMA ${crossovers}x in last ${lookbackBars} bars`,
    crossovers,
    lookbackBars,
  };
}

// ── 3. ADX ───────────────────────────────────────────────────────────────────

/**
 * Wilder's ADX. Requires at least 2*period candles.
 * Returns ADX value and direction (+DI vs -DI).
 */
function calculateADX(candles, period = 14) {
  if (!candles || candles.length < period * 2) return null;

  const trueRanges = [];
  const plusDMs    = [];
  const minusDMs   = [];

  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const ph = candles[i-1].high;
    const pl = candles[i-1].low;
    const pc = candles[i-1].close;

    const tr     = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const plusDM = (h - ph) > (pl - l) ? Math.max(h - ph, 0) : 0;
    const minusDM = (pl - l) > (h - ph) ? Math.max(pl - l, 0) : 0;

    trueRanges.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  // Wilder Smoothing (RMA) — correct implementation
  // First value = sum of first `p` elements
  // Subsequent = prev * (p-1)/p + current
  function wilderSmooth(arr, p) {
    if (arr.length < p) return arr.map(() => null);
    const result = new Array(arr.length).fill(null);
    result[p - 1] = arr.slice(0, p).reduce((a, b) => a + b, 0);
    for (let i = p; i < arr.length; i++) {
      result[i] = result[i - 1] * (p - 1) / p + arr[i];
    }
    return result;
  }

  const sTR  = wilderSmooth(trueRanges, period);
  const sPDM = wilderSmooth(plusDMs,    period);
  const sMDM = wilderSmooth(minusDMs,   period);

  // Compute DX from smoothed values
  const dxs = [];
  for (let i = period - 1; i < sTR.length; i++) {
    const tr = sTR[i];
    if (!tr || tr === 0) { dxs.push(0); continue; }
    const pdi   = (sPDM[i] / tr) * 100;
    const mdi   = (sMDM[i] / tr) * 100;
    const diff  = Math.abs(pdi - mdi);
    const sum2  = pdi + mdi;
    dxs.push(sum2 === 0 ? 0 : (diff / sum2) * 100);
  }

  // ADX = Wilder smooth of DX values
  const adxArr  = wilderSmooth(dxs, period);
  const adxRaw  = adxArr[adxArr.length - 1];
  const adx     = adxRaw === null ? 0 : Math.min(100, Math.max(0, adxRaw));

  // Final +DI and -DI
  const lastIdx = sTR.length - 1;
  const lastTR  = sTR[lastIdx] || 1;
  const plusDI  = (sPDM[lastIdx] / lastTR) * 100;
  const minusDI = (sMDM[lastIdx] / lastTR) * 100;

  return {
    adx:     fmt(adx, 1),
    plusDI:  fmt(plusDI,  1),
    minusDI: fmt(minusDI, 1),
    direction: plusDI > minusDI ? 'bullish' : 'bearish',
  };
}

function scoreADX(candles) {
  const result = calculateADX(candles, 14);

  if (!result) return { score: 50, label: 'Unknown', detail: 'Insufficient data for ADX' };

  const { adx, plusDI, minusDI, direction } = result;
  let score, label;

  if      (adx < 10) { score = 95; label = 'No trend (ADX < 10) — pure chop'; }
  else if (adx < 15) { score = 80; label = 'Very weak trend (ADX < 15)'; }
  else if (adx < 20) { score = 60; label = 'Weak trend (ADX < 20) — choppy'; }
  else if (adx < 25) { score = 35; label = 'Developing trend (ADX 20-25)'; }
  else if (adx < 35) { score = 15; label = 'Trending (ADX 25-35)'; }
  else if (adx < 50) { score = 5;  label = 'Strong trend (ADX 35-50)'; }
  else               { score = 2;  label = 'Very strong trend (ADX > 50)'; }

  return {
    score,
    label,
    detail: `ADX: ${adx} | +DI: ${plusDI} | -DI: ${minusDI} | Direction: ${direction}`,
    adx,
    plusDI,
    minusDI,
    direction,
  };
}

// ── 4. Candle Body Ratio ──────────────────────────────────────────────────────

function scoreCandleBodyRatio(candles, lookbackBars = 10) {
  const slice = candles.slice(-lookbackBars).filter(c => (c.high - c.low) > 0);
  if (slice.length < 3) return { score: 50, label: 'Unknown', detail: 'Insufficient candles' };

  const ratios = slice.map(c => {
    const body  = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    return body / range;
  });

  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

  let score, label;
  if      (avgRatio < 0.20) { score = 90; label = 'Doji candles — strong indecision'; }
  else if (avgRatio < 0.30) { score = 70; label = 'Small bodies — lots of rejection'; }
  else if (avgRatio < 0.40) { score = 50; label = 'Moderate bodies — mixed conviction'; }
  else if (avgRatio < 0.55) { score = 30; label = 'Decent bodies — some conviction'; }
  else if (avgRatio < 0.70) { score = 15; label = 'Strong bodies — directional'; }
  else                       { score = 5;  label = 'Very strong bodies — high conviction'; }

  return {
    score,
    label,
    detail: `Avg body/range ratio: ${(avgRatio * 100).toFixed(1)}% over last ${slice.length} bars`,
    avgBodyRatio: fmt(avgRatio, 3),
    lookbackBars: slice.length,
  };
}

// ── 5. ATR Compression ───────────────────────────────────────────────────────

function scoreATRCompression(candles) {
  if (!candles || candles.length < 30) return { score: 50, label: 'Unknown', detail: 'Insufficient data' };

  const closes = candles.map(c => c.close);

  // Current ATR vs ATR from 10 bars ago
  const currentATR = atr(candles, 14);
  const oldSlice   = candles.slice(0, -10);
  const oldATR     = oldSlice.length >= 14 ? atr(oldSlice, 14) : null;

  if (!currentATR || !oldATR) return { score: 50, label: 'Unknown', detail: 'ATR unavailable' };

  const atrRatio = currentATR / oldATR; // < 1 = compressing, > 1 = expanding

  let score, label;
  if      (atrRatio < 0.5)  { score = 85; label = 'Heavy ATR compression (>50% shrink)'; }
  else if (atrRatio < 0.7)  { score = 65; label = 'Moderate ATR compression'; }
  else if (atrRatio < 0.85) { score = 45; label = 'Slight ATR compression'; }
  else if (atrRatio < 1.15) { score = 25; label = 'ATR stable — normal conditions'; }
  else if (atrRatio < 1.4)  { score = 15; label = 'ATR expanding — momentum building'; }
  else                       { score = 5;  label = 'ATR surging — strong directional move'; }

  return {
    score,
    label,
    detail: `ATR now: ${currentATR.toFixed(2)} | ATR 10 bars ago: ${oldATR.toFixed(2)} | Ratio: ${atrRatio.toFixed(2)}`,
    currentATR: fmt(currentATR),
    oldATR:     fmt(oldATR),
    atrRatio:   fmt(atrRatio, 3),
    expanding:  atrRatio > 1.0,
  };
}

// ── 6. Range vs Average ───────────────────────────────────────────────────────

function scoreRangeVsAverage(candles, lookback = 10) {
  if (!candles || candles.length < lookback + 3) return { score: 50, label: 'Unknown', detail: 'Insufficient data' };

  const recent    = candles.slice(-lookback - 1, -1); // last N bars excluding today
  const todayBar  = candles[candles.length - 1];
  const todayRange = todayBar.high - todayBar.low;
  const avgRange   = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;

  if (avgRange === 0) return { score: 50, label: 'Unknown', detail: 'Zero average range' };

  const rangeRatio = todayRange / avgRange;

  let score, label;
  if      (rangeRatio < 0.35) { score = 90; label = 'Extremely tight range vs average'; }
  else if (rangeRatio < 0.50) { score = 70; label = 'Very tight range'; }
  else if (rangeRatio < 0.70) { score = 50; label = 'Below-average range'; }
  else if (rangeRatio < 0.90) { score = 30; label = 'Near average range'; }
  else if (rangeRatio < 1.20) { score = 15; label = 'Average to above-average range'; }
  else                         { score = 5;  label = 'Wide range — high participation'; }

  return {
    score,
    label,
    detail: `Today range: ${todayRange.toFixed(2)} pts | Avg (${lookback} bars): ${avgRange.toFixed(2)} pts | Ratio: ${rangeRatio.toFixed(2)}`,
    todayRange:  fmt(todayRange),
    avgRange:    fmt(avgRange),
    rangeRatio:  fmt(rangeRatio, 3),
  };
}

// ── 7. EMA 50 Slope ───────────────────────────────────────────────────────────

function scoreEMASlope(closes, e50vals, lookbackBars = 5) {
  const last    = closes.length - 1;
  const current = e50vals[last];
  const prev    = e50vals[Math.max(0, last - lookbackBars)];

  if (!current || !prev) return { score: 50, label: 'Unknown', detail: 'EMA50 unavailable' };

  const slopePct = Math.abs((current - prev) / prev) * 100;
  const direction = current > prev ? 'rising' : current < prev ? 'falling' : 'flat';

  let score, label;
  if      (slopePct < 0.05)  { score = 90; label = 'Flat EMA50 — no macro trend'; }
  else if (slopePct < 0.10)  { score = 65; label = 'Nearly flat EMA50'; }
  else if (slopePct < 0.20)  { score = 40; label = 'Slight EMA50 slope'; }
  else if (slopePct < 0.40)  { score = 20; label = 'Moderate EMA50 slope'; }
  else                        { score = 5;  label = 'Strong EMA50 slope — clear trend'; }

  return {
    score,
    label,
    detail: `EMA50 moved ${slopePct.toFixed(3)}% over ${lookbackBars} bars (${direction})`,
    slopePct:  fmt(slopePct, 3),
    direction,
  };
}

// ── Composite ─────────────────────────────────────────────────────────────────

function compositeLabel(score) {
  if (score >= 76) return { label: 'Extreme Chop',  color: '#ef4444', emoji: '🔴', action: 'Do not trade — no edge in this environment' };
  if (score >= 56) return { label: 'Choppy',         color: '#f97316', emoji: '🟠', action: 'Reduce size — only A+ setups, widen stops' };
  if (score >= 31) return { label: 'Mixed',           color: '#eab308', emoji: '🟡', action: 'Be selective — wait for clear confirmation' };
  return                   { label: 'Trending',       color: '#22c55e', emoji: '🟢', action: 'Look for entries — trend is your friend' };
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * @param {Array} candles1H — hourly OHLCV candle array, oldest first
 * @returns {object} Full chop analysis
 */
function detectChop(candles1H) {
  if (!candles1H || candles1H.length < 55) {
    return {
      score: 50, label: 'Mixed', color: '#eab308', emoji: '🟡',
      action: 'Insufficient hourly data for chop analysis',
      tests: {}, lastUpdated: new Date().toISOString(),
    };
  }

  const closes = candles1H.map(c => c.close);
  const e9vals  = ema(closes, 9);
  const e21vals = ema(closes, 21);
  const e50vals = ema(closes, 50);

  // Run all 7 tests
  const tests = {
    emaCompression: scoreEMACompression(closes, e9vals, e21vals, e50vals),
    emaCrossovers:  scoreEMACrossovers(closes, e9vals, 12),
    adx:            scoreADX(candles1H),
    candleBody:     scoreCandleBodyRatio(candles1H, 10),
    atrCompression: scoreATRCompression(candles1H),
    rangeVsAvg:     scoreRangeVsAverage(candles1H, 10),
    ema50Slope:     scoreEMASlope(closes, e50vals, 5),
  };

  // Weighted average — ADX and EMA compression are the most reliable
  const weights = {
    emaCompression: 0.20,
    emaCrossovers:  0.15,
    adx:            0.25,  // heaviest — ADX is the gold standard
    candleBody:     0.10,
    atrCompression: 0.15,
    rangeVsAvg:     0.10,
    ema50Slope:     0.05,
  };

  let weightedScore = 0;
  for (const [key, weight] of Object.entries(weights)) {
    weightedScore += (tests[key].score || 50) * weight;
  }

  const score = Math.round(weightedScore);
  const meta  = compositeLabel(score);

  // Which tests are signaling chop vs trend?
  const chopSignals  = Object.entries(tests).filter(([,t]) => t.score >= 60).map(([k]) => k);
  const trendSignals = Object.entries(tests).filter(([,t]) => t.score <= 25).map(([k]) => k);

  return {
    score,
    label:  meta.label,
    color:  meta.color,
    emoji:  meta.emoji,
    action: meta.action,
    chopSignals,
    trendSignals,
    isChoppy: score >= 56,
    isTrending: score <= 30,
    tests,
    // Summary for display
    adxValue:      tests.adx.adx,
    adxDirection:  tests.adx.direction,
    ema9:          tests.emaCompression.ema9,
    ema21:         tests.emaCompression.ema21,
    ema50:         tests.emaCompression.ema50,
    spreadPct:     tests.emaCompression.spreadPct,
    crossovers12h: tests.emaCrossovers.crossovers,
    currentATR:    tests.atrCompression.currentATR,
    lastUpdated:   new Date().toISOString(),
  };
}

module.exports = { detectChop, calculateADX };
