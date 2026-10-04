import config from '../config/config.js';
import { listBotGroups, isGroupAdmin } from './groupHelper.js';

/** Bot admins can always manage group settings. */
export function isBotAdmin(jid) {
  return Array.isArray(config.adminJids) && config.adminJids.includes(jid);
}

/**
 * True when the user is a bot admin OR an admin of at least one group the bot
 * is in. This gates the DM submenu; per-group checks use canManageGroup.
 *
 * @param {object} sock Baileys socket
 * @param {string} userJid
 * @returns {Promise<boolean>}
 */
export async function canManageGroups(sock, userJid) {
  if (!userJid) return false;
  if (isBotAdmin(userJid)) return true;
  const groups = await listBotGroups(sock);
  for (const g of groups || []) {
    if (await isGroupAdmin(sock, g.id, userJid)) return true;
  }
  return false;
}

/**
 * Per-group permission: bot admin, or admin of this specific group. Used before
 * revealing or changing anything about one group.
 */
export async function canManageGroup(sock, userJid, groupJid) {
  if (!userJid || !groupJid) return false;
  if (isBotAdmin(userJid)) return true;
  return isGroupAdmin(sock, groupJid, userJid);
}