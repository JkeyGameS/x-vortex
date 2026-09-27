import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const RESPONSE_TIMES_FILE = path.join(DATA_DIR, 'responseTimes.json');

const MAX_ENTRIES = 1000;

let samples = [];

function load() {
  try {
    if (fs.existsSync(RESPONSE_TIMES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RESPONSE_TIMES_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        samples = parsed.filter((s) => s && typeof s.command === 'string' && typeof s.durationMs === 'number');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load response times from disk');
  }
}

let saveTimer = null;

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(RESPONSE_TIMES_FILE, JSON.stringify(samples, null, 2));
    } catch (err) {
      logger.warn({ err }, 'Failed to save response times to disk');
    }
  }, 5000);
  if (saveTimer.unref) saveTimer.unref();
}

load();

export function recordResponseTime(command, durationMs) {
  if (!command || typeof durationMs !== 'number' || durationMs < 0) return;
  samples.push({ command: String(command).toLowerCase(), durationMs: Math.round(durationMs), timestamp: new Date().toISOString() });
  if (samples.length > MAX_ENTRIES) {
    samples = samples.slice(-MAX_ENTRIES);
  }
  saveSoon();
}

function summarize(list) {
  if (!list.length) return { avg: 0, min: 0, max: 0, count: 0 };
  let sum = 0;
  let min = Infinity;
  let max = 0;
  for (const s of list) {
    sum += s.durationMs;
    if (s.durationMs < min) min = s.durationMs;
    if (s.durationMs > max) max = s.durationMs;
  }
  return { avg: Math.round(sum / list.length), min, max, count: list.length };
}

export function getStats() {
  return summarize(samples);
}

export function getPerCommandStats(limit = 10) {
  const byCommand = {};
  for (const s of samples) {
    (byCommand[s.command] = byCommand[s.command] || []).push(s);
  }
  return Object.entries(byCommand)
    .map(([command, list]) => ({ command, ...summarize(list) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, limit);
}

export function clearResponseTimes() {
  samples = [];
  saveSoon();
}
