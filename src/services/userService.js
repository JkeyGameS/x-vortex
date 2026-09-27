import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sessionManager from '../utils/sessionManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const users = new Map(); // key: jid, value: user object

export const TUTORIAL_PROGRESS_KEYS = [
  'gettingStarted',
  'usefulCommands',
  'profileGuide',
  'settingsPrefs',
  'selfDestruct',
  'feedback',
  'quickTips',
  'whatNew'
];

export function defaultTutorialProgress() {
  return Object.fromEntries(TUTORIAL_PROGRESS_KEYS.map((key) => [key, false]));
}

function normalizeTutorialProgress(progress) {
  return TUTORIAL_PROGRESS_KEYS.reduce((result, key) => {
    result[key] = progress?.[key] === true;
    return result;
  }, {});
}

function resolveUserJid(jid) {
  const session = sessionManager.getSession(jid, jid) || {};
  return session.isTestActive && session.testSession?.testUserJid
    ? session.testSession.testUserJid
    : jid;
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      users.clear();
      for (const [jid, user] of Object.entries(raw)) {
        users.set(jid, user);
      }
    }
  } catch (err) {
    console.error('Failed to load users:', err.message);
  }
}

function saveUsers() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(users), null, 2));
  } catch (err) {
    console.error('Failed to save users:', err.message);
  }
}

loadUsers();

/**
 * Ensure user exists; create if not.
 * @param {object} data - { jid, name }
 * @returns {object} { user, isNewUser }
 */
export async function ensureUserProfile({ jid, name, username = null, isTest = false }) {
  const resolvedJid = resolveUserJid(jid);
  if (users.has(resolvedJid)) {
    return { user: users.get(resolvedJid), isNewUser: false };
  }

  const newUser = {
    jid: resolvedJid,
    name,
    isTest,
    username,
    bio: '',
    language: null,           // will be set after language selection
    timezone: 'UTC',
    joined: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    accountType: 'free',
    level: 1,
    rank: null,
    profileCompleteness: 0,
    notifyRequests: {},       // { [featureId]: true } = notify when feature becomes available
    chatReplyHistory: {},     // { [ruleId]: [recent reply texts] } for anti-repetition
    preferences: {
      notifications: true,
      theme: 'dark',
      announcements: true,
      replyStyle: 'formal',
      privacy: 'contacts',
      tutorialProgress: defaultTutorialProgress()
    },
    stats: {
      messagesSent: 0,
      commandsUsed: 0,
      recentCommandTimestamps: [],
      commandCounts: {},
      lastCommand: null,
      lastCommandTime: null,
      points: 0
    }
  };

  users.set(resolvedJid, newUser);
  saveUsers();
  return { user: newUser, isNewUser: true };
}

export async function getUserByJid(jid) {
  return users.get(resolveUserJid(jid));
}

/**
 * Synchronous lookup of a user by JID from the in-memory store.
 * @param {string} jid
 * @returns {object|undefined} the matching user object, or undefined
 */
export function getUserByJidSync(jid) {
  return users.get(resolveUserJid(jid));
}

/**
 * Find a user by username (case-insensitive).
 * @param {string} username
 * @returns {object|undefined} the matching user object, or undefined
 */
export async function findUserByUsername(username) {
  if (!username) return undefined;
  const target = username.toLowerCase().replace(/^@/, '');
  for (const user of users.values()) {
    if (user.username && String(user.username).toLowerCase().replace(/^@/, '') === target) {
      return user;
    }
  }
  return undefined;
}

/**
 * Resolve a user by either a full JID or a username.
 * @param {string} identifier - JID or @username / username
 * @returns {object|undefined} the matching user object, or undefined
 */
export async function findUser(identifier) {
  if (!identifier) return undefined;
  return (await getUserByJid(identifier)) || (await findUserByUsername(identifier));
}

export async function getAllUsers() {
  return Array.from(users.values());
}

export async function getAllUsersPaginated(page = 0, perPage = 10) {
  const all = await getAllUsers();
  const totalPages = Math.max(1, Math.ceil(all.length / perPage));
  const currentPage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  return { users: all.slice(currentPage * perPage, (currentPage + 1) * perPage), page: currentPage, totalPages, total: all.length };
}

