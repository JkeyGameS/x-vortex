import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const REGISTRY_FILE = path.join(DATA_DIR, 'contextRegistry.json');

function validName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(name.trim());
}

function load() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load context registry');
  }
  return {};
}

function save(registry) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save context registry');
  }
}

export function getContexts() {
  return load();
}

export function hasContext(name) {
  if (!validName(name)) return false;
  return Object.prototype.hasOwnProperty.call(load(), name.trim());
}

export function registerContext(name, { description = '', createdBy = '' } = {}) {
  const clean = String(name || '').trim();
  if (!validName(clean)) return null;
  const registry = load();
  if (!registry[clean]) {
    registry[clean] = {
      description: String(description || '').slice(0, 200),
      createdBy: String(createdBy || ''),
      createdAt: new Date().toISOString()
    };
    save(registry);
  }
  return clean;
}

export function renameContext(oldName, newName) {
  const registry = load();
  if (!registry[oldName] || !validName(newName)) return false;
  const clean = newName.trim();
  if (registry[clean]) return false;
  registry[clean] = registry[oldName];
  delete registry[oldName];
  save(registry);
  return true;
}

export function deleteContext(name) {
  const registry = load();
  if (!registry[name]) return false;
  delete registry[name];
  save(registry);
  return true;
}

export function isValidContextName(name) {
  return validName(name);
}
