import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { normalize, similarity, generateId, isActiveNow } from '../utils/matchUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const FAQ_FILE = path.join(DATA_DIR, 'faq.json');
const FAQ_CATEGORIES_FILE = path.join(DATA_DIR, 'faqCategories.json');

const DEFAULT_FAQ_CATEGORIES = [
  { id: 'profile', nameKey: 'faq.catProfile', emoji: '👤' },
  { id: 'settings', nameKey: 'faq.catSettings', emoji: '⚙️' },
  { id: 'privacy', nameKey: 'faq.catPrivacy', emoji: '🔐' },
  { id: 'chat_messaging', nameKey: 'faq.catChatMessaging', emoji: '💬' },
  { id: 'help_support', nameKey: 'faq.catHelpSupport', emoji: '🆘' },
  { id: 'bot_info', nameKey: 'faq.catBotInfo', emoji: '🤖' },
  { id: 'fun_extras', nameKey: 'faq.catFunExtras', emoji: '🎉' },
  { id: 'misc', nameKey: 'faq.catMisc', emoji: '🔧' }
];

export function getFaqCategories() {
  try {
    if (fs.existsSync(FAQ_CATEGORIES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FAQ_CATEGORIES_FILE, 'utf8'));
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load FAQ categories');
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FAQ_CATEGORIES_FILE, JSON.stringify(DEFAULT_FAQ_CATEGORIES, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to seed FAQ categories');
  }
  return DEFAULT_FAQ_CATEGORIES.map((c) => ({ ...c }));
}

export function getFaqCategory(id) {
  return getFaqCategories().find((c) => c.id === id) || null;
}

// Common words removed during keyword extraction.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
  'how', 'what', 'where', 'when', 'why', 'who', 'which', 'can', 'could', 'would',
  'will', 'shall', 'should', 'i', 'me', 'my', 'your', 'you', 'to', 'for', 'of', 'in',
  'on', 'at', 'with', 'and', 'or', 'but', 'not', 'so', 'if', 'then', 'the', 'this',
  'that', 'there', 'here', 'get', 'got', 'use', 'using', 'need'
]);

let entries = [];

function load() {
  try {
    if (fs.existsSync(FAQ_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FAQ_FILE, 'utf8'));
      if (Array.isArray(parsed)) entries = parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load FAQ from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FAQ_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save FAQ to disk');
  }
}

load();

function clone(arr) {
  return JSON.parse(JSON.stringify(arr));
}

export function getAllEntries() {
  return clone(entries);
}

export function getEnabledEntries() {
  return clone(entries.filter((e) => e.enabled));
}

export function getEntry(id) {
  const found = entries.find((e) => e.id === id);
  return found ? { ...found } : null;
}

export function reloadEntries() {
  load();
  return entries.length;
}

function cleanWeights(weights) {
  const out = {};
  if (weights && typeof weights === 'object' && !Array.isArray(weights)) {
    for (const [k, v] of Object.entries(weights)) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) out[normalize(k)] = Math.min(10, n);
    }
  }
  return out;
}

export function addEntry(data = {}) {
  const now = new Date().toISOString();
  const status = data.status === 'draft' ? 'draft' : (data.status === 'disabled' ? 'disabled' : 'active');
  const entry = {
    id: data.id || generateId(),
    question: data.question || '',
    keywords: Array.isArray(data.keywords) ? data.keywords.map((k) => normalize(k)).filter(Boolean) : [],
    keywordWeights: cleanWeights(data.keywordWeights),
    answer: data.answer || '',
    answerVariants: Array.isArray(data.answerVariants) ? data.answerVariants.map((a) => String(a)).filter(Boolean) : [],
    language: data.language || 'all',
    category: data.category || '',
    priority: Number(data.priority) || 1,
    status,
    enabled: status === 'active' ? data.enabled !== false : false,
    favorite: data.favorite === true,
    activeFrom: data.activeFrom || null,
    activeTo: data.activeTo || null,
    createdBy: data.createdBy || '',
    lastEditedBy: data.lastEditedBy || data.createdBy || '',
    packId: typeof data.packId === 'string' && data.packId ? data.packId : null,
    packVersion: Number(data.packVersion) || (data.packId ? 1 : null),
    createdFrom: typeof data.createdFrom === 'string' && data.createdFrom ? data.createdFrom : null,
    lastUpdated: data.lastUpdated || now,
    createdAt: data.createdAt || now
  };
  entries.push(entry);
  save();
  return entry.id;
}

