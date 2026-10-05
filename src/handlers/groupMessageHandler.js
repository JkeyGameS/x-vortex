import logger from '../utils/logger.js';
import { getGroup } from '../services/groupService.js';
import { getGroupMetadata, isBotGroupAdmin, isGroupAdmin } from '../utils/groupHelper.js';
import { isMuted, isBanned, addWarning, muteUser } from '../services/moderationService.js';
import { recordMessage as recordGroupMessage } from '../services/groupStatsService.js';
import {
  recordMessage,
  recordOffense,
  getMuteDurationForOffense,
  antiSpamActive
} from '../services/antiSpamService.js';
import { detectLinks, isWhitelisted, isInviteLink } from '../utils/linkDetector.js';
import { tryDeleteMessage } from '../utils/deleteMessage.js';
import { sendText } from '../services/messageService.js';
import { getContent } from '../services/botContentService.js';
import { resolvePlaceholders } from '../utils/placeholderResolver.js';
import { humanizeDuration } from '../utils/humanizeDuration.js';
import { logAdminAction } from '../services/adminLogService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { isBotMentioned } from '../utils/messageHelper.js';
import config from '../config/config.js';

/**
 * Entry point for every group message.
 *
 * Groups never fall through to the DM router, so nothing here can trigger
 * onboarding, welcome-back, DM chat rules or the DM main menu.
 *
 * Check order matters and is fixed:
 *   1. feature kill switch
 *   2. group activated
 *   3. banned / muted (Phase 4) -- before any tracking, so a silenced user is
 *      not also counted as spamming
 *   4. anti-link (Phase 5) -- before anti-spam, because a link is a more
 *      specific offence than volume
 *   5. anti-spam (Phase 5)
 *   6. /groupinfo
 *   7. mention-only gate
 *
 * Any violation returns immediately.
 *
 * Group sends go through sendText WITHOUT bypassRateLimit, so they count
 * against the group's per-chat outbound budget.
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

    // Stats (Phase 6): one O(1) in-memory increment per message, counted before
    // the banned/muted gates so totals reflect real activity. Slash-prefixed text
    // is a bot command and is not counted. The write is debounced in the service.
    if (!trimmed.startsWith('/')) {
      try { recordGroupMessage(chatId, sender); } catch { /* stats must never block */ }
    }

    if (isBanned(chatId, sender)) {
      logger.debug({ chatId, sender }, '[GROUP] banned user, ignored');
      return;
    }
    if (isMuted(chatId, sender)) {
      const actorIsBotAdmin = Array.isArray(config.adminJids) && config.adminJids.includes(sender);
      const senderAdministers = actorIsBotAdmin
        ? true
        : await isGroupAdmin(sock, chatId, sender);
      if (!senderAdministers) {
        logger.debug({ chatId, sender }, '[GROUP] muted user, ignored');
        return;
      }
    }

    const opts = { skipTyping: true };
    const settings = group.settings || {};

    // Phase 5: one admin resolution shared by both checks and the violation
    // handlers. isGroupAdmin reads the cached participant list, so this costs at
    // most one metadata fetch per message.
    const senderIsBotAdmin = Array.isArray(config.adminJids) && config.adminJids.includes(sender);
    const senderIsGroupAdmin = senderIsBotAdmin ? false : await isGroupAdmin(sock, chatId, sender);
    const senderExempt = senderIsBotAdmin || senderIsGroupAdmin;
    const actor = { sock, chatId, sender, msg, pushName, group, senderIsBotAdmin, senderIsGroupAdmin };

    // --- anti-link -------------------------------------------------------
    if (settings.antiLink && config.antiLinkEnabled !== false && config.antiLink?.enabled !== false) {
      const linkCfg = config.antiLink || {};
      const { hasLink, urls, hostnames } = detectLinks(trimmed);
      const exempt = linkCfg.exemptAdmins !== false && senderExempt;
      const allowedHost = isWhitelisted(hostnames, linkCfg.whitelist);
      const allowedInvite = linkCfg.allowInviteLinks === true && isInviteLink(urls);
      if (hasLink && !exempt && !allowedHost && !allowedInvite) {
        await handleAntiLinkViolation(actor);
        return;
      }
    }

    // --- anti-spam -------------------------------------------------------
    if (settings.antiSpam && config.antiSpamEnabled !== false && antiSpamActive()) {
      if (!senderExempt) {
        const result = recordMessage(chatId, sender, trimmed);
        if (result.flagged) {
          await handleAntiSpamViolation(actor, result.reason);
          return;
        }
      }
    }

    if (trimmed === '/groupinfo' || trimmed === '/ginfo') {
      await handleGroupInfo({ sock, chatId, opts });
      return;
    }

    // Mention-only is the Phase 1 default. Phase 3/5 add real behaviour behind
    // this gate; for now an activated group stays quiet unless addressed, so
    // activation alone cannot turn the bot noisy.
    if (settings.mentionOnly !== false && !isBotMentioned(msg, sock?.user?.id)) {
      logger.debug({ chatId, sender }, '[GROUP] ignored (mention-only)');
      return;
    }

    logger.debug({ chatId, sender }, '[GROUP] message ignored (Phase 1)');
  } catch (err) {
    logger.error({ err, chatId }, '[GROUP] handler threw');
  }
}

