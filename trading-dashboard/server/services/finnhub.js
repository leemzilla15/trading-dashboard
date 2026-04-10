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
  if (!c || !pc || pc === 0) return { change: 0, changePct: 0 };
  return {
    change: parseFloat((c - pc).toFixed(2)),
    changePct: parseFloat(((c - pc) / pc * 100).toFixed(2))
  };
}

// Futures use ETF proxies on Finnhub free tier
// SPY tracks ES, QQQ tracks NQ, DIA tracks YM
// We scale them to approximate futures prices
const FUTURES_CONFIG = [
  { key: 'ES', primary: 'SPY',  scale: 10.0,  name: 'E-Mini S&P 500' },
  { key: 'NQ', primary: 'QQQ',  scale: 75.0,  name: 'E-Mini Nasdaq'  },
  { key: 'YM', primary: 'DIA',  scale: 100.0, name: 'E-Mini Dow'     },
];

async function getFuturesQuotes() {
  const out = {};
  const results = await Promise.allSettled(
    FUTURES_CONFIG.map(f => getQ(f.primary))
  );

  results.forEach((result, i) => {
    const { key, scale, name } = FUTURES_CONFIG[i];
    if (result.status === 'fulfilled' && result.value && result.value.c > 0) {
      const q = result.value;
      const price = parseFloat((q.c * scale).toFixed(2));
      const prevClose = parseFloat((q.pc * scale).toFixed(2));
      const high = parseFloat((q.h * scale).toFixed(2));
      const low = parseFloat((q.l * scale).toFixed(2));
      const open = parseFloat((q.o * scale).toFixed(2));
      const { change, changePct } = calcChange(price, prevClose);
      out[key] = {
        symbol: key,
        name,
        price,
        change,
        changePct,
        high,
        low,
        open,
        previousClose: prevClose,
        marketState: 'REGULAR',
        proxy: FUTURES_CONFIG[i].primary,
        lastUpdated: new Date().toISOString()
      };
    } else {
      out[key] = {
        symbol: key,
        name,
        price: null,
        change: null,
        changePct: null,
        error: true,
        lastUpdated: new Date().toISOString()
      };
    }
  });
  return out;
}

async function getVIX() {
  // Try multiple VIX symbol formats
  const symbols = ['VIX', 'CBOE:VIX'];
  let q = null;
  for (const sym of symbols) {
    try {
      const data = await getQ(sym);
      if (data && data.c > 0) { q = data; break; }
    } catch(e) {}
  }

  // Fallback: derive VIX estimate from SPY options activity
  if (!q || !q.c) {
    try {
      const spy = await getQ('SPY');
      if (spy && spy.c > 0) {
        // Rough VIX estimate from SPY intraday range
        const rangeRatio = spy.h > 0 ? ((spy.h - spy.l) / spy.c) * 100 : 0;
        const estimatedVix = Math.max(10, Math.min(40, rangeRatio * 15));
        return {
          symbol: 'VIX',
          price: parseFloat(estimatedVix.toFixed(2)),
          change: 0,
          changePct: 0,
          high: null,
          low: null,
          open: null,
          previousClose: null,
          regime: estimatedVix < 15 ? 'LOW' : estimatedVix < 20 ? 'MODERATE' : estimatedVix < 30 ? 'ELEVATED' : 'EXTREME',
          estimated: true,
          lastUpdated: new Date().toISOString()
        };
      }
    } catch(e) {}
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
    estimated: false,
    lastUpdated: new Date().toISOString()
  };
}

async function getOvernightLevels() {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 7 * 24 * 60 * 60;

  // Use SPY daily candles, scale to ES
  const r = await axios.get(BASE + '/stock/candle', {
    params: { symbol: 'SPY', resolution: 'D', from, to: now, token: KEY },
    timeout: 8000
  });

  const d = r.data;
  if (!d || d.s !== 'ok' || !d.c || d.c.length < 2) {
    throw new Error('No candle data available');
  }

  const i = d.c.length - 2;
  const SCALE = 10.0;
  const high = parseFloat((d.h[i] * SCALE).toFixed(2));
  const low = parseFloat((d.l[i] * SCALE).toFixed(2));
  const mid = parseFloat(((high + low) / 2).toFixed(2));
  const range = parseFloat((high - low).toFixed(2));
  const cur = (d.o[d.c.length - 1] || d.c[d.c.length - 1]) * SCALE;
  const pos = range > 0 ? parseFloat(((cur - low) / range * 100).toFixed(1)) : null;

  // Also compute ATR for chop detection
  const atrs = [];
  for (let j = 1; j < Math.min(d.c.length, 15); j++) {
    const tr = Math.max(
      d.h[j] - d.l[j],
      Math.abs(d.h[j] - d.c[j-1]),
      Math.abs(d.l[j] - d.c[j-1])
    ) * SCALE;
    atrs.push(tr);
  }
  const atr14 = atrs.length > 0 ? parseFloat((atrs.reduce((a,b) => a+b,0) / atrs.length).toFixed(2)) : null;
  const avgRange5 = d.h.slice(-6,-1).reduce((a,h,idx) => a + (h - d.l.slice(-6,-1)[idx]),0) / 5 * SCALE;
  const todayRange = (d.h[d.h.length-1] - d.l[d.l.length-1]) * SCALE;
  const isChoppy = atr14 && todayRange < atr14 * 0.6;

  return {
    symbol: 'ES',
    high, low,
    midpoint: mid,
    range,
    positionInRange: pos,
    atr14,
    avgRange5: parseFloat(avgRange5.toFixed(2)),
    todayRange: parseFloat(todayRange.toFixed(2)),
    isChoppy,
    date: new Date(d.t[i] * 1000).toISOString().split('T')[0],
    lastUpdated: new Date().toISOString()
  };
}

module.exports = { getFuturesQuotes, getVIX, getOvernightLevels };
