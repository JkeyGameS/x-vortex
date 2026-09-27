import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { toSmallCaps } from '../utils/smallCaps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.join(__dirname, '../../data/exports');

const PROGRESS_FILL = '▰';
const PROGRESS_EMPTY = '▱';

// Ensure the exports directory exists (called at import time and on startup).
export function ensureExportsDir() {
  try {
    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to create exports directory');
  }
}

ensureExportsDir();

function safeStrip(str, max = 40) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function timestampLabel(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Render a progress message with a small-caps status bar.
 * @param {number} percent - 0..100
 * @param {string} label - short stage label (already localized/small-capped)
 * @param {string} heading - '🎉' style prefix or localized heading
 * @param {number} width - bar width in blocks
 * @returns {string} rendered message text
 */
export function buildProgressText(percent, label, opts = {}) {
  const width = opts.width || 10;
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((pct / 100) * width);
  const bar = PROGRESS_FILL.repeat(filled) + PROGRESS_EMPTY.repeat(Math.max(0, width - filled));
  const lines = [];
  if (opts.heading) lines.push(toSmallCaps(opts.heading));
  lines.push('');
  lines.push(toSmallCaps(label || '') + ' `[' + bar + '] ' + pct + '%`');
  lines.push('');
  lines.push(toSmallCaps(opts.footer || 'reply 0 ᴛᴏ ᴄᴀɴᴄᴇʟ'));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Export file CRUD
// ---------------------------------------------------------------------------

function timestampForFilename(ms) {
  return new Date(ms || Date.now()).toISOString().replace(/[:.]/g, '-');
}

/**
 * Write a new export file. Returns the filename.
 * @param {Object} payload - { exportedAt, adminJid, heading, data: { chatRules, faqEntries } }
 * @returns {string} filename
 */
export function writeExport(payload = {}) {
  const now = new Date().toISOString();
  const filename = 'export-' + timestampForFilename(Date.now()) + '.json';
  const data = {
    exportedAt: payload.exportedAt || now,
    adminJid: payload.adminJid || '',
    heading: payload.heading || ('export ' + timestampLabel(Date.now())),
    data: {
      chatRules: Array.isArray(payload.data?.chatRules) ? payload.data.chatRules : [],
      faqEntries: Array.isArray(payload.data?.faqEntries) ? payload.data.faqEntries : []
    }
  };
  try {
    ensureExportsDir();
    fs.writeFileSync(path.join(EXPORTS_DIR, filename), JSON.stringify(data, null, 2));
    return filename;
  } catch (err) {
    logger.warn({ err }, 'Failed to write export file');
    return null;
  }
}

export function listExports() {
  try {
    ensureExportsDir();
    return fs.readdirSync(EXPORTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        let info = null;
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(EXPORTS_DIR, f), 'utf8'));
          info = {
            exportedAt: parsed.exportedAt || '',
            adminJid: parsed.adminJid || '',
            heading: parsed.heading || '',
            chatRules: Array.isArray(parsed.data?.chatRules) ? parsed.data.chatRules.length : 0,
            faqEntries: Array.isArray(parsed.data?.faqEntries) ? parsed.data.faqEntries.length : 0
          };
        } catch (err) {
          logger.warn({ err }, 'Failed to read export meta for ' + f);
        }
        return { filename: f, ...(info || {}) };
      })
      .sort((a, b) => {
        const at = a.exportedAt ? new Date(a.exportedAt).getTime() : 0;
        const bt = b.exportedAt ? new Date(b.exportedAt).getTime() : 0;
        return bt - at;
      });
  } catch (err) {
    logger.warn({ err }, 'Failed to list exports');
    return [];
  }
}

export function readExport(filename) {
  try {
    const full = path.join(EXPORTS_DIR, filename);
    if (!fs.existsSync(full)) return null;
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    logger.warn({ err }, 'Failed to read export ' + filename);
    return null;
  }
}

export function deleteExport(filename) {
  try {
    const full = path.join(EXPORTS_DIR, filename);
    if (!fs.existsSync(full)) return false;
    fs.unlinkSync(full);
    return true;
  } catch (err) {
    logger.warn({ err }, 'Failed to delete export ' + filename);
    return false;
  }
}

export function exportExists(filename) {
  try {
    return fs.existsSync(path.join(EXPORTS_DIR, filename));
  } catch {
    return false;
  }
}

/**
 * Edit the stored heading of an export file without changing its filename.
 * @returns {boolean} true on success
 */
export function setExportHeading(filename, heading) {
  try {
    const full = path.join(EXPORTS_DIR, filename);
    if (!fs.existsSync(full)) return false;
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    const h = String(heading || '').trim();
    if (!h) return false;
    parsed.heading = h;
    fs.writeFileSync(full, JSON.stringify(parsed, null, 2));
    return true;
  } catch (err) {
    logger.warn({ err }, 'Failed to edit export heading ' + filename);
    return false;
  }
}

/**
 * Rename an export file. `newName` may include or omit the `.json` extension.
 * If the target name already exists, the operation fails.
 * @returns {string|null} the new filename, or null on failure
 */
export function renameExport(filename, newName) {
  try {
    const src = path.join(EXPORTS_DIR, filename);
    if (!fs.existsSync(src)) return null;
    let target = String(newName || '').trim();
    if (!target) return null;
    if (!target.endsWith('.json')) target += '.json';
    // Guard against path traversal / weird characters.
    if (/[\\/:*?"<>|]/.test(target) || target.includes('..')) return null;
    const dst = path.join(EXPORTS_DIR, target);
    if (fs.existsSync(dst)) return null;
    fs.renameSync(src, dst);
    return target;
  } catch (err) {
    logger.warn({ err }, 'Failed to rename export ' + filename);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin lock / processing helpers
// ---------------------------------------------------------------------------

/**
 * Update (edit) a progress message in place, with a delete+send fallback.
 * @returns {Promise<string|null>} the message key (or null)
 */
export async function updateProgress({ sock, sender, chatId, key, text }) {
  if (!sock || !sender) return key || null;
  try {
    if (key) {
      await sock.sendMessage(sender, { text, edit: key });
      return key;
    }
    const sent = await sock.sendMessage(sender, { text });
    return sent?.key || null;
  } catch (err) {
    logger.warn({ err }, 'Progress edit failed, falling back to delete + send');
    try {
      if (key) {
        await sock.sendMessage(sender, { delete: key });
      }
    } catch (deleteErr) {
      logger.debug({ err: deleteErr }, 'Progress delete failed');
    }
    const sent = await sock.sendMessage(sender, { text });
    return sent?.key || null;
  }
}

/**
 * Wait for the admin to send `0` to cancel, or up to `timeoutMs`. When the
 * session flag `isProcessing` is cleared (a cancellation or completion),
 * resolution returns immediately.
 *
 * @returns {Promise<boolean>} true if cancelled (admin sent 0), false on timeout
 */
export function waitForCancel({ sessionManager, sender, chatId }, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // De-duplicate across calls: a single shared timer per sender+chatId.
    const key = `${sender}_${chatId}_cancelWait`;
    if (global.__exportCancelWaiters) delete global.__exportCancelWaiters[key];
    const timer = setInterval(() => {
      const session = sessionManager.getSession(sender, chatId) || {};
      if (!session.isProcessing || session.cancelled === true) {
        clearInterval(timer);
        resolve(true); // was cancelled
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false); // timed out, continue
      }
    }, 100);
  });
}
