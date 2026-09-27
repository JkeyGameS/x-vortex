import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { normalize, fuzzyMatch, generateId, isActiveNow, levenshtein, similarity } from '../utils/matchUtils.js';
import { getSettings as getChatSettings } from './chatSettingsService.js';
import { normalizeReplies } from './replySelector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const RULES_FILE = path.join(DATA_DIR, 'chatRules.json');

let rules = [];

function load() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
      if (Array.isArray(parsed)) rules = parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load chat rules from disk');
  }
}

export function reloadRules() {
  load();
  return rules.length;
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save chat rules to disk');
  }
}

load();

function clone(arr) {
  return JSON.parse(JSON.stringify(arr));
}

export function getAllRules() {
  return clone(rules);
}

export function getEnabledRules() {
  return clone(rules.filter((r) => r.enabled && r.status !== 'draft'));
}

export function getRule(id) {
  const found = rules.find((r) => r.id === id);
  return found ? { ...found } : null;
}

export function addRule(data = {}) {
  const now = new Date().toISOString();
  const rule = {
    id: data.id || generateId(),
    triggers: Array.isArray(data.triggers) ? data.triggers.map((t) => normalize(t)).filter(Boolean) : [],
    triggerExact: Boolean(data.triggerExact),
    replies: normalizeReplies(data.replies),
    language: data.language || 'all',
    priority: Number(data.priority) || 1,
    style: data.style || 'friendly',
    emojisEnabled: data.emojisEnabled !== false,
    enabled: data.enabled !== false,
    favorite: data.favorite === true,
    action: typeof data.action === 'string' && data.action ? data.action : 'send_text',
    cooldownSeconds: Math.max(0, Number(data.cooldownSeconds) || 0),
    activeFrom: data.activeFrom || null,
    activeTo: data.activeTo || null,
    context: typeof data.context === 'string' && data.context.trim() ? data.context.trim().slice(0, 40) : null,
    setsContext: typeof data.setsContext === 'string' && data.setsContext.trim() ? data.setsContext.trim().slice(0, 40) : null,
    contextExpiryMs: Number(data.contextExpiryMs) > 0 ? Math.min(3600000, Math.floor(Number(data.contextExpiryMs))) : null,
    toneSensitive: data.toneSensitive === true ? true : (data.toneSensitive === false ? false : null),
    timeSensitive: data.timeSensitive === true ? true : (data.timeSensitive === false ? false : null),
    styleSensitive: data.styleSensitive === false ? false : (data.styleSensitive === true ? true : null),
    followUpChance: data.followUpChance == null || data.followUpChance === '' ? null : Math.min(1, Math.max(0, Number(data.followUpChance) || 0)),
    packId: typeof data.packId === 'string' && data.packId ? data.packId : null,
    packVersion: Number(data.packVersion) || (data.packId ? 1 : null),
    createdFrom: typeof data.createdFrom === 'string' && data.createdFrom ? data.createdFrom : 'manual',
    status: data.status === 'draft' ? 'draft' : (data.status === 'disabled' ? 'disabled' : 'active'),
    enabled: data.status ? data.status === 'active' : data.enabled !== false,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    createdBy: data.createdBy || ''
  };
  rules.push(rule);
  save();
  return rule.id;
}