export async function searchUsers(query) {
  const needle = String(query || '').trim().toLowerCase().replace(/^@/, '');
  if (!needle) return [];
  return (await getAllUsers()).filter((user) =>
    String(user.jid || '').toLowerCase() === needle ||
    String(user.username || '').toLowerCase().replace(/^@/, '') === needle
  );
}

export async function deleteUser(jid) {
  const resolvedJid = resolveUserJid(jid);
  const deleted = users.delete(resolvedJid);
  if (deleted) saveUsers();
  return deleted;
}

export async function purgeTestUsers() {
  const removed = [];
  for (const [jid, user] of users) {
    if (user.isTest === true) {
      removed.push(user);
      users.delete(jid);
    }
  }
  if (removed.length) saveUsers();
  return removed;
}

export async function editUser(jid, updates) {
  return updateUser(jid, updates);
}

export async function exportUserData(jid) {
  return (await getUserByJid(jid)) || null;
}

export async function resetUserData(jid, parts = {}) {
  const user = await getUserByJid(jid);
  if (!user) return null;
  const updates = {};
  if (parts.preferences) updates.preferences = {};
  if (parts.stats) updates.stats = { messagesSent: 0, commandsUsed: 0, commandCounts: {}, recentCommands: [] };
  if (parts.notifyRequests) updates.notifyRequests = {};
  return updateUser(jid, updates);
}

export async function addAdminNote(jid, note) {
  const user = await getUserByJid(jid);
  if (!user) return null;
  const notes = Array.isArray(user.adminNotes) ? user.adminNotes : [];
  notes.push({ text: String(note), timestamp: new Date().toISOString() });
  return updateUser(jid, { adminNotes: notes });
}

export async function deleteAdminNote(jid, index) {
  const user = await getUserByJid(jid);
  if (!user) return null;
  const notes = Array.isArray(user.adminNotes) ? [...user.adminNotes] : [];
  notes.splice(Number(index), 1);
  return updateUser(jid, { adminNotes: notes });
}

export async function getAdminNotes(jid) {
  const user = await getUserByJid(jid);
  return Array.isArray(user?.adminNotes) ? user.adminNotes : [];
}

export async function setFeatureOverride(jid, featureId, status) {
  const user = await getUserByJid(jid);
  if (!user) return null;
  return updateUser(jid, { featureOverrides: { ...(user.featureOverrides || {}), [featureId]: status } });
}

export async function getFeatureOverrides(jid) {
  const user = await getUserByJid(jid);
  return user?.featureOverrides || {};
}

export async function getUserRecentActivity(jid) {
  const user = await getUserByJid(jid);
  return user?.stats?.recentCommands || [];
}

export async function filterAndSortUsers(filters = {}, sortBy = 'joined') {
  let result = await getAllUsers();
  if (filters.language) result = result.filter((user) => user.language === filters.language);
  if (filters.blocked !== undefined) result = result.filter((user) => user.blocked === filters.blocked);
  if (filters.test !== undefined) result = result.filter((user) => user.isTest === filters.test);
  result.sort((a, b) => {
    if (sortBy === 'lastActive') return String(b.lastActive || '').localeCompare(String(a.lastActive || ''));
    if (sortBy === 'commands') return (b.stats?.commandsUsed || 0) - (a.stats?.commandsUsed || 0);
    return String(b.joined || '').localeCompare(String(a.joined || ''));
  });
  return result;
}

/**
 * Return the users store as an object keyed by JID (same shape as users.json).
 * Used for backups so the export round-trips losslessly.
 * @returns {object} { [jid]: user }
 */
export function getUsersObject() {
  return Object.fromEntries(users);
}

/**
 * Replace the entire users store with imported data and persist to disk.
 * @param {object} data - object keyed by JID, e.g. { [jid]: user }
 * @returns {Promise<number>} number of imported users
 */
export async function replaceAllUsers(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid users payload: expected an object keyed by JID');
  }
  users.clear();
  for (const [jid, user] of Object.entries(data)) {
    if (user && typeof user === 'object') {
      users.set(jid, user);
    }
  }
  saveUsers();
  return users.size;
}

