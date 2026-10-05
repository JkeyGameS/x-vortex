import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { humanizeDuration } from '../utils/humanizeDuration.js';
import { getGroup, getAllGroups } from '../services/groupService.js';
import { getContent } from '../services/botContentService.js';
import { resolvePlaceholders } from '../utils/placeholderResolver.js';
import { logAdminAction } from '../services/adminLogService.js';
import {
  canModerate,
  addWarning,
  removeLastWarning,
  getWarnings,
  muteUser,
  unmuteUser,
  banUser,
  unbanUser,
  isMuted,
  isBanned
} from '../services/moderationService.js';
import { isGroupAdmin, isBotGroupAdmin } from '../utils/groupHelper.js';
import config from '../config/config.js';

/**
 * Shared moderation flows (Phase 4).
 *
 * Every flow is invoked from DM by a bot admin or an admin of the target group.
 * The slash commands in moderationCommands.js and the Group Management submenu
 * both call into here, so there is exactly one implementation of each action.
 *
 * Nothing here bypasses the outbound rate limiter: the DMs to moderated users
 * are ordinary sends and count like any other.
 */

const DM_OPTS = { skipTyping: true };
const MEMBER_PAGE_SIZE = 20;

const NO_REASON = 'no reason given';

function modCfg() {
  return (config && config.moderation) || {};
}

/** Push a DM at a moderated user. Never let a closed DM break the flow. */
async function notifyUser(sock, userJid, templateKey, ctx) {
  try {
    const template = getContent(templateKey);
    if (typeof template !== 'string' || !template.trim()) return false;
    const text = resolvePlaceholders(template, ctx);
    const ok = await sendText(sock, userJid, text, DM_OPTS);
    return ok !== false;
  } catch {
    // A user who has blocked the bot, or a JID that cannot be DM'd, is normal.
    return false;
  }
}

function usage(context, text) {
  return sendText(context.sock, context.sender, toSmallCaps('Usage: ') + text, DM_OPTS);
}

function disabled(context) {
  return sendText(
    context.sock,
    context.sender,
    '\u{1F6AB} ' + toSmallCaps('Moderation is currently disabled.'),
    DM_OPTS
  );
}

function permissionDenied(context) {
  return sendText(
    context.sock,
    context.sender,
    '\u{1F6AB} ' + toSmallCaps("You don't have permission to moderate this group."),
    DM_OPTS
  );
}

function notFound(context) {
  return sendText(
    context.sock,
    context.sender,
    '\u274C ' + toSmallCaps('Group not found. Activate it first via /groups.'),
    DM_OPTS
  );
}

async function guard(context, groupJid) {
  if (config.moderationEnabled === false || modCfg().enabled === false) {
    await disabled(context);
    return false;
  }
  if (!groupJid) return false;
  if (!getGroup(groupJid)) {
    await notFound(context);
    return false;
  }
  const allowed = await canModerate(context.sock, context.sender, groupJid, isGroupAdmin);
  if (!allowed) {
    await permissionDenied(context);
    return false;
  }
  return true;
}

function log(actorJid, action, payload) {
  try {
    logAdminAction(actorJid, action, JSON.stringify(payload));
  } catch { /* logging must never break the flow */ }
}

/**
 * Remove a participant. Requires the bot itself to be a group admin; without
 * that Baileys rejects the call, so refuse up front with a clear reason.
 */
