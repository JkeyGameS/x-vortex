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
import { pushDebug } from '../services/groupDebugService.js';
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
/** YES/NO for a debug line; keeps the emissions readable. */
function yn(value) {
  return value ? 'YES' : 'NO';
}

/**
 * Header identifying which message the decision lines below belong to.
 * One header per message, reused by every decision, so a throttled batch reads
 * as a sequence rather than as unrelated lines.
 */
function debugLine(chatId, sender, pushName, text, group) {
  return [
    '\uD83D\uDD0D *' + toSmallCaps('Group Debug') + '*',
    '',
    toSmallCaps('From') + ': ' + (pushName || sender || 'unknown'),
    toSmallCaps('Sender') + ': @' + String(sender || '?').split('@')[0],
    toSmallCaps('Group') + ': ' + (group?.name || chatId),
    toSmallCaps('Text') + ': "' + String(text || '').slice(0, 100) + '"'
  ].join('\n');
}

export async function handleGroupMessage({ sock, msg, chatId, sender, pushName, text }) {
  try {
    if (!config.groupManagementEnabled) {
      logger.debug({ chatId }, '[GROUP] feature disabled, ignored');
      return;
    }

    const group = getGroup(chatId);
    if (!group || group.enabled !== true) {
      logger.debug({ chatId }, '[GROUP] not activated, ignored');
      await pushDebug(
        sock, chatId,
        debugLine(chatId, sender, pushName, text, null,
          '\u274C ' + toSmallCaps('Group not activated'))
      );
      return;
    }

    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    // One header identifying the message, reused by every decision below so a
    // batch of lines can be read as a sequence for a single message.
    const head = debugLine(chatId, sender, pushName, text, group);
    const say = (statusLine) => pushDebug(sock, chatId, head + '\n\n' + statusLine);

    // Stats (Phase 6): one O(1) in-memory increment per message, counted before
    // the banned/muted gates so totals reflect real activity. Slash-prefixed text
    // is a bot command and is not counted. The write is debounced in the service.
    if (!trimmed.startsWith('/')) {
      try { recordGroupMessage(chatId, sender); } catch { /* stats must never block */ }
    }

    if (isBanned(chatId, sender)) {
      logger.debug({ chatId, sender }, '[GROUP] banned user, ignored');
      await say('\u274C ' + toSmallCaps('User banned'));
      return;
    }
    if (isMuted(chatId, sender)) {
      const actorIsBotAdmin = Array.isArray(config.adminJids) && config.adminJids.includes(sender);
      const senderAdministers = actorIsBotAdmin
        ? true
        : await isGroupAdmin(sock, chatId, sender);
      if (!senderAdministers) {
        logger.debug({ chatId, sender }, '[GROUP] muted user, ignored');
        await say('\u274C ' + toSmallCaps('User muted'));
        return;
      }
      // Muted but administering: worth seeing, because "I am muted and still
      // being ignored" is the confusing case this debug mode exists for.
      await say('\u23ED ' + toSmallCaps('User muted but administers') +
        ' → ' + toSmallCaps('continuing'));
    }

    const opts = { skipTyping: true };
    const settings = group.settings || {};

    // Phase 5: one admin resolution shared by both checks and the violation
    // handlers. isGroupAdmin reads the cached participant list, so this costs at
    // most one metadata fetch per message.
    const senderIsBotAdmin = Array.isArray(config.adminJids) && config.adminJids.includes(sender);
    const senderIsGroupAdmin = senderIsBotAdmin ? false : await isGroupAdmin(sock, chatId, sender);
    const senderExempt = senderIsBotAdmin || senderIsGroupAdmin;

    // --- anti-link -------------------------------------------------------
    if (settings.antiLink && config.antiLinkEnabled !== false && config.antiLink?.enabled !== false) {
      const linkCfg = config.antiLink || {};
      const { hasLink, urls, hostnames } = detectLinks(trimmed);
      const exempt = linkCfg.exemptAdmins !== false && senderExempt;
      const allowedHost = isWhitelisted(hostnames, linkCfg.whitelist);
      const allowedInvite = linkCfg.allowInviteLinks === true && isInviteLink(urls);
      await say(
        '\uD83D\uDD17 ' + toSmallCaps('Anti-link') + ': ' +
        toSmallCaps('has link') + '=' + yn(hasLink) + ', ' +
        toSmallCaps('exempt') + '=' + yn(exempt) + ', ' +
        toSmallCaps('bot admin') + '=' + yn(senderExempt)
      );
      if (hasLink && !exempt && !allowedHost && !allowedInvite) {
        await say('\uD83D\uDEA8 ' + toSmallCaps('Anti-link violation') + ' → ' + toSmallCaps('handled'));
        await handleAntiLinkViolation({ sock, chatId, sender, msg, pushName, group, senderIsBotAdmin, senderIsGroupAdmin });
        return;
      }
    } else {
      await say('\u23ED\uFE0F ' + toSmallCaps('Anti-link') + ': ' + toSmallCaps('off'));
    }

    // --- anti-spam -------------------------------------------------------
    if (settings.antiSpam && config.antiSpamEnabled !== false && antiSpamActive()) {
      if (!senderExempt) {
        const result = recordMessage(chatId, sender, trimmed);
        await say(
          '\uD83D\uDEE1\uFE0F ' + toSmallCaps('Anti-spam') + ': ' +
          toSmallCaps('flagged') + '=' + yn(result.flagged) + ', ' +
          toSmallCaps('exempt') + '=' + yn(senderExempt)
        );
        if (result.flagged) {
          await say('\uD83D\uDEA8 ' + toSmallCaps('Anti-spam violation') + ' → ' + toSmallCaps('handled'));
          await handleAntiSpamViolation({ sock, chatId, sender, pushName, group }, result.reason);
          return;
        }
      } else {
        await say('\u23ED\uFE0F ' + toSmallCaps('Anti-spam') + ': ' + toSmallCaps('exempt') +
          ' → ' + toSmallCaps('skipped'));
      }
    } else {
      await say('\u23ED\uFE0F ' + toSmallCaps('Anti-spam') + ': ' + toSmallCaps('off'));
    }

    if (trimmed === '/groupinfo' || trimmed === '/ginfo') {
      await say('\u2139\uFE0F ' + toSmallCaps('/groupinfo') + ' → ' + toSmallCaps('handled'));
      await handleGroupInfo({ sock, chatId, opts });
      return;
    }

    // Mention-only is the Phase 1 default. Phase 3/5 add real behaviour behind
    // this gate; for now an activated group stays quiet unless addressed, so
    // activation alone cannot turn the bot noisy.
    if (settings.mentionOnly !== false && !isBotMentioned(msg, sock?.user?.id)) {
      logger.debug({ chatId, sender }, '[GROUP] ignored (mention-only)');
      await say('\u26A0\uFE0F ' + toSmallCaps('Mention-only') + ': ' + toSmallCaps('off') +
        ', ' + toSmallCaps('bot not mentioned') + ' → ' + toSmallCaps('ignored'));
      return;
    }

    // No chat-rule evaluation exists yet anywhere in this handler, so this line
    // is the diagnostic that says so rather than leaving the silence
    // unexplained. If it is ever wired up, this becomes the match/no-match pair.
    await say('\u23ED\uFE0F ' + toSmallCaps('Chat rules') + ': ' + toSmallCaps('not implemented'));
    await say('\u23F9 ' + toSmallCaps('No handler match'));
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
