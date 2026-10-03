// Admin-editable bot content: every user-facing onboarding / welcome-back
// string plus the timing and language-display settings.
//
// data/botContent.json is the live override and is tracked in git on purpose:
// it is content, not runtime state. src/config/defaultBotContent.js is the
// safety net and is never removed -- deepMerge always fills gaps from it, so a
// truncated or hand-mangled file degrades to defaults instead of crashing.
//
// Corrupt JSON is caught and replaced by defaults rather than thrown, because a
// bad admin import must not take the whole bot down.
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import defaultContent from '../config/defaultBotContent.js';

const CONTENT_PATH = path.resolve('data/botContent.json');
const SNAPSHOT_DIR = path.resolve('data/snapshots');
const MAX_SNAPSHOTS = 20;

let cache = null;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Merge overlay onto base. Objects merge key-by-key; arrays and scalars replace. */
export function deepMerge(base, overlay) {
  if (!isPlainObject(base)) return overlay;
  const out = { ...base };
  for (const key of Object.keys(overlay || {})) {
    if (isPlainObject(overlay[key]) && isPlainObject(base[key])) {
      out[key] = deepMerge(base[key], overlay[key]);
    } else {
      out[key] = overlay[key];
    }
  }
  return out;
}

function persist() {
  try {
    if (cache) cache.updatedAt = new Date().toISOString();
    const dir = path.dirname(CONTENT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONTENT_PATH, JSON.stringify(cache, null, 2), 'utf8');
    return true;
  } catch (err) {
    logger.error({ err }, '[BOT_CONTENT] persist failed');
    return false;
  }
}

export function loadBotContent() {
  try {
    if (!fs.existsSync(CONTENT_PATH)) {
      cache = deepMerge({}, defaultContent);
      persist();
      logger.info('[BOT_CONTENT] created from defaults');
      return cache;
    }
    const parsed = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
    if (!isPlainObject(parsed)) throw new Error('root is not an object');
    cache = deepMerge(defaultContent, parsed);
    logger.info(
      { version: cache.version, sections: Object.keys(cache).length },
      '[BOT_CONTENT] loaded'
    );
    return cache;
  } catch (err) {
    logger.error({ err }, '[BOT_CONTENT] load failed, falling back to defaults');
    cache = deepMerge({}, defaultContent);
    return cache;
  }
}

/** Read a dotted path, e.g. 'timing.welcomeBackThresholds.minGapMs'. */
export function getContent(pathStr, fallback = undefined) {
  if (!cache) loadBotContent();
  let cur = cache;
  for (const p of String(pathStr).split('.')) {
    if (cur == null) return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

/** Write a dotted path and persist. Returns the previous value. */
export function setContent(pathStr, value, adminJid = null) {
  if (!cache) loadBotContent();
  const parts = String(pathStr).split('.');
  let cur = cache;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  const old = cur[leaf];
  cur[leaf] = value;
  if (adminJid) cache.updatedBy = adminJid;
  persist();
  return old;
}

/** Restore one dotted section from the defaults. */
export function resetSection(sectionPath, adminJid = null) {
  if (!cache) loadBotContent();
  const parts = String(sectionPath).split('.');
  let def = defaultContent;
  for (const p of parts) def = def?.[p];
  if (def === undefined) return false;
  let cur = cache;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(def));
  if (adminJid) cache.updatedBy = adminJid;
  persist();
  return true;
}

export function resetAll(adminJid = null) {
  cache = deepMerge({}, defaultContent);
  if (adminJid) cache.updatedBy = adminJid;
  persist();
  return cache;
}

/** Save a timestamped copy, trimming to MAX_SNAPSHOTS. */
export function snapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(SNAPSHOT_DIR, `botContent-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.startsWith('botContent-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_SNAPSHOTS) {
      fs.unlinkSync(path.join(SNAPSHOT_DIR, files.shift()));
    }
    return file;
  } catch (err) {
    logger.error({ err }, '[BOT_CONTENT] snapshot failed');
    return null;
  }
}

export function listSnapshots() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return [];
    return fs.readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.startsWith('botContent-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Restore a snapshot. path.basename keeps a caller from escaping the dir. */
export function restoreSnapshot(filename) {
  try {
    const full = path.join(SNAPSHOT_DIR, path.basename(String(filename)));
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (!isPlainObject(parsed)) throw new Error('root is not an object');
    cache = deepMerge(defaultContent, parsed);
    persist();
    return true;
  } catch (err) {
    logger.error({ err, filename }, '[BOT_CONTENT] restore failed');
    return false;
  }
}

export function deleteSnapshot(filename) {
  try {
    const full = path.join(SNAPSHOT_DIR, path.basename(String(filename)));
    fs.unlinkSync(full);
    return true;
  } catch (err) {
    logger.error({ err, filename }, '[BOT_CONTENT] snapshot delete failed');
    return false;
  }
}

export function reload() {
  cache = null;
  return loadBotContent();
}

/** Raw live object, for export and previews. */
export function getAll() {
  if (!cache) loadBotContent();
  return cache;
}

export { CONTENT_PATH, SNAPSHOT_DIR, MAX_SNAPSHOTS };