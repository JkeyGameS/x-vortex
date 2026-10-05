import logger from '../utils/logger.js';
import { getGroup, updateGroup } from './groupService.js';
import config from '../config/config.js';

/**
 * Per-group moderation state: warnings, mutes and bans.
 *
 * Everything lives under group.moderation in data/groups.json, so it travels
 * with the group and needs no extra file. State shape:
 *   warnings: { [userJid]: { count, reasons: [{ reason, at }] } }
 *   mutes:    { [userJid]: { until, reason, durationMs } }
 *   bans:     { [userJid]: { reason, bannedAt } }
 *
 * A mute is stored with an absolute `until` timestamp, so it expires on its own
 * without a sweeper. Warnings carry timestamps too and are pruned against a
 * rolling window on read.
 */

function cfg() {
  return (config && config.moderation) || {};
}

/** Backfill the shape for entries written by an earlier phase. */
function ensureModerationShape(group) {
  if (!group.moderation || typeof group.moderation !== 'object') {
    group.moderation = { warnings: {}, mutes: {}, bans: {} };
  }
  const m = group.moderation;
  if (!m.warnings || typeof m.warnings !== 'object') m.warnings = {};
  if (!m.mutes || typeof m.mutes !== 'object') m.mutes = {};
  if (!m.bans || typeof m.bans !== 'object') m.bans = {};
  return m;
}

/**
 * Drop warnings older than warnExpiryMs.
 *
 * Returns true when something was actually removed. The caller MUST persist on
 * a true result: without that, the pruned entries are only gone from the
 * in-memory object and get re-read from disk on the next call, so a warning
 * would never actually expire.
 */
function pruneExpiredWarnings(moderation) {
  const expiry = cfg().warnExpiryMs;
  if (!expiry) return false;
  const cutoff = Date.now() - expiry;
  let changed = false;
  for (const jid of Object.keys(moderation.warnings)) {
    const entry = moderation.warnings[jid];
    const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
    const kept = reasons.filter((r) => new Date(r?.at).getTime() >= cutoff);
    if (kept.length === reasons.length) continue;
    changed = true;
    if (kept.length === 0) {
      delete moderation.warnings[jid];
    } else {
      entry.reasons = kept;
      entry.count = kept.length;
    }
  }
  return changed;
}

/** Prune if needed and persist if the prune changed anything. */
function pruneAndPersist(groupJid, group) {
  const m = ensureModerationShape(group);
  if (pruneExpiredWarnings(m)) {
    updateGroup(groupJid, { moderation: m });
  }
  return m;
}

export function getActiveWarningCount(groupJid, userJid) {
  const group = getGroup(groupJid);
  if (!group) return 0;
  const m = pruneAndPersist(groupJid, group);
  return m.warnings[userJid]?.count || 0;
}

export function addWarning(groupJid, userJid, reason) {
  const group = getGroup(groupJid);
  if (!group) return null;
  const m = pruneAndPersist(groupJid, group);
  const entry = m.warnings[userJid] || { count: 0, reasons: [] };
  if (!Array.isArray(entry.reasons)) entry.reasons = [];
  entry.reasons.push({ reason: reason || 'no reason given', at: new Date().toISOString() });
  entry.count = entry.reasons.length;
  m.warnings[userJid] = entry;
  updateGroup(groupJid, { moderation: m });
  return { count: entry.count, reason: reason || 'no reason given' };
}

export function removeLastWarning(groupJid, userJid) {
  const group = getGroup(groupJid);
  if (!group) return null;
  const m = ensureModerationShape(group);
  pruneExpiredWarnings(m);
  const entry = m.warnings[userJid];
  if (!entry || !Array.isArray(entry.reasons) || entry.reasons.length === 0) {
    return { removed: 0, count: 0 };
  }
  entry.reasons.pop();
  const remaining = entry.reasons.length;
  if (remaining === 0) {
    delete m.warnings[userJid];
    updateGroup(groupJid, { moderation: m });
    return { removed: 1, count: 0 };
  }
  entry.count = remaining;
  m.warnings[userJid] = entry;
  updateGroup(groupJid, { moderation: m });
  return { removed: 1, count: remaining };
}

