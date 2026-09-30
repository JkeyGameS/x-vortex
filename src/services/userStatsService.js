// New-user / onboarding statistics for the admin notifications.
//
// Persisted to data/userStats.json. Writes are debounced-ish (synchronous, but
// only on real changes) and every reader tolerates a missing or corrupt file by
// falling back to an empty shape rather than throwing into the message path.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'userStats.json');

const DAILY_RETENTION = 30;

const EMPTY = {
  totalUsers: 0,
  onboardingStarted: 0,
  onboardingCompleted: 0,
  onboardingAbandoned: 0,
  dailySignups: {},
  users: {}
};

function dayKey(date = new Date()) {
  // Local calendar day; the admin dashboard groups by the same key.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return structuredClone(EMPTY);
    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return structuredClone(EMPTY);
    return {
      ...structuredClone(EMPTY),
      ...parsed,
      dailySignups: parsed.dailySignups && typeof parsed.dailySignups === 'object' ? parsed.dailySignups : {},
      users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {}
    };
  } catch (err) {
    logger.warn({ err, file: STATS_FILE }, '[USERSTATS] unreadable stats file, using defaults');
    return structuredClone(EMPTY);
  }
}

function pruneDaily(daily) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (DAILY_RETENTION - 1));
  const cutoffKey = dayKey(cutoff);
  for (const key of Object.keys(daily)) {
    if (key < cutoffKey) delete daily[key];
  }
  return daily;
}

function writeStats(stats) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    stats.dailySignups = pruneDaily(stats.dailySignups || {});
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2) + '\n');
    return true;
  } catch (err) {
    logger.error({ err, file: STATS_FILE }, '[USERSTATS] failed to persist stats');
    return false;
  }
}

/**
 * Record a first-time user sighting.
 * Idempotent per JID: re-sighting a known user only refreshes the profile, it
 * never increments totals or sends a duplicate "new user" signal.
 * @returns {{ firstTime: boolean, entry: object }}
 */
export function recordNewUser(jid, meta = {}) {
  const stats = readStats();
  const existing = stats.users[jid];
  const now = new Date().toISOString();
  if (existing) {
    existing.deviceLanguageRaw = meta.deviceLanguageRaw ?? existing.deviceLanguageRaw ?? null;
    existing.deviceLanguage = meta.deviceLanguage ?? existing.deviceLanguage ?? null;
    existing.platform = meta.platform ?? existing.platform ?? null;
    existing.pushName = meta.pushName ?? existing.pushName ?? null;
    writeStats(stats);
    return { firstTime: false, entry: existing };
  }

  const entry = {
    firstSeen: now,
    pushName: meta.pushName || null,
    deviceLanguage: meta.deviceLanguage || null,
    deviceLanguageRaw: meta.deviceLanguageRaw || null,
    platform: meta.platform || null,
    chosenLanguage: null,
    onboardingStatus: 'started',
    attempts: 0
  };
  stats.users[jid] = entry;
  stats.totalUsers += 1;
  stats.onboardingStarted += 1;
  const key = dayKey();
  stats.dailySignups[key] = (stats.dailySignups[key] || 0) + 1;
  writeStats(stats);
  return { firstTime: true, entry };
}

function setStatus(jid, status, patch = {}) {
  const stats = readStats();
  const entry = stats.users[jid];
  if (!entry) return null;
  // Read both prior states before overwriting, so a repeated call cannot
  // double-count and the check cannot compare against the value just written.
  const wasCompleted = entry.onboardingStatus === 'completed';
  const wasAbandoned = entry.onboardingStatus === 'abandoned';
  entry.onboardingStatus = status;
  Object.assign(entry, patch);
  // Counters follow the transition, not the call.
  if (status === 'completed' && !wasCompleted) stats.onboardingCompleted += 1;
  if (status === 'abandoned' && !wasAbandoned) stats.onboardingAbandoned += 1;
  writeStats(stats);
  return entry;
}

export function recordOnboardingCompleted(jid, chosenLanguage, attempts = null) {
  return setStatus(jid, 'completed', {
    chosenLanguage: chosenLanguage || null,
    ...(attempts === null ? {} : { attempts })
  });
}

export function recordOnboardingAbandoned(jid, attempts = null) {
  return setStatus(jid, 'abandoned', attempts === null ? {} : { attempts });
}

export function recordOnboardingAttempt(jid, attempts) {
  const stats = readStats();
  if (!stats.users[jid]) return null;
  stats.users[jid].attempts = attempts;
  writeStats(stats);
  return stats.users[jid];
}

export function getUserStatsEntry(jid) {
  return readStats().users[jid] || null;
}

export function isKnownUser(jid) {
  return Boolean(readStats().users[jid]);
}

export function getTotalUsers() {
  return readStats().totalUsers;
}

export function getNewToday() {
  return readStats().dailySignups[dayKey()] || 0;
}

export function getNewThisWeek() {
  const stats = readStats();
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    total += stats.dailySignups[dayKey(d)] || 0;
  }
  return total;
}

export function getDailySignups() {
  return readStats().dailySignups;
}

export function getAllStats() {
  const stats = readStats();
  return {
    totalUsers: stats.totalUsers,
    onboardingStarted: stats.onboardingStarted,
    onboardingCompleted: stats.onboardingCompleted,
    onboardingAbandoned: stats.onboardingAbandoned,
    dailySignups: stats.dailySignups
  };
}

export const __testing = { dayKey, pruneDaily, STATS_FILE, DAILY_RETENTION };
