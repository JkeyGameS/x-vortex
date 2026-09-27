import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import config from '../config/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'typingSettings.json');

export const TYPING_MODES = ['on', 'off', 'instant', 'adaptive'];
export const TYPING_TYPES = ['composing', 'recording'];
export const TYPING_TARGETS = ['mainMenu', 'submenuTransition', 'chatReply', 'confirmation', 'error'];

export function defaultTypingSettings() {
  return {
    globalEnabled: true,
    allowUserOverride: true,
    readReceiptsEnabled: true,
    defaults: {
      mode: 'adaptive',
      delayMs: 600,
      typingType: 'composing',
      readReceipts: true,
      targeting: {
        mainMenu: true,
        submenuTransition: true,
        chatReply: true,
        confirmation: false,
        error: false
      }
    }
  };
}

export function defaultUserTyping() {
  return {
    mode: 'on',
    delayMs: 600,
    typingType: 'composing',
    readReceipts: true,
    targeting: {
      mainMenu: true,
      submenuTransitions: false,
      chatReplies: true,
      confirmations: false,
      errors: false
    }
  };
}

const PRESETS = {
  natural: { mainMenu: true, submenuTransition: false, chatReply: true, confirmation: false, error: false },
  minimal: { mainMenu: false, submenuTransition: false, chatReply: true, confirmation: false, error: false },
  silent: { mainMenu: false, submenuTransition: false, chatReply: false, confirmation: false, error: false }
};

export function typingPreset(name) {
  return PRESETS[name] ? { ...PRESETS[name] } : null;
}

function sanitizeTargeting(value, fallback) {
  const out = { ...fallback };
  if (value && typeof value === 'object') {
    for (const k of TYPING_TARGETS) {
      if (typeof value[k] === 'boolean') out[k] = value[k];
    }
  }
  return out;
}

export function sanitizeUserTyping(value) {
  const d = defaultUserTyping();
  if (!value || typeof value !== 'object') return d;
  const targeting = {};
  const src = value.targeting && typeof value.targeting === 'object' ? value.targeting : {};
  // Accept both admin-style keys (mainMenu, chatReply...) and user-style
  // plural keys (submenuTransitions, chatReplies, confirmations, errors).
  const alias = { mainMenu: 'mainMenu', submenuTransition: 'submenuTransitions', chatReply: 'chatReplies', confirmation: 'confirmations', error: 'errors' };
  for (const [adminKey, userKey] of Object.entries(alias)) {
    if (typeof src[userKey] === 'boolean') targeting[userKey] = src[userKey];
    else if (typeof src[adminKey] === 'boolean') targeting[userKey] = src[adminKey];
    else targeting[userKey] = d.targeting[userKey];
  }
  return {
    mode: TYPING_MODES.includes(value.mode) ? value.mode : d.mode,
    delayMs: Math.min(3000, Math.max(100, Math.floor(Number(value.delayMs) || d.delayMs))),
    typingType: TYPING_TYPES.includes(value.typingType) ? value.typingType : d.typingType,
    readReceipts: value.readReceipts !== false,
    targeting
  };
}

let settings = null;

function load() {
  settings = defaultTypingSettings();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.globalEnabled === 'boolean') settings.globalEnabled = parsed.globalEnabled;
        if (typeof parsed.allowUserOverride === 'boolean') settings.allowUserOverride = parsed.allowUserOverride;
        if (typeof parsed.readReceiptsEnabled === 'boolean') settings.readReceiptsEnabled = parsed.readReceiptsEnabled;
        const d = parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {};
        if (TYPING_MODES.includes(d.mode)) settings.defaults.mode = d.mode;
        if (Number.isFinite(Number(d.delayMs))) settings.defaults.delayMs = Math.min(3000, Math.max(100, Math.floor(Number(d.delayMs))));
        if (TYPING_TYPES.includes(d.typingType)) settings.defaults.typingType = d.typingType;
        if (typeof d.readReceipts === 'boolean') settings.defaults.readReceipts = d.readReceipts;
        settings.defaults.targeting = sanitizeTargeting(d.targeting, settings.defaults.targeting);
      }
    } else {
      save();
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load typing settings');
  }
  return settings;
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save typing settings');
  }
}

load();

export function getTypingSettings() {
  if (!settings) load();
  return JSON.parse(JSON.stringify(settings));
}

function sanitizeValue(key, value) {
  switch (key) {
    case 'globalEnabled':
    case 'allowUserOverride':
    case 'readReceiptsEnabled':
      return value === true;
    case 'mode':
      return TYPING_MODES.includes(value) ? value : 'adaptive';
    case 'delayMs': {
      const n = Math.floor(Number(value) || 0);
      return n > 0 ? Math.min(3000, Math.max(100, n)) : 600;
    }
    case 'typingType':
      return TYPING_TYPES.includes(value) ? value : 'composing';
    case 'readReceipts':
      return value !== false;
    default:
      return undefined;
  }
}

export function updateTypingSetting(key, value) {
  if (!settings) load();
  if (key === 'targeting' && value && typeof value === 'object') {
    settings.defaults.targeting = sanitizeTargeting(value, settings.defaults.targeting);
    save();
    return getTypingSettings();
  }
  if (['globalEnabled', 'allowUserOverride', 'readReceiptsEnabled'].includes(key)) {
    settings[key] = sanitizeValue(key, value);
    save();
    return getTypingSettings();
  }
  if (['mode', 'delayMs', 'typingType', 'readReceipts'].includes(key)) {
    settings.defaults[key] = sanitizeValue(key, value);
    save();
    return getTypingSettings();
  }
  return null;
}

export function toggleTypingTarget(key) {
  if (!settings) load();
  if (!TYPING_TARGETS.includes(key)) return null;
  settings.defaults.targeting[key] = !settings.defaults.targeting[key];
  save();
  return getTypingSettings();
}

export function resetTypingSettings() {
  settings = defaultTypingSettings();
  save();
  return getTypingSettings();
}

export function reloadTypingSettings() {
  return load();
}

export function typingConfigFallbacks() {
  return {
    globalEnabled: config.typingAnimationEnabled !== false,
    allowUserOverride: config.typingAllowUserOverride !== false,
    readReceiptsEnabled: config.typingReadReceiptsEnabled !== false
  };
}
