// Writes approved entries into data/changelog.json.
//
// The file is authored content and IS tracked in git, so every write is done
// through a temp file + rename: a crash mid-write must not leave truncated
// JSON behind, since the Version History menu reads it.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { reload as reloadChangelog, __testing as changelogTesting } from './changelogService.js';

const CHANGELOG_PATH = changelogTesting.CHANGELOG_PATH;

function readRaw() {
  const raw = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    throw new Error('changelog.json is malformed');
  }
  return data;
}

function writeAtomic(data) {
  const dir = path.dirname(CHANGELOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  const tmp = CHANGELOG_PATH + '.tmp';
  fs.writeFileSync(tmp, payload, 'utf8');
  try {
    fs.renameSync(tmp, CHANGELOG_PATH);
  } catch (err) {
    // Windows refuses rename-over-target while another handle is open (EPERM),
    // which the running bot can cause. Fall back to a direct write so a publish
    // never fails outright; the file is small and rewritten in one call.
    logger.warn({ err, code: err.code }, '[CHANGELOG] atomic rename unavailable, writing in place');
    fs.writeFileSync(CHANGELOG_PATH, payload, 'utf8');
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

/**
 * Insert an entry at the top, replacing any entry with the same version, and
 * make it the current version.
 */
export function publishEntry(entry) {
  const data = readRaw();
  data.entries = data.entries.filter((e) => e.version !== entry.version);
  data.entries.unshift({ ...entry });
  data.currentVersion = entry.version;
  data.releasedAt = new Date().toISOString();
  writeAtomic(data);
  reloadChangelog();
  logger.info({ version: entry.version, entries: data.entries.length }, '[CHANGELOG] published');
  return data.entries[0];
}

/** Replace one entry in place, matched by version. */
export function updateChangelogEntry(version, patch) {
  const data = readRaw();
  const idx = data.entries.findIndex((e) => e.version === version);
  if (idx < 0) return null;
  data.entries[idx] = { ...data.entries[idx], ...patch };
  writeAtomic(data);
  reloadChangelog();
  return data.entries[idx];
}

export function deleteChangelogEntry(version) {
  const data = readRaw();
  const before = data.entries.length;
  data.entries = data.entries.filter((e) => e.version !== version);
  if (data.entries.length === before) return false;
  writeAtomic(data);
  reloadChangelog();
  return true;
}

/** Change the advertised version without touching the entry list. */
export function setCurrentVersion(version) {
  const data = readRaw();
  data.currentVersion = version;
  writeAtomic(data);
  reloadChangelog();
  return version;
}

/** Overwrite the whole changelog (import). Validated by the caller. */
export function replaceChangelog(data) {
  writeAtomic(data);
  reloadChangelog();
  return data;
}

/** Shape check used before an import replaces the real file. */
export function validateChangelogShape(data) {
  const problems = [];
  if (!data || typeof data !== 'object') return ['not an object'];
  if (typeof data.currentVersion !== 'string' || !data.currentVersion) problems.push('currentVersion missing');
  if (!Array.isArray(data.entries)) problems.push('entries is not an array');
  else {
    data.entries.forEach((e, i) => {
      if (!e || typeof e !== 'object') problems.push(`entries[${i}] is not an object`);
      else {
        if (typeof e.version !== 'string' || !e.version) problems.push(`entries[${i}].version missing`);
        if (!Array.isArray(e.changes)) problems.push(`entries[${i}].changes is not an array`);
      }
    });
  }
  return problems;
}

export function readChangelogFile() {
  return readRaw();
}

export const __testing = { CHANGELOG_PATH };