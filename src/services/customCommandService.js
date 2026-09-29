import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'customCommands.json');

export const ACTION_TYPES = ['send_text', 'open_menu', 'invoke_chat_rule', 'forward_to_admin'];

const NAME_RE = /^[a-z0-9_]{1,30}$/;

let cache = null;

function limits() {
  return {
    ...config.customCommands,
    maxCommands: config.customCommands?.maxCommands ?? 200,
    maxAliasesPerCommand: config.customCommands?.maxAliasesPerCommand ?? 5,
    maxNameLength: config.customCommands?.maxNameLength ?? 30,
    maxDescriptionLength: config.customCommands?.maxDescriptionLength ?? 100,
    maxTextActionLength: config.customCommands?.maxTextActionLength ?? 1000
  };
}

export function isValidName(name) {
  const n = String(name || '').trim().toLowerCase();
  return NAME_RE.test(n) && n.length <= limits().maxNameLength;
}

function readFile() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    logger.warn({ err }, '[CUSTOM_CMD] unreadable customCommands.json, starting empty');
    return {};
  }
}

function writeFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2) + '\n');
    return true;
  } catch (err) {
    logger.error({ err }, '[CUSTOM_CMD] failed to persist customCommands.json');
    return false;
  }
}

export function loadCustomCommands() {
  cache = readFile() || {};
  writeFile();
  return { ...cache };
}

function ensure() {
  if (!cache) loadCustomCommands();
  return cache;
}

export function getAllCustomCommands() {
  return Object.values(ensure()).map((c) => ({ ...c }));
}

export function getCustomCommand(name) {
  const c = ensure()[String(name || '').toLowerCase()];
  return c ? { ...c } : null;
}

