import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import { getSettings as getChatSettings } from './chatSettingsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const RATE_LOG_FILE = path.join(DATA_DIR, 'rateLimitLog.json');

function resolveConfig(chatSettings) {
  const s = chatSettings && typeof chatSettings === 'object' ? chatSettings : {};
  let live = {};
  try {
    live = getChatSettings() || {};
  } catch { /* file config only */ }
  const pick = (key, fallback) => {
    if (s[key] !== undefined && s[key] !== null) return s[key];
    if (live[key] !== undefined && live[key] !== null) return live[key];
    return fallback;
  };
  const enabledRaw = pick('rateLimitEnabled', config.chatRateLimitEnabled !== false);
  const maxRaw = Math.floor(Number(pick('rateLimitMaxReplies', config.chatRateLimitMaxReplies)) || 0);
  const windowRaw = Math.floor(Number(pick('rateLimitWindowMs', config.chatRateLimitWindowMs)) || 0);
  const behaviorRaw = pick('rateLimitBehavior', config.chatRateLimitCooldownBehavior);
  return {
    enabled: enabledRaw !== false,
    max: maxRaw > 0 ? Math.min(1000, maxRaw) : 10,
    windowMs: windowRaw > 0 ? Math.min(3600000, windowRaw) : 60000,
    behavior: behaviorRaw === 'polite' ? 'polite' : 'silent'
  };
}

function pruneList(list, now, windowMs) {
  return (Array.isArray(list) ? list : []).filter((ts) => Number.isFinite(Number(ts)) && now - Number(ts) < windowMs);
}

function appendSuppression(entry) {
  try {
    let arr = [];
    if (fs.existsSync(RATE_LOG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RATE_LOG_FILE, 'utf8'));
      if (Array.isArray(parsed)) arr = parsed;
    }
    arr.push(entry);
    if (arr.length > 1000) arr = arr.slice(-1000);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RATE_LOG_FILE, JSON.stringify(arr, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to append rate limit log');
  }
}

/**
 * Conversation-level per-user rate check.
 * @param {string} jid user id
 * @param {object} session live session object (mutated: chatRepliesInWindow, rateLimitPoliteSentAt)
 * @param {object} chatSettings effective chat settings (may be partial)
 * @param {number} now override timestamp (tests)
 * @returns {{ allowed: boolean, politeDue: boolean, count: number, cfg: object }}
 */
export function checkRateLimit(jid, session, chatSettings, now = Date.now()) {
  const cfg = resolveConfig(chatSettings);
  if (!cfg.enabled) return { allowed: true, politeDue: false, count: 0, cfg };
  const sess = session && typeof session === 'object' ? session : {};
  const pruned = pruneList(sess.chatRepliesInWindow, now, cfg.windowMs);
  sess.chatRepliesInWindow = pruned;
  if (pruned.length < cfg.max) {
    return { allowed: true, politeDue: false, count: pruned.length, cfg };
  }
  appendSuppression({
    userId: jid,
    count: pruned.length,
    behavior: cfg.behavior,
    timestamp: new Date(now).toISOString()
  });
  let politeDue = false;
  if (cfg.behavior === 'polite') {
    const lastPolite = Number(sess.rateLimitPoliteSentAt || 0);
    politeDue = !(lastPolite > 0 && now - lastPolite < cfg.windowMs);
  }
  return { allowed: false, politeDue, count: pruned.length, cfg };
}

/**
 * Record one delivered reply in the user's window. Mutates the session object;
 * the caller persists it via sessionManager.setState.
 */
export function recordReply(session, now = Date.now()) {
  if (!session || typeof session !== 'object') return [];
  const list = Array.isArray(session.chatRepliesInWindow) ? session.chatRepliesInWindow : [];
  list.push(now);
  session.chatRepliesInWindow = list;
  return list;
}

export function markPoliteSent(session, now = Date.now()) {
  if (session && typeof session === 'object') session.rateLimitPoliteSentAt = now;
}

export function getRateLimitLog(limit = 20) {
  try {
    if (fs.existsSync(RATE_LOG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RATE_LOG_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed.slice(-Math.max(1, limit)).reverse();
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read rate limit log');
  }
  return [];
}
