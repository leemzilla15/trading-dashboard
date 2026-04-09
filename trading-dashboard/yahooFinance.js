
  const axios = require(‘axios’);

const API_KEY = process.env.FINNHUB_API_KEY || ‘d7c3dk1r01quh9fcctv0d7c3dk1r01quh9fcctvg’;
const BASE = ‘https://finnhub.io/api/v1’;

const SYMBOLS = {
ES: ‘ES1!’,
NQ: ‘NQ1!’,
YM: ‘YM1!’
};

const VIX_SYMBOL = ‘VIX’;

function fmt(n, decimals = 2) {
if (n === null || n === undefined || isNaN(n)) return null;
return parseFloat(Number(n).toFixed(decimals));
}

function vixRegime(price) {
if (!price) return ‘UNKNOWN’;
if (price < 15) return ‘LOW’;
if (price < 20) return ‘MODERATE’;
if (price < 30) return ‘ELEVATED’;
return ‘EXTREME’;
}

async function getQuote(symbol) {
const res = await axios.get(`${BASE}/quote`, {
params: { symbol, token: API_KEY },
timeout: 8000
});
return res.data;
}

async function getFuturesQuotes() {
const keys = Object.keys(SYMBOLS);
const results = await Promise.allSettled(
Object.values(SYMBOLS).map(s => getQuote(s))
);

const futures = {};
results.forEach((result, i) => {
const key = keys[i];
if (result.status === ‘fulfilled’ && result.value && result.value.c) {
const q = result.value;
const change = fmt(q.c - q.pc);
const changePct = q.pc ? fmt(((q.c - q.pc) / q.pc) * 100) : null;
futures[key] = {
symbol: key,
price: fmt(q.c),
change,
changePct,
high: fmt(q.h),
low: fmt(q.l),
open: fmt(q.o),
previousClose: fmt(q.pc),
volume: null,
marketState: ‘REGULAR’,
lastUpdated: new Date().toISOString()
};
} else {
futures[key] = {
symbol: key,
price: null, change: null, changePct: null,
error: true, lastUpdated: new Date().toISOString()
};
}
});
return futures;
}

async function getVIX() {
const q = await getQuote(VIX_SYMBOL);
const price = fmt(q.c);
const change = fmt(q.c - q.pc);
const changePct = q.pc ? fmt(((q.c - q.pc) / q.pc) * 100) : null;
return {
symbol: ‘VIX’,
price,
change,
changePct,
high: fmt(q.h),
low: fmt(q.l),
open: fmt(q.o),
previousClose: fmt(q.pc),
regime: vixRegime(price),
lastUpdated: new Date().toISOString()
};
}

async function getOvernightLevels(symbol = ‘ES1!’) {
const now = Math.floor(Date.now() / 1000);
const from = now - 5 * 24 * 60 * 60;

const res = await axios.get(`${BASE}/stock/candle`, {
params: { symbol, resolution: ‘D’, from, to: now, token: API_KEY },
timeout: 8000
});

const d = res.data;
if (!d || d.s !== ‘ok’ || !d.c || d.c.length < 2) {
throw new Error(‘Not enough candle data for overnight levels’);
}

const idx = d.c.length - 2;
const high = fmt(d.h[idx]);
const low = fmt(d.l[idx]);
const midpoint = fmt((high + low) / 2);
const range = fmt(high - low);
const currentPrice = d.o[d.c.length - 1] || d.c[d.c.length - 1];
const positionInRange = range > 0 && currentPrice
? fmt(((currentPrice - low) / range) * 100, 1)
: null;

return {
symbol: ‘ES’,
high, low, midpoint, range, positionInRange,
date: new Date(d.t[idx] * 1000).toISOString().split(‘T’)[0],
lastUpdated: new Date().toISOString()
};
}

module.exports = { getFuturesQuotes, getVIX, getOvernightLevels };