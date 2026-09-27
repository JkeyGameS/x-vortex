import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SNIPPETS_FILE = path.join(DATA_DIR, 'snippets.json');

const SUPPORTED_LANGUAGES = ['en', 'fr', 'de', 'es', 'ar'];

const DEFAULT_SNIPPETS = {
  greeting: {
    en: 'Hi {username}! 👋',
    fr: 'Salut {username} ! 👋',
    de: 'Hallo {username}! 👋',
    es: '¡Hola {username}! 👋',
    ar: 'مرحبًا {username}! 👋'
  },
  askAnything: {
    en: 'What else can I help you with?'
  }
};

let snippets = null;

function normalizeEntry(value) {
  if (typeof value === 'string') {
    return value.trim() ? { en: value.trim() } : null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [lang, text] of Object.entries(value)) {
      if (SUPPORTED_LANGUAGES.includes(lang) && typeof text === 'string' && text.trim()) {
        out[lang] = text.trim();
      }
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

function load() {
  try {
    if (fs.existsSync(SNIPPETS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SNIPPETS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        snippets = {};
        let migrated = false;
        for (const [k, v] of Object.entries(parsed)) {
          if (!validName(k)) continue;
          const norm = normalizeEntry(v);
          if (!norm) continue;
          // Migrate legacy flat strings to per-language maps.
          if (typeof v === 'string') migrated = true;
          snippets[k] = norm;
        }
        if (Object.keys(snippets).length) {
          if (migrated) save();
          return;
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load snippets from disk');
  }
  snippets = JSON.parse(JSON.stringify(DEFAULT_SNIPPETS));
  save();
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save snippets to disk');
  }
}

load();

function validName(name) {
  return /^[A-Za-z0-9_]{1,30}$/.test(String(name || ''));
}

export function getSupportedSnippetLanguages() {
  return [...SUPPORTED_LANGUAGES];
}

export function getSnippets() {
  if (!snippets) load();
  return JSON.parse(JSON.stringify(snippets));
}

export function getSnippet(name) {
  if (!snippets) load();
  const entry = snippets[name];
  return entry ? { ...entry } : null;
}

/**
 * Get the best text for a snippet in a language (requested → en → null).
 */
export function getSnippetText(name, language) {
  if (!snippets) load();
  const entry = snippets[name];
  if (!entry) return null;
  if (typeof language === 'string' && entry[language]) return entry[language];
  if (entry.en) return entry.en;
  const first = Object.values(entry)[0];
  return typeof first === 'string' ? first : null;
}

export function setSnippet(name, text, language = 'en') {
  const clean = String(text || '').trim();
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
  if (!validName(name) || !clean) return false;
  if (!snippets) load();
  const entry = { ...(snippets[name] || {}) };
  entry[lang] = clean;
  // Guarantee an English fallback so expansion never silently drops text.
  if (!entry.en) entry.en = clean;
  snippets[name] = entry;
  save();
  return true;
}

export function deleteSnippet(name) {
  if (!snippets) load();
  if (!Object.prototype.hasOwnProperty.call(snippets, name)) return false;
  delete snippets[name];
  save();
  return true;
}

export function deleteSnippetLanguage(name, language) {
  if (!snippets) load();
  const entry = snippets[name];
  if (!entry || !entry[language]) return false;
  if (Object.keys(entry).length <= 1) return false; // keep at least one language
  delete entry[language];
  save();
  return true;
}

export function importSnippets(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
  if (!snippets) load();
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (!validName(k)) continue;
    const norm = normalizeEntry(v);
    if (!norm) continue;
    snippets[k] = norm;
    count++;
  }
  if (count) save();
  return count;
}

/**
 * Legacy expansion entry point. New code should use
 * src/utils/snippetExpander.js (centralized, language-aware).
 */
export function expandSnippets(text, language = 'en') {
  if (!snippets) load();
  let out = String(text || '');
  for (let depth = 0; depth < 3; depth++) {
    let changed = false;
    out = out.replace(/\{snippet:([A-Za-z0-9_]{1,30})\}/g, (m, name) => {
      const snippetText = getSnippetText(name, language);
      if (snippetText != null) {
        changed = true;
        return snippetText;
      }
      return m;
    });
    if (!changed) break;
  }
  return out;
}
