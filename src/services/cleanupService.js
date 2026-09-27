import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { getAllRules } from './chatRuleService.js';
import { getChatRuleHits } from './chatStatsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const CLEANUP_FILE = path.join(DATA_DIR, 'cleanupSuggestions.json');

const ALLOWED_PLACEHOLDERS = new Set(['username', 'firstname', 'time', 'date', 'botname', 'user_id', 'level']);
const NO_HIT_DAYS = 30;

function findPlaceholders(text) {
  const out = new Set();
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.add(m[1]);
  return [...out];
}

/** Regenerate cleanup suggestions and persist them. */
export async function generateCleanupSuggestions() {
  const rules = getAllRules();
  const hits = getChatRuleHits();
  const cutoff = Date.now() - NO_HIT_DAYS * 24 * 3600 * 1000;

  const noHits = rules
    .filter((r) => !(hits[r.id] > 0))
    .filter((r) => {
      const created = new Date(r.createdAt || 0).getTime();
      return created && created < cutoff;
    })
    .map((r) => r.id);

  const seen = new Map();
  const duplicates = [];
  for (const r of rules) {
    const key = JSON.stringify([
      [...(r.triggers || [])].map((s) => String(s).toLowerCase()).sort(),
      [...(r.replies || [])].sort(),
      r.language || 'all'
    ]);
    if (seen.has(key)) {
      let group = duplicates.find((g) => g.includes(seen.get(key)));
      if (!group) {
        group = [seen.get(key)];
        duplicates.push(group);
      }
      group.push(r.id);
    } else {
      seen.set(key, r.id);
    }
  }

  const broken = [];
  for (const r of rules) {
    const bad = new Set();
    for (const reply of r.replies || []) {
      for (const ph of findPlaceholders(reply)) {
        if (!ALLOWED_PLACEHOLDERS.has(ph)) bad.add(ph);
      }
    }
    if (bad.size) broken.push({ id: r.id, placeholders: [...bad] });
  }

  let orphaned = [];
  try {
    const { getPack } = await import('./chatTemplateService.js');
    orphaned = rules.filter((r) => r.packId && !getPack(r.packId)).map((r) => r.id);
  } catch { /* pack lookup must never break cleanup */ }

  const result = {
    generatedAt: new Date().toISOString(),
    groups: { noHits, duplicates, broken, orphaned }
  };
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLEANUP_FILE, JSON.stringify(result, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save cleanup suggestions');
  }
  return result;
}

export function getCleanupSuggestions() {
  try {
    if (fs.existsSync(CLEANUP_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CLEANUP_FILE, 'utf8'));
      if (parsed && parsed.groups) return parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load cleanup suggestions');
  }
  return null;
}

/** Resolve orphaned pack rules given a pack-existence check (injected to avoid cycles). */
export function findOrphanedPackRules(rules, packExists) {
  return rules.filter((r) => r.packId && !packExists(r.packId)).map((r) => r.id);
}
