import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import config from '../config/config.js';

/**
 * Per-group activity stats (Phase 6).
 *
 * Shape per group:
 *   totalMessages, joins, leaves, currentMembers
 *   daily:      { 'YYYY-MM-DD': count }
 *   hourly:     { '0'..'23': count }
 *   topMembers: { userJid: count }
 *   createdAt
 *
 * The message path only mutates memory and sets a dirty flag. Writing the whole
 * file per message would put a synchronous disk write on the hot path, so
 * flushStats() is debounced and also called explicitly by the stats viewer,
 * pruneOldStats and shutdown. A hard crash can lose the last few seconds of
 * counts, which is the right trade for analytics.
 *
 * GROUP_STATS_DATA_PATH overrides the path so tests never touch live data.
 */

const STATS_PATH = process.env.GROUP_STATS_DATA_PATH
  ? path.resolve(process.env.GROUP_STATS_DATA_PATH)
  : path.resolve('data/groupStats.json');

let cache = null;
let dirty = false;
let flushTimer = null;

function cfg() {
  return (config.groupStats) || {};
}

export function statsActive() {
  return config.groupStatsEnabled !== false && cfg().enabled !== false;
}

function ensureFile() {
  const dir = path.dirname(STATS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STATS_PATH)) fs.writeFileSync(STATS_PATH, '{}', 'utf8');
}

function writeNow() {
  try {
    ensureFile();
    fs.writeFileSync(STATS_PATH, JSON.stringify(cache, null, 2), 'utf8');
    dirty = false;
    return true;
  } catch (err) {
    logger.error({ err }, '[GROUP_STATS] persist failed');
    return false;
  }
}

/** Mark dirty and (re)arm the debounce timer. */
function scheduleFlush() {
  dirty = true;
  const interval = cfg().flushIntervalMs || 5000;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) writeNow();
  }, interval);
  // Never hold the process open just to flush stats.
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/** Write immediately if anything is pending. Safe to call at any time. */
export function flushStats() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty) return false;
  return writeNow();
}

export function loadGroupStats() {
  try {
    ensureFile();
    const parsed = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8') || '{}');
    cache = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    dirty = false;
    logger.info({ count: Object.keys(cache).length }, '[GROUP_STATS] loaded');
    return cache;
  } catch (err) {
    logger.error({ err }, '[GROUP_STATS] load failed, starting empty');
    cache = {};
    dirty = false;
    return cache;
  }
}

function ensureCache() {
  if (!cache) loadGroupStats();
}

