import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function defaultSettings() {
  return {
    maintenanceMode: false,
    reportsEnabled: true,
    adminNotificationsEnabled: true,
    adminPanelLocked: false,
    emergencyBroadcastsDisabled: false,
    sessionSaveEnabled: true,
    sleepAnimationEnabled: true,
    typingIndicatorEnabled: true,
    botName: config.botName || 'X-Vortex',
    conversationEnabled: config.conversationEnabled === true,
    conversationDisabledUntil: null
  };
}

/**
 * Persistent bot settings stored in data/settings.json.
 * Defaults come from config.js and are used when the file is missing.
 */
class SettingsService {
  constructor() {
    this._settings = { ...defaultSettings() };
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(SETTINGS_FILE)) return;
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return;
      this._settings = { ...this._settings, ...parsed };
      logger.info('Settings loaded from disk');
    } catch (err) {
      logger.warn({ err }, 'Failed to load settings from disk');
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this._settings, null, 2));
    } catch (err) {
      logger.warn({ err }, 'Failed to save settings to disk');
    }
  }

  getSettings() {
    return { ...this._settings };
  }

  getBotName() {
    return this._settings.botName || config.botName || 'X-Vortex';
  }

  /** Apply a partial patch and persist. Returns the full (new) settings. */
  updateSettings(patch) {
    if (patch && typeof patch === 'object') {
      this._settings = { ...this._settings, ...patch };
      this._save();
    }
    return { ...this._settings };
  }

  resetSettings() {
    this._settings = { ...defaultSettings() };
    this._save();
    return { ...this._settings };
  }
}

export default new SettingsService();
