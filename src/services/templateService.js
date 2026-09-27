import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

let templates = {};

function load() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        templates = parsed;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load templates from disk');
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save templates to disk');
  }
}

load();

export function getTemplates() {
  return { ...templates };
}

export function getTemplate(name) {
  return templates[name] || null;
}

export function getTemplateNames() {
  return Object.keys(templates);
}

export function getTemplateByIndex(index) {
  const names = Object.keys(templates);
  if (index < 0 || index >= names.length) return null;
  return { name: names[index], text: templates[names[index]] };
}

export function saveTemplate(name, text) {
  if (!name || !text) return false;
  templates[name] = text;
  save();
  return true;
}

export function deleteTemplate(name) {
  if (!(name in templates)) return false;
  delete templates[name];
  save();
  return true;
}