function ensureGroupStats(groupJid) {
  ensureCache();
  if (!cache[groupJid] || typeof cache[groupJid] !== 'object') {
    cache[groupJid] = {
      totalMessages: 0,
      daily: {},
      hourly: {},
      topMembers: {},
      joins: 0,
      leaves: 0,
      currentMembers: null,
      createdAt: new Date().toISOString()
    };
  }
  const s = cache[groupJid];
  if (!s.daily || typeof s.daily !== 'object') s.daily = {};
  if (!s.hourly || typeof s.hourly !== 'object') s.hourly = {};
  if (!s.topMembers || typeof s.topMembers !== 'object') s.topMembers = {};
  if (typeof s.totalMessages !== 'number') s.totalMessages = 0;
  if (typeof s.joins !== 'number') s.joins = 0;
  if (typeof s.leaves !== 'number') s.leaves = 0;
  return s;
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Recording (in-memory only)
// ---------------------------------------------------------------------------

export function recordMessage(groupJid, userJid) {
  if (!statsActive()) return;
  const s = ensureGroupStats(groupJid);
  s.totalMessages += 1;
  const day = dayKey();
  s.daily[day] = (s.daily[day] || 0) + 1;
  const hour = String(new Date().getHours());
  s.hourly[hour] = (s.hourly[hour] || 0) + 1;
  if (userJid) s.topMembers[userJid] = (s.topMembers[userJid] || 0) + 1;
  scheduleFlush();
}

export function recordJoin(groupJid) {
  if (!statsActive()) return;
  const s = ensureGroupStats(groupJid);
  s.joins += 1;
  scheduleFlush();
}

export function recordLeave(groupJid) {
  if (!statsActive()) return;
  const s = ensureGroupStats(groupJid);
  s.leaves += 1;
  scheduleFlush();
}

// ---------------------------------------------------------------------------
// Member count
// ---------------------------------------------------------------------------

/**
 * Adjust the live member count by delta.
 *
 * Returns null and changes nothing when no baseline has been established yet:
 * starting from 0 would make the first join in a 12-member group report
 * "member #1". Callers fall back to the metadata count until
 * syncMemberCount/setMemberCount has run.
 */
export function adjustMemberCount(groupJid, delta) {
  if (!statsActive()) return null;
  const s = ensureGroupStats(groupJid);
  if (typeof s.currentMembers !== 'number') return null;
  s.currentMembers = Math.max(0, s.currentMembers + Number(delta || 0));
  scheduleFlush();
  return s.currentMembers;
}

export function getCurrentMemberCount(groupJid) {
  const s = getGroupStats(groupJid);
  if (!s || typeof s.currentMembers !== 'number') return null;
  return s.currentMembers;
}

export function setMemberCount(groupJid, count) {
  // Gated like every other writer: with stats disabled nothing is created.
  if (!statsActive()) return null;
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return null;
  const s = ensureGroupStats(groupJid);
  s.currentMembers = Math.floor(n);
  scheduleFlush();
  return s.currentMembers;
}

// ---------------------------------------------------------------------------
// Reads (flush first so a viewer never shows stale numbers)
// ---------------------------------------------------------------------------

function flushIfDirty() {
  if (dirty) flushStats();
}

export function getGroupStats(groupJid) {
  ensureCache();
  flushIfDirty();
  return cache[groupJid] || null;
}

export function getAllGroupStats() {
  ensureCache();
  flushIfDirty();
  return cache;
}

export function getTopMembers(groupJid, limit) {
  const s = getGroupStats(groupJid);
  if (!s) return [];
  const cap = limit || cfg().topMembersLimit || 10;
  return Object.entries(s.topMembers || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap);
}

/** The hour bucket with the most messages, or null when there is no data. */
export function getPeakHour(groupJid) {
  const s = getGroupStats(groupJid);
  if (!s) return null;
  const entries = Object.entries(s.hourly || {});
  if (!entries.length) return null;
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
}

/**
 * Daily counts for the last `days` days, oldest first.
 * @returns {{ date: string, count: number }[]}
 */
export function getDailyActivity(groupJid, days = 7) {
  const s = getGroupStats(groupJid);
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    out.push({ date: key, count: s?.daily?.[key] || 0 });
  }
  return out;
}

export function getAggregateStats() {
  ensureCache();
  flushIfDirty();
  const groups = Object.values(cache);
  const totals = { groupCount: groups.length, totalMessages: 0, totalJoins: 0, totalLeaves: 0 };
  for (const g of groups) {
    totals.totalMessages += g.totalMessages || 0;
    totals.totalJoins += g.joins || 0;
    totals.totalLeaves += g.leaves || 0;
  }
  return totals;
}

/** Groups ranked by message volume, busiest first. */
export function getTopGroups(limit) {
  ensureCache();
  flushIfDirty();
  const cap = limit || cfg().topMembersLimit || 10;
  return Object.entries(cache)
    .map(([jid, s]) => ({ jid, totalMessages: s.totalMessages || 0 }))
    .sort((a, b) => b.totalMessages - a.totalMessages)
    .slice(0, cap);
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Drop daily buckets older than retentionDays. Counters (totals, joins,
 * leaves) are lifetime values and are never pruned.
 */
export function pruneOldStats() {
  if (!statsActive()) return { pruned: 0 };
  ensureCache();
  const days = cfg().retentionDays || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = dayKey(cutoff);

  let pruned = 0;
  for (const s of Object.values(cache)) {
    for (const day of Object.keys(s.daily || {})) {
      if (day < cutoffKey) {
        delete s.daily[day];
        pruned++;
      }
    }
  }
  if (pruned) {
    dirty = true;
    flushStats();
  }
  return { pruned };
}

export function reload() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  dirty = false;
  cache = null;
  return loadGroupStats();
}

/** Test helpers. */
export function __setCacheForTests(c) {
  cache = c;
  dirty = false;
}
export function __setDirtyForTests(v) {
  dirty = !!v;
}
export { STATS_PATH };
