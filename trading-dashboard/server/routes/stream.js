/**
 * GET /api/stream
 *
 * Server-Sent Events (SSE) endpoint for real-time dashboard updates.
 *
 * WHY SSE INSTEAD OF WEBSOCKETS?
 *   - SSE is one-way (server → client) which is all we need
 *   - No library needed on client — native EventSource API
 *   - Works through proxies and load balancers without special config
 *   - Automatically reconnects if the connection drops
 *   - Render/Railway support long-lived HTTP connections
 *
 * HOW IT WORKS:
 *   1. Client opens EventSource('/api/stream')
 *   2. Server sends an initial 'snapshot' event immediately
 *   3. Server sends 'update' events every PUSH_INTERVAL_MS
 *   4. Server sends 'heartbeat' events every 20s to keep the connection alive
 *      (proxies close idle connections after ~30s without traffic)
 *   5. On disconnect, the interval is cleared — no memory leak
 *
 * CLIENT USAGE (in index.html):
 *   const es = new EventSource('/api/stream');
 *   es.addEventListener('update', e => {
 *     const data = JSON.parse(e.data);
 *     renderFutures(data.futures);
 *     renderVIX(data.vix);
 *   });
 *   es.addEventListener('heartbeat', () => console.log('alive'));
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../logger');
const cache   = require('../cache');

const { getFuturesQuotes, getVIX, getOvernightLevels } = require('../services/yahooFinance');
const { getHighImpactNews }   = require('../services/forexFactory');
const { calculateSentiment }  = require('../engines/sentimentEngine');
const { calculateRating }     = require('../engines/ratingEngine');
const fetchWithFallback       = require('../services/fetchWithFallback');

const PUSH_INTERVAL_MS   = 30_000;   // push fresh data every 30s
const HEARTBEAT_MS       = 20_000;   // keepalive ping every 20s
const MAX_CONN_AGE_MS    = 4 * 60 * 60 * 1000; // 4 hours — then ask client to reconnect

// Track active connections for monitoring
const connections = new Set();

// ── Data assembler (same logic as individual routes, bundled) ─────────────────

async function assembleSnapshot() {
  const [futuresR, vixR, newsR, levelsR] = await Promise.allSettled([
    fetchWithFallback(() => getFuturesQuotes(),         null, 'futures', cache, 30_000),
    fetchWithFallback(() => getVIX(),                   null, 'vix',     cache, 30_000),
    fetchWithFallback(() => getHighImpactNews(),        null, 'news',    cache, 300_000),
    fetchWithFallback(() => getOvernightLevels('ES=F'), null, 'levels',  cache, 60_000),
  ]);

  const futures = futuresR.status === 'fulfilled' ? futuresR.value : null;
  const vix     = vixR.status     === 'fulfilled' ? vixR.value     : null;
  const news    = newsR.status    === 'fulfilled' ? newsR.value     : { events: [] };
  const levels  = levelsR.status  === 'fulfilled' ? levelsR.value  : null;

  const sentiment = calculateSentiment({ vix, futures, news });
  const rating    = calculateRating({ sentiment, vix, news, levels });

  return {
    futures:   futures   ? stripMeta(futures)   : null,
    vix:       vix       ? stripMeta(vix)       : null,
    news:      news      ? stripMeta(news)       : null,
    levels:    levels    ? stripMeta(levels)    : null,
    sentiment,
    rating,
    serverTime: new Date().toISOString(),
    connCount:  connections.size,
  };
}

// Strip internal cache flags from data before sending to client
function stripMeta(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { _cached, _stale, _staleAgeSeconds, ...clean } = obj;
  return clean;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sendEvent(res, eventName, data) {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // flush() is needed when compression middleware is present
    if (typeof res.flush === 'function') res.flush();
  } catch (_) {
    // Client disconnected mid-write — ignore, cleanup handles it
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  // ── SSE headers ────────────────────────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache, no-transform',
    'Connection':                  'keep-alive',
    'X-Accel-Buffering':           'no',   // disable Nginx buffering on Render
    'Access-Control-Allow-Origin': req.headers.origin || '*',
  });

  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  connections.add(clientId);
  logger.info('SSE client connected', { clientId, total: connections.size });

  // ── Send initial snapshot ──────────────────────────────────────────────────
  try {
    const snapshot = await assembleSnapshot();
    sendEvent(res, 'snapshot', snapshot);
  } catch (err) {
    logger.error('SSE initial snapshot failed', { error: err.message });
    sendEvent(res, 'error', { message: 'Initial data load failed — retrying' });
  }

  // ── Periodic data push ─────────────────────────────────────────────────────
  const dataInterval = setInterval(async () => {
    try {
      const data = await assembleSnapshot();
      sendEvent(res, 'update', data);
    } catch (err) {
      logger.error('SSE update failed', { clientId, error: err.message });
      sendEvent(res, 'error', { message: 'Update failed — using cached data' });
    }
  }, PUSH_INTERVAL_MS);

  // ── Heartbeat (keeps proxy connection alive) ───────────────────────────────
  const heartbeatInterval = setInterval(() => {
    sendEvent(res, 'heartbeat', { t: Date.now() });
  }, HEARTBEAT_MS);

  // ── Max age reconnect (avoids very stale connections) ──────────────────────
  const maxAgeTimeout = setTimeout(() => {
    sendEvent(res, 'reconnect', { reason: 'max_age_reached' });
    res.end();
  }, MAX_CONN_AGE_MS);

  // ── Cleanup on disconnect ──────────────────────────────────────────────────
  req.on('close', () => {
    clearInterval(dataInterval);
    clearInterval(heartbeatInterval);
    clearTimeout(maxAgeTimeout);
    connections.delete(clientId);
    logger.info('SSE client disconnected', { clientId, remaining: connections.size });
  });
});

// Expose connection count for health check
router.connectionCount = () => connections.size;

module.exports = router;
