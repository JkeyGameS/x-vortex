import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const RULES_FILE = path.join(DATA_DIR, 'chatRules.json');
const FAQ_FILE = path.join(DATA_DIR, 'faq.json');

const KEEP = 10;

function stampName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `chatRules-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}.json`;
}

/** Save a snapshot of the current chat rules. @returns {string|null} file name */
export function saveSnapshot(reason = 'manual') {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    let rules = [];
    try {
      if (fs.existsSync(RULES_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
        if (Array.isArray(parsed)) rules = parsed;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read chat rules for snapshot');
      return null;
    }
    const name = stampName();
    fs.writeFileSync(
      path.join(SNAPSHOT_DIR, name),
      JSON.stringify({ createdAt: new Date().toISOString(), reason, count: rules.length, rules }, null, 2)
    );
    pruneSnapshots();
    return name;
  } catch (err) {
    logger.warn({ err }, 'Failed to save rules snapshot');
    return null;
  }
}

export function listSnapshots() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return [];
    return fs.readdirSync(SNAPSHOT_DIR)
      .filter((f) => /^chatRules-.*\.json$/.test(f))
      .sort()
      .reverse()
      .map((f) => {
        let meta = { count: null, createdAt: null, reason: null };
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
          meta = { count: Array.isArray(parsed.rules) ? parsed.rules.length : null, createdAt: parsed.createdAt || null, reason: parsed.reason || null };
        } catch { /* unreadable snapshot, still listable */ }
        return { file: f, ...meta };
      });
  } catch (err) {
    logger.warn({ err }, 'Failed to list snapshots');
    return [];
  }
}

function pruneSnapshots() {
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter((f) => /^chatRules-.*\.json$/.test(f))
      .sort();
    while (files.length > KEEP) {
      const oldest = files.shift();
      fs.rmSync(path.join(SNAPSHOT_DIR, oldest), { force: true });
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to prune snapshots');
  }
}

/** Overwrite current chat rules with a snapshot. @returns {Promise<{ok, count}>} */
export async function restoreSnapshot(file) {
  try {
    const target = path.join(SNAPSHOT_DIR, path.basename(String(file || '')));
    if (!fs.existsSync(target)) return { ok: false, count: 0 };
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!parsed || !Array.isArray(parsed.rules)) return { ok: false, count: 0 };
    saveSnapshot('pre-restore');
    fs.writeFileSync(RULES_FILE, JSON.stringify(parsed.rules, null, 2));
    const { reloadRules } = await import('./chatRuleService.js');
    reloadRules();
    return { ok: true, count: parsed.rules.length };
  } catch (err) {
    logger.warn({ err }, 'Failed to restore snapshot');
    return { ok: false, count: 0 };
  }
}

function stampFaqName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `faq-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}.json`;
}

/** Save a snapshot of the current FAQ entries. @returns {string|null} file name */
export function saveFaqSnapshot(reason = 'manual') {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    let entries = [];
    try {
      if (fs.existsSync(FAQ_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(FAQ_FILE, 'utf8'));
        if (Array.isArray(parsed)) entries = parsed;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read FAQ entries for snapshot');
      return null;
    }
    const name = stampFaqName();
    fs.writeFileSync(
      path.join(SNAPSHOT_DIR, name),
      JSON.stringify({ createdAt: new Date().toISOString(), reason, kind: 'faq', count: entries.length, entries }, null, 2)
    );
    pruneFaqSnapshots();
    return name;
  } catch (err) {
    logger.warn({ err }, 'Failed to save FAQ snapshot');
    return null;
  }
}

export function listFaqSnapshots() {
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) return [];
    return fs.readdirSync(SNAPSHOT_DIR)
      .filter((f) => /^faq-.*\.json$/.test(f))
      .sort()
      .reverse()
      .map((f) => {
        let meta = { count: null, createdAt: null, reason: null };
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
          meta = { count: Array.isArray(parsed.entries) ? parsed.entries.length : null, createdAt: parsed.createdAt || null, reason: parsed.reason || null };
        } catch { /* unreadable snapshot, still listable */ }
        return { file: f, ...meta };
      });
  } catch (err) {
    logger.warn({ err }, 'Failed to list FAQ snapshots');
    return [];
  }
}

function pruneFaqSnapshots() {
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter((f) => /^faq-.*\.json$/.test(f))
      .sort();
    while (files.length > KEEP) {
      const oldest = files.shift();
      fs.rmSync(path.join(SNAPSHOT_DIR, oldest), { force: true });
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to prune FAQ snapshots');
  }
}

/** Overwrite current FAQ entries with a snapshot. @returns {Promise<{ok, count}>} */
export async function restoreFaqSnapshot(file) {
  try {
    const target = path.join(SNAPSHOT_DIR, path.basename(String(file || '')));
    if (!fs.existsSync(target)) return { ok: false, count: 0 };
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!parsed || !Array.isArray(parsed.entries)) return { ok: false, count: 0 };
    saveFaqSnapshot('pre-restore');
    fs.writeFileSync(FAQ_FILE, JSON.stringify(parsed.entries, null, 2));
    const { reloadEntries } = await import('./faqService.js');
    reloadEntries();
    return { ok: true, count: parsed.entries.length };
  } catch (err) {
    logger.warn({ err }, 'Failed to restore FAQ snapshot');
    return { ok: false, count: 0 };
  }
}