/** DM a moderated user. A closed DM must not break the flow. */
async function notify(sock, userJid, templateKey, ctx) {
  try {
    const template = getContent(templateKey);
    if (typeof template !== 'string' || !template.trim()) return false;
    const text = resolvePlaceholders(template, ctx);
    return await sendText(sock, userJid, text, { skipTyping: true }) !== false;
  } catch {
    return false;
  }
}

function logSystem(action, payload) {
  try {
    logAdminAction('system', action, JSON.stringify(payload));
  } catch { /* logging must never break moderation */ }
}

function groupNameOf(group, chatId) {
  return group?.name || chatId;
}

/**
 * A link was posted. Deletes the message only when the bot is a group admin;
 * otherwise it falls back to warn-only, because Baileys rejects the delete.
 */
async function handleAntiLinkViolation({ sock, chatId, sender, msg, pushName, group }) {
  const linkCfg = config.antiLink || {};
  const action = linkCfg.action || 'warn';
  const groupName = groupNameOf(group, chatId);

  let deleted = false;
  const wantsDelete = action === 'delete' || action === 'delete_warn' || action === 'delete_warn_mute';
  if (wantsDelete) {
    // A bot admin who is not a WhatsApp group admin still cannot delete, so
    // this is checked against the group, not against config.adminJids.
    const botIsGroupAdmin = await isBotGroupAdmin(sock, chatId, sock?.user?.id);
    if (botIsGroupAdmin) {
      deleted = (await tryDeleteMessage(sock, chatId, msg?.key)).success;
    }
  }

  const warned = addWarning(chatId, sender, 'posted a link');
  const warningCount = warned?.count || 1;
  const threshold = (config.moderation && config.moderation.warnKickThreshold) || 5;

  const wantsWarn = action === 'warn' || action === 'delete_warn' || action === 'delete_warn_mute';
  if (wantsWarn) {
    await notify(sock, sender, 'moderationMessages.antiLinkWarning', {
      pushName: pushName || String(sender).split('@')[0],
      groupName,
      count: warningCount,
      threshold
    });
  }

  let muted = false;
  if (action === 'delete_warn_mute') {
    const offense = recordOffense(chatId, sender);
    const durationMs = getMuteDurationForOffense(offense.count);
    muteUser(chatId, sender, durationMs, 'link posting');
    muted = true;
    await notify(sock, sender, 'moderationMessages.antiLinkMuted', {
      groupName,
      duration: humanizeDuration(durationMs)
    });
  }

  logSystem('group_user_link_detected', {
    groupJid: chatId, userJid: sender, action, deleted, warningCount, muted
  });
}

/** Flood or repeat detected. */
async function handleAntiSpamViolation({ sock, chatId, sender, pushName, group }, reason) {
  const spamCfg = config.antiSpam || {};
  const action = spamCfg.action || 'warn';
  const groupName = groupNameOf(group, chatId);
  const why = reason === 'flood' ? 'flooding' : 'repeating messages';

  const offense = recordOffense(chatId, sender);
  const durationMs = getMuteDurationForOffense(offense.count);

  const warned = addWarning(chatId, sender, why);
  const warningCount = warned?.count || 1;
  const threshold = (config.moderation && config.moderation.warnKickThreshold) || 5;

  const wantsWarn = action === 'warn' || action === 'warn_then_mute' || action === 'mute_then_kick';
  if (wantsWarn) {
    await notify(sock, sender, 'moderationMessages.antiSpamWarning', {
      pushName: pushName || String(sender).split('@')[0],
      groupName,
      count: warningCount,
      threshold
    });
  }

  // 'warn_then_mute' mutes from the second offense, not the first.
  const shouldMute = action === 'mute'
    || action === 'mute_then_kick'
    || (action === 'warn_then_mute' && offense.count >= 2);

  if (shouldMute) {
    muteUser(chatId, sender, durationMs, why);
    await notify(sock, sender, 'moderationMessages.antiSpamMuted', {
      groupName,
      duration: humanizeDuration(durationMs)
    });
  }

  logSystem('group_user_antispam_detected', {
    groupJid: chatId, userJid: sender, reason, offenseCount: offense.count, muted: shouldMute
  });
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
