import logger from '../utils/logger.js';

const MAX_ERRORS = 10;
const errors = [];

export function addError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : undefined;
  errors.push({
    timestamp: new Date().toISOString(),
    message,
    stack
  });
  if (errors.length > MAX_ERRORS) {
    errors.splice(0, errors.length - MAX_ERRORS);
  }
  return errors.length;
}

export function getRecentErrors(limit = 5) {
  return errors.slice(-limit);
}

export function getErrorCount() {
  return errors.length;
}