export function updateRule(id, patch = {}) {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return false;
  Object.keys(patch).forEach((k) => {
    if (k === 'id') return;
    if (k === 'triggers') {
      rule.triggers = patch.triggers.map((t) => normalize(t)).filter(Boolean);
    } else if (k === 'replies') {
      rule.replies = normalizeReplies(patch.replies);
    } else if (k === 'context' || k === 'setsContext') {
      rule[k] = typeof patch[k] === 'string' && patch[k].trim() ? patch[k].trim().slice(0, 40) : null;
    } else if (k === 'contextExpiryMs') {
      rule[k] = Number(patch[k]) > 0 ? Math.min(3600000, Math.floor(Number(patch[k]))) : null;
    } else if (k === 'toneSensitive' || k === 'timeSensitive') {
      rule[k] = patch[k] === true ? true : (patch[k] === false ? false : null);
    } else if (k === 'styleSensitive') {
      rule[k] = patch[k] === false ? false : (patch[k] === true ? true : null);
    } else if (k === 'followUpChance') {
      rule[k] = patch[k] == null || patch[k] === '' ? null : Math.min(1, Math.max(0, Number(patch[k]) || 0));
    } else {
      rule[k] = patch[k];
    }
  });
  // Keep the status flag and the enabled boolean consistent.
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    if (!['active', 'draft', 'disabled'].includes(rule.status)) rule.status = 'active';
    rule.enabled = rule.status === 'active';
  } else if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    if (rule.status === 'draft' && rule.enabled) {
      // Drafts stay drafts; enabling a draft promotes it.
      rule.status = 'active';
    } else if (!rule.enabled && rule.status === 'active') {
      rule.status = 'disabled';
    } else if (rule.enabled && rule.status === 'disabled') {
      rule.status = 'active';
    }
  }
  if (typeof rule.status !== 'string') rule.status = rule.enabled === false ? 'disabled' : 'active';
  rule.updatedAt = new Date().toISOString();
  save();
  return true;
}

export function deleteRule(id) {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  save();
  return true;
}

/**
 * Duplicate a rule for translation/variation: same triggers and replies,
 * fresh id, new language. Returns the new rule id (or null if missing).
 */
export function duplicateChatRule(ruleId, newLanguage) {
  const found = rules.find((r) => r.id === ruleId);
  if (!found) return null;
  const now = new Date().toISOString();
  const copy = {
    ...JSON.parse(JSON.stringify(found)),
    id: generateId(),
    language: newLanguage || found.language || 'all',
    createdAt: now,
    updatedAt: now,
    createdBy: found.createdBy || ''
  };
  rules.push(copy);
  save();
  return copy.id;
}

export function toggleRule(id) {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return null;
  if (rule.status === 'draft') {
    rule.status = 'active';
    rule.enabled = true;
  } else {
    rule.enabled = !rule.enabled;
    rule.status = rule.enabled ? 'active' : 'disabled';
  }
  rule.updatedAt = new Date().toISOString();
  save();
  return rule.enabled;
}

export function searchRules(keyword) {
  const kw = normalize(keyword);
  if (!kw) return [];
  return clone(rules.filter((r) =>
    r.triggers.some((t) => t.includes(kw)) ||
    r.replies.some((rep) => normalize(rep).includes(kw))
  ));
}

export function importRules(data) {
  if (!Array.isArray(data)) return false;
  const now = new Date().toISOString();
  rules = data.map((r) => ({
    id: r.id || generateId(),
    triggers: Array.isArray(r.triggers) ? r.triggers.map((t) => normalize(t)).filter(Boolean) : [],
    triggerExact: Boolean(r.triggerExact),
    replies: normalizeReplies(r.replies),
    language: r.language || 'all',
    priority: Number(r.priority) || 1,
    style: r.style || 'friendly',
    emojisEnabled: r.emojisEnabled !== false,
    enabled: r.status ? r.status === 'active' : r.enabled !== false,
    status: r.status === 'draft' ? 'draft' : (r.status === 'disabled' || r.enabled === false ? 'disabled' : 'active'),
    favorite: r.favorite === true,
    action: typeof r.action === 'string' && r.action ? r.action : 'send_text',
    cooldownSeconds: Math.max(0, Number(r.cooldownSeconds) || 0),
    activeFrom: r.activeFrom || null,
    activeTo: r.activeTo || null,
    context: typeof r.context === 'string' && r.context.trim() ? r.context.trim().slice(0, 40) : null,
    setsContext: typeof r.setsContext === 'string' && r.setsContext.trim() ? r.setsContext.trim().slice(0, 40) : null,
    contextExpiryMs: Number(r.contextExpiryMs) > 0 ? Math.min(3600000, Math.floor(Number(r.contextExpiryMs))) : null,
    toneSensitive: r.toneSensitive === true ? true : (r.toneSensitive === false ? false : null),
    timeSensitive: r.timeSensitive === true ? true : (r.timeSensitive === false ? false : null),
    styleSensitive: r.styleSensitive === false ? false : (r.styleSensitive === true ? true : null),
    followUpChance: r.followUpChance == null || r.followUpChance === '' ? null : Math.min(1, Math.max(0, Number(r.followUpChance) || 0)),
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || now,
    createdBy: r.createdBy || ''
  }));
  save();
  return true;
}

