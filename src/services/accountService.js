// Reset / Delete account. Part 1: the destructive operations themselves.
//
// Both operations are irreversible from the bot's point of view, so both take a
// snapshot of the user record FIRST and abort if the snapshot cannot be
// written. Part 2 will add restore-from-snapshot on top of these files.
//
// Everything here is synchronous on disk and talks to the live userService
// Map. Tests must set ACCOUNT_DATA_PATH (see userService) so the three stores
// this touches -- users, feedback, blockedUsers -- resolve to a temp folder.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { getUserByJid, deleteUserByJid, replaceUser, defaultUserSkeleton } from './userService.js';
import { logAdminAction } from './adminLogService.js';
import config from '../config/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ACCOUNT_DATA_PATH
  ? path.resolve(process.env.ACCOUNT_DATA_PATH)
  : path.join(__dirname, '../../data');

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const GROUPS_PATH = path.join(DATA_DIR, 'groups.json');
const GROUP_STATS_PATH = path.join(DATA_DIR, 'groupStats.json');
const FEEDBACK_PATH = path.join(DATA_DIR, 'feedback.json');
const BLOCKED_PATH = path.join(DATA_DIR, 'blockedUsers.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots', 'users');

export const SNAPSHOT_PREFIX = { reset: 'reset', delete: 'deleted' };

function ensureDirs() {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function readJson(p, fallback = {}) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8') || '');
    return parsed ?? fallback;
  } catch (err) {
    logger.warn({ err, path: p }, '[ACCOUNT] unreadable JSON, treating as empty');
    return fallback;
  }
}

function writeJson(p, obj) {
  if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Trim the snapshot folder to config.account.snapshotRetentionCount, newest
 * kept. Runs after every snapshot so the folder cannot grow without bound.
 */
function pruneSnapshots() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return 0;
    const max = config.account?.snapshotRetentionCount || 50;
    const files = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(SNAPSHOT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    let removed = 0;
    while (files.length > max) {
      const old = files.pop();
      try {
        fs.unlinkSync(path.join(SNAPSHOT_DIR, old.name));
        removed++;
      } catch { /* keep going; a stuck file must not block pruning */ }
    }
    return removed;
  } catch (err) {
    logger.warn({ err }, '[ACCOUNT] snapshot prune failed');
    return 0;
  }
}

/**
 * Write a full copy of the user record to the snapshot folder.
 * @returns {string|null} the file written, or null if the user is unknown.
 * @throws if the write fails -- callers must not proceed past that.
 */
