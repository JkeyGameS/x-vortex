// Reads dev-changes.json (written by the dev agent) and tracks which entry was
// last shown to admins, so a restart can report only what is new.
//
// dev-changes.json is repository content and is tracked. The last-notified id is
// environment-specific state, so it lives under data/ and is git-ignored.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
// Resolved against the module, not process.cwd(): on a PaaS platform the working
// directory is not guaranteed to be the repository root.
const DEV_CHANGES_PATH = path.join(ROOT, 'dev-changes.json');
const STATE_PATH = path.join(ROOT, 'data', 'lastNotifiedChangeId.json');

const EMPTY_STATE = { lastNotifiedId: null, lastNotifiedAt: null };

/** Entries, newest first. A missing or malformed file yields an empty list. */
export function loadDevChanges() {
  try {
    const raw = fs.readFileSync(DEV_CHANGES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('dev-changes.json is not an object');
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (err) {
    // Expected on a deploy that ships no dev-changes.json: warn, never throw.
    logger.warn({ err, path: DEV_CHANGES_PATH }, '[DEV_CHANGES] failed to read dev-changes.json');
    return [];
  }
}

export function loadNotifiedState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastNotifiedId: parsed?.lastNotifiedId ?? null,
      lastNotifiedAt: parsed?.lastNotifiedAt ?? null
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saveNotifiedState(lastNotifiedId) {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      lastNotifiedId,
      lastNotifiedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    return true;
  } catch (err) {
    logger.error({ err, path: STATE_PATH }, '[DEV_CHANGES] failed to save state');
    return false;
  }
}

/**
 * Entries newer than the last one shown to admins, newest first.
 *
 * First run (no state) reports everything, which is the intended cold-start
 * behaviour. If the stored id is no longer present in the file the history was
 * rewritten, so everything is reported again rather than silently skipping.
 */
export function getPendingChanges() {
  const entries = loadDevChanges();
  if (entries.length === 0) return [];

  const state = loadNotifiedState();
  let stopIndex = entries.length;
  if (state.lastNotifiedId) {
    const idx = entries.findIndex((e) => e.id === state.lastNotifiedId);
    if (idx >= 0) stopIndex = idx;
  }
  return entries.slice(0, stopIndex);
}

/** True when the newest entry has already been reported. */
export function hasPendingChanges() {
  return getPendingChanges().length > 0;
}

export const __testing = { DEV_CHANGES_PATH, STATE_PATH, EMPTY_STATE };