/**
 * Filter users by a criteria object. Supported keys:
 * - language: exact language code match
 * - joinedWithinDays: joined in the last N days
 * - lastActiveWithinDays: active in the last N days
 * - testOnly: only isTest users
 * - blockedOnly: only blocked users
 * @param {object} [filters]
 * @returns {Array} matching user objects
 */
export function filterUsers(filters = {}) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return Array.from(users.values()).filter((u) => {
    if (!u) return false;
    if (filters.language && u.language !== filters.language) return false;
    if (filters.joinedWithinDays != null) {
      const joined = u.joined ? new Date(u.joined).getTime() : 0;
      if (!joined || now - joined > filters.joinedWithinDays * day) return false;
    }
    if (filters.lastActiveWithinDays != null) {
      const last = u.lastActive ? new Date(u.lastActive).getTime() : 0;
      if (!last || now - last > filters.lastActiveWithinDays * day) return false;
    }
    if (filters.testOnly && u.isTest !== true) return false;
    if (filters.blockedOnly && u.blocked !== true) return false;
    return true;
  });
}

export function getStats() {
  const all = Array.from(users.values());
  const now = Date.now();
  let total = all.length;
  let testUsers = 0;
  let activeToday = 0;
  let blocked = 0;
  let commandsUsed = 0;

  for (const u of all) {
    if (u.isTest === true) testUsers++;
    if (u.blocked === true) blocked++;
    commandsUsed += u.stats?.commandsUsed || 0;
    const last = u.lastActive ? new Date(u.lastActive).getTime() : (u.lastUpdated ? new Date(u.lastUpdated).getTime() : 0);
    if (now - last < 24 * 60 * 60 * 1000) activeToday++;
  }

  return { total, testUsers, activeToday, blocked, commandsUsed };
}

/**
 * Set (or clear) a user's "notify me" request for a feature.
 * @param {string} jid
 * @param {string} featureId
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true if updated
 */
export async function setNotifyRequest(jid, featureId, enabled) {
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (!user) return false;
  if (!user.notifyRequests || typeof user.notifyRequests !== 'object') {
    user.notifyRequests = {};
  }
  if (enabled) {
    user.notifyRequests[featureId] = true;
  } else {
    delete user.notifyRequests[featureId];
  }
  saveUsers();
  return true;
}

/**
 * All users who requested to be notified when a feature becomes available.
 * @param {string} featureId
 * @returns {Array<object>} matching user objects
 */
export function getUsersWithNotifyRequest(featureId) {
  return Array.from(users.values()).filter((u) =>
    u.notifyRequests && u.notifyRequests[featureId] === true
  );
}

export async function updateUser(jid, updates) {
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (!user) return null;
  Object.assign(user, updates, { lastUpdated: new Date().toISOString() });
  users.set(resolvedJid, user);
  saveUsers();
  return user;
}

export async function getTutorialProgress(jid) {
  const user = await getUserByJid(jid);
  const progress = normalizeTutorialProgress(user?.preferences?.tutorialProgress);
  if (user && JSON.stringify(user.preferences?.tutorialProgress || {}) !== JSON.stringify(progress)) {
    user.preferences = { ...(user.preferences || {}), tutorialProgress: progress };
    await updateUser(jid, { preferences: user.preferences });
  }
  return progress;
}

export async function updateTutorialProgress(jid, updates) {
  const user = await getUserByJid(jid);
  if (!user) return defaultTutorialProgress();
  const progress = normalizeTutorialProgress({
    ...user.preferences?.tutorialProgress,
    ...updates
  });
  await updateUser(jid, {
    preferences: { ...(user.preferences || {}), tutorialProgress: progress }
  });
  return progress;
}

export async function updateLastActive(jid) {
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (user) {
    user.lastActive = new Date().toISOString();
    users.set(resolvedJid, user);
    saveUsers();
  }
}

