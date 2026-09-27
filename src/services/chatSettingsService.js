import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import config from '../config/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'chatSettings.json');
const IGNORE_FILE = path.join(DATA_DIR, 'chatIgnoreList.json');
const RATE_LOG_FILE = path.join(DATA_DIR, 'rateLimitLog.json');
const DRY_RUN_FILE = path.join(DATA_DIR, 'chatDryRunLog.json');
const MATCH_LOG_FILE = path.join(DATA_DIR, 'chatMatchLog.json');

const MAX_LOG_ENTRIES = 1000;

export function defaultChatSettings() {
  return {
    chatEnabled: true,
    fuzzyMatching: 'normal',
    defaultCooldownSeconds: 0,
    fallbackBehavior: 'friendly',
    priorityMode: 'highest',
    autoTranslate: false,
    contextAwareness: true,
    maxRepliesPerMinute: 0,
    dryRunMode: false,
    logChatMatches: false,
    languageFilter: ['en', 'fr', 'de', 'es', 'ar'],
    chatReplyDelayMs: null,
    antiRepetition: true,
    weightedRandom: true,
    contextAwarenessEnabled: true,
    contextExpiryMs: 120000,
    toneDetection: true,
    timeAwareness: true,
    replyStylePersonalization: true,
    followUps: true,
    followUpChance: 0.3,
    abTesting: true,
    contextPriorityBoost: 100,
    rateLimitEnabled: true,
    rateLimitMaxReplies: 10,
    rateLimitWindowMs: 60000,
    rateLimitBehavior: 'silent',
    snippetMaxDepth: 3
  };
}

const VALID_FUZZY = ['strict', 'normal', 'loose', 'off'];
const VALID_FALLBACK = ['friendly', 'silent', 'ask_admin', 'help_only'];
const VALID_PRIORITY = ['strict', 'random', 'highest'];

let settings = null;

function load() {
  settings = { ...defaultChatSettings() };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = { ...settings, ...parsed };
      }
    } else {
      save();
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load chat settings');
  }
  return settings;
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save chat settings');
  }
}

load();

export function getSettings() {
  if (!settings) load();
  return { ...settings };
}

function sanitizeValue(key, value) {
  switch (key) {
    case 'chatEnabled':
    case 'autoTranslate':
    case 'contextAwareness':
    case 'dryRunMode':
    case 'logChatMatches':
    case 'antiRepetition':
    case 'weightedRandom':
    case 'contextAwarenessEnabled':
    case 'toneDetection':
    case 'timeAwareness':
    case 'replyStylePersonalization':
    case 'followUps':
    case 'abTesting':
    case 'rateLimitEnabled':
      return value === true;
    case 'rateLimitBehavior':
      return value === 'polite' ? 'polite' : 'silent';
    case 'contextPriorityBoost': {
      const b = Math.floor(Number(value) || 0);
      return b > 0 ? Math.min(10000, b) : 100;
    }
    case 'rateLimitMaxReplies': {
      const n = Math.floor(Number(value) || 0);
      return n > 0 ? Math.min(1000, n) : 10;
    }
    case 'rateLimitWindowMs': {
      const ms = Math.floor(Number(value) || 0);
      return ms > 0 ? Math.min(3600000, ms) : 60000;
    }
    case 'snippetMaxDepth': {
      const d = Math.floor(Number(value) || 0);
      return d > 0 ? Math.min(10, d) : 3;
    }
    case 'followUpChance': {
      const c = Number(value);
      if (!Number.isFinite(c)) return 0.3;
      return Math.min(1, Math.max(0, c));
    }
    case 'contextExpiryMs': {
      const ms = Math.floor(Number(value) || 0);
      return ms > 0 ? Math.min(3600000, ms) : 120000;
    }
    case 'fuzzyMatching':
      return VALID_FUZZY.includes(value) ? value : 'normal';
    case 'fallbackBehavior':
      return VALID_FALLBACK.includes(value) ? value : 'friendly';
    case 'priorityMode':
      return VALID_PRIORITY.includes(value) ? value : 'highest';
    case 'defaultCooldownSeconds':
    case 'maxRepliesPerMinute': {
      const n = Math.max(0, Math.floor(Number(value) || 0));
      return key === 'maxRepliesPerMinute' ? n : Math.min(86400, n);
    }
    case 'languageFilter':
      if (!Array.isArray(value)) return defaultChatSettings().languageFilter;
      return value.filter((l) => ['en', 'fr', 'de', 'es', 'ar'].includes(l));
    case 'chatReplyDelayMs':
      if (value === null || value === undefined || value === '') return null;
      return Math.min(10000, Math.max(0, Math.floor(Number(value) || 0)));
    default:
      return undefined;
  }
}

