import config from '../config/config.js';
import logger from './logger.js';
import settingsService from '../services/settingsService.js';
import { shouldShowTyping, shouldMarkRead } from './typingResolver.js';
import { getUserByJidSync } from '../services/userService.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Debounce: jid -> timestamp of the last typing presence we sent. Avoids
// restarting the indicator between messages sent back to back.
const lastTypingAt = new Map();
const TYPING_DEBOUNCE_MS = 2000;

export function isTypingEnabled() {
  try {
    const settings = settingsService.getSettings();
    if (typeof settings.typingIndicatorEnabled === 'boolean') return settings.typingIndicatorEnabled;
  } catch { /* fall through to config */ }
  return config.typingIndicatorEnabled !== false;
}

/** Compute the randomized typing delay for a reply text (legacy fallback). */
export function typingDelayFor(text, overrideMs = null) {
  if (overrideMs != null) return Math.min(10000, Math.max(0, Math.floor(Number(overrideMs) || 0)));
  const min = Math.max(0, Number(config.typingDelayMinMs) || 0);
  const max = Math.max(min, Number(config.typingDelayMaxMs) || 0);
  const baseDelay = min + Math.random() * (max - min);
  if (config.typingDelayScalesWithLength !== false) {
    const perChar = Math.max(0, Number(config.typingDelayPerCharMs) || 0);
    const cap = Math.max(baseDelay, Number(config.typingDelayMaxCapMs) || 0);
    return Math.min(baseDelay + String(text || '').length * perChar, cap || baseDelay);
  }
  return baseDelay;
}

async function sendPresence(sock, jid, state) {
  try {
    if (sock && typeof sock.sendPresenceUpdate === 'function') {
      await sock.sendPresenceUpdate(state, jid);
    }
  } catch (err) {
    logger.warn({ err }, 'Typing presence failed');
  }
}

/**
 * Show the typing indicator per the resolved typing preferences.
 * Options: { type, typingDelayMs (explicit override), presenceType (explicit override) }.
 * Resolves immediately when typing is disabled for this message type.
 */
export async function showTyping(sock, jid, text = '', options = {}) {
  if (!isTypingEnabled()) return;
  // Legacy compat: global conversation toggle also gates typing here.
  if (config.conversationTypingIndicator === false) return;
  const messageType = options && typeof options.type === 'string' && options.type ? options.type : 'chatReply';
  if (messageType === 'silent') return;
  let user = null;
  try {
    user = getUserByJidSync(jid);
  } catch { /* resolver falls back to admin defaults */ }
  let decision;
  try {
    decision = shouldShowTyping({ user, messageType, textLength: String(text || '').length });
  } catch {
    return;
  }
  if (!decision.show) return;
  const now = Date.now();
  const last = lastTypingAt.get(jid) || 0;
  // Debounce: a typing session is already active for this chat — skip both
  // the presence restart and the extra delay.
  if (now - last <= TYPING_DEBOUNCE_MS) return;
  const presence = (options && (options.presenceType === 'composing' || options.presenceType === 'recording'))
    ? options.presenceType
    : decision.presenceType;
  await sendPresence(sock, jid, presence);
  lastTypingAt.set(jid, now);
  const waitMs = options && options.typingDelayMs != null
    ? Math.min(10000, Math.max(0, Math.floor(Number(options.typingDelayMs) || 0)))
    : decision.delayMs;
  if (waitMs > 0) await delay(waitMs);
}

/** Mark typing as done (best effort). */
export async function hideTyping(sock, jid) {
  if (!isTypingEnabled()) return;
  await sendPresence(sock, jid, 'paused');
}

/**
 * Run fn() wrapped in typing presence + resolved delay.
 * Options: { skipTyping: true, type } — 'silent' type bypasses presence and delay.
 */
export async function withTyping(sock, jid, fn, options = {}) {
  if (options && (options.skipTyping || options.type === 'silent')) return fn();
  // Legacy compat: global conversation toggle also gates typing here.
  if (config.conversationTypingIndicator === false) return fn();
  await showTyping(sock, jid, '', options);
  try {
    return await fn();
  } finally {
    await hideTyping(sock, jid);
  }
}

/**
 * Best-effort read receipt shortly after an incoming message is processed.
 * Fire-and-forget: never throws, never blocks.
 */
export function markReadSoon(sock, jid, messageKey) {
  try {
    setTimeout(() => {
      (async () => {
        try {
          let user = null;
          try {
            user = getUserByJidSync(jid);
          } catch { /* admin default applies */ }
          if (!shouldMarkRead(user).enabled) return;
          if (sock && typeof sock.readMessages === 'function' && messageKey) {
            await sock.readMessages([messageKey]);
          }
        } catch (err) {
          logger.warn({ err }, 'Read receipt failed');
        }
      })();
    }, 300);
  } catch { /* never break message flow */ }
}
