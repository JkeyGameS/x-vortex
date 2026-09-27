import config from '../config/config.js';
import logger from '../utils/logger.js';
import { sendText, sendError } from '../services/messageService.js';
import { getUserByJid } from '../services/userService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { askConfirmation } from '../utils/confirmationHelper.js';
import { sendAdminPanel } from './adminCommand.js';
import { addError } from '../services/errorLogService.js';

function isAdmin(sender) {
  return (config.adminJids || []).includes(sender);
}

async function languageOf(sender) {
  const user = await getUserByJid(sender);
  return user?.language || config.defaultLanguage;
}

/**
 * Normalize a parsed backup payload into an object keyed by JID.
 * Supports:
 *  - the /backup payload: { generatedAt, app, version, count, users: {jid: user} }
 *  - a raw object keyed by JID
 *  - an array of user objects (each having a `jid`)
 * @returns {{ users: object, count: number }}
 */
export function normalizePayload(parsed) {
  let raw = parsed;

  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.users) {
    raw = raw.users;
  }

  if (Array.isArray(raw)) {
    const dict = {};
    for (const u of raw) {
      if (u && u.jid) dict[u.jid] = u;
    }
    return { users: dict, count: Object.keys(dict).length };
  }

  if (raw && typeof raw === 'object') {
    const dict = {};
    for (const [jid, u] of Object.entries(raw)) {
      if (u && typeof u === 'object' && !Array.isArray(u)) {
        dict[jid] = u;
      }
    }
    return { users: dict, count: Object.keys(dict).length };
  }

  throw new Error('Invalid backup: expected a JSON object or array of users.');
}

/**
 * Process raw JSON captured after an admin starts /restore.
 * Called from the message router when the session is in `awaiting_restore_data`.
 * @param {object} context - { sock, sender, chatId, pushName }
 * @param {string} jsonString - the raw text (or decoded document content)
 */
export async function handleRestoreData(context, jsonString) {
  const sender = context.sender;
  const chatId = context.chatId || sender;

  if (jsonString.trim() === '0') {
    await sendAdminPanel(context);
    return;
  }

  let parsed;
  let normalized;
  try {
    parsed = JSON.parse(jsonString.trim());
    normalized = normalizePayload(parsed);
  } catch (err) {
    logger.warn({ err: err.message, sender }, '[RESTORE] invalid JSON from admin');
    const language = await languageOf(sender);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'restore.invalidJson')));
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'restoreBackup', {
    users: normalized.users,
    count: normalized.count,
    returnTo: 'admin'
  });
}

export async function startRestore(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;

  const sessionManager = (await import('../utils/sessionManager.js')).default;
  sessionManager.setState(sender, chatId, {
    currentMenu: 'awaiting_restore_data',
    pendingAction: 'restore',
    pendingData: null
  });

  const language = await languageOf(sender);
  const tr = (key, params) => toSmallCaps(t(language, key, params));

  const text =
    '> *' + tr('restore.title') + '*\n\n' +
    tr('restore.prompt') + '\n\n' +
    tr('restore.cancelHint');

  const { sendMenu } = await import('../utils/messageHelper.js');
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'restore_input' });
  return { success: true };
}

export const command = {
  name: 'restore',
  description: 'Restore user data from a backup (admin)',
  usage: '/restore',
  aliases: ['import'],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    try {
      if (!isAdmin(context.sender)) {
        const language = await languageOf(context.sender);
        return sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.notAuthorized')));
      }
      return await startRestore(context);
    } catch (error) {
      addError(error);
      logger.error({ err: error, sender: context.sender, action: 'restore_command' }, '[RESTORE] Failed');
      await sendError(context.sock, context.sender, 'Failed to start restore.');
      throw error;
    }
  }
};
