import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { getAllEntries } from './faqService.js';
import { getFaqHits } from './chatStatsService.js';
import { similarity } from '../utils/matchUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const CLEANUP_FILE = path.join(DATA_DIR, 'faqCleanupSuggestions.json');

const NO_HIT_DAYS = 30;
const SIMILARITY_THRESHOLD = 0.7;

/** Regenerate FAQ cleanup suggestions and persist them. */
export async function generateFaqCleanupSuggestions() {
  const entries = getAllEntries();
  const hits = getFaqHits();
  const cutoff = Date.now() - NO_HIT_DAYS * 24 * 3600 * 1000;

  const unused = entries
    .filter((e) => !(hits[e.id] > 0))
    .filter((e) => {
      const created = new Date(e.createdAt || 0).getTime();
      return created && created < cutoff;
    })
    .map((e) => e.id);

  const seen = new Map();
  const duplicates = [];
  for (const e of entries) {
    const key = JSON.stringify([
      String(e.question || '').toLowerCase().trim(),
      [...(e.keywords || [])].map((s) => String(s).toLowerCase()).sort(),
      e.language || 'all'
    ]);
    if (seen.has(key)) {
      let group = duplicates.find((g) => g.includes(seen.get(key)));
      if (!group) {
        group = [seen.get(key)];
        duplicates.push(group);
      }
      group.push(e.id);
    } else {
      seen.set(key, e.id);
    }
  }

  let orphaned = [];
  try {
    const { getFaqPack } = await import('./faqTemplateService.js');
    orphaned = entries.filter((e) => e.packId && !getFaqPack(e.packId)).map((e) => e.id);
  } catch { /* pack lookup must never break cleanup */ }

  // Similarity clusters: pairs with question similarity >= threshold.
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (used.has(a.id + '|' + b.id)) continue;
      const sim = similarity(
        String(a.question || '').toLowerCase(),
        String(b.question || '').toLowerCase()
      );
      if (sim >= SIMILARITY_THRESHOLD && a.id !== b.id) {
        let cluster = clusters.find((c) => c.includes(a.id) || c.includes(b.id));
        if (!cluster) {
          cluster = [a.id];
          clusters.push(cluster);
        }
        if (!cluster.includes(b.id)) cluster.push(b.id);
        used.add(a.id + '|' + b.id);
      }
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    groups: { unused, duplicates, orphaned, similar: clusters.filter((c) => c.length > 1) }
  };
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLEANUP_FILE, JSON.stringify(result, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save FAQ cleanup suggestions');
  }
  return result;
}

export function getFaqCleanupSuggestions() {
  try {
    if (fs.existsSync(CLEANUP_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CLEANUP_FILE, 'utf8'));
      if (parsed && parsed.groups) return parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load FAQ cleanup suggestions');
  }
  return null;
}
