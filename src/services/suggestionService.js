import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'unmatchedSuggestions.json');

const MAX_MESSAGES = 200;

let store = null;

function load() {
  store = { messages: {}, ignored: [] };
  try {
    if (fs.existsSync(SUGGESTIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        if (parsed.messages && typeof parsed.messages === 'object') store.messages = parsed.messages;
        if (Array.isArray(parsed.ignored)) store.ignored = parsed.ignored.filter((x) => typeof x === 'string');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load unmatched suggestions');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save unmatched suggestions');
  }
}

load();

function norm(text) {
  return String(text || '').trim().toLowerCase().slice(0, 200);
}

export function recordSuggestion(text) {
  if (!store) load();
  const key = norm(text);
  if (!key || store.ignored.includes(key)) return null;
  const cur = store.messages[key] || { message: String(text).trim().slice(0, 200), count: 0, lastSeen: null };
  cur.count += 1;
  cur.lastSeen = new Date().toISOString();
  store.messages[key] = cur;
  const keys = Object.keys(store.messages);
  if (keys.length > MAX_MESSAGES) {
    const drop = keys.length - MAX_MESSAGES;
    const oldest = keys
      .map((k) => [k, store.messages[k].lastSeen || ''])
      .sort((a, b) => (a[1] < b[1] ? -1 : 1))
      .slice(0, drop);
    for (const [k] of oldest) delete store.messages[k];
  }
  save();
  return { ...cur };
}

export function topSuggestions(limit = 5) {
  if (!store) load();
  return Object.entries(store.messages)
    .filter(([k]) => !store.ignored.includes(k))
    .map(([key, v]) => ({ key, message: v.message, count: v.count || 0, lastSeen: v.lastSeen }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function ignoreSuggestion(key) {
  if (!store) load();
  const k = norm(key);
  if (!k) return false;
  if (!store.ignored.includes(k)) store.ignored.push(k);
  delete store.messages[k];
  save();
  return true;
}

export function removeSuggestion(key) {
  if (!store) load();
  const k = norm(key);
  if (!k || !store.messages[k]) return false;
  delete store.messages[k];
  save();
  return true;
}
