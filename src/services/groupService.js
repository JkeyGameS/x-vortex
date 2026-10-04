import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * Registry of groups the bot has been activated into.
 *
 * Phase 1 uses only enabled / activatedAt / activatedBy / language / settings.
 * `moderation` is initialised empty for Phase 4. A group that is not in this
 * file, or present with enabled: false, is ignored entirely by the router.
 *
 * Path follows the repo convention (see botContentService): relative to the
 * process CWD. GROUPS_DATA_PATH overrides it so tests can run against a
 * temporary file instead of the live registry.
 */
const GROUPS_PATH = process.env.GROUPS_DATA_PATH
  ? path.resolve(process.env.GROUPS_DATA_PATH)
  : path.resolve('data/groups.json');

let cache = null;

/** Phase 1 defaults. Do not enable behaviour here beyond what Phase 1 stores. */
export function defaultGroupSettings() {
  return {
    mentionOnly: true,
    chatRules: false,
    welcome: false,
    goodbye: false,
    antiSpam: true,
    antiLink: false,
    respondToCommands: true
  };
}

function ensureFile() {
  const dir = path.dirname(GROUPS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(GROUPS_PATH)) fs.writeFileSync(GROUPS_PATH, '{}', 'utf8');
}

function persist() {
  try {
    ensureFile();
    fs.writeFileSync(GROUPS_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    logger.error({ err }, '[GROUPS] persist failed');
  }
}

export function loadGroups() {
  try {
    ensureFile();
    const raw = fs.readFileSync(GROUPS_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    // A non-object (array/null) would silently break every lookup below.
    cache = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    logger.info({ count: Object.keys(cache).length }, '[GROUPS] loaded');
    return cache;
  } catch (err) {
    logger.error({ err }, '[GROUPS] load failed, starting empty');
    cache = {};
    return cache;
  }
}

function ensureCache() {
  if (!cache) loadGroups();
}

export function getGroup(groupJid) {
  ensureCache();
  return cache[groupJid] || null;
}

export function getAllGroups() {
  ensureCache();
  return Object.values(cache);
}

export function getEnabledGroups() {
  return getAllGroups().filter((g) => g.enabled === true);
}

export function isGroupEnabled(groupJid) {
  const g = getGroup(groupJid);
  return !!(g && g.enabled === true);
}

export function activateGroup(groupJid, { name, activatedBy, language = 'en' } = {}) {
  ensureCache();
  const existing = cache[groupJid];
  if (existing) {
    existing.enabled = true;
    existing.activatedAt = new Date().toISOString();
    existing.activatedBy = activatedBy || existing.activatedBy;
    if (name) existing.name = name;
    if (language) existing.language = language;
    // Backfill settings for entries written before a key existed.
    existing.settings = { ...defaultGroupSettings(), ...(existing.settings || {}) };
    if (!existing.moderation) existing.moderation = { warnings: {}, mutes: {}, bans: {} };
    persist();
    return existing;
  }
  const entry = {
    id: groupJid,
    name: name || 'Unknown Group',
    enabled: true,
    activatedAt: new Date().toISOString(),
    activatedBy: activatedBy || null,
    language: language || 'en',
    settings: defaultGroupSettings(),
    moderation: { warnings: {}, mutes: {}, bans: {} }
  };
  cache[groupJid] = entry;
  persist();
  return entry;
}

export function deactivateGroup(groupJid) {
  ensureCache();
  const g = cache[groupJid];
  if (!g) return null;
  g.enabled = false;
  persist();
  return g;
}

/** Remove a group from the registry entirely (not just disable it). */
export function removeGroup(groupJid) {
  ensureCache();
  if (!cache[groupJid]) return null;
  const gone = cache[groupJid];
  delete cache[groupJid];
  persist();
  return gone;
}

export function updateGroup(groupJid, patch) {
  ensureCache();
  const g = cache[groupJid];
  if (!g) return null;
  Object.assign(g, patch || {});
  persist();
  return g;
}

export function getGroupSettings(groupJid) {
  const g = getGroup(groupJid);
  return g ? (g.settings || null) : null;
}

export function setGroupSetting(groupJid, key, value) {
  ensureCache();
  const g = cache[groupJid];
  if (!g) return null;
  if (!g.settings || typeof g.settings !== 'object') g.settings = defaultGroupSettings();
  g.settings[key] = value;
  persist();
  return g.settings;
}

/** Drop the in-memory cache so the next read comes from disk. */
export function reload() {
  cache = null;
  return loadGroups();
}

/** Test helper: point the cache at an arbitrary object. */
export function __setCacheForTests(obj) {
  cache = obj;
}

export { GROUPS_PATH };