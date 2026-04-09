/**
 * priceHistory.js
 *
 * Fetches intraday OHLC bars from Yahoo Finance for technical analysis.
 * Used by the bias and trading-day engines — never called directly by routes.
 *
 * 1H  bars → last 10 days  → HTF structure, EMA, swing detection
 * 15M bars → last 5 days   → LTF confirmation, FVG detection
 *
 * Yahoo Finance chart intervals: 1m 2m 5m 15m 30m 60m 90m 1h 1d 1wk 1mo
 * Max lookback for intraday: 60d for ≤1h, 7d for ≤15m (unofficial limit)
 */

const yf = require('yahoo-finance2').default;

yf.setGlobalConfig({ validation: { logErrors: false } });

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return null;
  return parseFloat(n.toFixed(d));
}

/**
 * Normalise raw Yahoo chart quotes into clean OHLCV objects.
 * Filters out any bar where open/high/low/close is null (partial bars).
 */
function normaliseCandles(rawQuotes) {
  return rawQuotes
    .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
    .map(q => ({
      time:   q.date instanceof Date ? q.date.toISOString() : q.date,
      open:   fmt(q.open),
      high:   fmt(q.high),
      low:    fmt(q.low),
      close:  fmt(q.close),
      volume: q.volume ?? null,
    }));
}

/**
 * Fetch 1-hour bars for ES futures.
 * @param {number} lookbackDays  — how many calendar days back (default 12)
 * @returns {Promise<Array<{time,open,high,low,close,volume}>>}
 */
async function get1HCandles(symbol = 'ES=F', lookbackDays = 12) {
  const result = await yf.chart(symbol, {
    period1:  daysAgo(lookbackDays),
    period2:  new Date(),
    interval: '1h',
  });
  return normaliseCandles(result?.quotes ?? []);
}

/**
 * Fetch 15-minute bars for ES futures.
 * Yahoo restricts 15m data to ~60 days but we only need 5.
 * @returns {Promise<Array<{time,open,high,low,close,volume}>>}
 */
async function get15MCandles(symbol = 'ES=F', lookbackDays = 5) {
  const result = await yf.chart(symbol, {
    period1:  daysAgo(lookbackDays),
    period2:  new Date(),
    interval: '15m',
  });
  return normaliseCandles(result?.quotes ?? []);
}

module.exports = { get1HCandles, get15MCandles };
