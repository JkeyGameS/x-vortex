import config from '../config/config.js';
import logger from '../utils/logger.js';
import { updateUser, getUserByJidSync } from './userService.js';
import { getSettings as getChatSettingsLive } from './chatSettingsService.js';
import { detectTone } from '../utils/toneDetector.js';
import { getTimeOfDay } from '../utils/timeOfDay.js';

const VALID_TIMES = ['morning', 'afternoon', 'evening', 'night', 'any'];
const VALID_EMOTIONS = ['positive', 'negative', 'neutral', 'any'];

function defaultWeight() {
  const w = Number(config.chatReplyDefaultWeight);
  return Number.isFinite(w) && w > 0 ? w : 1.0;
}

function antiRepWindow() {
  const n = Math.floor(Number(config.chatReplyAntiRepetitionWindow) || 0);
  return n > 0 ? n : 3;
}

function historyMaxRules() {
  const n = Math.floor(Number(config.chatReplyHistoryMaxRules) || 0);
  return n > 0 ? n : 50;
}

function liveSettings() {
  try {
    return getChatSettingsLive();
  } catch {
    return null;
  }
}

function antiRepEnabled(settings) {
  if (settings && typeof settings.antiRepetition === 'boolean') return settings.antiRepetition;
  const live = liveSettings();
  if (live && typeof live.antiRepetition === 'boolean') return live.antiRepetition;
  return config.chatReplyAntiRepetitionEnabled !== false;
}

function weightedEnabled(settings) {
  if (settings && typeof settings.weightedRandom === 'boolean') return settings.weightedRandom;
  const live = liveSettings();
  if (live && typeof live.weightedRandom === 'boolean') return live.weightedRandom;
  return config.chatReplyWeightedRandomEnabled !== false;
}

function cleanTime(value) {
  const v = String(value ?? 'any').toLowerCase();
  return VALID_TIMES.includes(v) ? v : 'any';
}

function cleanEmotion(value) {
  const v = String(value ?? 'any').toLowerCase();
  return VALID_EMOTIONS.includes(v) ? v : 'any';
}

const VALID_STYLES = ['friendly', 'formal', 'casual', 'minimal', 'detailed'];

function cleanStyle(value) {
  const v = String(value ?? 'friendly').toLowerCase();
  return VALID_STYLES.includes(v) ? v : 'friendly';
}

function cleanFollowUps(value) {
  if (!Array.isArray(value)) return [];
  const cap = Math.max(1, Math.floor(Number(config.chatFollowUpMaxLength) || 120));
  return value.map((s) => String(s ?? '').trim()).filter(Boolean).map((s) => s.slice(0, cap)).slice(0, 10);
}

function cleanFollowUpChance(value) {
  if (value === null || value === undefined || value === '') return null;
  const c = Number(value);
  return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : null;
}

/** Normalize one stored reply (string legacy or { text, weight, time, emotion, style, followUps }) to an object. */
export function normalizeReply(entry) {
  if (typeof entry === 'string') return { text: entry, weight: defaultWeight(), time: 'any', emotion: 'any', style: 'friendly', followUps: [], followUpChance: null };
  if (entry && typeof entry === 'object') {
    const w = Number(entry.weight);
    return {
      text: String(entry.text ?? ''),
      weight: Number.isFinite(w) && w > 0 ? w : defaultWeight(),
      time: cleanTime(entry.time),
      emotion: cleanEmotion(entry.emotion),
      style: cleanStyle(entry.style),
      followUps: cleanFollowUps(entry.followUps),
      followUpChance: cleanFollowUpChance(entry.followUpChance),
      ...(entry.context !== undefined ? { context: entry.context } : {})
    };
  }
  return { text: '', weight: defaultWeight(), time: 'any', emotion: 'any', style: 'friendly', followUps: [], followUpChance: null };
}

/** Normalize a replies array (strings and/or objects). Drops empties. */
export function normalizeReplies(replies) {
  if (!Array.isArray(replies)) return [];
  return replies.map(normalizeReply).filter((r) => r.text);
}

/** Extract display text from a stored reply of either format. */
export function replyText(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return String(entry.text ?? '');
  return '';
}

