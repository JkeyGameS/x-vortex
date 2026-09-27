import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');

export const BUG_CATEGORIES = ['crash', 'menu', 'translation', 'other'];

const COOLDOWN_FIRST_MS = 60 * 1000;
const COOLDOWN_NEXT_MS = 60 * 60 * 1000;

// In-memory per-user per-kind submission tracking: `${userId}:${kind}` -> { count, lastTs }.
const cooldowns = {};

function emptyStore() {
  return { ratings: [], bugReports: [], suggestions: [] };
}

let store = emptyStore();

function makeId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export const EDIT_WINDOW_MS = 5 * 60 * 1000;

export function isEditable(entry) {
  if (!entry || typeof entry.editableUntil !== 'string') return false;
  const until = Date.parse(entry.editableUntil);
  if (isNaN(until)) return false;
  return Date.now() < until;
}

function freshEditableUntil(fromIso) {
  const base = Date.parse(fromIso);
  const t = isNaN(base) ? Date.now() : base;
  return new Date(t + EDIT_WINDOW_MS).toISOString();
}

function normalizeEntry(kind, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const out = { ...entry };
  if (out.reply !== undefined && (typeof out.reply !== 'object' || out.reply === null)) delete out.reply;
  if (typeof out.resolved !== 'boolean') out.resolved = false;
  if (typeof out.id !== 'string' || !out.id) {
    out.id = makeId(kind === 'ratings' ? 'rt' : kind === 'bugReports' ? 'bg' : 'sg');
  }
  if (typeof out.userId !== 'string') out.userId = String(out.userId || '-');
  if (typeof out.timestamp !== 'string' || !out.timestamp) out.timestamp = new Date().toISOString();
  if (typeof out.editableUntil !== 'string' || !out.editableUntil) {
    out.editableUntil = freshEditableUntil(out.timestamp);
  }
  if (typeof out.anonymous !== 'boolean') out.anonymous = false;
  if (kind === 'ratings') {
    out.rating = parseInt(out.rating, 10);
    if (isNaN(out.rating) || out.rating < 1 || out.rating > 5) return null;
    if (typeof out.comment !== 'string') out.comment = '';
  } else {
    if (typeof out.description !== 'string') out.description = '';
  }
  if (kind === 'bugReports' && !BUG_CATEGORIES.includes(out.category)) out.category = 'other';
  return out;
}

function load() {
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        store = {
          ratings: (Array.isArray(parsed.ratings) ? parsed.ratings : []).map((e) => normalizeEntry('ratings', e)).filter(Boolean),
          bugReports: (Array.isArray(parsed.bugReports) ? parsed.bugReports : []).map((e) => normalizeEntry('bugReports', e)).filter(Boolean),
          suggestions: (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).map((e) => normalizeEntry('suggestions', e)).filter(Boolean)
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load feedback from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save feedback to disk');
  }
}

load();

function nowIso() {
  return new Date().toISOString();
}

export function addRating(userId, rating, comment = '', anonymous = false) {
  const n = parseInt(rating, 10);
  if (!userId || isNaN(n) || n < 1 || n > 5) return null;
  const ts = nowIso();
  const entry = {
    id: makeId('rt'),
    userId,
    rating: n,
    comment: comment || '',
    anonymous: anonymous === true,
    timestamp: ts,
    editableUntil: freshEditableUntil(ts)
  };
  store.ratings.push(entry);
  save();
  return entry;
}

export function addBugReport(userId, category, description, anonymous = false) {
  const text = (description || '').trim();
  if (!userId || !text) return null;
  const ts = nowIso();
  const entry = {
    id: makeId('bg'),
    userId,
    category: BUG_CATEGORIES.includes(category) ? category : 'other',
    description: text,
    anonymous: anonymous === true,
    timestamp: ts,
    editableUntil: freshEditableUntil(ts)
  };
  store.bugReports.push(entry);
  save();
  return entry;
}

export function addSuggestion(userId, description, anonymous = false) {
  const text = (description || '').trim();
  if (!userId || !text) return null;
  const ts = nowIso();
  const entry = {
    id: makeId('sg'),
    userId,
    description: text,
    anonymous: anonymous === true,
    timestamp: ts,
    editableUntil: freshEditableUntil(ts)
  };
  store.suggestions.push(entry);
  save();
  return entry;
}

export function updateRatingComment(id, comment) {
  const entry = store.ratings.find((r) => r.id === id);
  if (!entry) return null;
  entry.comment = comment || '';
  save();
  return entry;
}

