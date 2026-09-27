import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const STATS_FILE = path.join(DATA_DIR, 'faqPackStats.json');

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
    logger.warn({ err }, 'Failed to load FAQ pack stats');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save FAQ pack stats');
  }
}

load();

export function recordFaqPackInstall(packId, entriesAdded) {
  if (!stats) load();
  const cur = stats[packId] || { installs: 0, lastInstalled: null, totalRulesAdded: 0 };
  cur.installs += 1;
  cur.lastInstalled = new Date().toISOString();
  cur.totalRulesAdded += Number(entriesAdded) || 0;
  stats[packId] = cur;
  save();
  return { ...cur };
}

export function getFaqPackStats(packId) {
  if (!stats) load();
  return stats[packId] ? { ...stats[packId] } : null;
}

export function resetFaqPackStats() {
  stats = {};
  save();
}