/** Get replies[language] with en fallback, as raw stored entries. */
export function candidatesFor(rule, language) {
  const all = rule?.replies;
  if (Array.isArray(all)) return all;
  if (all && typeof all === 'object') {
    if (Array.isArray(all[language]) && all[language].length) return all[language];
    if (Array.isArray(all.en) && all.en.length) return all.en;
    const langObj = [all[language], all.en].find((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (langObj) {
      // Style-keyed format: { friendly: [...], formal: [...] } → flat, tagged.
      const flat = [];
      for (const [style, arr] of Object.entries(langObj)) {
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
          if (typeof entry === 'string') flat.push({ text: entry, style });
          else if (entry && typeof entry === 'object') flat.push({ ...entry, style: entry.style || style });
        }
      }
      if (flat.length) return flat;
    }
    const first = Object.values(all).find((v) => Array.isArray(v) && v.length);
    return first || [];
  }
  return [];
}

function abTestingEnabled(settings, options = {}) {
  if (options.abTesting !== undefined) return !!options.abTesting;
  if (settings && typeof settings.abTesting === 'boolean') return settings.abTesting;
  const live = liveSettings();
  if (live && typeof live.abTesting === 'boolean') return live.abTesting;
  return config.chatAbTestingEnabled !== false;
}

function styleEnabled(rule, settings, options = {}) {
  if (options.stylePersonalization !== undefined) return !!options.stylePersonalization;
  if (rule && rule.styleSensitive === false) return false;
  if (settings && typeof settings.replyStylePersonalization === 'boolean') return settings.replyStylePersonalization;
  const live = liveSettings();
  if (live && typeof live.replyStylePersonalization === 'boolean') return live.replyStylePersonalization;
  return config.chatReplyStylePersonalizationEnabled !== false;
}

function requestedStyle(user, options = {}) {
  if (typeof options.style === 'string' && VALID_STYLES.includes(options.style.toLowerCase())) {
    return options.style.toLowerCase();
  }
  const pref = user?.preferences?.replyStyle;
  if (typeof pref === 'string' && VALID_STYLES.includes(pref.toLowerCase())) return pref.toLowerCase();
  return 'friendly';
}

/**
 * Resolve the style pool from normalized candidates.
 * Chain: requested style → friendly → first available style present.
 */
export function resolveStylePool(candidates, style) {
  const wanted = VALID_STYLES.includes(style) ? style : 'friendly';
  const byStyle = {};
  for (const c of candidates) {
    const key = VALID_STYLES.includes(c.style) ? c.style : 'friendly';
    (byStyle[key] = byStyle[key] || []).push(c);
  }
  if (byStyle[wanted] && byStyle[wanted].length) return { pool: byStyle[wanted], styleUsed: wanted };
  if (byStyle.friendly && byStyle.friendly.length) return { pool: byStyle.friendly, styleUsed: 'friendly' };
  const first = VALID_STYLES.find((s) => byStyle[s] && byStyle[s].length);
  if (first) return { pool: byStyle[first], styleUsed: first };
  return { pool: candidates, styleUsed: wanted };
}

function followUpsEnabled(settings, options = {}) {
  if (options.followUps !== undefined) return !!options.followUps;
  if (settings && typeof settings.followUps === 'boolean') return settings.followUps;
  const live = liveSettings();
  if (live && typeof live.followUps === 'boolean') return live.followUps;
  return config.chatFollowUpEnabled !== false;
}

function followUpDefaultChance(settings) {
  if (settings && Number.isFinite(Number(settings.followUpChance))) {
    return Math.min(1, Math.max(0, Number(settings.followUpChance)));
  }
  const live = liveSettings();
  if (live && Number.isFinite(Number(live.followUpChance))) {
    return Math.min(1, Math.max(0, Number(live.followUpChance)));
  }
  const c = Number(config.chatFollowUpDefaultChance);
  return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.3;
}

function pickRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getHistory(user, ruleId) {
  const h = user?.chatReplyHistory;
  if (!h || typeof h !== 'object') return [];
  return Array.isArray(h[ruleId]) ? h[ruleId] : [];
}

async function persistHistory(jid, ruleId, history) {
  try {
    const user = getUserByJidSync(jid);
    if (!user) return;
    const map = { ...((user.chatReplyHistory && typeof user.chatReplyHistory === 'object') ? user.chatReplyHistory : {}) };
    map[ruleId] = history;
    const keys = Object.keys(map);
    const over = keys.length - historyMaxRules();
    if (over > 0) {
      for (const k of keys.slice(0, over)) delete map[k];
    }
    await updateUser(jid, { chatReplyHistory: map });
  } catch (err) {
    logger.warn({ err }, 'Failed to persist reply history');
  }
}

function weightedPick(candidates) {
  const total = candidates.reduce((a, c) => a + c.weight, 0);
  if (!(total > 0)) return { reply: candidates[0], reset: false };
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return { reply: c, reset: false };
  }
  return { reply: candidates[candidates.length - 1], reset: false };
}

