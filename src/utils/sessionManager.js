import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import logger from './logger.js';
import { toSmallCaps } from './smallCaps.js';
import settingsService from '../services/settingsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const SESSION_TIMEOUT_MS = (config.sessionTimeoutMinutes || 5) * 60 * 1000;

function buildSessionClosedText() {
  return [
    `❌ ${toSmallCaps('Session closed')}`,
    toSmallCaps('Send /start to reopen the menu.')
  ].join('\n');
}

class SessionManager {
  constructor() {
    this.sessions = new Map(); // key: `${sender}_${chatId}`, value: state object
    this.sock = null;
    this._loadSessions();
  }

  setSock(sock) {
    this.sock = sock;
  }

  /**
   * Load persisted sessions from disk into the in-memory Map, restoring
   * `currentMenu`, `lastMenuKey`, `editCount`, `pendingAction`, `pendingData`,
   * `helpFrom`, `tutorialFrom`, etc. Timers are not restored; they are
   * re-scheduled on the next `touch`/`setState`. Expired sessions are dropped.
   */
  _loadSessions() {
    try {
      if (!fs.existsSync(SESSIONS_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      const now = Date.now();
      for (const [key, state] of Object.entries(raw)) {
        if (!state || typeof state !== 'object') continue;
        if (!state.isSleeping && now - (state.lastActivity || 0) > SESSION_TIMEOUT_MS) continue; // expired
        delete state._timer;
        this.sessions.set(key, state);
      }
      logger.info({ restored: this.sessions.size }, 'Sessions restored from disk');
    } catch (err) {
      logger.warn({ err }, 'Failed to restore sessions from disk');
    }
  }

  /** Persist the current sessions map to disk (without unserializable `_timer`). */
  _save() {
    try {
      // Session save can be disabled via the System Settings toggle.
      if (settingsService.getSettings().sessionSaveEnabled === false) return;
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const plain = {};
      for (const [key, state] of this.sessions) {
        const copy = { ...state };
        delete copy._timer;
        plain[key] = copy;
      }
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(plain, null, 2));
    } catch (err) {
      logger.warn({ err }, 'Failed to save sessions to disk');
    }
  }

  _scheduleTimeout(sender, chatId) {
    const key = `${sender}_${chatId}`;
    const session = this.sessions.get(key);
    if (!session) return;
    if (session._timer) clearTimeout(session._timer);
    if (session.isSleeping) {
      session._timer = null;
      return;
    }
    session._timer = setTimeout(
      () => this._closeIfIdle(sender, chatId, session.lastActivity),
      SESSION_TIMEOUT_MS
    );
  }

  goToMain(sender, chatId) {
    const key = `${sender}_${chatId}`;
    this.sessions.set(key, {
      ...this.sessions.get(key),
      currentMenu: 'main',
      lastActivity: Date.now()
    });
    this._scheduleTimeout(sender, chatId);
    this._save();
    return this.sessions.get(key);
  }

  setState(sender, chatId, state) {
    const key = `${sender}_${chatId}`;
    this.sessions.set(key, {
      ...this.sessions.get(key),
      ...state,
      lastActivity: Date.now()
    });
    this._scheduleTimeout(sender, chatId);
    this._save();
  }

  touch(sender, chatId) {
    const key = `${sender}_${chatId}`;
    const session = this.sessions.get(key);
    if (!session) return;
    session.lastActivity = Date.now();
    this.sessions.set(key, session);
    this._scheduleTimeout(sender, chatId);
    this._save();
  }

  getSession(sender, chatId) {
    const key = `${sender}_${chatId}`;
    const session = this.sessions.get(key);
    if (!session) return { currentMenu: null };
    if (Date.now() - (session.lastActivity || 0) > SESSION_TIMEOUT_MS) {
      if (session.isTestActive && session.testSession?.testUserJid) {
        const preserved = {
          ...session,
          currentMenu: null,
          lastMenuKey: session.lastMenuKey || null,
          editCount: 0,
          pendingAction: null,
          pendingData: null,
          lastActivity: Date.now(),
          _timer: null
        };
        this.sessions.set(key, preserved);
        this._save();
        return preserved;
      }
      this.clear(sender, chatId);
      return { currentMenu: null };
    }
    return session;
  }

  _closeIfIdle(sender, chatId, expectedLastActivity) {
    const key = `${sender}_${chatId}`;
    const session = this.sessions.get(key);
    // Session gone, or user became active again (timer was reset) → do nothing.
    if (!session || session.lastActivity !== expectedLastActivity) return;
    this._closeSession(sender, chatId);
  }

  async _closeSession(sender, chatId) {
    const key = `${sender}_${chatId}`;
    const session = this.sessions.get(key);
    const lastMenuKey = session?.lastMenuKey || null;
    const text = buildSessionClosedText();
    let replacementKey = lastMenuKey;

    if (this.sock && lastMenuKey) {
      try {
        await this.sock.sendMessage(chatId, { text, edit: lastMenuKey });
      } catch (err) {
        logger.warn({ err }, 'Session close edit failed, falling back to delete + send');
        try {
          await this.sock.sendMessage(chatId, { delete: lastMenuKey });
        } catch (deleteErr) {
          logger.warn({ err: deleteErr }, 'Session close delete failed, sending new message');
        }
        const sent = await this.sock.sendMessage(chatId, { text });
        replacementKey = sent?.key || null;
      }
    } else if (this.sock) {
      const sent = await this.sock.sendMessage(chatId, { text });
      replacementKey = sent?.key || null;
    }

    if (session?.isTestActive && session.testSession?.testUserJid) {
      const preserved = {
        ...session,
        currentMenu: null,
        lastMenuKey: replacementKey,
        editCount: 0,
        pendingAction: null,
        pendingData: null,
        lastActivity: Date.now(),
        _timer: null
      };
      this.sessions.set(key, preserved);
    } else {
      this.sessions.delete(key);
    }
    this._save();
  }

  clear(sender, chatId) {
    const key = `${sender}_${chatId}`;
    const session = this.sessions.get(key);
    if (session?._timer) clearTimeout(session._timer);
    this.sessions.delete(key);
    this._save();
  }

  /** Snapshot of all live sessions as [{ key, state }]. */
  listSessions() {
    return [...this.sessions.entries()].map(([key, state]) => ({ key, state }));
  }

  /** Drop a session by its internal key. Returns true when removed. */
  clearByKey(key) {
    const session = this.sessions.get(key);
    if (!session) return false;
    if (session?._timer) clearTimeout(session._timer);
    this.sessions.delete(key);
    this._save();
    return true;
  }
}

export default new SessionManager();