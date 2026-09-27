import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { filterUsers } from './userService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SEGMENTS_FILE = path.join(DATA_DIR, 'segments.json');

let segments = [];

function load() {
  try {
    if (fs.existsSync(SEGMENTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SEGMENTS_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        segments = parsed.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && s.filters && typeof s.filters === 'object');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load segments from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SEGMENTS_FILE, JSON.stringify(segments, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save segments to disk');
  }
}

load();

function genId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function getSegments() {
  return segments.map((s) => ({ ...s, filters: { ...s.filters } }));
}

export function getSegment(id) {
  const found = segments.find((s) => s.id === id);
  return found ? { ...found, filters: { ...found.filters } } : null;
}

export function createSegment(name, filters = {}) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const entry = { id: genId(), name: clean, filters: { ...filters } };
  segments.push(entry);
  save();
  return { ...entry };
}

export function deleteSegment(id) {
  const idx = segments.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const [removed] = segments.splice(idx, 1);
  save();
  return { ...removed };
}

export async function getUsersInSegment(segmentOrId) {
  const segment = typeof segmentOrId === 'string' ? getSegment(segmentOrId) : segmentOrId;
  if (!segment) return [];
  return filterUsers(segment.filters || {});
}
