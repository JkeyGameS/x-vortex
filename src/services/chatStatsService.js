import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const CHAT_STATS_FILE = path.join(DATA_DIR, 'chatStats.json');
const FAQ_STATS_FILE = path.join(DATA_DIR, 'faqStats.json');

function loadMap(file) {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && v > 0) out[k] = v;
        }
        return out;
      }
    }
  } catch (err) {
    logger.warn({ err, file }, 'Failed to load usage stats from disk');
  }
  return {};
}

function saveMap(file, map) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(map, null, 2));
  } catch (err) {
    logger.warn({ err, file }, 'Failed to save usage stats to disk');
  }
}

let chatRuleHits = loadMap(CHAT_STATS_FILE);
let faqHits = loadMap(FAQ_STATS_FILE);

export function incrementChatRuleHit(ruleId) {
  if (!ruleId) return;
  chatRuleHits[ruleId] = (chatRuleHits[ruleId] || 0) + 1;
  saveMap(CHAT_STATS_FILE, chatRuleHits);
}

export function incrementFaqHit(faqId) {
  if (!faqId) return;
  faqHits[faqId] = (faqHits[faqId] || 0) + 1;
  saveMap(FAQ_STATS_FILE, faqHits);
}

export function getChatRuleHits() {
  return { ...chatRuleHits };
}

export function getFaqHits() {
  return { ...faqHits };
}

export function clearUsageStats() {
  chatRuleHits = {};
  faqHits = {};
  saveMap(CHAT_STATS_FILE, chatRuleHits);
  saveMap(FAQ_STATS_FILE, faqHits);
}
