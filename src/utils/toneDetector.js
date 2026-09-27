import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import sessionManager from './sessionManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const TONE_WORDS_FILE = path.join(DATA_DIR, 'toneWords.json');

const DEFAULT_POSITIVE = [
  'great', 'good', 'awesome', 'amazing', 'love', 'happy', 'glad', 'nice',
  'wonderful', 'excellent', 'fantastic', 'perfect', 'cool', 'beautiful',
  'best', 'enjoy', 'excited', 'yay', 'thanks', 'thank', 'wonderful', 'brilliant',
  '😊', '😄', '😍', '❤️', '🔥', '🎉', '✨', '👍', '🥰', '😁'
];

const DEFAULT_NEGATIVE = [
  'bad', 'sad', 'angry', 'hate', 'terrible', 'awful', 'tired', 'sick',
  'hurt', 'upset', 'annoyed', 'frustrated', 'bored', 'lonely', 'stressed',
  'worried', 'scared', 'hate', 'horrible', 'stupid', 'dumb', 'cry',
  '😢', '😡', '😞', '😭', '👎', '💔', '😩', '😤'
];

let cached = null;

function loadWords() {
  try {
    if (fs.existsSync(TONE_WORDS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TONE_WORDS_FILE, 'utf8'));
      if (parsed && Array.isArray(parsed.positive) && Array.isArray(parsed.negative)) {
        return {
          positive: parsed.positive.map(String),
          negative: parsed.negative.map(String)
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load tone words');
  }
  return null;
}

function ensureDefaults() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TONE_WORDS_FILE)) {
    try {
      fs.writeFileSync(TONE_WORDS_FILE, JSON.stringify({ positive: DEFAULT_POSITIVE, negative: DEFAULT_NEGATIVE }, null, 2));
    } catch (err) {
      logger.warn({ err }, 'Failed to seed tone words');
    }
  }
}

export function getToneWords() {
  if (!cached) {
    ensureDefaults();
    cached = loadWords() || { positive: [...DEFAULT_POSITIVE], negative: [...DEFAULT_NEGATIVE] };
  }
  return { positive: [...cached.positive], negative: [...cached.negative] };
}

export function reloadToneWords() {
  cached = null;
  return getToneWords();
}

function tokenize(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Lightweight word-list sentiment classifier.
 * @returns {'positive'|'negative'|'neutral'}
 */
export function detectTone(message) {
  const { positive, negative } = getToneWords();
  const pos = new Set(positive.map((w) => w.toLowerCase()));
  const neg = new Set(negative.map((w) => w.toLowerCase()));
  let p = 0;
  let n = 0;
  for (const tok of tokenize(message)) {
    if (pos.has(tok)) p += 1;
    if (neg.has(tok)) n += 1;
  }
  // Raw emoji scan: tokenization keeps most emoji intact, but catch any
  // pictographs the punctuation strip may have split.
  const raw = String(message || '');
  for (const e of pos) {
    if (e.length <= 4 && /\p{Extended_Pictographic}/u.test(e) && raw.includes(e) && !tokenize(message).includes(e)) p += 1;
  }
  for (const e of neg) {
    if (e.length <= 4 && /\p{Extended_Pictographic}/u.test(e) && raw.includes(e) && !tokenize(message).includes(e)) n += 1;
  }
  if (p > n) return 'positive';
  if (n > p) return 'negative';
  return 'neutral';
}

/** Store the detected tone in the session for future use (analytics, etc.). */
export function updateUserTone(userId, tone, chatId = null) {
  try {
    const cid = chatId || userId;
    sessionManager.setState(userId, cid, { lastTone: tone });
  } catch (err) {
    logger.warn({ err }, 'Failed to store user tone');
  }
  return tone;
}

function persistWords(words) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TONE_WORDS_FILE, JSON.stringify(words, null, 2));
    cached = null;
    return true;
  } catch (err) {
    logger.warn({ err }, 'Failed to save tone words');
    return false;
  }
}

export function addToneWord(word, category) {
  const w = String(word || '').trim().toLowerCase();
  if (!w || (category !== 'positive' && category !== 'negative')) return false;
  const words = getToneWords();
  if (words[category].map((x) => x.toLowerCase()).includes(w)) return false;
  words[category].push(w);
  return persistWords(words);
}

export function removeToneWord(word, category) {
  const w = String(word || '').trim().toLowerCase();
  if (!w || (category !== 'positive' && category !== 'negative')) return false;
  const words = getToneWords();
  const before = words[category].length;
  words[category] = words[category].filter((x) => x.toLowerCase() !== w);
  if (words[category].length === before) return false;
  return persistWords(words);
}

export function resetToneWords() {
  cached = null;
  try {
    if (fs.existsSync(TONE_WORDS_FILE)) fs.rmSync(TONE_WORDS_FILE, { force: true });
  } catch (err) {
    logger.warn({ err }, 'Failed to reset tone words');
  }
  return getToneWords();
}

export function defaultToneWords() {
  return { positive: [...DEFAULT_POSITIVE], negative: [...DEFAULT_NEGATIVE] };
}
