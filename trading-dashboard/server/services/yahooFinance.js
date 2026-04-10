const axios = require('axios');
const. KEY = process.env.FINNHUB_API_KEY;
const BASE = 'https://finnhub.io/api/v1';

async function getQ(sym) {
  const r = await axios.get(BASE + '/quote?symbol=' + sym + '&token=' + KEY, {timeout:8000});
  return r.data;
}

async function getFuturesQuotes() {
  const syms = {ES:'ES1!', NQ:'NQ1!', YM:'YM1!'};
  const out = {};
  for (const [k,s] of Object.entries(syms)) {
    try {
      const q = await getQ(s);
      out[k] = {symbol:k, price:q.c, change:+(q.c-q.pc).toFixed(2), changePct:+((q.c-q.pc)/q.pc*100).toFixed(2), high:q.h, low:q.l, open:q.o, previousClose:q.pc, lastUpdated:new Date().toISOString()};
    } catch(e) { out[k] = {symbol:k, price:null, error:true}; }
  }
  return out;
}

async function getVIX() {
  const q = await getQ('VIX');
  const price = q.c;
  const regime = price < 15 ? 'LOW' : price < 20 ? 'MODERATE' : price < 30 ? 'ELEVATED' : 'EXTREME';
  return {symbol:'VIX', price, change:+(q.c-q.pc).toFixed(2), changePct:+((q.c-q.pc)/q.pc*100).toFixed(2), high:q.h, low:q.l, open:q.o, previousClose:q.pc, regime, lastUpdated:new Date().toISOString()};
}

async function getOvernightLevels() {
  const now = Math.floor(Date.now()/1000);
  const r = await axios.get(BASE + '/stock/candle?symbol=ES1!&resolution=D&from=' + (now - 5*86400) + '&to=' + now + '&token=' + KEY, {timeout:8000});
  const d = r.data;
  if (!d || d.s !== 'ok') throw new Error('No candle data');
  const i = d.c.length - 2;
  const high = d.h[i], low = d.l[i];
  const mid = +((high+low)/2).toFixed(2);
  const range = +(high-low).toFixed(2);
  const cur = d.o[d.c.length-1];
  const pos = range > 0 ? +((cur-low)/range*100).toFixed(1) : null;
  return {symbol:'ES', high, low, midpoint:mid, range, positionInRange:pos, date:new Date(d.t[i]*1000).toISOString().split('T')[0], lastUpdated:new Date().toISOString()};
}

module.exports = {getFuturesQuotes, getVIX, getOvernightLevels};