function toneEnabled(rule, settings, options = {}) {
  if (options.toneDetection !== undefined) return !!options.toneDetection;
  if (rule && rule.toneSensitive === true) return true;
  if (rule && rule.toneSensitive === false) return false;
  if (settings && typeof settings.toneDetection === 'boolean') return settings.toneDetection;
  const live = liveSettings();
  if (live && typeof live.toneDetection === 'boolean') return live.toneDetection;
  return config.chatToneDetectionEnabled !== false;
}

function timeEnabled(rule, settings, options = {}) {
  if (options.timeAwareness !== undefined) return !!options.timeAwareness;
  if (rule && rule.timeSensitive === true) return true;
  if (rule && rule.timeSensitive === false) return false;
  if (settings && typeof settings.timeAwareness === 'boolean') return settings.timeAwareness;
  const live = liveSettings();
  if (live && typeof live.timeAwareness === 'boolean') return live.timeAwareness;
  return config.chatTimeAwarenessEnabled !== false;
}

/**
 * Pick a reply for a matched rule.
 * Order: candidates → anti-repetition → tone → time → weighted pick → record.
 * Each filter falls back to the previous pool when it would empty it.
 * @returns {Promise<{ reply, ruleId, reason, candidatesCount, excludedByAntiRepeat, filters, detectedTone, timeOfDay, fallbacksUsed }|null>}
 */