export async function tryKick(sock, groupJid, userJid, reason) {
  try {
    const botAdmin = await isBotGroupAdmin(sock, groupJid, sock?.user?.id);
    if (!botAdmin) return { success: false, error: 'bot_not_admin' };
    await sock.groupParticipantsUpdate(groupJid, [userJid], 'remove');
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

/** /warn <groupJid> <userJid> [reason...] -- with auto-escalation. */
export async function flowWarn(context, { groupJid, userJid, reason }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/warn <groupJid> <userJid> [reason]');
    return { ok: false };
  }
  const why = reason || NO_REASON;
  const cfg = modCfg();
  const result = addWarning(groupJid, userJid, why);
  if (!result) {
    await notFound(context);
    return { ok: false };
  }
  const group = getGroup(groupJid);
  const groupName = group.name || groupJid;

  const kickThreshold = cfg.warnKickThreshold || 5;
  const muteThreshold = cfg.warnMuteThreshold || 3;

  await notifyUser(context.sock, userJid, 'moderationMessages.warningDM', {
    pushName: String(userJid).split('@')[0],
    groupName,
    reason: why,
    count: result.count,
    threshold: kickThreshold
  });

  log(context.sender, 'group_user_warned', {
    groupJid, userJid, reason: why, count: result.count
  });

  let escalated = null;
  if (result.count >= kickThreshold) {
    const kicked = await tryKick(context.sock, groupJid, userJid, 'warning threshold reached');
    if (kicked.success) {
      await notifyUser(context.sock, userJid, 'moderationMessages.autoKickDM', {
        groupName, threshold: kickThreshold
      });
      log('system', 'group_user_auto_kicked', {
        groupJid, userJid, warningCount: result.count
      });
      escalated = 'auto_kick';
    } else {
      // The bot cannot remove members, so at least stop hearing them.
      muteUser(groupJid, userJid, cfg.maxMuteDurationMs || 7 * 24 * 60 * 60 * 1000,
        'auto: kick unavailable, warning threshold reached');
      log('system', 'group_user_auto_muted', {
        groupJid, userJid, warningCount: result.count, fallback: kicked.error
      });
      escalated = 'auto_mute_fallback';
    }
  } else if (result.count >= muteThreshold) {
    const durationMs = cfg.warnMuteDurationMs || 30 * 60 * 1000;
    muteUser(groupJid, userJid, durationMs, 'warning threshold reached');
    await notifyUser(context.sock, userJid, 'moderationMessages.autoMuteDM', {
      groupName,
      duration: humanizeDuration(durationMs),
      threshold: muteThreshold
    });
    log('system', 'group_user_auto_muted', {
      groupJid, userJid, warningCount: result.count, durationMs
    });
    escalated = 'auto_mute';
  }

  await sendText(
    context.sock,
    context.sender,
    '\u26A0\uFE0F ' + toSmallCaps('Warning sent.') + ' ' +
      String(userJid).split('@')[0] +
      ' — ' + toSmallCaps('warnings') + ': ' + result.count + '/' + kickThreshold +
      (escalated ? ' — ' + toSmallCaps(escalated.replace(/_/g, ' ')) : ''),
    DM_OPTS
  );
  return { ok: true, count: result.count, escalated };
}

/** /unwarn <groupJid> <userJid> */
export async function flowUnwarn(context, { groupJid, userJid }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/unwarn <groupJid> <userJid>');
    return { ok: false };
  }
  const res = removeLastWarning(groupJid, userJid);
  log(context.sender, 'group_user_unwarned', {
    groupJid, userJid, remainingCount: res?.count ?? 0
  });
  await sendText(
    context.sock,
    context.sender,
    '\u2705 ' + toSmallCaps('Warning removed.') + ' ' +
      toSmallCaps('remaining') + ': ' + (res?.count ?? 0),
    DM_OPTS
  );
  return { ok: true, count: res?.count ?? 0 };
}

/** /mute <groupJid> <userJid> [durationMs|custom] [reason...] */
export async function flowMute(context, { groupJid, userJid, durationMs, reason }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/mute <groupJid> <userJid> [minutes] [reason]');
    return { ok: false };
  }
  const presets = modCfg().presetMuteDurations || [];
  let ms = Number(durationMs) > 0 ? Number(durationMs) : 0;
  if (ms > 0 && ms < 60_000) ms = ms * 60_000; // bare number means minutes
  if (!ms) ms = presets[1] ?? 30 * 60 * 1000;

  const res = muteUser(groupJid, userJid, ms, reason || NO_REASON);
  if (!res) {
    await notFound(context);
    return { ok: false };
  }
  const group = getGroup(groupJid);
  await notifyUser(context.sock, userJid, 'moderationMessages.muteDM', {
    groupName: group.name || groupJid,
    duration: humanizeDuration(res.durationMs),
    reason: reason || NO_REASON
  });
  log(context.sender, 'group_user_muted', {
    groupJid, userJid, durationMs: res.durationMs, reason: reason || NO_REASON
  });
  await sendText(
    context.sock,
    context.sender,
    '\u{1F507} ' + toSmallCaps('Muted') + ' ' + String(userJid).split('@')[0] +
      ' ' + toSmallCaps('for') + ' ' + humanizeDuration(res.durationMs) +
      (res.capped ? ' (' + toSmallCaps('capped') + ')' : ''),
    DM_OPTS
  );
  return { ok: true, durationMs: res.durationMs };
}

