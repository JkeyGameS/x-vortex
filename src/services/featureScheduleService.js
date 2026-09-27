import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { t } from './localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { getAllUsers, setNotifyRequest } from './userService.js';
import * as featureFlagService from './featureFlagService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'featureSchedules.json');

let sock = null;
let changes = [];
const timers = new Map();

function load() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        changes = parsed.filter(s => s && s.id && s.featureId && typeof s.startAt === 'number');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load scheduled feature changes from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(changes, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save scheduled feature changes to disk');
  }
}

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Notify every user who requested a notification for this feature that it is
 * now available, then clear their requests.
 * @param {string} featureId
 */
export async function notifyFeatureAvailable(featureId) {
  if (!sock) {
    logger.warn({ featureId }, '[FEATURE_SCHEDULE] no socket, availability notification dropped');
    return 0;
  }
  let notified = 0;
  try {
    const users = await getAllUsers();
    for (const u of users) {
      if (!u.jid || u.blocked === true) continue;
      if (!(u.notifyRequests && u.notifyRequests[featureId] === true)) continue;
      const language = u.language || 'en';
      const name = featureFlagService.getFeatureLabel(language, featureId);
      const text = '✅ *' + toSmallCaps(name) + '* ' + toSmallCaps(t(language, 'feature.nowAvailableSuffix'));
      try {
        await sock.sendMessage(u.jid, { text });
        notified++;
      } catch (err) {
        logger.warn({ err, jid: u.jid }, '[FEATURE_SCHEDULE] failed to send availability notification');
      }
      await setNotifyRequest(u.jid, featureId, false);
    }
  } catch (err) {
    logger.error({ err, featureId }, '[FEATURE_SCHEDULE] failed to notify users');
  }
  return notified;
}

async function fire(entry) {
  timers.delete(entry.id);

  // Apply any custom messages that were part of the scheduled change.
  if (entry.messages && typeof entry.messages === 'object') {
    for (const slot of ['unavailable', 'notifyPrompt', 'info']) {
      const val = entry.messages[slot];
      if (typeof val === 'string' && val.trim()) {
        featureFlagService.setFeatureMessage(entry.featureId, slot, val);
      }
    }
  }

  featureFlagService.setFeatureStatus(entry.featureId, entry.newStatus);

  // Remove the one-shot entry.
  changes = changes.filter(s => s.id !== entry.id);
  save();
  logger.info({ id: entry.id, featureId: entry.featureId, status: entry.newStatus }, '[FEATURE_SCHEDULE] scheduled feature change applied');

  if (entry.newStatus === 'available') {
    const notified = await notifyFeatureAvailable(entry.featureId);
    logger.info({ featureId: entry.featureId, notified }, '[FEATURE_SCHEDULE] availability notifications sent');
  }
}

async function scheduleTimer(entry) {
  const delay = entry.startAt - Date.now();
  if (delay <= 0) {
    await fire(entry);
    return;
  }
  const timer = setTimeout(() => fire(entry), delay);
  if (timer.unref) timer.unref();
  timers.set(entry.id, timer);
}

export function setSock(socket) {
  sock = socket;
}

/**
 * Schedule a feature status change for a future timestamp and persist it.
 * @param {object} data - { adminJid, featureId, newStatus, startAt, messages? }
 * @returns {Promise<object>} the persisted entry
 */
export async function scheduleFeatureChange({ adminJid, featureId, newStatus, startAt, messages }) {
  const entry = {
    id: genId(),
    adminJid: adminJid || '-',
    featureId,
    newStatus,
    startAt,
    messages: messages && typeof messages === 'object' ? messages : null
  };
  changes.push(entry);
  save();
  await scheduleTimer(entry);
  return entry;
}

export function listFeatureSchedules() {
  return changes.map(s => ({ ...s }));
}

export async function cancelFeatureSchedule(id) {
  const idx = changes.findIndex(s => s.id === id);
  if (idx === -1) return false;
  changes.splice(idx, 1);
  if (timers.has(id)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
  save();
  return true;
}

export async function clearAllFeatureSchedules() {
  const count = changes.length;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  changes = [];
  save();
  return count;
}

/**
 * Load persisted scheduled feature changes and (re)arm their timers.
 * Call once on bot startup.
 */
export async function loadSchedulesAndSchedule() {
  load();
  let pending = 0;
  for (const entry of changes) {
    if (entry.startAt > Date.now()) {
      await scheduleTimer(entry);
      pending++;
    } else {
      await fire(entry); // overdue -> apply immediately & clean up
    }
  }
  logger.info({ pending, total: changes.length }, '[FEATURE_SCHEDULE] scheduled feature changes loaded');
  return pending;
}