export function findByNameOrAlias(input) {
  const key = String(input || '').trim().toLowerCase().replace(/^\//, '');
  const store = ensure();
  if (store[key]) return { name: key, command: { ...store[key] } };
  for (const [name, cmd] of Object.entries(store)) {
    if ((cmd.aliases || []).some((a) => String(a).toLowerCase() === key)) {
      return { name, command: { ...cmd } };
    }
  }
  return null;
}

/**
 * Names already taken. `reserved` is the set of built-in command names/aliases
 * plus menu standaloneCommand/aliases, supplied by the caller so this module
 * stays free of import cycles.
 *
 * `ownNames` are this command's own name+aliases: they are excluded from
 * BOTH the store and `reserved`, because once a command is registered at
 * runtime its own name appears in the command map and would otherwise be
 * reported as a conflict against itself on every edit.
 */
export function findConflicts(name, aliases, reserved, ignoreName = null, ownNames = []) {
  const store = ensure();
  const out = [];
  const own = new Set(ownNames.map((x) => String(x).toLowerCase()));
  const taken = (candidate) => {
    if (own.has(candidate)) return false;
    if (reserved && reserved.has(candidate)) return true;
    for (const [n, cmd] of Object.entries(store)) {
      if (ignoreName && n === ignoreName) continue;
      if (n === candidate) return true;
      if ((cmd.aliases || []).some((a) => String(a).toLowerCase() === candidate)) return true;
    }
    return false;
  };
  const n = String(name || '').toLowerCase();
  if (n && taken(n)) out.push({ kind: 'name', value: n });
  for (const a of aliases || []) {
    const al = String(a).toLowerCase();
    if (al && taken(al)) out.push({ kind: 'alias', value: al });
  }
  return out;
}

function sanitize(input) {
  const now = new Date().toISOString();
  const L = limits();
  const aliases = (Array.isArray(input.aliases) ? input.aliases : [])
    .map((a) => String(a).trim().toLowerCase())
    .filter(Boolean)
    .filter((a) => a === input.name?.toLowerCase() ? false : true)
    .slice(0, L.maxAliasesPerCommand);
  return {
    name: String(input.name).trim().toLowerCase(),
    aliases,
    description: String(input.description || '').slice(0, L.maxDescriptionLength),
    action: ACTION_TYPES.includes(input.action) ? input.action : 'send_text',
    actionConfig: normalizeActionConfig(input.action, input.actionConfig || {}),
    adminOnly: input.adminOnly === true,
    groupAllowed: input.groupAllowed !== false,
    enabled: input.enabled !== false,
    language: input.language || 'all',
    createdAt: input.createdAt || now,
    createdBy: input.createdBy || 'unknown',
    updatedAt: now,
    updatedBy: input.updatedBy || 'unknown'
  };
}

function normalizeActionConfig(action, cfg) {
  const L = limits();
  switch (action) {
    case 'send_text':
      return { text: String(cfg.text || '').slice(0, L.maxTextActionLength) };
    case 'open_menu':
      return { menuId: String(cfg.menuId || '') };
    case 'invoke_chat_rule':
      return { ruleId: String(cfg.ruleId || '') };
    case 'forward_to_admin':
      return { prefix: String(cfg.prefix || '').slice(0, 200) };
    default:
      return {};
  }
}

export function addCustomCommand(data, reserved) {
  const store = ensure();
  const L = limits();
  if (Object.keys(store).length >= L.maxCommands) {
    return { ok: false, error: 'limit_reached', limit: L.maxCommands };
  }
  if (!isValidName(data.name)) return { ok: false, error: 'invalid_name' };
  const name = data.name.trim().toLowerCase();
  if (store[name]) return { ok: false, error: 'exists' };
  const conflicts = findConflicts(name, data.aliases || [], reserved, null);
  if (conflicts.length) return { ok: false, error: 'conflict', conflicts };
  store[name] = sanitize({ ...data, name });
  writeFile();
  return { ok: true, command: { ...store[name] } };
}

export function updateCustomCommand(name, patch, reserved) {
  const store = ensure();
  const key = String(name || '').toLowerCase();
  const existing = store[key];
  if (!existing) return { ok: false, error: 'not_found' };
  const merged = { ...existing, ...patch, name: patch.name ? String(patch.name).toLowerCase() : key };
  if (patch.name && !isValidName(patch.name)) return { ok: false, error: 'invalid_name' };
  const conflicts = findConflicts(merged.name, merged.aliases || [], reserved, key, [key, ...(existing.aliases || [])]);
  if (conflicts.length) return { ok: false, error: 'conflict', conflicts };
  const nextName = merged.name;
  if (nextName !== key) delete store[key];
  const clean = sanitize(merged);
  clean.createdAt = existing.createdAt;
  clean.createdBy = existing.createdBy;
  store[nextName] = clean;
  writeFile();
  return { ok: true, command: { ...store[nextName] }, renamedFrom: nextName !== key ? key : null };
}

export function deleteCustomCommand(name) {
  const store = ensure();
  const key = String(name || '').toLowerCase();
  if (!store[key]) return { ok: false, error: 'not_found' };
  const removed = store[key];
  delete store[key];
  writeFile();
  return { ok: true, command: { ...removed } };
}

export function toggleCustomCommand(name) {
  const store = ensure();
  const key = String(name || '').toLowerCase();
  if (!store[key]) return { ok: false, error: 'not_found' };
  store[key].enabled = !store[key].enabled;
  store[key].updatedAt = new Date().toISOString();
  writeFile();
  return { ok: true, command: { ...store[key] } };
}

export function exportCustomCommands() {
  return JSON.stringify(ensure(), null, 2);
}

/**
 * Import a JSON document. conflictPolicy: 'skip' | 'rename' | 'overwrite'.
 * `resolveName` (optional) supplies a new name for 'rename' conflicts.
 * Returns a per-command summary; never throws on a single bad entry.
 */
export function importCustomCommands(json, conflictPolicy = 'skip', reserved = null, resolveName = null) {
  const store = ensure();
  let parsed;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  const entries = parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
  const summary = { ok: true, added: 0, skipped: 0, overwritten: 0, errors: [], conflicts: [] };

  // `reserved` holds BUILT-IN names only (custom ones are excluded by the
  // caller), so any conflict found here is a genuine built-in collision.
  const builtinOnly = reserved;

  for (const [rawName, raw] of entries) {
    if (!raw || typeof raw !== 'object') { summary.skipped++; summary.errors.push({ name: rawName, error: 'not_an_object' }); continue; }
    const candidate = { ...raw, name: String(raw.name || rawName) };
    if (!isValidName(candidate.name)) { summary.skipped++; summary.errors.push({ name: String(rawName), error: 'invalid_name' }); continue; }

    const storeHas = Boolean(store[candidate.name.toLowerCase()]);
    const conflicts = findConflicts(candidate.name, candidate.aliases || [], builtinOnly, null);
    // A conflict that only exists because another CUSTOM command owns the name
    // is handled by the policy; only genuinely built-in names block it.
    const builtinConflict = conflicts.filter((c) => builtinOnly.has(c.value));
    const anyConflict = storeHas || conflicts.length > 0;

    if (anyConflict) {
      summary.conflicts.push({ name: candidate.name.toLowerCase(), inFile: storeHas, builtin: builtinConflict.length > 0 });
      if (conflictPolicy === 'skip') { summary.skipped++; continue; }
      if (conflictPolicy === 'overwrite') {
        if (builtinConflict.length > 0) { summary.skipped++; summary.errors.push({ name: candidate.name, error: 'builtin_conflict' }); continue; }
        const key = candidate.name.toLowerCase();
        store[key] = sanitize({ ...store[key], ...candidate, name: key });
        summary.overwritten++;
        continue;
      }
      // rename
      let newName = resolveName ? resolveName(candidate.name) : null;
      if (!newName || !isValidName(newName) || findConflicts(newName, candidate.aliases || [], builtinOnly, null).length) {
        summary.skipped++;
        summary.errors.push({ name: candidate.name, error: 'rename_failed' });
        continue;
      }
      candidate.name = newName;
      store[newName.toLowerCase()] = sanitize(candidate);
      summary.added++;
      continue;
    }
    store[candidate.name.toLowerCase()] = sanitize(candidate);
    summary.added++;
  }
  writeFile();
  return summary;
}

export const __testing = { FILE, DATA_DIR, sanitize, normalizeActionConfig };
