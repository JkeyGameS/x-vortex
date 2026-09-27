import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const UNMATCHED_FILE = path.join(DATA_DIR, 'unmatched.json');

const MAX_ENTRIES = 100;

let entries = [];

function load() {
  try {
    if (fs.existsSync(UNMATCHED_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(UNMATCHED_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        entries = parsed.filter((e) => e && typeof e.id === 'string' && typeof e.text === 'string');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load unmatched messages from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(UNMATCHED_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save unmatched messages to disk');
  }
}

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

load();

export function logUnmatched(jid, text) {
  const clean = String(text || '').trim().slice(0, 300);
  if (!clean) return null;
  const entry = {
    id: genId(),
    text: clean,
    jid: jid || '-',
    timestamp: new Date().toISOString(),
    resolved: false
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  save();
  return { ...entry };
}

export function getUnmatched(includeResolved = false) {
  const list = includeResolved ? entries : entries.filter((e) => !e.resolved);
  return list.map((e) => ({ ...e })).reverse();
}

export function resolveUnmatched(id) {
  const found = entries.find((e) => e.id === id);
  if (!found) return false;
  found.resolved = true;
  save();
  return true;
}

export function deleteUnmatched(id) {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return false;
  entries.splice(idx, 1);
  save();
  return true;
}

export function clearUnmatched() {
  entries = [];
  save();
}
