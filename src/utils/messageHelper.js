import config from '../config/config.js';
import logger from './logger.js';
import sessionManager from './sessionManager.js';
import { toSmallCaps } from './smallCaps.js';
import { menuTransitions } from '../config/menuConfig.js';
import { getUserByJid } from '../services/userService.js';
import { t } from '../services/localeService.js';
import { scheduleSelfDestruct } from '../services/selfDestructService.js';
import { checkOutbound, recordBlock } from '../services/outboundRateLimitService.js';

/**
 * Send a menu message according to the transition defined in menuConfig,
 * optionally overridden by a resolved display mode (messageSettingsService).
 *
 * Pass `bypassRateLimit: true` only for admin/system notifications.
 *
 * Display modes (override the transition's hybrid behavior):
 * - 'edit': always try to edit the stored menu key. On failure, fall back to
 *   delete + send so the user is never left without a menu.
 * - 'send_new': always send a new message; never edit or delete the previous menu.
 * - 'delete_send': always delete the previous menu, then send a new one.
 * - 'hybrid': the shipped default - edit while `editCount < maxEdit`, then
 *   delete + send. This matches the pre-feature behavior exactly.
 *
 * Transitions flagged 'edit_or_new' keep their legacy never-delete behavior.
 *
 * Stores the new message key as lastMenuKey unless the transition says storeKey: false.
 * @returns {Promise<{ key: object|null, action: 'edited'|'sent'|'deleted_sent'|'suppressed' }>}
 */
function deleteAndSend(sock, sender, lastMenuKey, text) {
  if (lastMenuKey) {
    try {
      sock.sendMessage(sender, { delete: lastMenuKey });
    } catch (err) {
      logger.warn({ err }, 'Menu delete failed, sending new message anyway');
    }
  }
  return sock.sendMessage(sender, { text });
}

