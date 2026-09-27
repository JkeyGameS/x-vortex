import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const BLOCKED_FILE = path.join(DATA_DIR, 'blockedUsers.json');

let blockedUsers = {};

function load() {
  try {
    if (fs.existsSync(BLOCKED_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(BLOCKED_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        blockedUsers = {};
        for (const jid of parsed) {
          blockedUsers[jid] = { jid, reason: '', timestamp: new Date().toISOString() };
        }
      } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        blockedUsers = parsed;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load blocked users from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(BLOCKED_FILE, JSON.stringify(blockedUsers, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save blocked users to disk');
  }
}

load();

export function isBlocked(jid) {
  return !!blockedUsers[jid];
}

export function blockUser(jid, reason) {
  if (!jid) return false;
  const added = !blockedUsers[jid];
  blockedUsers[jid] = {
    jid,
    reason: reason || '',
    timestamp: new Date().toISOString()
  };
  save();
  return added;
}

export function unblockUser(jid) {
  const removed = !!blockedUsers[jid];
  delete blockedUsers[jid];
  if (removed) save();
  return removed;
}

export function getBlockedUsers() {
  return Object.values(blockedUsers);
}

export function getBlocked() {
  return Object.keys(blockedUsers);
}

export function getBlockedEntry(jid) {
  return blockedUsers[jid] || null;
}
