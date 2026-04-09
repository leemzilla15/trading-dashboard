const yahooFinance = require(‘yahoo-finance2’);
const yf = yahooFinance.default || yahooFinance;

try {
yf.setGlobalConfig({ validation: { logErrors: false } });
} catch(e) {}

const FUTURES_SYMBOLS = { ES: ‘ES=F’, NQ: ‘NQ=F’, YM: ‘YM=F’ };
const VIX_SYMBOL = ‘^VIX’;

function fmt(n, decimals = 2) {
if (n === null || n === undefined || isNaN(n)) return null;
return parseFloat(n.toFixed(decimals));
}

function vixRegime(price) {
if (price === null) return ‘UNKNOWN’;
if (price < 15)    return ‘LOW’;
if (price < 20)    return ‘MODERATE’;
if (price < 30)    return ‘ELEVATED’;
return ‘EXTREME’;
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
marketState:   raw.marketState ?? ‘UNKNOWN’,
lastUpdated:   new Date().toISOString(),
};
}

async function getFuturesQuotes() {
const symbols = Object.values(FUTURES_SYMBOLS);
const keys    = Object.keys(FUTURES_SYMBOLS);
const results = await Promise.allSettled(symbols.map(s => yf.quote(s)));
const futures = {};
results.forEach((result, i) => {
const key = keys[i];
if (result.status === ‘fulfilled’ && result.value) {
futures[key] = normalizeQuote(symbols[i], key, result.value);
} else {
futures[key] = {
symbol: key, rawSymbol: symbols[i],
price: null, change: null, changePct: null,
error: true, lastUpdated: new Date().toISOString(),
};
}
});
return futures;
}

async function getVIX() {
const raw = await yf.quote(VIX_SYMBOL);
const price = fmt(raw.regularMarketPrice);
return {
symbol: ‘VIX’,
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

async function getOvernightLevels(symbol = ‘ES=F’) {
const twoDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const now        = new Date();
const result = await yf.chart(symbol, {
period1:  twoDaysAgo,
period2:  now,
interval: ‘1d’,
});
const quotes = result?.quotes ?? [];
const valid = quotes.filter(q => q.high !== null && q.low !== null);
if (valid.length < 2) {
throw new Error(‘Not enough OHLC bars for ’ + symbol + ’ (got ’ + valid.length + ‘)’);
}
const yesterday  = valid[valid.length - 2];
const todayBar   = valid[valid.length - 1];
const high      = fmt(yesterday.high);
const low       = fmt(yesterday.low);
const midpoint  = fmt((high + low) / 2);
const range     = fmt(high - low);
const currentPrice = todayBar.open ?? todayBar.close;
const positionInRange = (range > 0 && currentPrice !== null)
? fmt(((currentPrice - low) / range) * 100, 1)
: null;
return {
symbol:          symbol.replace(’=F’, ‘’),
high, low, midpoint, range, positionInRange,
date:            yesterday.date?.toISOString().split(‘T’)[0] ?? null,
lastUpdated:     new Date().toISOString(),
};
}

module.exports = { getFuturesQuotes, getVIX, getOvernightLevels };
