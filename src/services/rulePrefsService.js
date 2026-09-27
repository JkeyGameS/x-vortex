import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const PREFS_FILE = path.join(DATA_DIR, 'adminRulePrefs.json');

const MAX_RECENT = 5;
const MAX_FAVORITES = 10;

let prefs = {};

function load() {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        prefs = parsed;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load admin rule prefs from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save admin rule prefs to disk');
  }
}

function entry(jid) {
  if (!prefs[jid] || typeof prefs[jid] !== 'object') {
    prefs[jid] = { recent: [], favorites: [] };
  }
  if (!Array.isArray(prefs[jid].recent)) prefs[jid].recent = [];
  if (!Array.isArray(prefs[jid].favorites)) prefs[jid].favorites = [];
  return prefs[jid];
}

load();

export function touchRecent(jid, ruleId) {
  if (!jid || !ruleId) return;
  const e = entry(jid);
  e.recent = [ruleId, ...e.recent.filter((id) => id !== ruleId)].slice(0, MAX_RECENT);
  save();
}

export function getRecent(jid) {
  if (!jid) return [];
  return [...(entry(jid).recent || [])];
}

export function getFavorites(jid) {
  if (!jid) return [];
  return [...(entry(jid).favorites || [])];
}

export function addFavorite(jid, ruleId) {
  if (!jid || !ruleId) return false;
  const e = entry(jid);
  if (!e.favorites.includes(ruleId)) {
    e.favorites.push(ruleId);
    if (e.favorites.length > MAX_FAVORITES) {
      e.favorites = e.favorites.slice(-MAX_FAVORITES);
    }
    save();
  }
  return true;
}

export function removeFavorite(jid, ruleId) {
  if (!jid || !ruleId) return false;
  const e = entry(jid);
  const idx = e.favorites.indexOf(ruleId);
  if (idx < 0) return false;
  e.favorites.splice(idx, 1);
  save();
  return true;
}

export function isFavorite(jid, ruleId) {
  if (!jid || !ruleId) return false;
  return entry(jid).favorites.includes(ruleId);
}

export function clearPrefs() {
  prefs = {};
  save();
}
