import config from '../config/config.js';

/**
 * Normalize text: lowercase, strip punctuation, collapse whitespace, trim.
 */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein edit distance between two strings.
 */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Similarity score between two strings (0..1). 1 = identical.
 */
export function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Check if input fuzzy-matches target.
 * Returns true if exact, or Levenshtein distance ≤ 2, or similarity ≥ 0.8.
 */
export function fuzzyMatch(input, target, { exact = false } = {}) {
  if (exact) return input === target;
  if (input === target) return true;
  if (levenshtein(input, target) <= 2) return true;
  if (similarity(input, target) >= 0.8) return true;
  return false;
}

/**
 * Replace placeholders in text with dynamic values.
 * Supported: {username} {firstname} {time} {date} {botname} {user_id} {level}
 */
export function replacePlaceholders(text, user, cfg) {
  const c = cfg || config;
  const now = new Date();
  return text
    .replace(/\{username\}/g, user?.username ? '@' + user.username : (user?.name || 'User'))
    .replace(/\{firstname\}/g, (user?.name || 'User').split(' ')[0])
    .replace(/\{time\}/g, now.toLocaleTimeString())
    .replace(/\{date\}/g, now.toLocaleDateString())
    .replace(/\{botname\}/g, c.botName || 'Bot')
    .replace(/\{user_id\}/g, user?.jid || '')
    .replace(/\{level\}/g, String(user?.level || 1));
}

/**
 * Check whether a rule/entry with optional activeFrom/activeTo ISO bounds
 * is active right now. Missing bounds mean unbounded on that side.
 */
export function isActiveNow(entry) {
  if (!entry) return false;
  const now = Date.now();
  if (entry.activeFrom) {
    const from = new Date(entry.activeFrom).getTime();
    if (!isNaN(from) && now < from) return false;
  }
  if (entry.activeTo) {
    const to = new Date(entry.activeTo).getTime();
    if (!isNaN(to) && now > to) return false;
  }
  return true;
}

/**
 * Strip emojis from text. Removes common emoji Unicode ranges.
 */
export function stripEmojis(text) {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{FE0F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Pick a random element from an array.
 */
export function pickRandom(arr) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a unique ID for new entities.
 */
export function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Split a semicolon-separated string into trimmed, non-empty parts.
 */
export function splitSemicolons(text) {
  return String(text || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
