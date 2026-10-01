// Version history, loaded from data/changelog.json.
//
// The file is authored content rather than user data, so it is committed (the
// rest of data/ is git-ignored). A missing or corrupt file must never take the
// Info menu down, so every failure degrades to an empty changelog.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolved against the module, not process.cwd(): on a PaaS platform the working
// directory is not guaranteed to be the repository root.
const CHANGELOG_PATH = path.resolve(__dirname, '..', '..', 'data', 'changelog.json');

const FALLBACK = { currentVersion: '0.0.0', releasedAt: null, entries: [] };

let cache = null;

export function loadChangelog() {
  try {
    const raw = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('changelog is not an object');
    cache = {
      currentVersion: parsed.currentVersion || FALLBACK.currentVersion,
      releasedAt: parsed.releasedAt || null,
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
    logger.info(
      { version: cache.currentVersion, entries: cache.entries.length, path: CHANGELOG_PATH },
      '[CHANGELOG] loaded'
    );
    return cache;
  } catch (err) {
    // Includes a missing file: the menu still renders, just empty.
    logger.error({ err, path: CHANGELOG_PATH }, '[CHANGELOG] failed to load');
    cache = { ...FALLBACK, entries: [] };
    return cache;
  }
}

export function getChangelog() {
  if (!cache) return loadChangelog();
  return cache;
}

export function getCurrentVersion() {
  return getChangelog().currentVersion;
}

export function getEntries() {
  return getChangelog().entries || [];
}

/**
 * One page of entries, oldest-first files sliced newest-first.
 * @param {number} page 1-based
 * @param {number} pageSize entries per page
 */
export function getEntriesPage(page, pageSize = 2) {
  const all = getEntries();
  const size = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 2;
  const requested = Number(page);
  // Clamp so a stale session page can never render an empty menu.
  const maxPage = Math.max(1, Math.ceil(all.length / size));
  const current = Number.isFinite(requested) && requested > 0 ? Math.min(requested, maxPage) : 1;
  const start = (current - 1) * size;
  return {
    entries: all.slice(start, start + size),
    total: all.length,
    hasNext: start + size < all.length,
    hasPrev: current > 1,
    page: current
  };
}

export function reload() {
  cache = null;
  return loadChangelog();
}

export const __testing = { CHANGELOG_PATH, FALLBACK };