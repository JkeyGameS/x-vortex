import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const ROLES_FILE = path.join(DATA_DIR, 'roles.json');

export const ROLES = ['owner', 'admin', 'moderator', 'support', 'viewer'];

const RANKS = { viewer: 0, support: 1, moderator: 2, admin: 3, owner: 4 };

// Minimum rank required per permission area.
const PERMS = {
  'stats.view': 0,
  'logs.view': 0,
  broadcast: 2,
  'users.manage': 2,
  'feedback.manage': 2,
  'feedback.reply': 1,
  search: 1,
  'scheduled.view': 2,
  'scheduled.manage': 2,
  settings: 3,
  features: 2,
  chatfaq: 2,
  backup: 3,
  test: 3,
  quick: 0,
  emergency: 3,
  'roles.manage': 3,
  purge: 3
};

let overrides = {};

function load() {
  try {
    if (fs.existsSync(ROLES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        overrides = parsed;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load roles from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(ROLES_FILE, JSON.stringify(overrides, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save roles to disk');
  }
}

load();

export function getOwnerJid() {
  if (config.ownerJid) return config.ownerJid;
  return (config.adminJids || [])[0] || null;
}

export function isOwner(jid) {
  const owner = getOwnerJid();
  return !!owner && jid === owner;
}

/**
 * Effective role: explicit override, else admin for adminJids, else null.
 */
export function getRole(jid) {
  if (!jid) return null;
  if (isOwner(jid)) return 'owner';
  if (Object.prototype.hasOwnProperty.call(overrides, jid)) {
    const r = overrides[jid];
    return ROLES.includes(r) ? r : null;
  }
  if ((config.adminJids || []).includes(jid)) return 'admin';
  return null;
}

export function setRole(jid, role) {
  if (!jid || !ROLES.includes(role) || role === 'owner') return false;
  overrides[jid] = role;
  save();
  return true;
}

export function removeRole(jid) {
  if (!Object.prototype.hasOwnProperty.call(overrides, jid)) return false;
  delete overrides[jid];
  save();
  return true;
}

export function listRoles() {
  const out = [];
  const seen = new Set();
  const owner = getOwnerJid();
  if (owner) {
    out.push({ jid: owner, role: 'owner' });
    seen.add(owner);
  }
  for (const jid of config.adminJids || []) {
    if (seen.has(jid)) continue;
    seen.add(jid);
    out.push({ jid, role: getRole(jid) || 'admin' });
  }
  for (const jid of Object.keys(overrides)) {
    if (seen.has(jid)) continue;
    seen.add(jid);
    out.push({ jid, role: overrides[jid] });
  }
  return out;
}

function rankOf(jid) {
  const role = getRole(jid);
  if (!role) return -1;
  return RANKS[role] ?? -1;
}

export function hasPermission(jid, perm) {
  if (!(perm in PERMS)) return false;
  return rankOf(jid) >= PERMS[perm];
}

export function canManage(callerJid, targetJid) {
  if (!hasPermission(callerJid, 'roles.manage')) return false;
  if (isOwner(targetJid) && !isOwner(callerJid)) return false;
  return true;
}
