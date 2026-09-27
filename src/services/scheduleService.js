import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { getAllUsers } from './userService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'scheduledBroadcasts.json');

let sock = null;
let schedules = [];
const timers = new Map();

function load() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        schedules = parsed.filter(s => s && s.id && s.text && typeof s.sendAt === 'number');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load scheduled broadcasts from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save scheduled broadcasts to disk');
  }
}

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Compute the next fire time for a recurring entry, or null for a one-shot.
function computeNextFire(entry) {
  if (!entry.recurrence || entry.recurrence === 'once') return null;
  const base = entry.sendAt;
  switch (entry.recurrence) {
    case 'hourly':
      return base + 3600000;
    case 'daily':
      return base + 86400000;
    case 'weekly':
      return base + 7 * 86400000;
    case 'monthly': {
      const d = new Date(base);
      d.setMonth(d.getMonth() + 1);
      return d.getTime();
    }
    default:
      return null;
  }
}

async function fire(entry) {
  timers.delete(entry.id);

  if (!sock) {
    logger.warn({ id: entry.id }, '[SCHEDULE] no socket, scheduled broadcast dropped');
    const next = computeNextFire(entry);
    if (next !== null) {
      entry.sendAt = next;
      save();
      await scheduleTimer(entry);
      return;
    }
    schedules = schedules.filter(s => s.id !== entry.id);
    save();
    return;
  }

  let sent = 0;
  try {
    const users = await getAllUsers();
    for (const u of users) {
      if (!u.jid || u.blocked === true) continue;
      try {
        await sock.sendMessage(u.jid, { text: entry.text });
        sent++;
      } catch (err) {
        logger.warn({ err, jid: u.jid }, '[SCHEDULE] failed to send scheduled broadcast to user');
      }
    }
  } catch (err) {
    logger.error({ err, id: entry.id }, '[SCHEDULE] failed to gather users for scheduled broadcast');
  }

  const next = computeNextFire(entry);
  if (next !== null) {
    entry.sendAt = next;
    save();
    await scheduleTimer(entry);
    logger.info({ id: entry.id, next, sent }, '[SCHEDULE] fired recurring scheduled broadcast');
    return;
  }

  schedules = schedules.filter(s => s.id !== entry.id);
  save();
  logger.info({ id: entry.id, sent }, '[SCHEDULE] fired scheduled broadcast');
}

async function scheduleTimer(entry) {
  const delay = entry.sendAt - Date.now();
  if (delay <= 0) {
    await fire(entry);
    return;
  }
  const t = setTimeout(() => fire(entry), delay);
  if (t.unref) t.unref();
  timers.set(entry.id, t);
}

export function setSock(s) {
  sock = s;
}

/**
 * Schedule a broadcast for a future timestamp and persist it.
 * @param {object} data - { adminJid, text, sendAt, recurrence } (sendAt is epoch ms; recurrence: 'once'|'hourly'|'daily'|'weekly'|'monthly')
 * @returns {Promise<object>} the persisted schedule entry
 */
export async function scheduleBroadcast({ adminJid, text, sendAt, recurrence }) {
  const entry = {
    id: genId(),
    adminJid: adminJid || '-',
    text,
    sendAt,
    recurrence: recurrence || 'once'
  };
  schedules.push(entry);
  save();
  await scheduleTimer(entry);
  return entry;
}

export function listScheduled() {
  return schedules.map(s => ({ ...s }));
}

/**
 * Return a single schedule by id, or undefined if not found.
 * @param {string} id
 * @returns {object|undefined} a copy of the schedule entry
 */
export function getScheduleById(id) {
  const entry = schedules.find(s => s.id === id);
  return entry ? { ...entry } : undefined;
}

/**
 * Update a schedule's message, scheduled timestamp and/or recurrence, persist
 * it, and (re)schedule the underlying timer.
 * @param {string} id
 * @param {object} updates - { text?, sendAt?, recurrence? }
 * @returns {Promise<object|null>} the updated entry, or null if not found
 */
export async function updateSchedule(id, updates = {}) {
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return null;
  if (updates.text !== undefined) schedules[idx].text = updates.text;
  if (updates.sendAt !== undefined) schedules[idx].sendAt = updates.sendAt;
  if (updates.recurrence !== undefined) schedules[idx].recurrence = updates.recurrence || 'once';
  save();

  // Re-arm the timer for the (possibly changed) fire time.
  if (timers.has(id)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
  await scheduleTimer(schedules[idx]);

  return { ...schedules[idx] };
}

/**
 * Remove all persisted schedules and clear their timers.
 * @returns {Promise<number>} the number of schedules removed
 */
export async function clearAllSchedules() {
  const count = schedules.length;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  schedules = [];
  save();
  return count;
}

export async function cancelSchedule(id) {
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return false;
  const [removed] = schedules.splice(idx, 1);
  if (timers.has(id)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
  save();
  return !!removed;
}

/**
 * Load persisted schedules from disk and (re)schedule their timers.
 * Call once on bot startup.
 */
export async function loadSchedulesAndSchedule() {
  load();
  let pending = 0;
  for (const entry of schedules) {
    if (entry.sendAt > Date.now()) {
      await scheduleTimer(entry);
      pending++;
    } else {
      await fire(entry); // overdue -> send immediately & clean up
    }
  }
  logger.info({ pending, total: schedules.length }, '[SCHEDULE] scheduled broadcasts loaded');
  return pending;
}
