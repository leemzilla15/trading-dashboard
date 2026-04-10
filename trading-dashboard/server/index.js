/**
 * server/index.js  — production-hardened entry point
 */

require('dotenv').config();
const express      = require('express');
const compression  = require('compression');
const path         = require('path');

const logger         = require('./logger');
const requestLogger  = require('./middleware/requestLogger');
const { corsMiddleware, helmetMiddleware, apiLimiter, analysisLimiter } = require('./middleware/security');

const futuresRouter   = require('./routes/futures');
const vixRouter       = require('./routes/vix');
const newsRouter      = require('./routes/news');
const levelsRouter    = require('./routes/levels');
const sentimentRouter = require('./routes/sentiment');
const analysisRouter  = require('./routes/analysis');
const streamRouter    = require('./routes/stream');
const aiRouter        = require('./routes/ai');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Render/Railway proxy so req.ip and rate-limit see real client IPs
app.set('trust proxy', 1);

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(requestLogger);

// ── Static client ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag:   true,
}));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const uptimeSeconds = Math.floor(process.uptime());
  res.json({
    status:      'ok',
    uptime:      uptimeSeconds,
    uptimeHuman: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
    connections: streamRouter.connectionCount?.() ?? 0,
    memory:      process.memoryUsage(),
    nodeVersion: process.version,
    env:         process.env.NODE_ENV || 'development',
    timestamp:   new Date().toISOString(),
  });
});

// ── SSE (no rate-limit — long-lived connection) ───────────────────────────────
app.use('/api/stream', streamRouter);

// ── Rate-limited API routes ───────────────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api/futures',   futuresRouter);
app.use('/api/vix',       vixRouter);
app.use('/api/news',      newsRouter);
app.use('/api/levels',    levelsRouter);
app.use('/api/sentiment', sentimentRouter);
app.use('/api/analysis',  analysisLimiter, analysisRouter);
app.use('/api/ai',        aiRouter);

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Frontend not found' });
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.message?.startsWith('CORS:')) {
    logger.warn('CORS rejection', { origin: req.headers.origin, path: req.path });
    return res.status(403).json({ success: false, error: err.message });
  }
  logger.error('Unhandled error', { error: err.message, path: req.path, method: req.method });
  res.status(err.status || 500).json({
    success: false,
    error:   process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info('Trading Dashboard API started', { port: PORT, env: process.env.NODE_ENV || 'development' });
  logger.info('Routes: /api/futures /api/vix /api/news /api/levels /api/sentiment /api/analysis /api/stream /api/health');
});

// ── Graceful shutdown (Render sends SIGTERM before kill) ──────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} — shutting down gracefully`);
  server.close((err) => {
    if (err) { logger.error('Shutdown error', { error: err.message }); process.exit(1); }
    logger.info('Clean exit');
    process.exit(0);
  });
  setTimeout(() => { logger.warn('Shutdown timeout — forcing exit'); process.exit(1); }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

module.exports = app;