export async function pickReply(rule, user, language, options = {}) {
  const settings = options.settings || null;
  const isDryRunPreview = options.dryRun === true;
  const jid = user?.jid || options.jid || null;
  const raw = candidatesFor(rule, language);
  const candidates = normalizeReplies(raw);
  if (!candidates.length) return null;

  const useAntiRep = options.antiRepetition !== undefined ? !!options.antiRepetition : antiRepEnabled(settings);
  const useWeighted = options.weighted !== undefined ? !!options.weighted : weightedEnabled(settings);
  const window = Math.max(0, Math.floor(Number(options.window ?? antiRepWindow())));
  const useTone = toneEnabled(rule, settings, options);
  const useTime = timeEnabled(rule, settings, options);
  const message = typeof options.message === 'string' ? options.message : '';
  const detectedTone = useTone ? detectTone(message) : 'neutral';
  let timeOfDay = null;
  if (useTime) {
    try {
      timeOfDay = getTimeOfDay(options.now || new Date(), options.timezone || user?.timezone || 'UTC');
    } catch {
      timeOfDay = getTimeOfDay(new Date(), 'UTC');
    }
  }
  const useStyle = styleEnabled(rule, settings, options);
  const wantedStyle = useStyle ? requestedStyle(user, options) : 'friendly';
  const userStyle = requestedStyle(user, options);

  const fallbacksUsed = [];
  let pool = candidates;
  let styleUsed = 'friendly';
  if (useStyle) {
    const resolved = resolveStylePool(candidates, wantedStyle);
    pool = resolved.pool;
    styleUsed = resolved.styleUsed;
  } else {
    styleUsed = 'friendly';
  }
  let excludedByAntiRepeat = 0;
  let historyReset = false;

  if (useAntiRep && jid && window > 0 && pool.length > 1) {
    const history = getHistory(user, rule.id).slice(-window);
    const seen = new Set(history);
    const fresh = pool.filter((c) => !seen.has(c.text));
    if (fresh.length) {
      excludedByAntiRepeat = pool.length - fresh.length;
      pool = fresh;
    } else {
      // All excluded: clear history for this rule and retry with full pool.
      historyReset = true;
      excludedByAntiRepeat = 0;
      if (!isDryRunPreview) await persistHistory(jid, rule.id, []);
    }
  }

  let toneFilterApplied = false;
  if (useTone && pool.length) {
    const before = pool;
    const matching = pool.filter((c) => (c.emotion || 'any') === 'any' || c.emotion === detectedTone);
    if (matching.length) {
      if (matching.length < before.length) toneFilterApplied = true;
      pool = matching;
    } else {
      const anyOnly = before.filter((c) => (c.emotion || 'any') === 'any');
      if (anyOnly.length) {
        toneFilterApplied = true;
        fallbacksUsed.push('tone_any_only');
        pool = anyOnly;
      } else {
        fallbacksUsed.push('tone_all_filtered');
      }
    }
  }

  let timeFilterApplied = false;
  if (useTime && timeOfDay && pool.length) {
    const before = pool;
    const matching = pool.filter((c) => (c.time || 'any') === 'any' || c.time === timeOfDay);
    if (matching.length) {
      if (matching.length < before.length) timeFilterApplied = true;
      pool = matching;
    } else {
      const anyOnly = before.filter((c) => (c.time || 'any') === 'any');
      if (anyOnly.length) {
        timeFilterApplied = true;
        fallbacksUsed.push('time_any_only');
        pool = anyOnly;
      } else {
        fallbacksUsed.push('time_all_filtered');
      }
    }
  }

  const useAb = abTestingEnabled(settings, options);
  let reply;
  let engagementBonus = 0;
  if (!useWeighted || pool.length === 1) {
    reply = pool[0];
  } else if (useAb) {
    const { getBonusFor } = await import('./replyAnalyticsService.js');
    const boosted = pool.map((c) => {
      const info = getBonusFor(rule.id, c.text);
      const weight = Math.max(0.01, c.weight * (1 + info.bonus));
      return { candidate: c, weight, bonus: info.bonus };
    });
    const total = boosted.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * total;
    let picked = boosted[boosted.length - 1];
    for (const b of boosted) {
      r -= b.weight;
      if (r <= 0) { picked = b; break; }
    }
    reply = picked.candidate;
    engagementBonus = picked.bonus;
  } else {
    ({ reply } = weightedPick(pool));
  }

  // Follow-up decision AFTER selection.
  let followUpUsed = false;
  let followUpText = '';
  let finalText = reply.text;
  const canFollow = followUpsEnabled(settings, options)
    && Array.isArray(reply.followUps) && reply.followUps.length > 0
    && !(config.chatFollowUpRespectMinimalStyle !== false && (styleUsed === 'minimal' || (useStyle && userStyle === 'minimal')))
    && !(user && user.preferences && user.preferences.followUps === false);
  if (canFollow) {
    const chance = reply.followUpChance != null
      ? reply.followUpChance
      : (rule.followUpChance != null ? cleanFollowUpChance(rule.followUpChance) : null)
        ?? followUpDefaultChance(settings);
    if (chance > 0 && Math.random() < chance) {
      followUpText = String(pickRandomItem(reply.followUps) || '').trim();
      if (followUpText) {
        followUpUsed = true;
        finalText = `${reply.text} ${followUpText}`.trim();
      }
    }
  }

  if (useAntiRep && jid && window > 0) {
    const prev = historyReset ? [] : getHistory(user, rule.id);
    const next = [...prev, reply.text].slice(-window);
    // Fire-and-forget persist is intentionally awaited to keep tests deterministic.
    if (!isDryRunPreview) await persistHistory(jid, rule.id, next);
  }

  return {
    reply: { text: finalText, weight: reply.weight, time: reply.time || 'any', emotion: reply.emotion || 'any', style: reply.style || styleUsed },
    baseReply: { text: reply.text, weight: reply.weight },
    ruleId: rule.id,
    reason: !useWeighted ? 'unweighted' : (historyReset ? 'history-reset' : (excludedByAntiRepeat ? 'anti-repeat' : 'weighted')),
    candidatesCount: candidates.length,
    excludedByAntiRepeat,
    styleUsed,
    styleApplied: useStyle,
    followUpUsed,
    followUpText,
    engagementBonus,
    filters: { tone: toneFilterApplied, time: timeFilterApplied, antiRep: excludedByAntiRepeat > 0 || historyReset },
    detectedTone,
    timeOfDay,
    fallbacksUsed
  };
}
