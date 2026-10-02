import pino from 'pino';
import config from '../config/config.js';

/**
 * Build the logger.
 *
 * pino-pretty is a dev-only convenience: it is not installed by a slim or
 * production install (npm ci --omit=dev), and asking pino to use a transport
 * that is not there throws at construction time, which took the whole process
 * down before WhatsApp even connected. So: never use it in production, and fall
 * back to plain output if it is missing. Override with LOG_PRETTY=1|0.
 */
function createLogger() {
  const base = { level: config.logLevel };
  const forced = process.env.LOG_PRETTY;
  const usePretty = forced === '1' || (forced !== '0' && process.env.NODE_ENV !== 'production');
  if (!usePretty) return pino(base);
  try {
    return pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true } } });
  } catch (err) {
    // Resolved lazily by pino in some versions, so also guard first use.
    console.warn(`[LOGGER] pino-pretty unavailable (${err.message}); using plain output`);
    return pino(base);
  }
}

const logger = createLogger();

export default logger;