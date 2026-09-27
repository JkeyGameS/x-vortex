import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const KEYWORD_STATS_FILE = path.join(DATA_DIR, 'faqKeywordStats.json');

let keywordStats = null;

function load() {
  keywordStats = {};
  try {
    if (fs.existsSync(KEYWORD_STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(KEYWORD_STATS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) keywordStats = parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load FAQ keyword stats');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEYWORD_STATS_FILE, JSON.stringify(keywordStats, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save FAQ keyword stats');
  }
}

load();

function cell(entryId, keyword) {
  if (!keywordStats[entryId] || typeof keywordStats[entryId] !== 'object') keywordStats[entryId] = {};
  if (!keywordStats[entryId][keyword]) keywordStats[entryId][keyword] = { hits: 0, misses: 0 };
  return keywordStats[entryId][keyword];
}

export function recordKeywordHit(entryId, keyword) {
  if (!entryId || !keyword) return;
  cell(entryId, String(keyword)).hits += 1;
  save();
}

export function recordKeywordMiss(entryId, keyword) {
  if (!entryId || !keyword) return;
  cell(entryId, String(keyword)).misses += 1;
  save();
}

/** { keyword: { hits, misses, confidence, attempts } } for one entry. */
export function getEntryKeywordStats(entryId) {
  const out = {};
  const cells = keywordStats[entryId] || {};
  for (const [kw, v] of Object.entries(cells)) {
    const hits = Number(v?.hits) || 0;
    const misses = Number(v?.misses) || 0;
    const total = hits + misses;
    out[kw] = { hits, misses, attempts: total, confidence: total ? Math.round((hits / total) * 100) : null };
  }
  return out;
}
