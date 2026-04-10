const axios = require('axios');
const KEY = 'd7c3dk1r01quh9fcctv0d7c3dk1r01quh9fcctvg';
const BASE = 'https://finnhub.io/api/v1';

async function getQ(sym) {
  const r = await axios.get(BASE + '/quote', {params:{symbol:sym,token:KEY},timeout:8000});
  return r.data;
}

async function getFuturesQuotes() {
  const out = {};
  const pairs = [['ES','ESM2025'],['NQ','NQM2025'],['YM','YMM2025']];
  for (const [key,sym] of pairs) {
    try {
      const q = await getQ(sym);
      if (q && q.c > 0) {
        out[key] = {symbol:key,price:q.c,change:parseFloat((q.c-q.pc).toFixed(2)),changePct:parseFloat(((q.c-q.pc)/q.pc*100).toFixed(2)),high:q.h,low:q.l,open:q.o,previousClose:q.pc,marketState:'REGULAR',lastUpdated:new Date().toISOString()};
      } else {
        out[key] = {symbol:key,price:null,error:true,lastUpdated:new Date().toISOString()};
      }
    } catch(e) {
      out[key] = {symbol:key,price:null,error:true,lastUpdated:new Date().toISOString()};
    }
  }
  return out;
}

async function getVIX() {
  const q = await getQ('VIX');
  const price = q.c;
  const regime = price < 15 ? 'LOW' : price < 20 ? 'MODERATE' : price < 30 ? 'ELEVATED' : 'EXTREME';
  return {symbol:'VIX',price,change:parseFloat((q.c-q.pc).toFixed(2)),changePct:parseFloat(((q.c-q.pc)/q.pc*100).toFixed(2)),high:q.h,low:q.l,open:q.o,previousClose:q.pc,regime,lastUpdated:new Date().toISOString()};
}

async function getOvernightLevels() {
  const now = Math.floor(Date.now()/1000);
  const r = await axios.get(BASE+'/stock/candle',{params:{symbol:'ESM2025',resolution:'D',from:now-5*86400,to:now,token:KEY},timeout:8000});
  const d = r.data;
  if (!d || d.s !== 'ok') throw new Error('No data');
  const i = d.c.length-2;
  const high = d.h[i], low = d.l[i];
  const cur = d.o[d.c.length-1];
  const range = parseFloat((high-low).toFixed(2));
  return {symbol:'ES',high,low,midpoint:parseFloat(((high+low)/2).toFixed(2)),range,positionInRange:range>0?parseFloat(((cur-low)/range*100).toFixed(1)):null,date:new Date(d.t[i]*1000).toISOString().split('T')[0],lastUpdated:new Date().toISOString()};
}

module.exports = {getFuturesQuotes,getVIX,getOvernightLevels};
