/**
 * forexFactory.js
 *
 * Fetches high-impact USD economic news from Forex Factory.
 *
 * Primary:  FF's public weekly calendar JSON
 *   https://nfs.faireconomy.media/ff_calendar_thisweek.json
 *
 * Backup:   FF's RSS XML feed
 *   https://nfs.faireconomy.media/ff_calendar_thisweek.xml
 *
 * We filter to USD High-impact events within a ±4 hour window so the
 * dashboard shows only what's actionable right now.
 */

const axios  = require('axios');
const xml2js = require('xml2js');

const FF_JSON_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FF_XML_URL  = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';

const AXIOS_CFG = {
  timeout: 8_000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingDashboard/1.0)' },
};

// How many hours ahead/behind NOW to include events
const WINDOW_HOURS_FUTURE = 4;
const WINDOW_HOURS_PAST   = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

function minutesUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr) - Date.now()) / 60_000);
}

function inWindow(dateStr) {
  const mins = minutesUntil(dateStr);
  if (mins === null) return false;
  return mins >= -(WINDOW_HOURS_PAST * 60) && mins <= WINDOW_HOURS_FUTURE * 60;
}

function normalizeEvent(raw, source) {
  return {
    title:       raw.title    || 'Unknown Event',
    country:     raw.country  || 'USD',
    impact:      raw.impact   || 'High',
    date:        raw.date     || null,
    forecast:    raw.forecast || null,
    previous:    raw.previous || null,
    actual:      raw.actual   || null,
    minutesUntil: minutesUntil(raw.date),
    source,
  };
}

// ── Primary: JSON endpoint ────────────────────────────────────────────────────

async function getFromJSON() {
  const resp = await axios.get(FF_JSON_URL, AXIOS_CFG);

  if (!Array.isArray(resp.data)) {
    throw new Error('Unexpected Forex Factory JSON format');
  }

  const allEvents = resp.data;

  // Filter: USD + High impact + within window
  const filtered = allEvents
    .filter(e => e.impact === 'High' && e.country === 'USD')
    .filter(e => inWindow(e.date))
    .map(e => normalizeEvent(e, 'ff-json'))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const totalHighUSD = allEvents.filter(e => e.impact === 'High' && e.country === 'USD').length;

  return {
    events:         filtered,
    totalHighUSD,
    windowHours:    { past: WINDOW_HOURS_PAST, future: WINDOW_HOURS_FUTURE },
    lastUpdated:    new Date().toISOString(),
    source:         'ForexFactory-JSON',
  };
}

// ── Backup: XML/RSS endpoint ──────────────────────────────────────────────────

async function getFromXML() {
  const resp   = await axios.get(FF_XML_URL, AXIOS_CFG);
  const parser = new xml2js.Parser({ explicitArray: false, trim: true });
  const parsed = await parser.parseStringPromise(resp.data);

  const items = parsed?.rss?.channel?.item ?? [];
  const arr   = Array.isArray(items) ? items : [items];

  // The FF XML schema embeds event metadata in description / title text
  // We do a best-effort parse — impact filtering is approximate here
  const events = arr
    .filter(item => {
      const desc = (item.description || '').toLowerCase();
      return desc.includes('high') && (
        desc.includes('usd') || (item.title || '').includes('USD')
      );
    })
    .map(item => normalizeEvent({
      title:   item.title,
      country: 'USD',
      impact:  'High',
      date:    item.pubDate ? new Date(item.pubDate).toISOString() : null,
    }, 'ff-xml'))
    .filter(e => inWindow(e.date))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    events,
    totalHighUSD:   events.length,
    windowHours:    { past: WINDOW_HOURS_PAST, future: WINDOW_HOURS_FUTURE },
    lastUpdated:    new Date().toISOString(),
    source:         'ForexFactory-XML',
  };
}

// ── Public interface ──────────────────────────────────────────────────────────

async function getHighImpactNews() {
  try {
    return await getFromJSON();
  } catch (jsonErr) {
    console.warn('[ForexFactory] JSON source failed, trying XML:', jsonErr.message);
    return await getFromXML();
  }
}

module.exports = { getHighImpactNews };
