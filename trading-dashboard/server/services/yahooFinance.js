const axios = require('axios');
const KEY = process.env.FINNHUB_API_KEY || 'd7c3dk1r01quh9fcctv0d7c3dk1r01quh9fcctvg';
const BASE = 'https://finnhub.io/api/v1';

async function getQ(sym) {
  const r = await axios.get(BASE + '/quote', {
    params: { symbol: sym, token: KEY },
    timeout: 8000
  });
  return r.data;
}

function calcChange(c, pc) {
  if (!c || !pc) return { change: 0, changePct: 0 };
  return {
    change: parseFloat((c - pc).toFixed(2)),
    changePct: parseFloat(((c - pc) / pc * 100).toFixed(2))
  };
}

async function getFuturesQuotes() {
  const symbols = [
    { key: 'ES', sym: 'ESM2025', fallback: 'ES1!' },
    { key: 'NQ', sym: 'NQM2025', fallback: 'NQ1!' },
    { key: 'YM', sym: 'YMM2025', fallback: 'YM1!' }
  ];

  const out = {};

  for (const { key, sym, fallback } of symbols) {
    let q = null;
    for (const s of [sym, fallback, 'BINANCE:' + key + 'USDT']) {
      try {
        const data = await getQ(s);
        if (data && data.c && data.c > 0) { q = data; break; }
      } catch (e) {}
    }

    if (q && q.c > 0) {
      const { change, changePct } = calcChange(q.c, q.pc);
      out[key] = {
        symbol: key,
        price: q.c,
        change,
        changePct,
        high: q.h,
        low: q.l,
        open: q.o,
        previousClose: q.pc,
        volume: null,
        marketState: 'REGULAR',
        lastUpdated: new Date().toISOString()
      };
    } else {
      out[key] = { symbol: key, price: null, change: null, changePct: null, error: true, lastUpdated: new Date().toISOString() };
    }
  }
  return out;
}

async function getVIX() {
  let q = null;
  for (const sym of ['VIX', 'CBOE:VIX', '^VIX']) {
    try {
      const data = await getQ(sym);
      if (data && data.c && data.c > 0) { q = data; break; }
    } catch (e) {}
  }

  if (!q || !q.c) {
    return { symbol: 'VIX', price: null, change: null, changePct: null, regime: 'UNKNOWN', lastUpdated: new Date().toISOString() };
  }

  const price = q.c;
  const { change, changePct } = calcChange(q.c, q.pc);
  const regime = price < 15 ? 'LOW' : price < 20 ? 'MODERATE' : price < 30 ? 'ELEVATED' : 'EXTREME';

  return {
    symbol: 'VIX',
    price,
    change,
    changePct,
    high: q.h,
    low: q.l,
    open: q.o,
    previousClose: q.pc,
    regime,
    lastUpdated: new Date().toISOString()
  };
}

async function getOvernightLevels() {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 5 * 24 * 60 * 60;

  let data = null;
  for (const sym of ['ESM2025', 'ES1!']) {
    try {
      const r = await axios.get(BASE + '/stock/candle', {
        params: { symbol: sym, resolution: 'D', from, to: now, token: KEY },
        timeout: 8000
      });
      if (r.data && r.data.s === 'ok' && r.data.c && r.data.c.length >= 2) {
        data = r.data;
        break;
      }
    } catch (e) {}
  }

  if (!data) throw new Error('No candle data available');

  const i = data.c.length - 2;
  const high = data.h[i];
  const low = data.l[i];
  const mid = parseFloat(((high + low) / 2).toFixed(2));
  const range = parseFloat((high - low).toFixed(2));
  const cur = data.o[data.c.length - 1] || data.c[data.c.length - 1];
  const pos = range > 0 ? parseFloat(((cur - low) / range * 100).toFixed(1)) : null;

  return {
    symbol: 'ES',
    high, low,
    midpoint: mid,
    range, positionInRange: pos,
    date: new Date(data.t[i] * 1000).toISOString().split('T')[0],
    lastUpdated: new Date().toISOString()
  };
}

module.exports = { getFuturesQuotes, getVIX, getOvernightLevels };