export function getAllFeedback() {
  return {
    ratings: [...store.ratings],
    bugReports: [...store.bugReports],
    suggestions: [...store.suggestions]
  };
}

export function getUserFeedback(userId) {
  const ratings = store.ratings.filter((r) => r.userId === userId);
  const bugReports = store.bugReports.filter((b) => b.userId === userId);
  const suggestions = store.suggestions.filter((s) => s.userId === userId);
  const combined = [
    ...ratings.map((entry) => ({ kind: 'rating', entry })),
    ...bugReports.map((entry) => ({ kind: 'bug', entry })),
    ...suggestions.map((entry) => ({ kind: 'suggestion', entry }))
  ].sort((a, b) => (a.entry.timestamp < b.entry.timestamp ? 1 : -1));
  return { ratings, bugReports, suggestions, combined };
}

export function getAverageRating() {
  const count = store.ratings.length;
  if (count === 0) return { average: 0, count: 0 };
  const sum = store.ratings.reduce((acc, r) => acc + r.rating, 0);
  return { average: Math.round((sum / count) * 10) / 10, count };
}

export function getAllCombined() {
  return [
    ...store.ratings.map((entry) => ({ kind: 'rating', entry })),
    ...store.bugReports.map((entry) => ({ kind: 'bug', entry })),
    ...store.suggestions.map((entry) => ({ kind: 'suggestion', entry }))
  ].sort((a, b) => (a.entry.timestamp < b.entry.timestamp ? 1 : a.entry.timestamp > b.entry.timestamp ? -1 : 0));
}

export function addReply(feedbackId, adminJid, message) {
  const text = (message || '').trim();
  if (!feedbackId || !text) return null;
  const found = findFeedbackById(feedbackId);
  if (!found) return null;
  found.entry.reply = {
    adminJid: adminJid || '-',
    message: text,
    timestamp: new Date().toISOString()
  };
  save();
  return { kind: found.kind, entry: found.entry };
}

export function toggleResolved(id) {
  const found = findFeedbackById(id);
  if (!found) return null;
  found.entry.resolved = !found.entry.resolved;
  save();
  return { kind: found.kind, entry: found.entry };
}

export function getRecentFeedbackCount(sinceMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - sinceMs;
  let count = 0;
  for (const arr of [store.ratings, store.bugReports, store.suggestions]) {
    for (const entry of arr) {
      const ts = Date.parse(entry.timestamp);
      if (!isNaN(ts) && ts >= cutoff) count++;
    }
  }
  return count;
}

export function getFeedbackStats() {
  const { average, count } = getAverageRating();
  return {
    ratings: count,
    average,
    bugReports: store.bugReports.length,
    suggestions: store.suggestions.length
  };
}

