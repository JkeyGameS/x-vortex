import logger from '../utils/logger.js';
import { scheduleSelfDestruct } from './selfDestructService.js';
import { withTyping } from '../utils/typingHelper.js';

async function sendRaw(sock, jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  await scheduleSelfDestruct(sock, jid, sent?.key);
}

/**
 * Send a user-facing text reply with typing indicator + resolved delay.
 * Options: { type, skipTyping, typingDelayMs, presenceType }.
 * Types: mainMenu | submenuTransition | chatReply (default) | confirmation
 * | error | silent. Pass { skipTyping: true } or type 'silent' for immediate
 * system messages (broadcasts, reports, reminders, session notices).
 */
export async function sendText(sock, jid, text, options = {}) {
  try {
    const opts = { type: 'chatReply', ...(options || {}) };
    await withTyping(sock, jid, () => sendRaw(sock, jid, text), opts);
    return true;
  } catch (error) {
    logger.error({ err: error, jid }, 'Failed to send text');
    return false;
  }
}

/** Explicit typing send (same as sendText default). */
export async function sendTextWithTyping(sock, jid, text, options = {}) {
  return sendText(sock, jid, text, options);
}

/** Raw send without typing indicator or delay (system messages). */
export async function sendTextRaw(sock, jid, text) {
  try {
    await sendRaw(sock, jid, text);
    return true;
  } catch (error) {
    logger.error({ err: error, jid }, 'Failed to send raw text');
    return false;
  }
}

export async function sendError(sock, jid, text) {
  await sendText(sock, jid, `❌ ${text}`, { type: 'error' });
}
