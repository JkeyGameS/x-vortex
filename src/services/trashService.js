import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import config from '../config/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const TRASH_DIR = path.join(DATA_DIR, 'trash');
const TRASH_FILE = path.join(TRASH_DIR, 'chatRules.json');

function retentionMs() {
  const days = Math.max(1, Math.floor(Number(config.chatTrashRetentionDays) || 30));
  return days * 86400000;
}

function read() {
  try {
    if (fs.existsSync(TRASH_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TRASH_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed.filter((x) => x && typeof x === 'object');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read rule trash');
  }
  return [];
}

function write(entries) {
  try {
    if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
    fs.writeFileSync(TRASH_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save rule trash');
  }
}

/** Drop entries older than the retention window. @returns {number} purged count */
export function purgeExpiredTrash() {
  const entries = read();
  const cutoff = Date.now() - retentionMs();
  const kept = entries.filter((e) => {
    const ts = new Date(e.deletedAt || 0).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
  if (kept.length !== entries.length) write(kept);
  return entries.length - kept.length;
}

/**
 * Move full rule objects to trash (stamped with deletedAt).
 * @returns {number} moved count
 */
export function moveToTrash(rules) {
  if (!Array.isArray(rules) || !rules.length) return 0;
  const now = new Date().toISOString();
  const entries = read();
  const ids = new Set(entries.map((e) => e.id));
  let count = 0;
  for (const r of rules) {
    if (!r || !r.id) continue;
    const stamped = { ...r, deletedAt: r.deletedAt || now };
    const idx = entries.findIndex((e) => e.id === r.id);
    if (idx >= 0) entries[idx] = stamped;
    else entries.push(stamped);
    ids.add(r.id);
    count++;
  }
  write(entries);
  return count;
}

export function listTrash() {
  purgeExpiredTrash();
  return read().sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
}

/**
 * Remove entries from trash and return them (without deletedAt) for restore.
 */
export function takeFromTrash(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  const entries = read();
  const taken = [];
  const kept = [];
  for (const e of entries) {
    if (wanted.has(e.id)) {
      const { deletedAt, ...rule } = e;
      taken.push(rule);
    } else {
      kept.push(e);
    }
  }
  if (taken.length) write(kept);
  return taken;
}

export function clearTrash() {
  write([]);
}
