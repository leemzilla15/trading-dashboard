/**
 * security.js
 *
 * All security-related middleware in one file so you can audit it easily.
 *
 * Applied in order:
 *   1. Helmet   — sets hardened HTTP headers
 *   2. CORS     — explicit allowlist, not wildcard *
 *   3. Rate limiting — per-IP limits to protect upstream APIs
 *
 * CORS FIX: The most common production bug.
 * In dev, frontend runs on :5500 or similar. In production it's on a
 * different domain. Wildcard (*) breaks requests that send credentials.
 * We use an explicit allowlist read from ALLOWED_ORIGINS env var.
 */

const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const logger    = require('../logger');

// ── CORS ──────────────────────────────────────────────────────────────────────

/**
 * Build the CORS origin list from environment.
 *
 * ALLOWED_ORIGINS env var should be a comma-separated list:
 *   ALLOWED_ORIGINS=https://apex-trading.vercel.app,https://yourdomain.com
 *
 * In development, localhost ports are always allowed.
 */
function buildCorsOptions() {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000',
  ];

  const allowed = new Set([...devOrigins, ...envOrigins]);

  return {
    origin(origin, callback) {
      // Allow server-to-server requests (no Origin header) and health checks
      if (!origin) return callback(null, true);

      if (allowed.has(origin)) {
        return callback(null, true);
      }

      // In development, be lenient and log rather than block
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('CORS: unlisted origin allowed in dev mode', { origin });
        return callback(null, true);
      }

      logger.warn('CORS: blocked request from unlisted origin', { origin });
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods:          ['GET', 'OPTIONS'],
    allowedHeaders:   ['Content-Type', 'Authorization'],
    exposedHeaders:   ['X-Cache-Status', 'X-Stale'],
    credentials:      true,
    optionsSuccessStatus: 200,  // IE11 needs 200, not 204
    maxAge: 600,                // preflight cache: 10 min
  };
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

/**
 * General API limiter — prevents runaway polling or scraping.
 * 120 requests / 1 minute per IP is generous for a dashboard.
 * A 30s poll cycle = 12 req/min per client, so 10 simultaneous users = fine.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max:      120,
  standardHeaders: true, // Return `RateLimit-*` headers
  legacyHeaders:   false,
  message: {
    success: false,
    error:   'Too many requests — slow down your polling interval',
    retryAfterMs: 60_000,
  },
  handler(req, res, _next, options) {
    logger.warn('Rate limit hit', { ip: req.ip, path: req.path });
    res.status(429).json(options.message);
  },
});

/**
 * Analysis endpoint gets a stricter limit — it fetches intraday candles
 * which is the heaviest upstream call.
 */
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    error:   'Analysis endpoint rate limited — use cached data',
  },
});

// ── Helmet config ─────────────────────────────────────────────────────────────

const helmetOptions = {
  contentSecurityPolicy: false,
  frameguard: { action: 'sameorigin' },
  hidePoweredBy: true,
};

module.exports = {
  corsMiddleware:     cors(buildCorsOptions()),
  helmetMiddleware:   helmet(helmetOptions),
  apiLimiter,
  analysisLimiter,
};