/**
 * Normalize an incoming rule shape into the canonical stored form.
 * @returns {Object} normalized rule
 */
function normalizeRule(r, now, fallbackId) {
  return {
    id: r.id || fallbackId || generateId(),
    triggers: Array.isArray(r.triggers) ? r.triggers.map((t) => normalize(t)).filter(Boolean) : [],
    triggerExact: Boolean(r.triggerExact),
    replies: Array.isArray(r.replies) ? r.replies : [],
    language: r.language || 'all',
    priority: Number(r.priority) || 1,
    style: r.style || 'friendly',
    emojisEnabled: r.emojisEnabled !== false,
    enabled: r.status ? r.status === 'active' : r.enabled !== false,
    status: r.status === 'draft' ? 'draft' : (r.status === 'disabled' || r.enabled === false ? 'disabled' : 'active'),
    favorite: r.favorite === true,
    action: typeof r.action === 'string' && r.action ? r.action : 'send_text',
    cooldownSeconds: Math.max(0, Number(r.cooldownSeconds) || 0),
    activeFrom: r.activeFrom || null,
    activeTo: r.activeTo || null,
    context: typeof r.context === 'string' && r.context.trim() ? r.context.trim().slice(0, 40) : null,
    setsContext: typeof r.setsContext === 'string' && r.setsContext.trim() ? r.setsContext.trim().slice(0, 40) : null,
    contextExpiryMs: Number(r.contextExpiryMs) > 0 ? Math.min(3600000, Math.floor(Number(r.contextExpiryMs))) : null,
    toneSensitive: r.toneSensitive === true ? true : (r.toneSensitive === false ? false : null),
    timeSensitive: r.timeSensitive === true ? true : (r.timeSensitive === false ? false : null),
    styleSensitive: r.styleSensitive === false ? false : (r.styleSensitive === true ? true : null),
    followUpChance: r.followUpChance == null || r.followUpChance === '' ? null : Math.min(1, Math.max(0, Number(r.followUpChance) || 0)),
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || now,
    createdBy: r.createdBy || ''
  };
}

/**
 * Determine whether an incoming rule counts as a duplicate against the given
 * existing rule. A chat rule is a duplicate if it shares the same id, OR the
 * same primary trigger AND the same language.
 * @param {Object} incoming - normalized incoming rule
 * @param {Object} existing - existing rule
 * @returns {boolean}
 */
export function isDuplicateRule(incoming, existing) {
  if (incoming.id && existing.id && incoming.id === existing.id) return true;
  const inPrimary = (incoming.triggers && incoming.triggers[0]) || null;
  const exPrimary = (existing.triggers && existing.triggers[0]) || null;
  if (inPrimary && exPrimary && inPrimary === exPrimary && (incoming.language || 'all') === (existing.language || 'all')) {
    return true;
  }
  return false;
}

/**
 * Find the existing rule that an incoming rule duplicates, if any.
 * @returns {Object|null}
 */
export function findDuplicateRule(incoming) {
  const norm = normalizeRule(incoming, new Date().toISOString());
  return rules.find((r) => isDuplicateRule(norm, r)) || null;
}

/**
 * Additively merge an array of incoming rules into the current active data,
 * applying the given duplicate policy. Does NOT replace existing rules.
 *
 * @param {Array} data - incoming rules
 * @param {string} policy - 'skip' | 'overwrite' | 'keep_both'
 * @returns {{ added: number, skipped: number, overwritten: number, duplicated: number, total: number }}
 */
