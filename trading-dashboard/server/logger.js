/**
 * logger.js
 *
 * Structured logger using Winston.
 * - Development: coloured, human-readable output
 * - Production:  JSON lines to stdout (Render/Railway scrapes these)
 *
 * Usage:
 *   const log = require('./logger');
 *   log.info('Server started', { port: 3000 });
 *   log.warn('Cache miss', { key: 'futures' });
 *   log.error('API failed', { error: err.message, stack: err.stack });
 */

const winston = require('winston');

const IS_PROD = process.env.NODE_ENV === 'production';

// ── Formats ───────────────────────────────────────────────────────────────────

const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ── Transports ────────────────────────────────────────────────────────────────

const transports = [
  new winston.transports.Console({
    format: IS_PROD ? prodFormat : devFormat,
  }),
];

// In production on a persistent host (Railway/VPS), also write to files.
// On Render free tier, filesystem is ephemeral — console only is fine.
if (IS_PROD && process.env.LOG_TO_FILE === 'true') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level:    'error',
      maxsize:  5 * 1024 * 1024,   // 5 MB
      maxFiles: 3,
      format:   prodFormat,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize:  10 * 1024 * 1024,  // 10 MB
      maxFiles: 5,
      format:   prodFormat,
    }),
  );
}

// ── Logger instance ───────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level:       process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug'),
  transports,
  // Don't crash the process on unhandled promise rejections
  exitOnError: false,
});

// ── Convenience: capture uncaught exceptions ──────────────────────────────────
// These would otherwise silently crash Render dynos.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — process will exit', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
  // Don't exit — log and continue. Most are non-fatal API timeouts.
});

module.exports = logger;