export async function sendMenu({ sock, sender, chatId, text, transitionKey, skipTyping = false, type = 'submenuTransition', mode = null, bypassRateLimit = false }) {
  // Outbound rate limit gate. This is the single chokepoint for every menu
  // send: sendMenuById delegates here, and the edit/delete/send variants below
  // are all one logical message, so the check belongs at the top rather than
  // around each sock.sendMessage.
  if (bypassRateLimit !== true) {
    const check = checkOutbound(sender);
    if (!check.allowed) {
      logger.warn({ sender, reason: check.reason }, '[OUTBOUND_RATE_LIMIT] menu suppressed');
      try {
        const warning = recordBlock(check.reason);
        if (warning.shouldWarn) {
          const { notifyAdminsRateLimit } = await import('./adminRateLimitWarning.js');
          notifyAdminsRateLimit(sock, warning.count, check.reason).catch(() => {});
        }
      } catch (err) {
        logger.warn({ err }, '[OUTBOUND_RATE_LIMIT] failed to record block');
      }
      return { key: null, action: 'suppressed' };
    }
  }

  if (!skipTyping && type !== 'silent') {
    try {
      const { showTyping } = await import('./typingHelper.js');
      await showTyping(sock, sender, text, { type });
    } catch (err) {
      logger.warn({ err }, 'Menu typing indicator failed');
    }
  }
  const transition = menuTransitions[transitionKey] || { mode: 'new', storeKey: true };
  const session = sessionManager.getSession(sender, chatId) || {};
  const lastMenuKey = session.lastMenuKey;
  const editCount = session.editCount || 0;
  const maxEdit = config.messageDisplay?.editAttemptsBeforeDelete ?? config.maxEditBeforeSend ?? 2;

  // 'edit_or_new' never deletes; that is load-bearing for a few flows.
  // NOTE: the legacy transition mode 'edit' means HYBRID (edit twice, then
  // delete+send) - it is not the new always-edit display mode. Explicit
  // legacy modes are translated into the new vocabulary; an explicit `mode`
  // from the settings layer wins as-is.
  const LEGACY_MODE_MAP = { edit: 'hybrid', new: 'send_new' };
  const effective = transition.mode === 'edit_or_new'
    ? 'edit_or_new'
    : (mode || LEGACY_MODE_MAP[transition.mode] || transition.mode);

  let key = null;
  let action = 'sent';
  let nextEditCount = 0;

  if (effective === 'send_new') {
    // Never touch the previous menu message.
    const sent = await sock.sendMessage(sender, { text });
    key = sent?.key || null;
    await scheduleSelfDestruct(sock, sender, key);
  } else if (effective === 'edit' || effective === 'edit_or_new') {
    if (lastMenuKey) {
      try {
        await sock.sendMessage(sender, { text, edit: lastMenuKey });
        key = lastMenuKey;
        await scheduleSelfDestruct(sock, sender, key, false);
        action = 'edited';
        if (effective === 'edit') nextEditCount = editCount + 1;
      } catch (err) {
        logger.warn({ err }, 'Menu edit failed, sending new message');
        if (effective === 'edit_or_new') {
          const sent = await sock.sendMessage(sender, { text });
          key = sent?.key || null;
          await scheduleSelfDestruct(sock, sender, key);
        } else {
          const sent = await deleteAndSend(sock, sender, lastMenuKey, text);
          key = sent?.key || null;
          await scheduleSelfDestruct(sock, sender, key);
          nextEditCount = 0;
        }
      }
    } else {
      const sent = effective === 'edit_or_new'
        ? await sock.sendMessage(sender, { text })
        : await deleteAndSend(sock, sender, lastMenuKey, text);
      key = sent?.key || null;
      await scheduleSelfDestruct(sock, sender, key);
      nextEditCount = 0;
    }
  } else if (effective === 'delete_send') {
    const sent = await deleteAndSend(sock, sender, lastMenuKey, text);
    key = sent?.key || null;
    await scheduleSelfDestruct(sock, sender, key);
    if (lastMenuKey) action = 'deleted_sent';
  } else {
    // 'hybrid' (and any unknown mode): edit while under the threshold, else delete+send.
    if (lastMenuKey && editCount < maxEdit) {
      try {
        await sock.sendMessage(sender, { text, edit: lastMenuKey });
        key = lastMenuKey;
        await scheduleSelfDestruct(sock, sender, key, false);
        action = 'edited';
        nextEditCount = editCount + 1;
      } catch (err) {
        logger.warn({ err }, 'Menu edit failed, falling back to delete + send');
        const sent = await deleteAndSend(sock, sender, lastMenuKey, text);
        key = sent?.key || null;
        await scheduleSelfDestruct(sock, sender, key);
        nextEditCount = 0;
      }
    } else {
      const sent = await deleteAndSend(sock, sender, lastMenuKey, text);
      key = sent?.key || null;
      await scheduleSelfDestruct(sock, sender, key);
      nextEditCount = 0;
    }
  }

  const statePatch = { editCount: nextEditCount };
  if (transition.storeKey !== false) {
    statePatch.lastMenuKey = key;
  }
  sessionManager.setState(sender, chatId, statePatch);

  return { key, action };
}

/**
 * True for a WhatsApp group JID. Used by the router to divert group messages
 * before any DM handling runs.
 */
export function isGroupMessage(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

/** All @mentions attached to a message, normalised. */
export function extractMentionedJids(msg) {
  const ctx =
    msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo;
  const list = ctx?.mentionedJid;
  return Array.isArray(list) ? list : [];
}

/**
 * True when the bot is mentioned. Compares on the bare number so a JID stored
 * as "123:4@s.whatsapp.net" still matches a mention of "123@s.whatsapp.net".
 */
export function isBotMentioned(msg, botJid) {
  if (!botJid) return false;
  const mentions = extractMentionedJids(msg);
  if (mentions.includes(botJid)) return true;
  const bare = (jid) => String(jid || '').split('@')[0].split(':')[0];
  const botNumber = bare(botJid);
  if (!botNumber) return false;
  return mentions.some((j) => bare(j) === botNumber);
}

export function buildFarewell(language = config.defaultLanguage) {
  return [
    `> *${toSmallCaps('x vortex')}*`,
    '',
    toSmallCaps(t(language, 'farewell.tagline')),
    '',
    toSmallCaps(t(language, 'farewell.closed')),
    '',
    toSmallCaps(t(language, 'farewell.restart'))
  ].join('\n');
}

export async function exitMainMenu({ sock, sender, chatId }) {
  const user = await getUserByJid(sender);
  const language = user?.language || config.defaultLanguage;
  const farewell = buildFarewell(language);
  await sendMenu({ sock, sender, chatId, text: farewell, transitionKey: 'main_to_exit' });
  sessionManager.clear(sender, chatId);
}