const axios = require('axios');
const KEY = process.env.FINNHUB_API_KEY || 'd7c3dk1r01quh9fcctv0d7c3dk1r01quh9fcctvg';
const BASE = 'https://finnhub.io/api/v1';
const SCALE = 10.0; // SPY to ES approximation

function daysAgo(n) {
  return Math.floor((Date.now() - n * 24 * 60 * 60 * 1000) / 1000);
}

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return null;
  return parseFloat(Number(n).toFixed(d));
}

async function getCandles(resolution, fromDays) {
  const from = daysAgo(fromDays);
  const to = Math.floor(Date.now() / 1000);
  try {
    const res = await axios.get(BASE + '/stock/candle', {
      params: { symbol: 'SPY', resolution, from, to, token: KEY },
      timeout: 10000
    });
    const d = res.data;
    if (!d || d.s !== 'ok' || !d.c) return [];
    return d.t.map((t, i) => ({
      time: new Date(t * 1000).toISOString(),
      open:   fmt(d.o[i] * SCALE),
      high:   fmt(d.h[i] * SCALE),
      low:    fmt(d.l[i] * SCALE),
      close:  fmt(d.c[i] * SCALE),
      volume: d.v ? d.v[i] : null
    })).filter(c => c.open && c.high && c.low && c.close);
  } catch(e) {
    return [];
  }
}

async function get1HCandles() {
  return getCandles('60', 12);
}

async function get15MCandles() {
  return getCandles('15', 5);
}

module.exports = { get1HCandles, get15MCandles };
