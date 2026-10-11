// Best-effort broadcast to every bot admin.
//
// Used by accountService flows (self-delete notices, admin-action notices).
// It never throws and never rejects: a failed admin notification must not
// roll back the action that triggered it, and it must not stall the caller's
// send. Rate limiting is deliberately NOT bypassed here -- these are low
// frequency (one per account deletion), and Section 11 of the spec forbids
// bypassing the limiter.
import config from '../config/config.js';
import logger from './logger.js';

/**
 * Send a message to every configured admin.
 * @param {object} sock baileys socket
 * @param {string} text already-formatted message text
 * @returns {Promise<{sent:number, failed:number}>} delivery counts
 */
export async function notifyAdmins(sock, text) {
  const admins = config.adminJids || [];
  let sent = 0;
  let failed = 0;
  for (const jid of admins) {
    try {
      await sock.sendMessage(jid, { text });
      sent++;
    } catch (err) {
      failed++;
      logger.warn({ err, jid }, '[NOTIFY_ADMINS] send failed');
    }
  }
  return { sent, failed };
}