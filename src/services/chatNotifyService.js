import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from './localeService.js';
import config from '../config/config.js';
import { getUserByJidSync } from './userService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const REQUESTS_FILE = path.join(DATA_DIR, 'chatNotifyRequests.json');

let sock = null;

function loadRequests() {
  try {
    if (!fs.existsSync(REQUESTS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((jid) => typeof jid === 'string' && jid.length > 0);
  } catch (err) {
    logger.warn({ err }, 'Failed to load chat notify requests from disk');
    return [];
  }
}

function saveRequests(requests) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save chat notify requests to disk');
  }
}

export function setSock(socket) {
  sock = socket;
}

/**
 * Register a user who wants to be notified when the conversational chat is
 * available again.
 * @param {string} jid
 * @param {function} [notifyFn]
 * @returns {Promise<boolean>} true when the request was stored
 */
export async function addRequest(jid) {
  if (!jid) return false;
  const requests = loadRequests();
  if (!requests.includes(jid)) {
    requests.push(jid);
    saveRequests(requests);
  }
  return true;
}

export async function removeRequest(jid) {
  const requests = loadRequests().filter((x) => x !== jid);
  saveRequests(requests);
  return requests;
}

export async function getRequests() {
  const requests = loadRequests();
  // Drop JIDs that no longer correspond to a known user (they may have been
  // purged); keep the stored list tidy.
  return requests;
}

export async function clearRequests() {
  saveRequests([]);
  return [];
}

export function hasRequests() {
  return loadRequests().length > 0;
}

/**
 * Notify every user who asked to be reached when the chat is available, then
 * clear the waitlist. Returns the list of JIDs that were notified.
 */
export async function notifyWaitingUsers() {
  const requests = loadRequests();
  let notified = 0;
  for (const jid of requests) {
    try {
      if (sock) {
        const language = getUserByJidSync(jid)?.language || config.defaultLanguage;
        const text = '✅ ' + toSmallCaps(t(language, 'conversation.chatAvailable'));
        await sock.sendMessage(jid, { text });
        notified++;
      }
    } catch (err) {
      logger.error({ err, jid }, '[CHAT_NOTIFY] failed to notify user');
    }
  }
  if (!sock && notified === 0) {
    logger.warn({ requests: requests.length }, '[CHAT_NOTIFY] no socket, availability notification dropped');
  }
  saveRequests([]);
  return requests;
}