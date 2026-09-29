import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import { t } from './localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from './messageService.js';
import { logAdminAction } from './adminLogService.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const LAST_SHUTDOWN = path.join(DATA_DIR, 'lastShutdown.json');
const UPTIME_FILE = path.join(DATA_DIR, 'botUptime.json');

const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return { ...fallback };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { ...fallback };
  } catch (err) {
    logger.warn({ err, file }, '[LIFECYCLE] unreadable state file, using defaults');
    return { ...fallback };
  }
}

function writeJson(file, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    return true;
  } catch (err) {
    logger.error({ err, file }, '[LIFECYCLE] failed to persist state file');
    return false;
  }
}

const DEFAULT_UPTIME = {
  lastStartedAt: null,
  lastCrashedAt: null,
  totalUptimeMs: 0,
  recentCrashes: []
};

function cfg() {
  return config.botNotifications || {};
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** 3600000 -> "2d 5h 12m"; 0 -> "0m" */
export function formatUptime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const mins = Math.floor(total / 60000);
  if (mins < 1) return '0m';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = [];
  if (days) parts.push(days + 'd');
  if (hours) parts.push(hours + 'h');
  if (m || parts.length === 0) parts.push(m + 'm');
  return parts.join(' ');
}

/** Absolute ISO timestamp rendered small-caps; "unknown" when absent. */
export function formatTimestamp(iso, language) {
  if (!iso) return toSmallCaps(t(language || 'en', 'lifecycle.unknown'));
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return toSmallCaps(t(language || 'en', 'lifecycle.unknown'));
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ---------------------------------------------------------------------------
// Lifecycle markers
// ---------------------------------------------------------------------------

export function markStartup() {
  const uptime = readJson(UPTIME_FILE, DEFAULT_UPTIME);
  const now = new Date();
  const prevRef = uptime.lastCrashedAt || uptime.lastStartedAt;
  let downMs = null;
  if (prevRef) {
    const prev = new Date(prevRef).getTime();
    if (!Number.isNaN(prev)) downMs = Math.max(0, now.getTime() - prev);
  }
  uptime.lastStartedAt = now.toISOString();
  uptime.recentCrashes = pruneCrashes(uptime.recentCrashes || []);
  writeJson(UPTIME_FILE, uptime);
  return { downMs, uptime };
}

export function markShutdown(reason = 'graceful') {
  const uptime = readJson(UPTIME_FILE, DEFAULT_UPTIME);
  const sessionMs = Date.now() - startedAt;
  const payload = {
    reason,
    timestamp: new Date().toISOString(),
    uptimeMs: sessionMs,
    pid: process.pid
  };
  writeJson(LAST_SHUTDOWN, payload);
  uptime.totalUptimeMs = (Number(uptime.totalUptimeMs) || 0) + sessionMs;
  writeJson(UPTIME_FILE, uptime);
  return payload;
}

function pruneCrashes(list) {
  const windowMs = cfg().crashSpamWindowMs || 600000;
  const cutoff = Date.now() - windowMs;
  const kept = (Array.isArray(list) ? list : [])
    .map((x) => new Date(x).getTime())
    .filter((t) => !Number.isNaN(t) && t >= cutoff)
    .map((t) => new Date(t).toISOString());
  return kept.slice(-10);
}

export function detectPreviousCrash() {
  const windowMs = cfg().crashDetectionWindowMs || 300000;
  if (!fs.existsSync(LAST_SHUTDOWN)) {
    // Never ran before, or state lost: not a crash.
    const uptime = readJson(UPTIME_FILE, DEFAULT_UPTIME);
    if (!uptime.lastStartedAt) return { crashed: false };
    const prev = new Date(uptime.lastStartedAt).getTime();
    if (Number.isNaN(prev) || Date.now() - prev > windowMs) return { crashed: false };
    return { crashed: true, lastSeen: uptime.lastStartedAt, uptimeMs: null, reason: 'unknown' };
  }
  const last = readJson(LAST_SHUTDOWN, {});
  const ts = last.timestamp ? new Date(last.timestamp).getTime() : NaN;
  // Only an unclean stop INSIDE the detection window is a new crash. A stale
  // unclean entry means the bot crashed a while ago and has been running fine
  // since; re-alerting on every later restart would spam admins forever.
  const fresh = !Number.isNaN(ts) && Date.now() - ts <= windowMs;
  const ungraceful = last.reason !== 'graceful' && last.reason !== 'signal';
  if (fresh && ungraceful) {
    return { crashed: true, lastSeen: last.timestamp || null, uptimeMs: last.uptimeMs || null, reason: last.reason || 'unknown' };
  }
  return { crashed: false };
}

/** Record a crash and report whether the spam threshold was reached. */
export function recordCrash() {
  const uptime = readJson(UPTIME_FILE, DEFAULT_UPTIME);
  const list = pruneCrashes(uptime.recentCrashes || []);
  list.push(new Date().toISOString());
  uptime.recentCrashes = list.slice(-10);
  uptime.lastCrashedAt = new Date().toISOString();
  writeJson(UPTIME_FILE, uptime);
  const threshold = cfg().crashSpamThreshold || 3;
  const windowMs = cfg().crashSpamWindowMs || 600000;
  return {
    count: list.length,
    spammed: list.length >= threshold,
    windowMinutes: Math.round(windowMs / 60000)
  };
}

function enabled(key) {
  const c = cfg();
  if (c.enabled === false) return false;
  return c[key] !== false;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function broadcast(sock, text) {
  const admins = config.adminJids || [];
  if (!admins.length) {
    logger.info('[LIFECYCLE] no adminJids configured; notification skipped');
    return 0;
  }
  let sent = 0;
  for (const jid of admins) {
    try {
      // type: 'silent' skips the typing indicator.
      const ok = await sendText(sock, jid, text, { type: 'silent' });
      if (ok !== false) sent++;
    } catch (err) {
      // One unreachable admin must never stop the others.
      logger.error({ err, jid }, '[LIFECYCLE] admin notification failed');
    }
  }
  return sent;
}

const L = (language, key, params) => toSmallCaps(t(language || 'en', key, params));

export async function notifyAdminsStartup(sock) {
  if (!enabled('onStartup')) return { sent: 0, skipped: true };
  const uptime = readJson(UPTIME_FILE, DEFAULT_UPTIME);
  const last = readJson(LAST_SHUTDOWN, {});
  const text =
    '🟢 *' + L('en', 'lifecycle.onlineTitle') + '*\n\n' +
    '⏱️ ' + L('en', 'lifecycle.uptime') + ': ' + formatUptime(Date.now() - startedAt) + '\n' +
    '📅 ' + L('en', 'lifecycle.lastStart') + ': ' + (last.timestamp ? formatTimestamp(last.timestamp, 'en') : L('en', 'lifecycle.unknown'));
  const sent = await broadcast(sock, text);
  logAdminAction('system', 'bot_started', `uptime ${formatUptime(Date.now() - startedAt)}; lastShutdown ${last.timestamp || 'none'}`);
  logger.info({ sent, totalUptimeMs: uptime.totalUptimeMs }, '[LIFECYCLE] startup notification sent');
  return { sent, skipped: false };
}

export async function notifyAdminsShutdown(sock, reason = 'graceful') {
  if (!enabled('onShutdown')) return { sent: 0, skipped: true };
  const text =
    '🛑 *' + L('en', 'lifecycle.shutdownTitle') + '*\n\n' +
    L('en', 'lifecycle.reason') + ': ' + reason + '\n' +
    '⏱️ ' + L('en', 'lifecycle.uptime') + ': ' + formatUptime(Date.now() - startedAt);
  const sent = await broadcast(sock, text);
  logAdminAction('system', 'bot_shutdown', `${reason}; uptime ${formatUptime(Date.now() - startedAt)}`);
  return { sent, skipped: false };
}

export async function notifyAdminsCrash(sock, crashInfo) {
  if (!enabled('onCrash')) return { sent: 0, skipped: true };

  const { count, spammed, windowMinutes } = recordCrash();
  if (spammed) {
    const text =
      '⚠️ *' + L('en', 'lifecycle.repeatedTitle') + '*\n\n' +
      L('en', 'lifecycle.repeatedBody', { count: String(count), minutes: String(windowMinutes) }) + '\n\n' +
      L('en', 'lifecycle.repeatedFooter');
    const sent = await broadcast(sock, text);
    logAdminAction('system', 'bot_crashed', `repeated: ${count} crashes in ${windowMinutes}m`);
    return { sent, spammed: true, count };
  }

  const text =
    '⚠️ *' + L('en', 'lifecycle.crashTitle') + '*\n\n' +
    L('en', 'lifecycle.crashBody') + '\n\n' +
    '🕒 ' + L('en', 'lifecycle.lastSeen') + ': ' + (crashInfo?.lastSeen ? formatTimestamp(crashInfo.lastSeen, 'en') : L('en', 'lifecycle.unknown')) + '\n' +
    '⏱️ ' + L('en', 'lifecycle.previousUptime') + ': ' + formatUptime(crashInfo?.uptimeMs || 0) + '\n\n' +
    '_' + L('en', 'lifecycle.crashFooter') + '_';
  const sent = await broadcast(sock, text);
  logAdminAction('system', 'bot_crashed', `lastSeen ${crashInfo?.lastSeen || 'none'}; previousUptime ${crashInfo?.uptimeMs || 0}`);
  return { sent, spammed: false, count };
}

/**
 * Register SIGINT/SIGTERM handling. `getSock` is called at shutdown time so the
 * handler always uses the live socket. Returns the shutdown function for tests.
 */
export function installSignalHandlers(getSock) {
  let inProgress = false;

  async function gracefulShutdown(signal) {
    if (inProgress) return { alreadyRunning: true };
    inProgress = true;
    const timeoutMs = cfg().shutdownTimeoutMs || 3000;
    try {
      const sock = typeof getSock === 'function' ? getSock() : getSock;
      // Never let a slow network block the exit.
      await Promise.race([
        sock ? notifyAdminsShutdown(sock, signal) : Promise.resolve({ sent: 0, skipped: true }),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
      markShutdown(signal === 'SIGINT' || signal === 'SIGTERM' ? 'signal' : 'graceful');
      logger.info({ signal }, '[LIFECYCLE] graceful shutdown complete');
    } catch (err) {
      logger.error({ err }, '[LIFECYCLE] shutdown notification failed');
      try { markShutdown('graceful'); } catch { /* exit anyway */ }
    }
    process.exit(0);
    return { ok: true };
  }

  process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
  process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
  return gracefulShutdown;
}

export const __testing = { readJson, writeJson, pruneCrashes, DATA_DIR, LAST_SHUTDOWN, UPTIME_FILE };
