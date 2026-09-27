import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import config from '../config/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'replyAnalytics.json');
const SUMMARY_FILE = path.join(DATA_DIR, 'chatAnalyticsLog.json');

const SUMMARY_EVERY_N = 100;

let store = null;
let sendsSinceSummary = 0;

function load() {
  store = {};
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) store = parsed;
    } else {
      save();
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load reply analytics');
  }
  return store;
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save reply analytics');
  }
}

load();

/** Stable short hash for a reply text. */
export function replyHash(text) {
  return crypto.createHash('sha1').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 12);
}

function ruleEntry(ruleId) {
  if (!store[ruleId] || typeof store[ruleId] !== 'object') {
    store[ruleId] = {};
  }
  if (!store[ruleId].byStyle || typeof store[ruleId].byStyle !== 'object') {
    store[ruleId].byStyle = {};
  }
  return store[ruleId];
}

function cfgNum(key, fallback) {
  const v = Number(config[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function engagementRate(sent, engagements) {
  if (!(sent > 0)) return 0;
  return engagements / sent;
}

/** Bonus in [-0.5, +1.0]; 0 when below the minimum sample threshold. */
export function engagementBonus(sent, engagements) {
  const minSamples = Math.max(1, Math.floor(cfgNum('chatEngagementMinSamples', 5)));
  if (!(sent >= minSamples)) return 0;
  const baseline = cfgNum('chatEngagementBaseline', 0.5);
  const factor = cfgNum('chatEngagementBoostFactor', 1.0);
  const bonus = (engagementRate(sent, engagements) - baseline) * factor;
  return Math.min(cfgNum('chatEngagementBonusMax', 1.0), Math.max(cfgNum('chatEngagementBonusMin', -0.5), bonus));
}

export function getBonusFor(ruleId, text) {
  if (!store) load();
  const entry = store[ruleId];
  if (!entry) return { bonus: 0, rate: 0, sent: 0, engagements: 0 };
  const key = replyHash(text);
  const cell = entry[key];
  if (!cell) return { bonus: 0, rate: 0, sent: 0, engagements: 0 };
  const sent = Number(cell.sent) || 0;
  const engagements = Number(cell.engagements) || 0;
  return { bonus: engagementBonus(sent, engagements), rate: engagementRate(sent, engagements), sent, engagements };
}

export function recordSend(ruleId, { text, language = 'all', style = 'friendly' } = {}) {
  if (!store) load();
  if (!ruleId || !text) return null;
  const entry = ruleEntry(ruleId);
  const key = replyHash(text);
  const cell = entry[key] || { text: String(text).slice(0, 300), language, style, sent: 0, engagements: 0, lastSentAt: null };
  cell.sent = (Number(cell.sent) || 0) + 1;
  cell.language = cell.language || language;
  cell.style = cell.style || style;
  cell.lastSentAt = new Date().toISOString();
  entry[key] = cell;
  sendsSinceSummary += 1;
  save();
  if (sendsSinceSummary >= SUMMARY_EVERY_N) {
    sendsSinceSummary = 0;
    writeSummary();
  }
  return { hash: key, sent: cell.sent };
}

export function recordEngagement(ruleId, replyHashOrText) {
  if (!store) load();
  if (!ruleId || !replyHashOrText) return false;
  const entry = store[ruleId];
  if (!entry) return false;
  const key = /^[0-9a-f]{12}$/.test(replyHashOrText) ? replyHashOrText : replyHash(replyHashOrText);
  const cell = entry[key];
  if (!cell) return false;
  cell.engagements = (Number(cell.engagements) || 0) + 1;
  const style = cell.style || 'friendly';
  const byStyle = entry.byStyle;
  if (!byStyle[style]) byStyle[style] = { sent: 0, engagements: 0 };
  byStyle[style].engagements = (Number(byStyle[style].engagements) || 0) + 1;
  save();
  return true;
}

export function recordStyleSend(ruleId, style) {
  if (!store) load();
  if (!ruleId || !style) return;
  const entry = ruleEntry(ruleId);
  if (!entry.byStyle[style]) entry.byStyle[style] = { sent: 0, engagements: 0 };
  entry.byStyle[style].sent = (Number(entry.byStyle[style].sent) || 0) + 1;
  save();
}

export function getRuleAnalytics(ruleId) {
  if (!store) load();
  const entry = store[ruleId];
  if (!entry) return { replies: [], byStyle: {} };
  const replies = Object.entries(entry)
    .filter(([k]) => k !== 'byStyle')
    .map(([hash, cell]) => ({
      hash,
      text: cell.text || '',
      language: cell.language || 'all',
      style: cell.style || 'friendly',
      sent: Number(cell.sent) || 0,
      engagements: Number(cell.engagements) || 0,
      rate: engagementRate(Number(cell.sent) || 0, Number(cell.engagements) || 0),
      lastSentAt: cell.lastSentAt || null
    }));
  const byStyle = {};
  for (const [style, cell] of Object.entries(entry.byStyle || {})) {
    const sent = Number(cell.sent) || 0;
    const engagements = Number(cell.engagements) || 0;
    byStyle[style] = { sent, engagements, rate: engagementRate(sent, engagements) };
  }
  return { replies, byStyle };
}

export function getAllAnalytics() {
  if (!store) load();
  const out = {};
  for (const ruleId of Object.keys(store)) {
    const { replies, byStyle } = getRuleAnalytics(ruleId);
    const sent = replies.reduce((a, r) => a + r.sent, 0);
    const engagements = replies.reduce((a, r) => a + r.engagements, 0);
    out[ruleId] = { replies, byStyle, sent, engagements, rate: engagementRate(sent, engagements) };
  }
  return out;
}

export function resetAnalytics() {
  store = {};
  save();
  return true;
}

/** Merge an exported analytics object. Returns number of rules merged. */
export function importAnalytics(obj) {
  if (!store) load();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
  let count = 0;
  for (const [ruleId, data] of Object.entries(obj)) {
    if (!data || typeof data !== 'object') continue;
    const entry = ruleEntry(ruleId);
    const replyList = Array.isArray(data.replies)
      ? data.replies
      : Object.entries(data.replies || {}).map(([hash, cell]) => ({ ...(cell || {}), hash }));
    for (const cell of replyList) {
      if (!cell || typeof cell !== 'object') continue;
      const hash = typeof cell.hash === 'string' && cell.hash ? cell.hash : replyHash(cell.text || '');
      if (!hash) continue;
      const cur = entry[hash] || { text: '', language: 'all', style: 'friendly', sent: 0, engagements: 0, lastSentAt: null };
      cur.text = typeof cell.text === 'string' && cell.text ? cell.text.slice(0, 300) : cur.text;
      cur.language = typeof cell.language === 'string' ? cell.language : (cur.language || 'all');
      cur.style = typeof cell.style === 'string' ? cell.style : (cur.style || 'friendly');
      cur.sent = (Number(cur.sent) || 0) + (Number(cell.sent) || 0);
      cur.engagements = (Number(cur.engagements) || 0) + (Number(cell.engagements) || 0);
      if (cell.lastSentAt && (!cur.lastSentAt || cell.lastSentAt > cur.lastSentAt)) cur.lastSentAt = cell.lastSentAt;
      entry[hash] = cur;
    }
    if (data.byStyle && typeof data.byStyle === 'object') {
      for (const [style, cell] of Object.entries(data.byStyle)) {
        if (!cell || typeof cell !== 'object') continue;
        const cur = entry.byStyle[style] || { sent: 0, engagements: 0 };
        cur.sent = (Number(cur.sent) || 0) + (Number(cell.sent) || 0);
        cur.engagements = (Number(cur.engagements) || 0) + (Number(cell.engagements) || 0);
        entry.byStyle[style] = cur;
      }
    }
    count += 1;
  }
  save();
  return count;
}

export function pruneAnalytics(maxAgeDays = null) {
  if (!store) load();
  const days = maxAgeDays != null ? Number(maxAgeDays) : cfgNum('chatAnalyticsRetentionDays', 90);
  if (!(days > 0)) return 0;
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  for (const ruleId of Object.keys(store)) {
    const entry = store[ruleId];
    for (const key of Object.keys(entry)) {
      if (key === 'byStyle') continue;
      const last = entry[key]?.lastSentAt ? new Date(entry[key].lastSentAt).getTime() : 0;
      if (!last || last < cutoff) {
        delete entry[key];
        removed += 1;
      }
    }
    if (Object.keys(entry).filter((k) => k !== 'byStyle').length === 0) delete store[ruleId];
  }
  if (removed) save();
  return removed;
}

function writeSummary() {
  try {
    const all = getAllAnalytics();
    const rules = Object.keys(all).length;
    const sent = Object.values(all).reduce((a, r) => a + r.sent, 0);
    const engagements = Object.values(all).reduce((a, r) => a + r.engagements, 0);
    let lines = [];
    try {
      if (fs.existsSync(SUMMARY_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
        if (Array.isArray(parsed)) lines = parsed;
      }
    } catch { /* start fresh */ }
    lines.push({ at: new Date().toISOString(), rules, sent, engagements, rate: engagementRate(sent, engagements) });
    if (lines.length > 500) lines = lines.slice(-500);
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(lines, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to write analytics summary');
  }
}

export function reloadAnalytics() {
  return load();
}
