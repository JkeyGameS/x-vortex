import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const TRIGGER_STATS_FILE = path.join(DATA_DIR, 'triggerStats.json');
const COOLDOWN_LOG_FILE = path.join(DATA_DIR, 'cooldownLog.json');

const MAX_COOLDOWN_ENTRIES = 500;

let triggerStats = null;
let cooldownLog = null;

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (err) {
    logger.warn({ err, file }, 'Failed to load stats file');
  }
  return fallback;
}

function saveJson(file, obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (err) {
    logger.warn({ err, file }, 'Failed to save stats file');
  }
}

function ensure() {
  if (!triggerStats) {
    triggerStats = loadJson(TRIGGER_STATS_FILE, {});
    if (Array.isArray(triggerStats)) triggerStats = {};
  }
  if (!cooldownLog) {
    const raw = loadJson(COOLDOWN_LOG_FILE, []);
    cooldownLog = Array.isArray(raw) ? raw : [];
  }
}

function cell() {
  return { hits: 0, misses: 0 };
}

function ruleCell(ruleId) {
  ensure();
  if (!triggerStats[ruleId] || typeof triggerStats[ruleId] !== 'object') triggerStats[ruleId] = {};
  return triggerStats[ruleId];
}

export function recordTriggerHit(ruleId, trigger) {
  if (!ruleId || !trigger) return;
  const cell_ = ruleCell(ruleId);
  const key = String(trigger);
  cell_[key] = cell_[key] || cell();
  cell_[key].hits += 1;
  saveJson(TRIGGER_STATS_FILE, triggerStats);
}

export function recordTriggerMiss(ruleId, trigger) {
  if (!ruleId || !trigger) return;
  const cell_ = ruleCell(ruleId);
  const key = String(trigger);
  cell_[key] = cell_[key] || cell();
  cell_[key].misses += 1;
  saveJson(TRIGGER_STATS_FILE, triggerStats);
}

/** { trigger: { hits, misses, confidence } } for one rule. */
export function getRuleTriggerStats(ruleId) {
  ensure();
  const out = {};
  const cells = triggerStats[ruleId] || {};
  for (const [trigger, v] of Object.entries(cells)) {
    const hits = Number(v?.hits) || 0;
    const misses = Number(v?.misses) || 0;
    const total = hits + misses;
    out[trigger] = { hits, misses, confidence: total ? Math.round((hits / total) * 100) : null, attempts: total };
  }
  return out;
}

export function logCooldownHit(ruleId, userId) {
  if (!ruleId) return;
  ensure();
  cooldownLog.push({ ruleId, userId: userId || '-', timestamp: new Date().toISOString() });
  if (cooldownLog.length > MAX_COOLDOWN_ENTRIES) cooldownLog = cooldownLog.slice(-MAX_COOLDOWN_ENTRIES);
  saveJson(COOLDOWN_LOG_FILE, cooldownLog);
}

/** Cooldown hits in the last 24h (0 = all time when sinceMs omitted). */
export function countCooldownHits(sinceMs = 24 * 3600 * 1000) {
  ensure();
  const cutoff = Date.now() - sinceMs;
  return cooldownLog.filter((e) => new Date(e.timestamp || 0).getTime() >= cutoff).length;
}

/** Top rules by cooldown hits in the window. */
export function topCooldownRules(limit = 5, sinceMs = 24 * 3600 * 1000) {
  ensure();
  const cutoff = Date.now() - sinceMs;
  const counts = {};
  for (const e of cooldownLog) {
    if (new Date(e.timestamp || 0).getTime() < cutoff) continue;
    counts[e.ruleId] = (counts[e.ruleId] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([ruleId, hits]) => ({ ruleId, hits }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}
