const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const logger    = require('../logger');

function buildCorsOptions() {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000',
  ];

  const allowed = new Set([...devOrigins, ...envOrigins]);

  return {
    origin(origin, callback) {
      // No origin = same-origin request (server serving its own frontend) — always allow
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      // In production, allow the Render domain itself
      if (origin && origin.includes('onrender.com')) return callback(null, true);
      // Dev mode — allow everything
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      logger.warn('CORS blocked', { origin });
      return callback(new Error('CORS: origin ' + origin + ' not allowed'));
    },
    methods:          ['GET', 'POST', 'OPTIONS'],
    allowedHeaders:   ['Content-Type', 'Authorization'],
    credentials:      true,
    optionsSuccessStatus: 200,
  };
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests' },
  handler(req, res, _next, options) {
    logger.warn('Rate limit hit', { ip: req.ip, path: req.path });
    res.status(429).json(options.message);
  },
});

const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Analysis rate limited' },
});

const helmetOptions = {
  contentSecurityPolicy: false,
  frameguard: { action: 'sameorigin' },
  hidePoweredBy: true,
};

module.exports = {
  corsMiddleware:   cors(buildCorsOptions()),
  helmetMiddleware: helmet(helmetOptions),
  apiLimiter,
  analysisLimiter,
};
