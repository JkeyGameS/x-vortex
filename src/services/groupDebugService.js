// Group diagnostics by DM.
//
// Answers the question that used to require a log dashboard: "the bot ignored
// this message -- why?". Each decision handleGroupMessage makes is pushed here
// and DM'd to whichever admins have a live /debug session.
//
// Deliberate design choices, because each one is a way this could hurt someone:
//
//   - Direct sock.sendMessage, not sendText. Debug DMs bypass the outbound
//     limiter on purpose: they are admin-only, explicitly requested, and short
//     lived, and a limiter that ate them would defeat the purpose. The internal
//     throttle plus the line cap below are what actually bound the volume.
//   - Per-admin throttling. Two admins watching one group each get their own
//     window; a shared one would let the second admin silently starve the
//     first.
//   - A line cap, not a DM cap. Several decisions are emitted per message, so
//     counting DMs would still let a busy group produce hundreds of lines.
//   - Auto-expiry. Sessions are diagnostic and short-lived; none of this
//     state should survive the debugging session that created it.
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { toSmallCaps } from '../utils/smallCaps.js';

// adminJid -> { targetGroupJid, expiresAt, lastSentAt, queued, flushTimer, lineCount }
const sessions = new Map();

function settings() {
  return config.groupDebug || {};
}

/** Reset any pending flush timer so a stale timer cannot fire after expiry. */
function clearTimer(session) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
}

export function enableDebug(adminJid, targetGroupJid = null) {
  const previous = sessions.get(adminJid);
  if (previous) clearTimer(previous);
  sessions.set(adminJid, {
    targetGroupJid,
    // A fresh /debug on always starts a clean line count.
    expiresAt: Date.now() + (settings().autoExpireMs ?? 600000),
    lastSentAt: 0,
    queued: [],
    flushTimer: null,
    lineCount: 0
  });
}

export function disableDebug(adminJid) {
  const session = sessions.get(adminJid);
  if (session) clearTimer(session);
  sessions.delete(adminJid);
}

/**
 * True when this admin has a live session covering this group.
 * Expired sessions are dropped here rather than merely returning false, so a
 * long-lived process does not accumulate them.
 */
export function isDebugActive(adminJid, groupJid) {
  const session = sessions.get(adminJid);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    clearTimer(session);
    sessions.delete(adminJid);
    return false;
  }
  // A session scoped to one group must not receive another group's traffic.
  if (session.targetGroupJid && session.targetGroupJid !== groupJid) return false;
  return true;
}

function send(sock, jid, text) {
  return sock.sendMessage(jid, { text });
}

/**
 * Deliver one queued batch, then reschedule if lines arrived while sending.
 *
 * The reschedule is the part that matters: without it, lines queued during the
 * window between the drain and the next send sit in `queued` with no timer
 * attached and are stranded until some later, unrelated message arrives.
 */
async function flush(sock, adminJid, session) {
  const throttle = settings().rateLimitMs ?? 2000;
  const maxBatch = settings().maxLinesPerBatch ?? 20;
  const lines = session.queued.splice(0);
  session.flushTimer = null;
  if (lines.length === 0) return;

  const combined = lines.slice(0, maxBatch).join('\n');
  const dropped = lines.length > maxBatch ? lines.length - maxBatch : 0;
  const body = dropped > 0 ? combined + '\n' + `\u2026 and ${dropped} more in this batch.` : combined;

  try {
    await send(sock, adminJid, body);
    session.lastSentAt = Date.now();
  } catch (err) {
    logger.warn({ err, adminJid }, '[GROUP_DEBUG] send failed');
  }

  // Anything queued during the await above goes out on the next tick.
  if (session.queued.length > 0) {
    scheduleFlush(sock, adminJid, session);
  }
}

function scheduleFlush(sock, adminJid, session) {
  if (session.flushTimer) return;
  const throttle = settings().rateLimitMs ?? 2000;
  session.flushTimer = setTimeout(() => {
    flush(sock, adminJid, session).catch((err) => {
      logger.warn({ err, adminJid }, '[GROUP_DEBUG] flush failed');
    });
  }, throttle);
  // Do not hold the process open for a diagnostic timer.
  if (typeof session.flushTimer.unref === 'function') session.flushTimer.unref();
}

/** Tell the admin the session is over rather than dropping them to silence. */
async function announceLimit(sock, adminJid, suppressed) {
  try {
    await send(
      sock,
      adminJid,
      '\u23F9 ' + toSmallCaps('Debug limit reached.') + ' *' + suppressed + '* ' +
      toSmallCaps('lines suppressed. /debug on to start a new session.')
    );
  } catch (err) {
    logger.warn({ err, adminJid }, '[GROUP_DEBUG] limit notice failed');
  }
}

/**
 * Push one decision line to every admin watching this group.
 * Never throws: diagnostics must not be able to break message handling.
 */
export async function pushDebug(sock, groupJid, text) {
  if (settings().enabled === false) return;
  const throttle = settings().rateLimitMs ?? 2000;
  const maxLines = settings().maxLinesPerSession ?? 100;

  for (const [adminJid, session] of [...sessions.entries()]) {
    if (Date.now() > session.expiresAt) {
      clearTimer(session);
      sessions.delete(adminJid);
      continue;
    }
    if (session.targetGroupJid && session.targetGroupJid !== groupJid) continue;

    if (session.lineCount >= maxLines) {
      // Session is spent: report once, then tear down.
      const suppressed = session.lineCount;
      clearTimer(session);
      sessions.delete(adminJid);
      await announceLimit(sock, adminJid, suppressed);
      continue;
    }
    session.lineCount++;

    const now = Date.now();
    if (now - session.lastSentAt < throttle) {
      session.queued.push(text);
      scheduleFlush(sock, adminJid, session);
      continue;
    }

    try {
      await send(sock, adminJid, text);
      session.lastSentAt = now;
    } catch (err) {
      logger.warn({ err, adminJid }, '[GROUP_DEBUG] send failed');
    }
  }
}

/** Diagnostics for /debug status. */
export function listActiveDebugs() {
  const out = [];
  const now = Date.now();
  for (const [adminJid, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      clearTimer(session);
      sessions.delete(adminJid);
      continue;
    }
    out.push({
      adminJid,
      targetGroupJid: session.targetGroupJid,
      expiresAt: new Date(session.expiresAt).toISOString(),
      lineCount: session.lineCount
    });
  }
  return out;
}

/** Test seam; sessions hold timers, so tests need a clean way to reset. */
export const __testing = { sessions, flush, clearTimer };
