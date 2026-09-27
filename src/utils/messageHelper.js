import config from '../config/config.js';
import logger from './logger.js';
import sessionManager from './sessionManager.js';
import { toSmallCaps } from './smallCaps.js';
import { menuTransitions } from '../config/menuConfig.js';
import { getUserByJid } from '../services/userService.js';
import { t } from '../services/localeService.js';
import { scheduleSelfDestruct } from '../services/selfDestructService.js';

/**
 * Send a menu message according to the transition defined in menuConfig
 * combined with the hybrid edit-vs-delete+send strategy.
 *
 * Modes:
 * - 'edit': try to edit the same message while `editCount < maxEditBeforeSend`.
 *   On success `editCount` is incremented. If the edit fails, or the threshold is
 *   reached, the old message is deleted and a fresh message is sent, and editCount resets to 0.
 * - 'delete_send': always delete the previous menu (if a key exists) and send a new one. Resets editCount.
 * - 'new': always send a new message; never edit/delete the previous menu. Resets editCount.
 *
 * Stores the new message key as lastMenuKey unless the transition says storeKey: false.
 * @returns {Promise<{ key: object|null, action: 'edited'|'sent' }>}
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

export async function sendMenu({ sock, sender, chatId, text, transitionKey, skipTyping = false, type = 'submenuTransition' }) {
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
  const maxEdit = config.maxEditBeforeSend ?? 2;

  let key = null;
  let action = 'sent';
  let nextEditCount = 0;

  if (transition.mode === 'new' || transition.mode === 'delete_send') {
    const sent = await deleteAndSend(sock, sender, lastMenuKey, text);
    key = sent?.key || null;
    await scheduleSelfDestruct(sock, sender, key);
    if (transition.mode === 'delete_send' && lastMenuKey) action = 'deleted_sent';
  } else if (transition.mode === 'edit_or_new') {
    if (lastMenuKey) {
      try {
        await sock.sendMessage(sender, { text, edit: lastMenuKey });
        key = lastMenuKey;
        await scheduleSelfDestruct(sock, sender, key, false);
        action = 'edited';
      } catch (err) {
        logger.warn({ err }, 'Menu edit failed, sending new message without deleting the old one');
        const sent = await sock.sendMessage(sender, { text });
        key = sent?.key || null;
        await scheduleSelfDestruct(sock, sender, key);
      }
    } else {
      const sent = await sock.sendMessage(sender, { text });
      key = sent?.key || null;
      await scheduleSelfDestruct(sock, sender, key);
    }
  } else {
    // 'edit' (or any pseudo-edit mode): hybrid edit vs delete+send
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