export function updateEntry(id, patch = {}) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return false;
  Object.keys(patch).forEach((k) => {
    if (k === 'id') return;
    if (k === 'keywords') {
      entry.keywords = patch.keywords.map((w) => normalize(w)).filter(Boolean);
    } else if (k === 'keywordWeights') {
      entry.keywordWeights = cleanWeights(patch.keywordWeights);
    } else {
      entry[k] = patch[k];
    }
  });
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    if (!['active', 'draft', 'disabled'].includes(entry.status)) entry.status = 'active';
    entry.enabled = entry.status === 'active' ? entry.enabled !== false : false;
  } else if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    if (entry.status === 'draft' && entry.enabled) entry.status = 'active';
    else if (!entry.enabled && entry.status === 'active') entry.status = 'disabled';
    else if (entry.enabled && entry.status === 'disabled') entry.status = 'active';
  }
  if (typeof entry.status !== 'string') entry.status = entry.enabled === false ? 'disabled' : 'active';
  entry.lastUpdated = new Date().toISOString();
  save();
  return true;
}

export function deleteEntry(id) {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  save();
  return true;
}

/**
 * Duplicate an entry for translation/variation: same question/answer,
 * fresh id, new language. Returns the new entry id (or null if missing).
 */
export function duplicateFaq(entryId, newLanguage) {
  const found = entries.find((e) => e.id === entryId);
  if (!found) return null;
  const now = new Date().toISOString();
  const copy = {
    ...JSON.parse(JSON.stringify(found)),
    id: generateId(),
    language: newLanguage || found.language || 'all',
    lastUpdated: now
  };
  entries.push(copy);
  save();
  return copy.id;
}

export function toggleEntry(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  entry.enabled = !entry.enabled;
  entry.lastUpdated = new Date().toISOString();
  save();
  return entry.enabled;
}

export function searchEntries(keyword) {
  const kw = normalize(keyword);
  if (!kw) return [];
  return clone(entries.filter((e) =>
    normalize(e.question).includes(kw) ||
    e.keywords.some((k) => k.includes(kw)) ||
    normalize(e.answer).includes(kw)
  ));
}

export function importEntries(data) {
  if (!Array.isArray(data)) return false;
  const now = new Date().toISOString();
  entries = data.map((e) => ({
    id: e.id || generateId(),
    question: e.question || '',
    keywords: Array.isArray(e.keywords) ? e.keywords.map((k) => normalize(k)).filter(Boolean) : [],
    answer: e.answer || '',
    language: e.language || 'all',
    category: e.category || '',
    priority: Number(e.priority) || 1,
    enabled: e.enabled !== false,
    activeFrom: e.activeFrom || null,
    activeTo: e.activeTo || null,
    lastUpdated: e.lastUpdated || now
  }));
  save();
  return true;
}

function normalizeEntry(e, now, fallbackId) {
  return {
    id: e.id || fallbackId || generateId(),
    question: e.question || '',
    keywords: Array.isArray(e.keywords) ? e.keywords.map((k) => normalize(k)).filter(Boolean) : [],
    answer: e.answer || '',
    language: e.language || 'all',
    category: e.category || '',
    priority: Number(e.priority) || 1,
    enabled: e.enabled !== false,
    activeFrom: e.activeFrom || null,
    activeTo: e.activeTo || null,
    lastUpdated: e.lastUpdated || now
  };
}

/**
 * Determine whether an incoming FAQ entry is a duplicate of an existing one.
 * A FAQ entry is a duplicate if it shares the same id, OR the same question
 * AND the same language.
 */
export function isDuplicateEntry(incoming, existing) {
  if (incoming.id && existing.id && incoming.id === existing.id) return true;
  const inQ = normalize(incoming.question || '');
  const exQ = normalize(existing.question || '');
  if (inQ && exQ && inQ === exQ && (incoming.language || 'all') === (existing.language || 'all')) {
    return true;
  }
  return false;
}

export function findDuplicateEntry(incoming) {
  const norm = normalizeEntry(incoming, new Date().toISOString());
  return entries.find((e) => isDuplicateEntry(norm, e)) || null;
}

