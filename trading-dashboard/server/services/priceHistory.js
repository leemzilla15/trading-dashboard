const axios = require(‘axios’);

const API_KEY = process.env.FINNHUB_API_KEY || ‘d7c3dk1r01quh9fcctv0d7c3dk1r01quh9fcctvg’;
const BASE = ‘https://finnhub.io/api/v1’;

function daysAgo(n) {
return Math.floor((Date.now() - n * 24 * 60 * 60 * 1000) / 1000);
}

function fmt(n, d = 2) {
if (n == null || isNaN(n)) return null;
return parseFloat(Number(n).toFixed(d));
}

async function getCandles(symbol, resolution, fromDays) {
const from = daysAgo(fromDays);
const to = Math.floor(Date.now() / 1000);
const res = await axios.get(`${BASE}/stock/candle`, {
params: { symbol, resolution, from, to, token: API_KEY },
timeout: 10000
});
const d = res.data;
if (!d || d.s !== ‘ok’ || !d.c) return [];
return d.t.map((t, i) => ({
time: new Date(t * 1000).toISOString(),
open: fmt(d.o[i]),
high: fmt(d.h[i]),
low: fmt(d.l[i]),
close: fmt(d.c[i]),
volume: d.v ? d.v[i] : null
})).filter(c => c.open && c.high && c.low && c.close);
}

async function get1HCandles(symbol = ‘ES1!’) {
return getCandles(symbol, ‘60’, 12);
}

async function get15MCandles(symbol = ‘ES1!’) {
return getCandles(symbol, ‘15’, 5);
}

module.exports = { get1HCandles, get15MCandles };