export function findFeedbackById(id) {
  if (!id) return null;
  const pools = [
    ['rating', store.ratings],
    ['bug', store.bugReports],
    ['suggestion', store.suggestions]
  ];
  for (const [kind, arr] of pools) {
    const exact = arr.find((e) => e.id === id);
    if (exact) return { kind, entry: exact };
  }
  // Unique short-prefix match.
  const matches = [];
  for (const [kind, arr] of pools) {
    for (const entry of arr) {
      if (entry.id.startsWith(id)) matches.push({ kind, entry });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function deleteFeedback(id, userId = null) {
  const found = findFeedbackById(id);
  if (!found) return null;
  // Own-feedback deletes enforce ownership + 5-minute window; admin deletes
  // (no userId) bypass both checks.
  if (userId !== null && userId !== undefined) {
    if (found.entry.userId !== userId) return null;
    if (!isEditable(found.entry)) return null;
  }
  const pool = found.kind === 'rating' ? store.ratings : found.kind === 'bug' ? store.bugReports : store.suggestions;
  const idx = pool.findIndex((e) => e.id === found.entry.id);
  if (idx >= 0) pool.splice(idx, 1);
  save();
  return found;
}

export function updateFeedback(userId, id, updates = {}) {
  const found = findFeedbackById(id);
  if (!found) return null;
  if (found.entry.userId !== userId) return null;
  if (!isEditable(found.entry)) return null;
  const entry = found.entry;
  if (found.kind === 'rating') {
    if (updates.rating !== undefined) {
      const n = parseInt(updates.rating, 10);
      if (isNaN(n) || n < 1 || n > 5) return null;
      entry.rating = n;
    }
    if (typeof updates.comment === 'string') entry.comment = updates.comment;
  } else if (found.kind === 'bug') {
    if (typeof updates.description === 'string' && updates.description.trim()) {
      entry.description = updates.description.trim();
    } else if (updates.description !== undefined) {
      return null;
    }
    if (updates.category !== undefined) {
      if (!BUG_CATEGORIES.includes(updates.category)) return null;
      entry.category = updates.category;
    }
  } else {
    if (typeof updates.description === 'string' && updates.description.trim()) {
      entry.description = updates.description.trim();
    } else {
      return null;
    }
  }
  save();
  return { kind: found.kind, entry };
}

export function getUserFeedbackCounts(userId) {
  return {
    ratings: store.ratings.filter((r) => r.userId === userId).length,
    bugs: store.bugReports.filter((b) => b.userId === userId).length,
    suggestions: store.suggestions.filter((s) => s.userId === userId).length
  };
}

export function getLastRating(userId) {
  const mine = store.ratings.filter((r) => r.userId === userId);
  return mine.length ? mine[mine.length - 1] : null;
}

export function deleteAllFeedback() {
  const count = store.ratings.length + store.bugReports.length + store.suggestions.length;
  store = emptyStore();
  save();
  return count;
}

export function searchFeedback(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const entry of store.ratings) {
    if (entry.userId.toLowerCase().includes(q) || (entry.comment || '').toLowerCase().includes(q)) {
      out.push({ kind: 'rating', entry });
    }
  }
  for (const entry of store.bugReports) {
    if (entry.userId.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q) || (entry.category || '').includes(q)) {
      out.push({ kind: 'bug', entry });
    }
  }
  for (const entry of store.suggestions) {
    if (entry.userId.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q)) {
      out.push({ kind: 'suggestion', entry });
    }
  }
  return out.sort((a, b) => (a.entry.timestamp < b.entry.timestamp ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Submission cooldown: 60s between the 1st and 2nd submission of the same
// kind, then 60min between subsequent submissions of that kind.
// ---------------------------------------------------------------------------

export function checkCooldown(userId, kind) {
  const e = cooldowns[`${userId}:${kind}`];
  if (!e) return { allowed: true, waitMs: 0 };
  const gap = e.count >= 2 ? COOLDOWN_NEXT_MS : COOLDOWN_FIRST_MS;
  const elapsed = Date.now() - e.lastTs;
  if (elapsed >= gap) return { allowed: true, waitMs: 0 };
  return { allowed: false, waitMs: gap - elapsed };
}

export function recordSubmission(userId, kind) {
  const key = `${userId}:${kind}`;
  const e = cooldowns[key] || { count: 0, lastTs: 0 };
  e.count += 1;
  e.lastTs = Date.now();
  cooldowns[key] = e;
  return e;
}

export function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.ceil(m / 60)}h`;
}

export function clearCooldowns() {
  for (const key of Object.keys(cooldowns)) delete cooldowns[key];
}

// ---------------------------------------------------------------------------
// Preset replies (admin-managed quick answers), stored in
// data/presetReplies.json as [{ id, text }].
// ---------------------------------------------------------------------------

const PRESETS_FILE = path.join(DATA_DIR, 'presetReplies.json');

const DEFAULT_PRESET_TEXTS = [
  "Thank you for your feedback! We'll look into it.",
  "We've fixed the issue. Thanks for reporting!",
  "Your suggestion is great! We'll consider it."
];

let presets = null;

function presetId() {
  return 'pr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function loadPresets() {
  try {
    if (fs.existsSync(PRESETS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        presets = parsed.filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string' && p.text.trim());
        return;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load preset replies from disk');
  }
  presets = DEFAULT_PRESET_TEXTS.map((text) => ({ id: presetId(), text }));
  savePresets();
}

function savePresets() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save preset replies to disk');
  }
}

export function getPresetReplies() {
  if (!presets) loadPresets();
  return presets.map((p) => ({ ...p }));
}

export function addPresetReply(text) {
  const clean = (text || '').trim();
  if (!clean) return null;
  if (!presets) loadPresets();
  const entry = { id: presetId(), text: clean };
  presets.push(entry);
  savePresets();
  return { ...entry };
}

export function deletePresetReply(id) {
  if (!presets) loadPresets();
  const idx = presets.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const [removed] = presets.splice(idx, 1);
  savePresets();
  return { ...removed };
}
