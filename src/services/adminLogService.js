import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const LOG_FILE = path.join(DATA_DIR, 'adminLog.json');

const MAX_ENTRIES = 200;

let entries = [];

function load() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      if (Array.isArray(parsed)) entries = parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load admin log from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save admin log to disk');
  }
}

load();

/**
 * Record an admin action.
 * @param {string} adminJid - JID of the admin who performed the action
 * @param {string} action - short action label (e.g. 'broadcast', 'user_delete', 'settings_change')
 * @param {string} [details] - short human-readable detail string
 */
export function logAdminAction(adminJid, action, details = '') {
  entries.push({
    timestamp: new Date().toISOString(),
    adminJid: adminJid || '-',
    action,
    details: details || ''
  });
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  save();
}

/**
 * Return the most recent admin actions, newest first.
 * @param {number} [limit]
 * @returns {Array<{timestamp: string, adminJid: string, action: string, details: string}>}
 */
export function getRecentAdminActions(limit = 10) {
  return entries.slice(-limit).reverse();
}
