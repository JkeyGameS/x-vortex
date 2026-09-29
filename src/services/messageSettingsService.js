import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'messageSettings.json');

export const MESSAGE_MODES = ['edit', 'send_new', 'delete_send', 'hybrid'];

export const DEFAULTS = {
  defaultMode: 'hybrid',
  allowUserOverride: true,
  perMenuOverrideEnabled: true,
  userOverrideRange: ['edit', 'send_new', 'delete_send', 'hybrid']
};

let cache = null;

function readFile() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    logger.warn({ err }, '[MSG] unreadable messageSettings.json, using defaults');
    return null;
  }
}

function writeFile(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
    return true;
  } catch (err) {
    logger.error({ err }, '[MSG] failed to persist messageSettings.json');
    return false;
  }
}

/** Load from disk (called at startup); creates the file with defaults if missing. */
export function loadSettings() {
  const disk = readFile();
  cache = {
    ...DEFAULTS,
    ...(disk || {}),
    userOverrideRange: Array.isArray(disk?.userOverrideRange) && disk.userOverrideRange.length
      ? disk.userOverrideRange.filter((m) => MESSAGE_MODES.includes(m))
      : [...DEFAULTS.userOverrideRange]
  };
  if (!cache.userOverrideRange.length) cache.userOverrideRange = [...DEFAULTS.userOverrideRange];
  if (!MESSAGE_MODES.includes(cache.defaultMode)) cache.defaultMode = DEFAULTS.defaultMode;
  if (!disk) writeFile(cache);
  return { ...cache };
}

export function getSettings() {
  if (!cache) return loadSettings();
  return { ...cache };
}

export function updateSetting(key, value) {
  const cur = getSettings();
  if (key === 'userOverrideRange') {
    const list = (Array.isArray(value) ? value : []).filter((m) => MESSAGE_MODES.includes(m));
    cur.userOverrideRange = list.length ? list : [...DEFAULTS.userOverrideRange];
  } else if (key === 'defaultMode') {
    if (!MESSAGE_MODES.includes(value)) return { ...cur, error: 'unknown_mode' };
    cur.defaultMode = value;
  } else if (key === 'allowUserOverride' || key === 'perMenuOverrideEnabled') {
    cur[key] = value === true;
  } else {
    return { ...cur, error: 'unknown_key' };
  }
  cache = cur;
  writeFile(cache);
  return { ...cache };
}

export function resetSettings() {
  cache = { ...DEFAULTS, userOverrideRange: [...DEFAULTS.userOverrideRange] };
  writeFile(cache);
  return { ...cache };
}

/**
 * Resolve the effective display mode.
 *
 * Precedence: per-menu override > user preference > global default > the
 * transition's own legacy mode.
 *
 * NOTE: 'hybrid' is the shipped default and means "keep each transition's
 * legacy behavior" (menuConfig marks some flows as always-new or
 * always-delete+send). Any other global default is an explicit admin choice
 * and overrides those transitions too. This is what stops the feature from
 * silently changing the behavior of back-navigation flows.
 */
export function resolveMessageMode(definition, user, settings) {
  const s = settings || getSettings();
  if (s.perMenuOverrideEnabled && definition && MESSAGE_MODES.includes(definition.messageMode)) {
    return definition.messageMode;
  }
  if (s.allowUserOverride && user?.preferences?.messageDisplayMode
      && MESSAGE_MODES.includes(user.preferences.messageDisplayMode)) {
    return user.preferences.messageDisplayMode;
  }
  if (s.defaultMode && s.defaultMode !== 'hybrid') return s.defaultMode;
  return null; // caller keeps the transition's legacy mode
}

export const __testing = { FILE, DATA_DIR };
