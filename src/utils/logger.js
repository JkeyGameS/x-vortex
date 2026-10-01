import pino from 'pino';
import config from '../config/config.js';

const logger = pino({
  // Single source of truth: config.logLevel already reads LOG_LEVEL with an
  // 'info' fallback.
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

export default logger;