/**
 * Additively merge incoming FAQ entries into the current active data applying
 * the duplicate policy. Does NOT replace existing entries.
 */
export function mergeEntries(data, policy = 'skip') {
  if (!Array.isArray(data)) return { added: 0, skipped: 0, overwritten: 0, duplicated: 0, total: 0 };
  const now = new Date().toISOString();
  let added = 0;
  let skipped = 0;
  let overwritten = 0;
  let duplicated = 0;
  for (const raw of data) {
    const incoming = normalizeEntry(raw, now);
    const existing = entries.find((e) => isDuplicateEntry(incoming, e)) || null;
    if (existing) {
      duplicated += 1;
      if (policy === 'overwrite') {
        Object.keys(incoming).forEach((k) => {
          if (k === 'lastUpdated' || k === 'id') return;
          existing[k] = incoming[k];
        });
        existing.lastUpdated = now;
        overwritten += 1;
        continue;
      }
      if (policy === 'skip') {
        skipped += 1;
        continue;
      }
      incoming.id = generateId();
    }
    entries.push(incoming);
    added += 1;
  }
  save();
  return { added, skipped, overwritten, duplicated, total: data.length };
}

export function exportEntries() {
  return clone(entries);
}

/**
 * Auto-extract candidate keywords from a question by removing stop words.
 */
export function suggestKeywords(question) {
  const words = normalize(question).split(' ').filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const w of words) {
    if (!STOP_WORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
  }
  return result;
}

/**
 * Matching engine. Searches enabled entries matching the user's language (or
 * 'all'). Scores entries by keyword overlap; falls back to question
 * similarity. Returns:
 *  - { multiple: true, candidates: [top3] } when several match
 *  - { multiple: false, entry } when exactly one matches
 *  - null when nothing matches
 */
export function keywordWeight(entry, keyword) {
  const w = entry?.keywordWeights?.[keyword];
  return Number.isFinite(Number(w)) && Number(w) > 0 ? Number(w) : 1;
}

/** Resolve the answer text, picking a random variant when present. */
export function resolveAnswer(entry) {
  if (!entry) return '';
  const variants = Array.isArray(entry.answerVariants) ? entry.answerVariants.filter(Boolean) : [];
  if (variants.length) return variants[Math.floor(Math.random() * variants.length)];
  return entry.answer || '';
}

/** Related FAQs: same category or shared keywords, top N by overlap. */
export function relatedFaqs(id, limit = 2) {
  const src = entries.find((e) => e.id === id);
  if (!src) return [];
  const srcKws = new Set(src.keywords || []);
  return entries
    .filter((e) => e.id !== id && e.enabled && e.status !== 'draft' && isActiveNow(e))
    .map((e) => {
      let score = 0;
      if (src.category && e.category === src.category) score += 2;
      for (const kw of e.keywords || []) {
        if (srcKws.has(kw)) score += 1;
      }
      return { entry: { ...e }, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.entry);
}

export function matchFaq(text, userLanguage = 'all') {
  const input = normalize(text);
  if (!input) return null;

  const scored = [];

  for (const entry of entries) {
    if (!entry.enabled || entry.status === 'draft') continue;
    if (!isActiveNow(entry)) continue;
    if (entry.language !== 'all' && entry.language !== userLanguage) continue;

    let score = 0;
    const matchedKeywords = [];
    for (const kw of entry.keywords) {
      if (input.includes(kw)) {
        score += keywordWeight(entry, kw);
        matchedKeywords.push(kw);
      }
    }

    // Fuzzy similarity to the question as a fallback signal.
    let sim = 0;
    if (score === 0) {
      sim = similarity(input, normalize(entry.question));
      if (sim >= 0.6) score = 0.5;
    }

    if (score > 0) {
      scored.push({ entry, score: score + (entry.priority || 1) / 10, matchedKeywords });
    }
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 1) {
    return { multiple: false, entry: { ...scored[0].entry }, matchedKeywords: scored[0].matchedKeywords };
  }
  return {
    multiple: true,
    candidates: scored.slice(0, 3).map((s) => ({ ...s.entry })),
    matchedKeywords: scored[0].matchedKeywords
  };
}
