import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

let data = { commands: {}, lastUpdated: null };

function load() {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        data = { commands: parsed.commands || {}, lastUpdated: parsed.lastUpdated || null };
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load analytics from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save analytics to disk');
  }
}

load();

export function trackCommand(commandName, jid) {
  if (!commandName) return;
  const cmd = String(commandName).toLowerCase();
  if (!data.commands[cmd]) {
    data.commands[cmd] = { total: 0, users: {} };
  }
  data.commands[cmd].total++;
  if (jid) {
    const uid = String(jid);
    data.commands[cmd].users[uid] = (data.commands[cmd].users[uid] || 0) + 1;
  }
  save();
}

export function getTopCommands(limit = 10) {
  return Object.entries(data.commands)
    .map(([name, info]) => ({
      name,
      total: info.total,
      uniqueUsers: Object.keys(info.users || {}).length
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function getAnalytics() {
  return JSON.parse(JSON.stringify(data));
}

export function resetAnalytics() {
  data = { commands: {}, lastUpdated: null };
  save();
}