export async function trackUserCommand(jid, commandName) {
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (!user) return;
  if (!user.stats) user.stats = {};
  if (!Array.isArray(user.stats.recentCommands)) user.stats.recentCommands = [];
  user.stats.recentCommands.unshift({ command: commandName || 'unknown', timestamp: new Date().toISOString() });
  user.stats.recentCommands = user.stats.recentCommands.slice(0, 10);
  const now = Date.now();

  // Latest command info.
  user.stats.lastCommand = commandName || 'unknown';
  user.stats.lastCommandTime = new Date(now).toISOString();

  // Global command counter.
  user.stats.commandsUsed = (user.stats.commandsUsed || 0) + 1;

  // Per-command frequency map for "favorite command".
  user.stats.commandCounts = user.stats.commandCounts || {};
  user.stats.commandCounts[commandName || 'unknown'] =
    (user.stats.commandCounts[commandName || 'unknown'] || 0) + 1;

  // Rolling timestamp list for "commands this week" (keep last 100).
  user.stats.recentCommandTimestamps = user.stats.recentCommandTimestamps || [];
  user.stats.recentCommandTimestamps.push(now);
  if (user.stats.recentCommandTimestamps.length > 100) {
    user.stats.recentCommandTimestamps = user.stats.recentCommandTimestamps.slice(-100);
  }

  user.lastUpdated = new Date().toISOString();
  users.set(resolvedJid, user);
  saveUsers();
}

/**
 * Increment the usage counter for a feature menu/area (statistics feature
 * usage). Called when the user opens a feature area.
 * @param {string} jid
 * @param {string} feature
 */
export async function trackFeatureUsage(jid, feature) {
  if (!feature) return;
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (!user) return;
  if (!user.stats) user.stats = {};
  user.stats.featureUsage = user.stats.featureUsage || {};
  user.stats.featureUsage[feature] = (user.stats.featureUsage[feature] || 0) + 1;
  users.set(resolvedJid, user);
  saveUsers();
}

/**
 * Increment the successful-command counter (statistics success rate).
 * @param {string} jid
 */
export async function trackCommandSuccess(jid) {
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (!user) return;
  if (!user.stats) user.stats = {};
  user.stats.successCommands = (user.stats.successCommands || 0) + 1;
  users.set(resolvedJid, user);
  saveUsers();
}

/**
 * Increment the failed-command counter (statistics error rate).
 * @param {string} jid
 */
export async function trackCommandError(jid) {
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (!user) return;
  if (!user.stats) user.stats = {};
  user.stats.errorCommands = (user.stats.errorCommands || 0) + 1;
  users.set(resolvedJid, user);
  saveUsers();
}

/**
 * Increment the messages-sent counter for a user. Called for every incoming
 * non-bot message before command parsing.
 * @param {string} jid
 */
export async function trackUserMessage(jid) {
  const resolvedJid = resolveUserJid(jid);
  const user = users.get(resolvedJid);
  if (!user) return;
  if (!user.stats) user.stats = {};
  user.stats.messagesSent = (user.stats.messagesSent || 0) + 1;
  user.lastUpdated = new Date().toISOString();
  users.set(resolvedJid, user);
  saveUsers();
}

/**
 * Number of commands this user executed within the last 7 days.
 * @param {object} user
 * @returns {number}
 */
export function getCommandsThisWeek(user) {
  const list = user?.stats?.recentCommandTimestamps || [];
  if (!list.length) return 0;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return list.filter((ts) => ts >= cutoff).length;
}

/**
 * The most frequently used command name (nil if none).
 * @param {object} user
 * @returns {string|null}
 */
export function getFavoriteCommand(user) {
  const counts = user?.stats?.commandCounts || {};
  let best = null;
  let bestCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Whole days elapsed since a user joined.
 * @param {object} user
 * @returns {number}
 */
export function getDaysSinceJoined(user) {
  if (!user?.joined) return 0;
  const start = new Date(user.joined).getTime();
  const diffMs = Date.now() - start;
  return diffMs > 0 ? Math.floor(diffMs / (24 * 60 * 60 * 1000)) : 0;
}

export async function deleteUserByJid(jid) {
  const existed = users.delete(jid);
  if (existed) saveUsers();
  return existed;
}

/**
 * Remove all users marked as test users (isTest === true).
 * @returns {Promise<number>} number of removed users
 */
export async function deleteTestUsers() {
  let removed = 0;
  for (const [jid, user] of users) {
    if (user.isTest === true) {
      users.delete(jid);
      removed++;
    }
  }
  if (removed > 0) saveUsers();
  return removed;
}