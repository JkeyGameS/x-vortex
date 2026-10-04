import logger from '../utils/logger.js';
import { getGroup } from '../services/groupService.js';
import { getGroupMetadata, isBotGroupAdmin } from '../utils/groupHelper.js';
import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { isBotMentioned } from '../utils/messageHelper.js';
import config from '../config/config.js';

/**
 * Entry point for every group message.
 *
 * Groups never fall through to the DM router, so nothing here can trigger
 * onboarding, welcome-back, DM chat rules or the DM main menu.
 *
 * Group sends go through sendText WITHOUT bypassRateLimit, so they count
 * against the outbound per-chat limit under the group's JID. skipTyping avoids
 * a typing indicator in a group, which Baileys handles poorly at group scale.
 */
export async function handleGroupMessage({ sock, msg, chatId, sender, pushName, text }) {
  try {
    if (!config.groupManagementEnabled) {
      logger.debug({ chatId }, '[GROUP] feature disabled, ignored');
      return;
    }

    const group = getGroup(chatId);
    if (!group || group.enabled !== true) {
      logger.debug({ chatId }, '[GROUP] not activated, ignored');
      return;
    }

    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    const opts = { skipTyping: true };

    if (trimmed === '/groupinfo' || trimmed === '/ginfo') {
      await handleGroupInfo({ sock, chatId, opts });
      return;
    }

    // Mention-only is the Phase 1 default. Phase 3/5 will add real behaviour
    // behind this gate; for now an activated group simply stays quiet unless
    // addressed, so activation alone cannot turn the bot noisy.
    const settings = group.settings || {};
    if (settings.mentionOnly !== false && !isBotMentioned(msg, sock?.user?.id)) {
      logger.debug({ chatId, sender }, '[GROUP] ignored (mention-only)');
      return;
    }

    logger.debug({ chatId, sender }, '[GROUP] message ignored (Phase 1)');
  } catch (err) {
    logger.error({ err, chatId }, '[GROUP] handler threw');
  }
}

/** Read-only group summary. Values are dynamic and inserted as-is. */
async function handleGroupInfo({ sock, chatId, opts }) {
  const meta = await getGroupMetadata(sock, chatId);
  if (!meta) {
    await sendText(sock, chatId, '\u274C ' + toSmallCaps('Failed to load group info.'), opts);
    return;
  }
  const group = getGroup(chatId);
  const botAdmin = await isBotGroupAdmin(sock, chatId, sock?.user?.id);
  const memberCount = meta.participants?.length || 0;
  const activated = group?.enabled === true;

  const lines = [
    '> *\u{1F465} ' + toSmallCaps('Group Info') + '*',
    '',
    '\u{1F4DB} ' + toSmallCaps('Name') + ': ' + (meta.subject || group?.name || 'Unknown'),
    '\u{1F465} ' + toSmallCaps('Members') + ': ' + memberCount,
    '\u{1F310} ' + toSmallCaps('Language') + ': ' + (group?.language || 'en'),
    '\u2705 ' + toSmallCaps('Activated') + ': ' + (activated ? toSmallCaps('yes') : toSmallCaps('no')),
    '\u{1F916} ' + toSmallCaps('Bot is admin') + ': ' + (botAdmin ? toSmallCaps('yes') : toSmallCaps('no'))
  ];
  await sendText(sock, chatId, lines.join('\n'), opts);
}