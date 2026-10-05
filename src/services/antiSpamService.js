import config from '../config/config.js';

/**
 * Anti-spam detection (Phase 5).
 *
 * Per-user, per-group message history held in memory only. A redeploy clears
 * it, which is the safe direction to fail: the worst case is that someone gets
 * a free pass for the first few messages after a restart.
 *
 * Two detections:
 *   repeat -- the same normalized text repeated inside repeatWindowMs
 *   flood  -- too many messages inside floodWindowMs
 *
 * Normalization lowercases, collapses whitespace and strips punctuation so
 * "Hello!!!" and "hello" count as the same message.
 */

const userMessages = new Map();   // `${groupJid}::${userJid}` -> [{ text, at }]
const userOffenses = new Map();   // `${groupJid}::${userJid}` -> { count, lastAt }

const MAX_HISTORY = 20;

function key(groupJid, userJid) {
  return `${groupJid}::${userJid}`;
}

function cfg() {
  return (config.antiSpam) || {};
}

/** True when both the block and the global kill switch allow detection. */
export function antiSpamActive() {
  return config.antiSpamEnabled !== false && cfg().enabled !== false;
}

export function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

/**
 * Record one message and report whether it trips a detector.
 *
 * The current message is stored before the checks, so both counts include it:
 * repeatThreshold 3 flags on the third identical message, floodThreshold 10 on
 * the tenth message in the window.
 *
 * @returns {{ flagged: boolean, reason?: 'repeat'|'flood', count?: number }}
 */
export function recordMessage(groupJid, userJid, text) {
  if (!antiSpamActive()) return { flagged: false };

  const c = cfg();
  const k = key(groupJid, userJid);
  const now = Date.now();
  const history = userMessages.get(k) || [];

  const windowMs = Math.max(c.repeatWindowMs || 0, c.floodWindowMs || 0);
  const pruned = history.filter((m) => now - m.at <= windowMs);
  pruned.push({ text: text || '', at: now });
  while (pruned.length > MAX_HISTORY) pruned.shift();
  userMessages.set(k, pruned);

  const floodWindow = c.floodWindowMs || 0;
  const recent = pruned.filter((m) => now - m.at <= floodWindow);
  const floodThreshold = c.floodThreshold || Infinity;
  if (recent.length >= floodThreshold) {
    return { flagged: true, reason: 'flood', count: recent.length };
  }

  // Very short normalized text is skipped: "ok" repeated is usually a bot
  // handshake, not spam, and false positives here are costly.
  const norm = normalize(text);
  if (norm.length >= 3) {
    const repeatWindow = c.repeatWindowMs || 0;
    const repeatThreshold = c.repeatThreshold || Infinity;
    const same = pruned.filter(
      (m) => now - m.at <= repeatWindow && normalize(m.text) === norm
    );
    if (same.length >= repeatThreshold) {
      return { flagged: true, reason: 'repeat', count: same.length };
    }
  }

  return { flagged: false };
}

/** Count an offense and return the new total. Decays after offenseDecayMs. */
export function recordOffense(groupJid, userJid, now = Date.now()) {
  const k = key(groupJid, userJid);
  const decayMs = cfg().offenseDecayMs || 0;
  const entry = userOffenses.get(k) || { count: 0, lastAt: 0 };
  if (entry.lastAt && decayMs && now - entry.lastAt > decayMs) entry.count = 0;
  entry.count += 1;
  entry.lastAt = now;
  userOffenses.set(k, entry);
  return { count: entry.count };
}

export function getOffenseCount(groupJid, userJid, now = Date.now()) {
  const entry = userOffenses.get(key(groupJid, userJid));
  if (!entry) return 0;
  const decayMs = cfg().offenseDecayMs || 0;
  if (entry.lastAt && decayMs && now - entry.lastAt > decayMs) return 0;
  return entry.count;
}

/** Forget everything about one user in one group. */
export function clearUser(groupJid, userJid) {
  userMessages.delete(key(groupJid, userJid));
  userOffenses.delete(key(groupJid, userJid));
}

/** Clear all state. Tests only. */
export function resetAntiSpam() {
  userMessages.clear();
  userOffenses.clear();
}

/** First offense gets the short mute, later ones the long one. */
export function getMuteDurationForOffense(offenseCount) {
  const c = cfg();
  if (offenseCount >= 2) return c.secondOffenseMuteMs;
  return c.firstOffenseMuteMs;
}

/** Diagnostic counts, for the health endpoint. */
export function getAntiSpamStats() {
  return {
    trackedUsers: userMessages.size,
    trackedOffenders: userOffenses.size,
    limits: {
      repeatWindowMs: cfg().repeatWindowMs,
      repeatThreshold: cfg().repeatThreshold,
      floodWindowMs: cfg().floodWindowMs,
      floodThreshold: cfg().floodThreshold
    }
  };
}