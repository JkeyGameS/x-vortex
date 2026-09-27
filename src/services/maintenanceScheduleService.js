import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import settingsService from './settingsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'maintenanceSchedule.json');

let windows = [];
const timers = new Map();

function load() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        windows = parsed.filter((w) => w && w.id && typeof w.startAt === 'number' && typeof w.endAt === 'number' && w.endAt > w.startAt);
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load maintenance windows from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(windows, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save maintenance windows to disk');
  }
}

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function armTimer(window) {
  clearTimer(window.id);
  const now = Date.now();
  if (window.endAt <= now) return;
  const fireIn = Math.max(0, (window.startAt <= now ? window.endAt : window.startAt) - now);
  // Node caps timeouts at ~24.8 days; re-arm on fire if still pending.
  const timer = setTimeout(() => {
    timers.delete(window.id);
    applyWindow(window);
    armTimer(window);
  }, Math.min(fireIn, 2147483647));
  if (timer.unref) timer.unref();
  timers.set(window.id, timer);
}

function clearTimer(id) {
  if (timers.has(id)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
}

// Apply the current state for one window based on the current time.
function applyWindow(window) {
  const now = Date.now();
  if (now >= window.startAt && now < window.endAt) {
    if (!settingsService.getSettings().maintenanceMode) {
      settingsService.updateSettings({ maintenanceMode: true });
      logger.info({ id: window.id }, '[MAINTENANCE] scheduled window started');
    }
  } else if (now >= window.endAt) {
    if (settingsService.getSettings().maintenanceMode) {
      settingsService.updateSettings({ maintenanceMode: false });
      logger.info({ id: window.id }, '[MAINTENANCE] scheduled window ended');
    }
  }
}

export function getWindows() {
  return windows.map((w) => ({ ...w }));
}

export function scheduleWindow(startAt, endAt) {
  if (typeof startAt !== 'number' || typeof endAt !== 'number' || endAt <= startAt || endAt <= Date.now()) return null;
  const entry = { id: genId(), startAt, endAt };
  windows.push(entry);
  save();
  armTimer(entry);
  return { ...entry };
}

export function updateWindow(id, patch = {}) {
  const idx = windows.findIndex((w) => w.id === id);
  if (idx < 0) return null;
  if (patch.startAt !== undefined) windows[idx].startAt = patch.startAt;
  if (patch.endAt !== undefined) windows[idx].endAt = patch.endAt;
  if (!(windows[idx].endAt > windows[idx].startAt)) return null;
  save();
  armTimer(windows[idx]);
  return { ...windows[idx] };
}

export function deleteWindow(id) {
  const idx = windows.findIndex((w) => w.id === id);
  if (idx < 0) return false;
  clearTimer(id);
  windows.splice(idx, 1);
  save();
  return true;
}

export function clearAllWindows() {
  const count = windows.length;
  for (const id of [...timers.keys()]) clearTimer(id);
  windows = [];
  save();
  return count;
}

/**
 * Apply all windows to the current time and arm timers. Call on startup.
 */
export function applyScheduledWindows() {
  load();
  for (const window of windows) {
    applyWindow(window);
    armTimer(window);
  }
  logger.info({ count: windows.length }, '[MAINTENANCE] maintenance windows loaded');
  return windows.length;
}