export function mergeRules(data, policy = 'skip') {
  if (!Array.isArray(data)) return { added: 0, skipped: 0, overwritten: 0, duplicated: 0, total: 0 };
  const now = new Date().toISOString();
  let added = 0;
  let skipped = 0;
  let overwritten = 0;
  let duplicated = 0;
  for (const raw of data) {
    const incoming = normalizeRule(raw, now);
    const existing = rules.find((r) => isDuplicateRule(incoming, r)) || null;
    if (existing) {
      duplicated += 1;
      if (policy === 'overwrite') {
        Object.keys(incoming).forEach((k) => {
          if (k === 'createdAt' || k === 'createdBy' || k === 'id') return;
          existing[k] = incoming[k];
        });
        existing.updatedAt = now;
        overwritten += 1;
        continue;
      }
      if (policy === 'skip') {
        skipped += 1;
        continue;
      }
      // keep_both: fall through to append with a fresh id
      incoming.id = generateId();
    }
    rules.push(incoming);
    added += 1;
  }
  save();
  return { added, skipped, overwritten, duplicated, total: data.length };
}

export function exportRules() {
  return clone(rules).map((r) => ({ ...r, replies: normalizeReplies(r.replies) }));
}

/**
 * Matching engine. Returns the highest-priority enabled rule whose language
 * matches the user's language (or 'all') and whose trigger matches the input.
 *
 * Returns null when nothing matches.
 */
function chatSettings() {
  try {
    return getChatSettings();
  } catch {
    return null;
  }
}

function resolveFuzzyMode(opts = {}) {
  if (opts.fuzzy && ['strict', 'normal', 'loose', 'off'].includes(opts.fuzzy)) return opts.fuzzy;
  const settings = chatSettings();
  if (settings && typeof settings.fuzzyMatching === 'string') return settings.fuzzyMatching;
  return 'normal';
}

function fuzzyHit(input, normTrigger, mode) {
  if (input === normTrigger) return true;
  if (mode === 'strict' || mode === 'off') return false;
  if (mode === 'loose') {
    if (input.includes(normTrigger)) return true;
    if (levenshtein(input, normTrigger) <= 3) return true;
    if (similarity(input, normTrigger) >= 0.7) return true;
    return false;
  }
  // normal: substring or close edit distance / high similarity
  if (input.includes(normTrigger)) return true;
  if (levenshtein(input, normTrigger) <= 2) return true;
  if (similarity(input, normTrigger) >= 0.85) return true;
  return false;
}

function resolveLanguageFilter(opts = {}) {
  if (Array.isArray(opts.languageFilter)) return opts.languageFilter;
  const settings = chatSettings();
  if (settings && Array.isArray(settings.languageFilter)) return settings.languageFilter;
  return null;
}

function resolvePriorityMode(opts = {}) {
  if (opts.priorityMode && ['strict', 'random', 'highest'].includes(opts.priorityMode)) return opts.priorityMode;
  const settings = chatSettings();
  if (settings && typeof settings.priorityMode === 'string') return settings.priorityMode;
  return 'highest';
}

function resolveContextConfig(opts = {}) {
  if (opts.contextEnabled === false) return { enabled: false, boost: 0, defaultExpiryMs: 120000 };
  const settings = chatSettings();
  const enabled = settings && typeof settings.contextAwarenessEnabled === 'boolean'
    ? settings.contextAwarenessEnabled
    : true;
  if (!enabled) return { enabled: false, boost: 0, defaultExpiryMs: 120000 };
  const cfg = {};
  try {
    const persisted = Number(settings && settings.contextPriorityBoost);
    cfg.boost = Number.isFinite(persisted) && persisted > 0
      ? persisted
      : Number(config.chatContextPriorityBoost);
    cfg.defaultExpiryMs = Number(config.chatContextDefaultExpiryMs);
  } catch { /* defaults below */ }
  return {
    enabled: true,
    boost: Number.isFinite(cfg.boost) && cfg.boost > 0 ? cfg.boost : 100,
    defaultExpiryMs: Number.isFinite(cfg.defaultExpiryMs) && cfg.defaultExpiryMs > 0 ? cfg.defaultExpiryMs : 120000
  };
}