export function getWarnings(groupJid, userJid) {
  const group = getGroup(groupJid);
  if (!group) return [];
  const m = pruneAndPersist(groupJid, group);
  const reasons = m.warnings[userJid]?.reasons;
  return Array.isArray(reasons) ? reasons.slice() : [];
}

export function muteUser(groupJid, userJid, durationMs, reason) {
  const group = getGroup(groupJid);
  if (!group) return null;
  const m = ensureModerationShape(group);
  const cap = cfg().maxMuteDurationMs || Number.POSITIVE_INFINITY;
  const requested = Number(durationMs) > 0 ? Number(durationMs) : 0;
  const cappedMs = Math.min(requested, cap);
  const until = Date.now() + cappedMs;
  m.mutes[userJid] = { until, reason: reason || 'no reason', durationMs: cappedMs };
  updateGroup(groupJid, { moderation: m });
  return { until, durationMs: cappedMs, capped: requested > cap };
}

export function unmuteUser(groupJid, userJid) {
  const group = getGroup(groupJid);
  if (!group) return null;
  const m = ensureModerationShape(group);
  const existed = !!m.mutes[userJid];
  delete m.mutes[userJid];
  updateGroup(groupJid, { moderation: m });
  return { removed: existed };
}

/** True while the mute is live. An expired mute is removed as a side effect. */
export function isMuted(groupJid, userJid) {
  const group = getGroup(groupJid);
  if (!group) return false;
  const m = ensureModerationShape(group);
  const entry = m.mutes[userJid];
  if (!entry) return false;
  if (!Number.isFinite(entry.until) || entry.until <= Date.now()) {
    delete m.mutes[userJid];
    updateGroup(groupJid, { moderation: m });
    return false;
  }
  return true;
}

export function banUser(groupJid, userJid, reason) {
  const group = getGroup(groupJid);
  if (!group) return null;
  const m = ensureModerationShape(group);
  m.bans[userJid] = {
    reason: reason || 'no reason',
    bannedAt: new Date().toISOString()
  };
  updateGroup(groupJid, { moderation: m });
  return true;
}

export function unbanUser(groupJid, userJid) {
  const group = getGroup(groupJid);
  if (!group) return null;
  const m = ensureModerationShape(group);
  const existed = !!m.bans[userJid];
  delete m.bans[userJid];
  updateGroup(groupJid, { moderation: m });
  return { removed: existed };
}

export function isBanned(groupJid, userJid) {
  const group = getGroup(groupJid);
  if (!group) return false;
  const m = ensureModerationShape(group);
  return !!m.bans[userJid];
}

/** Full moderation snapshot for the group, for the log menu and diagnostics. */
export function getModerationLog(groupJid) {
  const group = getGroup(groupJid);
  if (!group) return null;
  const m = pruneAndPersist(groupJid, group);
  return { warnings: m.warnings, mutes: m.mutes, bans: m.bans };
}

/**
 * Whether a user may moderate the given group. Bot admins always may; anyone
 * else must be an admin of that specific group. False when either moderation
 * kill switch is off.
 */
export async function canModerate(sock, actorJid, groupJid, isGroupAdminFn) {
  if (config.moderationEnabled === false) return false;
  if (cfg().enabled === false) return false;
  if (!actorJid || !groupJid) return false;
  const admins = Array.isArray(config.adminJids) ? config.adminJids : [];
  if (admins.includes(actorJid)) return true;
  if (typeof isGroupAdminFn !== 'function') return false;
  try {
    return await isGroupAdminFn(sock, groupJid, actorJid);
  } catch (err) {
    logger.warn({ err, groupJid, actorJid }, '[MODERATION] admin check failed');
    return false;
  }
}