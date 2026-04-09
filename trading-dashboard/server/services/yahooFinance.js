/**
 * yahooFinance.js
 *
 * Wraps the yahoo-finance2 npm package (unofficial but reliable).
 * No API key required. Rate limits are generous for dashboard use.
 *
 * Symbols used:
 *   ES=F  — S&P 500 E-mini futures
 *   NQ=F  — Nasdaq-100 E-mini futures
 *   YM=F  — Dow Jones E-mini futures
 *   ^VIX  — CBOE Volatility Index
 */

const yf = require('yahoo-finance2');
const yfdefault = yf.default || yf;

// Suppress yahoo-finance2 validation warnings in console
yfDefault.setGlobalConfig({ validation: { logErrors: false } });

const FUTURES_SYMBOLS = { ES: 'ES=F', NQ: 'NQ=F', YM: 'YM=F' };
const VIX_SYMBOL = '^VIX';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return parseFloat(n.toFixed(decimals));
}

function vixRegime(price) {
  if (price === null) return 'UNKNOWN';
  if (price < 15)    return 'LOW';
  if (price < 20)    return 'MODERATE';
  if (price < 30)    return 'ELEVATED';
  return 'EXTREME';
}

function normalizeQuote(symbol, key, raw) {
  return {
    symbol: key,
    rawSymbol: symbol,
    price:         fmt(raw.regularMarketPrice),
    change:        fmt(raw.regularMarketChange),
    changePct:     fmt(raw.regularMarketChangePercent),
    high:          fmt(raw.regularMarketDayHigh),
    low:           fmt(raw.regularMarketDayLow),
    open:          fmt(raw.regularMarketOpen),
    previousClose: fmt(raw.regularMarketPreviousClose),
    volume:        raw.regularMarketVolume ?? null,
    marketState:   raw.marketState ?? 'UNKNOWN',
    lastUpdated:   new Date().toISOString(),
  };
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Fetch ES, NQ, YM quotes in a single batch.
 * Returns an object keyed by symbol shorthand: { ES: {...}, NQ: {...}, YM: {...} }
 */
async function getFuturesQuotes() {
  const symbols = Object.values(FUTURES_SYMBOLS);
  const keys    = Object.keys(FUTURES_SYMBOLS);

  // Promise.allSettled so one bad symbol doesn't kill the whole request
  const results = await Promise.allSettled(symbols.map(s => yfDefault.quote(s)));

  const futures = {};
  results.forEach((result, i) => {
    const key = keys[i];
    if (result.status === 'fulfilled' && result.value) {
      futures[key] = normalizeQuote(symbols[i], key, result.value);
    } else {
      console.warn(`[Yahoo] Failed to fetch ${symbols[i]}:`, result.reason?.message);
      futures[key] = {
        symbol: key, rawSymbol: symbols[i],
        price: null, change: null, changePct: null,
        error: true, lastUpdated: new Date().toISOString(),
      };
    }
  });

  return futures;
}

/**
 * Fetch VIX quote.
 */
async function getVIX() {
  const raw = await yfDefault.quote(VIX_SYMBOL);
  const price = fmt(raw.regularMarketPrice);
  return {
    symbol: 'VIX',
    price,
    change:        fmt(raw.regularMarketChange),
    changePct:     fmt(raw.regularMarketChangePercent),
    high:          fmt(raw.regularMarketDayHigh),
    low:           fmt(raw.regularMarketDayLow),
    open:          fmt(raw.regularMarketOpen),
    previousClose: fmt(raw.regularMarketPreviousClose),
    regime:        vixRegime(price),
    lastUpdated:   new Date().toISOString(),
  };
}

/**
 * Compute overnight session levels from yesterday's OHLC bar.
 * Uses the chart endpoint for historical daily bars.
 */
async function getOvernightLevels(symbol = 'ES=F') {
  const twoDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // buffer for weekends
  const now        = new Date();

  const result = await yf.chart(symbol, {
    period1:  twoDaysAgo,
    period2:  now,
    interval: '1d',
  });

  const quotes = result?.quotes ?? [];
  // Filter out bars with null OHLC (can happen with incomplete today bar)
  const valid = quotes.filter(q => q.high !== null && q.low !== null);

  if (valid.length < 2) {
    throw new Error(`Not enough OHLC bars for ${symbol} (got ${valid.length})`);
  }

  // Yesterday = second-to-last valid bar
  const yesterday  = valid[valid.length - 2];
  const todayBar   = valid[valid.length - 1];

  const high      = fmt(yesterday.high);
  const low       = fmt(yesterday.low);
  const midpoint  = fmt((high + low) / 2);
  const range     = fmt(high - low);

  // Where is today's open relative to the overnight range? (0% = at low, 100% = at high)
  const currentPrice = todayBar.open ?? todayBar.close;
  const positionInRange = (range > 0 && currentPrice !== null)
    ? fmt(((currentPrice - low) / range) * 100, 1)
    : null;

  return {
    symbol:          symbol.replace('=F', ''),
    high,
    low,
    midpoint,
    range,
    positionInRange,  // 0–100 — where today's price sits inside yesterday's range
    date:            yesterday.date?.toISOString().split('T')[0] ?? null,
    lastUpdated:     new Date().toISOString(),
  };
}

module.exports = { getFuturesQuotes, getVIX, getOvernightLevels };