function snapshotUser(jid, prefix) {
  ensureDirs();
  const users = readJson(USERS_PATH, {});
  const user = users[jid];
  if (!user) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeJid = String(jid).replace(/[^a-zA-Z0-9]/g, '_');
  const file = path.join(SNAPSHOT_DIR, `${prefix}-${safeJid}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(user, null, 2) + '\n', 'utf8');
  pruneSnapshots();
  return file;
}

/**
 * Build a user record identical to a brand new one.
 *
 * The shape comes from userService.defaultUserSkeleton(), which mirrors
 * ensureUserProfile() exactly. Tests/accountService.test.mjs diffs a reset
 * record against a real ensureUserProfile() record, so these two cannot drift
 * apart silently.
 */
function freshUser(jid, { name, language, isTest = false }) {
  const skeleton = defaultUserSkeleton();
  const now = new Date().toISOString();
  return {
    ...skeleton,
    jid,
    name: name || skeleton.name,
    username: null,
    bio: '',
    language: language ?? null,
    isTest,
    joined: now,
    lastUpdated: now,
    lastActive: now,
    preferences: { ...skeleton.preferences },
    stats: { ...skeleton.stats },
    notifyRequests: {},
    chatReplyHistory: {}
  };
}

/** Drop every moderation record for this JID from groups.json. */
function removeUserFromGroupsData(jid) {
  const groups = readJson(GROUPS_PATH, {});
  let changed = false;
  for (const gid of Object.keys(groups)) {
    const moderation = groups[gid]?.moderation;
    if (!moderation) continue;
    for (const bucket of ['warnings', 'mutes', 'bans']) {
      if (moderation[bucket] && moderation[bucket][jid]) {
        delete moderation[bucket][jid];
        changed = true;
      }
    }
  }
  if (changed) writeJson(GROUPS_PATH, groups);

  // topMembers lives in groupStats.json, not in the group record.
  const stats = readJson(GROUP_STATS_PATH, {});
  let statsChanged = false;
  for (const gid of Object.keys(stats)) {
    const top = stats[gid]?.topMembers;
    if (top && top[jid]) {
      delete top[jid];
      statsChanged = true;
    }
  }
  if (statsChanged) writeJson(GROUP_STATS_PATH, stats);

  return changed || statsChanged;
}

/**
 * Strip identifying data from feedback while keeping the entries.
 * Feedback identifies authors with `userId` (there is no `jid` field), so
 * nulling userId and flagging anonymous is the whole job.
 */
function anonymizeFeedback(jid) {
  const feedback = readJson(FEEDBACK_PATH, {});
  let changed = 0;
  for (const section of ['ratings', 'bugReports', 'suggestions']) {
    const list = feedback[section];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (entry && entry.userId === jid) {
        entry.userId = null;
        entry.anonymous = true;
        changed++;
      }
    }
  }
  if (changed) writeJson(FEEDBACK_PATH, feedback);
  return changed;
}

/**
 * Remove the JID from the blocked/ignore list.
 * blockedUsers.json is an object keyed by JID; the array branch is kept for
 * older installs that stored a bare list.
 */
function removeFromIgnoreList(jid) {
  if (!fs.existsSync(BLOCKED_PATH)) return false;
  const data = readJson(BLOCKED_PATH, {});
  if (Array.isArray(data)) {
    const filtered = data.filter((x) => x !== jid);
    if (filtered.length === data.length) return false;
    writeJson(BLOCKED_PATH, filtered);
    return true;
  }
  if (data && typeof data === 'object') {
    if (!data[jid]) return false;
    delete data[jid];
    writeJson(BLOCKED_PATH, data);
    return true;
  }
  return false;
}

/**
 * Wipe a user's data but keep their identity: JID, language and display name
 * survive so they are not re-onboarded. Everything else returns to defaults.
 *
 * @param {string} jid
 * @param {object} [opts] { actorJid, pushName }
 * @returns {Promise<{success:boolean,snapshot?:string,error?:string,cleared?:string[]}>}
 */
export async function resetAccount(jid, { actorJid, pushName } = {}) {
  const user = await getUserByJid(jid);
  if (!user) return { success: false, error: 'user_not_found' };

  let snapshot;
  try {
    snapshot = snapshotUser(jid, SNAPSHOT_PREFIX.reset);
  } catch (err) {
    // A failed snapshot must abort the reset: without one, the old data is
    // gone forever and there is nothing for Part 2 to restore from.
    logger.error({ err, jid }, '[ACCOUNT] reset snapshot failed; aborting');
    return { success: false, error: 'snapshot_failed' };
  }
  if (!snapshot) return { success: false, error: 'snapshot_failed' };

  const language = user.language || null;
  const name = pushName || user.name || user.jid;

  // updateUser() merges with Object.assign, so a shallow update would leave
  // stale sub-objects behind. replaceUser() overwrites the whole record.
  const reset = freshUser(jid, { name, language, isTest: user.isTest === true });
  await replaceUser(jid, reset);

  removeUserFromGroupsData(jid);
  logAdminAction(actorJid || 'system', 'account_reset', JSON.stringify({ targetJid: jid, snapshot }));

  return {
    success: true,
    snapshot,
    cleared: ['preferences', 'stats', 'notifyRequests', 'chatReplyHistory', 'groupData']
  };
}

/**
 * Remove a user entirely. Feedback is anonymized rather than deleted so the
 * ratings stay useful; snapshots under data/snapshots/users/ are untouched.
 *
 * @param {string} jid
 * @param {object} [opts] { actorJid }
 * @returns {Promise<{success:boolean,snapshot?:string,error?:string,anonymized?:number}>}
 */
export async function deleteAccount(jid, { actorJid } = {}) {
  const user = await getUserByJid(jid);
  if (!user) return { success: false, error: 'user_not_found' };

  let snapshot;
  try {
    snapshot = snapshotUser(jid, SNAPSHOT_PREFIX.delete);
  } catch (err) {
    logger.error({ err, jid }, '[ACCOUNT] delete snapshot failed; aborting');
    return { success: false, error: 'snapshot_failed' };
  }
  if (!snapshot) return { success: false, error: 'snapshot_failed' };

  const anonymized = anonymizeFeedback(jid);
  removeUserFromGroupsData(jid);
  removeFromIgnoreList(jid);

  await deleteUserByJid(jid);
  logAdminAction(actorJid || 'system', 'account_deleted', JSON.stringify({ targetJid: jid, snapshot, anonymized }));

  return { success: true, snapshot, anonymized };
}

/**
 * True when this JID is the only bot admin, so deleting it would leave the
 * bot with nobody who can restore it.
 */
export function isLastBotAdmin(jid) {
  const admins = config.adminJids || [];
  return admins.length === 1 && admins[0] === jid;
}

/** Newest-first list of snapshot filenames for the admin snapshot view. */
export function listUserSnapshots() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return [];
    return fs
      .readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Remove every user snapshot. Used by the Danger Zone purge action. */
export function purgeUserSnapshots() {
  ensureDirs();
  const files = fs.readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json'));
  let removed = 0;
  for (const f of files) {
    try {
      fs.unlinkSync(path.join(SNAPSHOT_DIR, f));
      removed++;
    } catch (err) {
      logger.warn({ err, file: f }, '[ACCOUNT] could not delete snapshot');
    }
  }
  return removed;
}

export const __testing = { SNAPSHOT_DIR, USERS_PATH, GROUPS_PATH, GROUP_STATS_PATH, FEEDBACK_PATH, BLOCKED_PATH, freshUser };