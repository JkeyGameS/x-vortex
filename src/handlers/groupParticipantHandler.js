import logger from '../utils/logger.js';
import { getGroup } from '../services/groupService.js';
import { getGroupMetadata, invalidateGroupMetadata } from '../utils/groupHelper.js';
import { sendText } from '../services/messageService.js';
import { getContent } from '../services/botContentService.js';
import { resolvePlaceholders } from '../utils/placeholderResolver.js';
import { logAdminAction } from '../services/adminLogService.js';
import {
  recordJoin,
  recordLeave,
  adjustMemberCount,
  getCurrentMemberCount
} from '../services/groupStatsService.js';
import config from '../config/config.js';

/**
 * Welcome / goodbye messages for activated groups (Phase 3).
 *
 * Both messages go to the GROUP chat, never to the participant's DM: a DM to
 * every new member is intrusive and is exactly the pattern that gets a bot
 * flagged for spam.
 *
 * Sends go through sendText WITHOUT bypassRateLimit, so they count against the
 * group's per-chat outbound budget like any other message.
 *
 * @param {object} params
 * @param {object} params.sock Baileys socket
 * @param {object} params.update raw group-participants.update payload
 * @param {{sendText?:Function}} [params.deps] test seam; defaults to the real sendText
 */
export async function handleParticipantsUpdate({ sock, update, deps } = {}) {
  const send = deps?.sendText || sendText;
  try {
    if (!config.groupManagementEnabled) return;

    const { id: groupJid, participants, action } = update || {};
    if (!groupJid || !Array.isArray(participants) || participants.length === 0) return;

    const group = getGroup(groupJid);
    if (!group || group.enabled !== true) {
      logger.debug({ groupJid }, '[GROUP_PARTICIPANT] group not active, ignored');
      return;
    }

    // promote/demote and anything else are not join/leave events.
    if (action !== 'add' && action !== 'remove') return;

    const settings = group.settings || {};

    // Stats (Phase 6) are recorded regardless of the welcome/goodbye toggles, so
    // the counters reflect real membership churn rather than which notifications
    // happen to be switched on. Placed above the toggle gates for that reason.
    try {
      if (action === 'add') {
        recordJoin(groupJid);
        adjustMemberCount(groupJid, 1);
      } else {
        recordLeave(groupJid);
        adjustMemberCount(groupJid, -1);
      }
    } catch (err) {
      logger.warn({ err, groupJid }, '[GROUP_PARTICIPANT] stats update failed');
    }

    if (action === 'add' && settings.welcome !== true) return;
    if (action === 'remove' && settings.goodbye !== true) return;

    const templateKey = action === 'add' ? 'groupMessages.welcome' : 'groupMessages.goodbye';
    const template = getContent(templateKey);
    if (typeof template !== 'string' || !template.trim()) {
      logger.warn({ templateKey }, '[GROUP_PARTICIPANT] template missing or empty');
      return;
    }

    // On add the cached participant list is stale, so drop it first to get a
    // count that includes the new member. On remove the cached count is close
    // enough and a refetch is not worth the round trip.
    if (action === 'add') invalidateGroupMetadata(groupJid);

    const meta = await getGroupMetadata(sock, groupJid);
        // Prefer the stats-backed counter: Baileys metadata still shows the
    // pre-join roster on the add event, so meta.participants.length lags by one.
    // The counter is only set once syncMemberCount has established a baseline,
    // and getCurrentMemberCount returns null until then, so the first join in a
    // never-synced group correctly falls back to the metadata count rather than
    // reporting "member #1".
    const tracked = getCurrentMemberCount(groupJid);
    const memberCount = tracked != null
      ? tracked
      : (meta?.participants?.length || 0);
    const groupName = meta?.subject || group.name || 'Unknown';

    let sent = false;
    for (const participant of participants) {
      const participantJid = typeof participant === 'string' ? participant : participant?.id;
      if (!participantJid) continue;
      const pushName =
        (typeof participant === 'object' && participant?.pushName) ||
        jidToNumber(participantJid);

      const text = resolvePlaceholders(template, {
        pushName,
        groupName,
        memberCount,
        botName: config.botName || 'X-Vortex'
      });

      await send(sock, groupJid, text, { skipTyping: true });
      sent = true;
    }

    logAdminAction(
      'system',
      action === 'add' ? 'group_member_joined' : 'group_member_left',
      JSON.stringify({ groupJid, groupName, participants: participants.map(jidOf), sent })
    );
  } catch (err) {
    logger.error({ err }, '[GROUP_PARTICIPANT] handler threw');
  }
}

/** Normalise a participant entry (string or object) to its JID. */
function jidOf(p) {
  return typeof p === 'string' ? p : p?.id;
}

/** Baileys does not always have a pushName at join time; the number is a fine fallback. */
function jidToNumber(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}