import logger from './logger.js';

/**
 * Delete a message from a group chat (Phase 5).
 *
 * Only works when the bot itself is a group admin; Baileys rejects it
 * otherwise. Callers must check isBotGroupAdmin first and fall back to
 * warn-only -- this helper reports failure rather than throwing so the
 * moderation flow can continue.
 *
 * @param {object} sock Baileys socket
 * @param {string} chatId group JID
 * @param {object} messageKey Baileys WAMessageKey
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function tryDeleteMessage(sock, chatId, messageKey) {
  if (!messageKey) return { success: false, error: 'no_key' };
  try {
    await sock.sendMessage(chatId, { delete: messageKey });
    return { success: true };
  } catch (err) {
    logger.warn({ err, chatId }, '[ANTI_MOD] message delete failed');
    return { success: false, error: err?.message || String(err) };
  }
}