export function updateSetting(key, value) {
  if (!settings) load();
  if (!(key in defaultChatSettings())) return null;
  settings[key] = sanitizeValue(key, value);
  save();
  return { ...settings };
}

export function resetSettings() {
  settings = { ...defaultChatSettings() };
  save();
  return { ...settings };
}

export function reloadSettings() {
  return load();
}

// ---------------------------------------------------------------------------
// Ignore list (chat rule matching)
// ---------------------------------------------------------------------------

function readStringArray(file) {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    }
  } catch (err) {
    logger.warn({ err, file }, 'Failed to load list file');
  }
  return [];
}

function writeJson(file, obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (err) {
    logger.warn({ err, file }, 'Failed to save list file');
  }
}

export function getIgnoreList() {
  return readStringArray(IGNORE_FILE);
}

export function isIgnored(jid) {
  return getIgnoreList().includes(jid);
}

export function addIgnore(jid) {
  const list = getIgnoreList();
  if (!jid || list.includes(jid)) return false;
  list.push(jid);
  writeJson(IGNORE_FILE, list);
  return true;
}

export function removeIgnore(jid) {
  const list = getIgnoreList().filter((x) => x !== jid);
  writeJson(IGNORE_FILE, list);
  return true;
}

export function clearIgnoreList() {
  writeJson(IGNORE_FILE, []);
}

// ---------------------------------------------------------------------------
// Append-only capped logs (rate limits, dry runs, matches)
// ---------------------------------------------------------------------------

function appendCapped(file, entry) {
  try {
    let arr = [];
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) arr = parsed;
    }
    arr.push(entry);
    if (arr.length > MAX_LOG_ENTRIES) arr = arr.slice(-MAX_LOG_ENTRIES);
    writeJson(file, arr);
  } catch (err) {
    logger.warn({ err, file }, 'Failed to append log');
  }
}

export function logRateLimit(userId, count) {
  appendCapped(RATE_LOG_FILE, { userId, count, timestamp: new Date().toISOString() });
}

export function logDryRun(ruleId, userId, message, meta = {}) {
  const rich = meta && typeof meta === 'object' && Object.keys(meta).length > 0;
  const entry = rich
    ? {
      timestamp: new Date().toISOString(),
      userId,
      message: String(message || '').slice(0, 200),
      ruleId,
      ruleTriggers: Array.isArray(meta.ruleTriggers) ? meta.ruleTriggers.slice(0, 20) : [],
      selectedReply: String(meta.selectedReply || '').slice(0, 200),
      styleUsed: meta.styleUsed || 'friendly',
      contextBefore: meta.contextBefore ?? null,
      contextAfter: meta.contextAfter ?? null,
      detectedTone: meta.detectedTone || 'neutral',
      timeOfDay: meta.timeOfDay || null,
      effectivePriority: meta.effectivePriority ?? null,
      engagementBonus: typeof meta.engagementBonus === 'number' ? meta.engagementBonus : 0,
      filtersApplied: Array.isArray(meta.filtersApplied) ? meta.filtersApplied : [],
      followUpUsed: !!meta.followUpUsed,
      followUpText: String(meta.followUpText || '').slice(0, 120)
    }
    : { ruleId, userId, message: String(message || '').slice(0, 200), timestamp: new Date().toISOString() };
  try {
    let max = 500;
    try {
      const n = Math.floor(Number(config && config.chatDryRunMaxLogEntries) || 0);
      if (n > 0) max = Math.min(5000, n);
    } catch { /* default cap */ }
    let arr = [];
    if (fs.existsSync(DRY_RUN_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DRY_RUN_FILE, 'utf8'));
      if (Array.isArray(parsed)) arr = parsed;
    }
    arr.push(entry);
    if (arr.length > max) arr = arr.slice(-max);
    writeJson(DRY_RUN_FILE, arr);
  } catch (err) {
    logger.warn({ err, file: DRY_RUN_FILE }, 'Failed to append log');
  }
}

export function getDryRunLog() {
  try {
    if (fs.existsSync(DRY_RUN_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DRY_RUN_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    logger.warn({ err, file: DRY_RUN_FILE }, 'Failed to read dry-run log');
  }
  return [];
}

export function clearDryRunLog() {
  writeJson(DRY_RUN_FILE, []);
}

export function getRateLimitLog() {
  try {
    if (fs.existsSync(RATE_LOG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RATE_LOG_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    logger.warn({ err, file: RATE_LOG_FILE }, 'Failed to read rate limit log');
  }
  return [];
}

export function logChatMatch(ruleId, userId, message, meta = {}) {
  appendCapped(MATCH_LOG_FILE, {
    ruleId,
    userId,
    message: String(message || '').slice(0, 200),
    timestamp: new Date().toISOString(),
    ...(meta && typeof meta === 'object' ? meta : {})
  });
}