/**
 * Return the still-valid pending context from a session object, or null.
 * Does not mutate; callers clear expired contexts themselves.
 */
export function resolvePendingContext(session) {
  if (!session || typeof session.pendingContext !== 'string' || !session.pendingContext) return null;
  const expiresAt = Number(session.pendingContextExpiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) return null;
  return session.pendingContext;
}

export function matchRule(text, userLanguage = 'all', opts = {}) {
  const input = normalize(text);
  if (!input) return null;
  const fuzzy = resolveFuzzyMode(opts);
  const langFilter = opts.ignoreLanguageFilter ? null : resolveLanguageFilter(opts);
  const priorityMode = resolvePriorityMode(opts);
  const contextTriggers = Array.isArray(opts.contextTriggers) ? opts.contextTriggers : [];
  const ctx = resolveContextConfig(opts);
  const pendingContext = ctx.enabled && typeof opts.pendingContext === 'string' && opts.pendingContext
    ? opts.pendingContext
    : null;

  const matches = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!isActiveNow(rule)) continue;
    if (rule.language !== 'all' && rule.language !== userLanguage && !opts.ignoreLanguageFilter) continue;
    if (langFilter && rule.language !== 'all' && !langFilter.includes(rule.language)) continue;
    if (ctx.enabled && pendingContext && rule.context && rule.context !== pendingContext) continue;
    for (const trigger of rule.triggers) {
      const normTrigger = normalize(trigger);
      if (!normTrigger) continue;
      let hit = false;
      if (rule.triggerExact) {
        hit = fuzzy === 'strict' || fuzzy === 'off' ? input === normTrigger : fuzzyMatch(input, normTrigger);
        if (fuzzy === 'loose' && !hit) hit = fuzzyHit(input, normTrigger, 'loose');
      } else if (fuzzy === 'strict') {
        hit = input === normTrigger;
      } else {
        hit = fuzzyHit(input, normTrigger, fuzzy);
      }
      if (hit) {
        const contextMatch = ctx.enabled && !!pendingContext && !!rule.context && rule.context === pendingContext;
        matches.push({ rule, matchedTrigger: trigger, contextMatch });
        break;
      }
    }
    if (priorityMode === 'strict' && matches.length) break;
  }
  if (!matches.length) return null;
  // Context-specific matches win over context-free ones when a pending context is active.
  // Rules carrying a context never match without one.
  let pool = matches;
  if (ctx.enabled) {
    if (pendingContext) {
      const scoped = matches.filter((m) => m.contextMatch);
      pool = scoped.length ? scoped : matches.filter((m) => !m.rule.context);
    } else {
      pool = matches.filter((m) => !m.rule.context);
    }
  }
  if (!pool.length) return null;
  const effectiveOf = (m) => (m.rule.priority || 0) + (m.contextMatch ? ctx.boost : 0);
  const ranked = [...pool]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (effectiveOf(b.m) - effectiveOf(a.m)) || (a.i - b.i))
    .map((x) => x.m);
  const withScore = (m) => ({ ...m, effectivePriority: effectiveOf(m) });
  if (priorityMode === 'strict') return withScore(ranked[0]);
  if (priorityMode === 'random') return withScore(ranked[Math.floor(Math.random() * ranked.length)]);
  // highest: max effective priority, ties prefer context-related rules, then first match.
  let best = ranked[0];
  for (const m of ranked) {
    const ms = effectiveOf(m);
    const bs = effectiveOf(best);
    if (ms > bs) {
      best = m;
    } else if (ms === bs && contextTriggers.length) {
      const mWords = new Set((m.matchedTrigger || '').toLowerCase().split(/\s+/));
      const bWords = new Set((best.matchedTrigger || '').toLowerCase().split(/\s+/));
      const mScore = contextTriggers.filter((w) => mWords.has(String(w).toLowerCase())).length;
      const bScore = contextTriggers.filter((w) => bWords.has(String(w).toLowerCase())).length;
      if (mScore > bScore) best = m;
    }
  }
  return withScore(best);
}