/** /unmute <groupJid> <userJid> */
export async function flowUnmute(context, { groupJid, userJid }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/unmute <groupJid> <userJid>');
    return { ok: false };
  }
  const group = getGroup(groupJid);
  const res = unmuteUser(groupJid, userJid);
  if (res?.removed) {
    await notifyUser(context.sock, userJid, 'moderationMessages.unmuteDM', {
      groupName: group.name || groupJid
    });
  }
  log(context.sender, 'group_user_unmuted', { groupJid, userJid });
  await sendText(
    context.sock,
    context.sender,
    '\u{1F50A} ' + toSmallCaps(res?.removed ? 'Unmuted.' : 'User was not muted.') +
      ' ' + String(userJid).split('@')[0],
    DM_OPTS
  );
  return { ok: true, removed: !!res?.removed };
}

/** /kick <groupJid> <userJid> [reason...] */
export async function flowKick(context, { groupJid, userJid, reason }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/kick <groupJid> <userJid> [reason]');
    return { ok: false };
  }
  const why = reason || NO_REASON;
  const kicked = await tryKick(context.sock, groupJid, userJid, why);
  if (!kicked.success) {
    await sendText(
      context.sock,
      context.sender,
      '\u274C ' + toSmallCaps('Kick failed.') + ' ' +
        (kicked.error === 'bot_not_admin'
          ? toSmallCaps('The bot must be a group admin to remove members.')
          : String(kicked.error)),
      DM_OPTS
    );
    return { ok: false, error: kicked.error };
  }
  const group = getGroup(groupJid);
  await notifyUser(context.sock, userJid, 'moderationMessages.kickDM', {
    groupName: group.name || groupJid,
    reason: why
  });
  log(context.sender, 'group_user_kicked', { groupJid, userJid, reason: why });
  await sendText(
    context.sock,
    context.sender,
    '\u{1F44B} ' + toSmallCaps('Removed') + ' ' + String(userJid).split('@')[0] + '.',
    DM_OPTS
  );
  return { ok: true };
}

/** /ban <groupJid> <userJid> [reason...] -- does NOT remove from the group. */
export async function flowBan(context, { groupJid, userJid, reason }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/ban <groupJid> <userJid> [reason]');
    return { ok: false };
  }
  const why = reason || NO_REASON;
  const ok = banUser(groupJid, userJid, why);
  if (ok === null) {
    await notFound(context);
    return { ok: false };
  }
  const group = getGroup(groupJid);
  await notifyUser(context.sock, userJid, 'moderationMessages.banDM', {
    groupName: group.name || groupJid,
    reason: why
  });
  log(context.sender, 'group_user_banned', { groupJid, userJid, reason: why });
  await sendText(
    context.sock,
    context.sender,
    '\u26D4 ' + toSmallCaps('Banned') + ' ' + String(userJid).split('@')[0] + '. ' +
      toSmallCaps('The bot will ignore their messages in this group.'),
    DM_OPTS
  );
  return { ok: true };
}

/** /unban <groupJid> <userJid> */
export async function flowUnban(context, { groupJid, userJid }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/unban <groupJid> <userJid>');
    return { ok: false };
  }
  const res = unbanUser(groupJid, userJid);
  log(context.sender, 'group_user_unbanned', { groupJid, userJid });
  await sendText(
    context.sock,
    context.sender,
    '\u2705 ' + toSmallCaps(res?.removed ? 'Unbanned.' : 'User was not banned.') +
      ' ' + String(userJid).split('@')[0],
    DM_OPTS
  );
  return { ok: true, removed: !!res?.removed };
}

