import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const STATS_FILE = path.join(DATA_DIR, 'packInstallStats.json');

let stats = null;

function load() {
  stats = {};
  try {
    if (fs.existsSync(STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v === 'object') {
            stats[k] = {
              installs: Number(v.installs) || 0,
              lastInstalled: v.lastInstalled || null,
              totalRulesAdded: Number(v.totalRulesAdded) || 0
            };
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load pack install stats');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save pack install stats');
  }
}

load();

export function recordPackInstall(packId, rulesAdded) {
  if (!stats) load();
  const cur = stats[packId] || { installs: 0, lastInstalled: null, totalRulesAdded: 0 };
  cur.installs += 1;
  cur.lastInstalled = new Date().toISOString();
  cur.totalRulesAdded += Number(rulesAdded) || 0;
  stats[packId] = cur;
  save();
  return { ...cur };
}

export function getPackStats(packId) {
  if (!stats) load();
  return stats[packId] ? { ...stats[packId] } : null;
}

export function resetPackStats() {
  stats = {};
  save();
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return { value: 0, unit: 'minutes' };
  if (mins < 60) return { value: mins, unit: 'minutes' };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { value: hours, unit: 'hours' };
  const days = Math.floor(hours / 24);
  return { value: days, unit: 'days' };
}
