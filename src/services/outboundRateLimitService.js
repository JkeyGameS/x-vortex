import logger from '../utils/logger.js';
import config from '../config/config.js';

/**
 * Outbound rate limiter -- a safety net against the bot being flagged as a
 * spam bot by the host or by WhatsApp.
 *
 * This is NOT the inbound conversation limiter. That one lives in
 * rateLimitService.js, counts replies a user receives, is per-user, and is
 * configured by the flat chatRateLimit* keys. This one counts every outbound
 * message the bot attempts, per chat and globally, and is configured by the
 * `rateLimit` block. The two are independent; neither replaces the other.
 *
 * State is in-memory and per-process. A redeploy resets it, which is the safe
 * direction to fail: a fresh process starts with empty windows.
 */

const chatWindows = new Map();   // jid -> array of timestamps
const globalWindow = [];         // array of timestamps

// Recent blocks, for deciding when to warn admins. Separate from the windows
// above: those are per-chat budgets, this is a global health signal.
const recentBlocks = [];
let lastAdminWarnAt = 0;

function cfg() {
  return (config && config.rateLimit) || {};
}

function prune(arr, now, windowMs) {
  while (arr.length > 0 && now - arr[0] > windowMs) arr.shift();
}

/**
 * Check whether an outbound message to this JID is allowed.
 * Consumes a slot on success. Does not consume one on failure, so a blocked
 * caller cannot deepen its own penalty by retrying.
 *
 * @param {string} jid destination chat
 * @returns {{ allowed: boolean, reason?: 'per_chat_limit'|'global_limit' }}
 */
export function checkOutbound(jid) {
  const c = cfg();
  if (c.enabled === false) return { allowed: true };

  const now = Date.now();
  const windowMs = c.windowMs || 60000;
  const perChatLimit = c.perChatPerMinute || 8;
  const globalLimit = c.globalPerMinute || 40;

  prune(globalWindow, now, windowMs);
  const chatWindow = chatWindows.get(jid) || [];
  prune(chatWindow, now, windowMs);

  if (chatWindow.length >= perChatLimit) {
    return { allowed: false, reason: 'per_chat_limit' };
  }
  if (globalWindow.length >= globalLimit) {
    return { allowed: false, reason: 'global_limit' };
  }

  chatWindow.push(now);
  globalWindow.push(now);
  chatWindows.set(jid, chatWindow);
  return { allowed: true };
}

/**
 * Diagnostic stats for the admin panel / health output.
 */
export function getOutboundRateLimitStats() {
  const c = cfg();
  const windowMs = c.windowMs || 60000;
  const now = Date.now();
  prune(globalWindow, now, windowMs);

  const chats = {};
  for (const [jid, arr] of chatWindows.entries()) {
    prune(arr, now, windowMs);
    if (arr.length > 0) chats[jid] = arr.length;
  }
  return {
    globalCount: globalWindow.length,
    chats,
    limits: {
      perChatPerMinute: c.perChatPerMinute || 8,
      globalPerMinute: c.globalPerMinute || 40,
      windowMs
    }
  };
}

/**
 * Note that a send was blocked, and say whether admins should be warned.
 *
 * Warned at most once per adminWarnCooldownMs, so a sustained flood produces
 * one alert rather than a second flood aimed at the admins.
 *
 * @returns {{ shouldWarn: boolean, count?: number }}
 */
export function recordBlock(reason) {
  const c = cfg();
  const now = Date.now();
  recentBlocks.push({ at: now, reason });

  const windowMs = c.adminWarnWindowMs || 300000;
  while (recentBlocks.length > 0 && now - recentBlocks[0].at > windowMs) recentBlocks.shift();

  const threshold = c.adminWarnThreshold || 5;
  const cooldown = c.adminWarnCooldownMs || 900000;

  if (recentBlocks.length >= threshold && now - lastAdminWarnAt > cooldown) {
    lastAdminWarnAt = now;
    logger.warn(
      { count: recentBlocks.length, reason },
      '[OUTBOUND_RATE_LIMIT] admin warning threshold reached'
    );
    return { shouldWarn: true, count: recentBlocks.length };
  }
  return { shouldWarn: false, count: recentBlocks.length };
}

/** Recent blocks, newest last. For diagnostics. */
export function getRecentBlocks() {
  return recentBlocks.map((b) => ({ ...b }));
}

/** Clear all limiter state. Tests only. */
export function resetOutboundRateLimit() {
  chatWindows.clear();
  globalWindow.length = 0;
  recentBlocks.length = 0;
  lastAdminWarnAt = 0;
}