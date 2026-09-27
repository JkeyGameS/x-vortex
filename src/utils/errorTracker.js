let lastError = null;
let lastErrorAt = null;

export function setLastError(error) {
  lastError = error?.message || String(error);
  lastErrorAt = new Date().toISOString();
}

export function getLastError() {
  return lastError;
}

export function getLastErrorAt() {
  return lastErrorAt;
}