/** /warnings <groupJid> <userJid> */
export async function flowWarnings(context, { groupJid, userJid }) {
  if (!await guard(context, groupJid)) return { ok: false };
  if (!userJid) {
    await usage(context, '/warnings <groupJid> <userJid>');
    return { ok: false };
  }
  const reasons = getWarnings(groupJid, userJid);
  const lines = [
    '> *\u26A0\uFE0F ' + toSmallCaps('Warnings for') + ' ' + String(userJid).split('@')[0] + '*',
    ''
  ];
  if (!reasons.length) {
    lines.push(toSmallCaps('No active warnings.'));
  } else {
    reasons.forEach((r, i) => {
      const day = String(r?.at || '').slice(0, 10);
      lines.push(`${i + 1}. ${day} — ${r?.reason ?? ''}`);
    });
    lines.push('', toSmallCaps('total') + ': ' + reasons.length);
  }
  const muted = isMuted(groupJid, userJid);
  const banned = isBanned(groupJid, userJid);
  lines.push(
    '',
    '\u{1F507} ' + toSmallCaps('muted') + ': ' + (muted ? '\u2705' : '\u274C'),
    '\u26D4 ' + toSmallCaps('banned') + ': ' + (banned ? '\u2705' : '\u274C')
  );
  await sendText(context.sock, context.sender, lines.join('\n'), DM_OPTS);
  return { ok: true, count: reasons.length };
}

// ---------------------------------------------------------------------------
// Group Management submenu
// ---------------------------------------------------------------------------

/** Groups the actor moderates, for the picker. */
export async function listModeratedGroups(sock, actorJid) {
  const all = getAllGroups();
  const out = [];
  for (const g of all) {
    if (await canModerate(sock, actorJid, g.id, isGroupAdmin)) out.push(g);
  }
  return out;
}

export function renderModerationRoot() {
  return [
    '> *\u26A0\uFE0F ' + toSmallCaps('Moderation') + '*',
    '',
    toSmallCaps('Select a group first, then a user.'),
    '',
    '0. ' + toSmallCaps('Back')
  ].join('\n');
}

export function renderMemberPicker(users, page, total) {
  const lines = [
    '> *\u{1F465} ' + toSmallCaps('Select a user') + '*',
    ''
  ];
  if (!users.length) {
    lines.push(toSmallCaps('No members found.'), '', '0. ' + toSmallCaps('Back'));
    return lines.join('\n');
  }
  users.forEach((u, i) => {
    lines.push(`${i + 1}. ${u.label}`);
  });
  lines.push(
    '',
    toSmallCaps('page') + ' ' + (page + 1) + '/' + Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE))
  );
  lines.push(toSmallCaps('next') + ': ' + (page + 1) * MEMBER_PAGE_SIZE);
  lines.push('0. ' + toSmallCaps('Back'));
  return lines.join('\n');
}

export function renderUserActions(label) {
  return [
    '> *\u26A0\uFE0F ' + label + '*',
    '',
    '1. \u26A0\uFE0F ' + toSmallCaps('Warn'),
    '2. \u{1F507} ' + toSmallCaps('Mute'),
    '3. \u{1F44B} ' + toSmallCaps('Kick'),
    '4. \u26D4 ' + toSmallCaps('Ban'),
    '5. \u26A0\uFE0F ' + toSmallCaps('View warnings'),
    '6. \u{1F50A} ' + toSmallCaps('Unmute'),
    '7. \u2705 ' + toSmallCaps('Unban'),
    '',
    '0. ' + toSmallCaps('Back')
  ].join('\n');
}

export function renderDurationPicker() {
  const presets = modCfg().presetMuteDurations || [];
  const lines = [
    '> *\u{1F507} ' + toSmallCaps('Mute user') + '*',
    '',
    toSmallCaps('Select duration:'),
    ''
  ];
  presets.forEach((ms, i) => {
    lines.push(`${i + 1}. ${humanizeDuration(ms)}`);
  });
  lines.push(
    `${presets.length + 1}. ` + toSmallCaps('Custom (send minutes)'),
    '',
    '0. ' + toSmallCaps('Back')
  );
  return lines.join('\n');
}

export { MEMBER_PAGE_SIZE, DM_OPTS, humanizeDuration };
