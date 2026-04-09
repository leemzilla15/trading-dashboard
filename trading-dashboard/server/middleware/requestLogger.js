/**
 * requestLogger.js
 *
 * Morgan HTTP access logger that feeds into Winston.
 * Logs every request with: method, url, status, response time, IP.
 *
 * In production these lines appear in Render/Railway log streams and are
 * invaluable for debugging "why is the frontend getting 404s" type issues.
 *
 * Skips logging for:
 *   - /api/health  (noisy keepalive pings)
 *   - Static assets (favicon, css, etc.)
 */

const morgan = require('morgan');
const logger = require('../logger');

// Pipe Morgan output into Winston so everything goes through one stream
const morganStream = {
  write(message) {
    // Morgan adds a trailing \n — strip it before passing to Winston
    logger.http(message.trim());
  },
};

// Custom token: real client IP (respects X-Forwarded-For from Render's proxy)
morgan.token('real-ip', (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || 'unknown';
});

// Format: METHOD /path STATUS - Xms [IP]
const formatString = ':method :url :status - :response-time ms [:real-ip]';

const requestLogger = morgan(formatString, {
  stream: morganStream,
  // Skip health checks and static files to keep logs clean
  skip(req, res) {
    if (req.path === '/api/health') return true;
    if (req.path.match(/\.(ico|png|jpg|css|js\.map)$/)) return true;
    return false;
  },
});

module.exports = requestLogger;
