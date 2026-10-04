import { toSmallCaps } from './smallCaps.js';
import config from '../config/config.js';
import logger from './logger.js';

/**
 * Warn bot admins that the outbound rate limiter is throttling the bot.
 *
 * This deliberately calls sock.sendMessage directly rather than going through
 * messageService. Routing it through the guarded wrapper would let a spam
 * warning be suppressed by the very limit it is reporting -- the admin would
 * never learn why the bot went quiet.
 *
 * Emojis are concatenated here in code, never stored in translations.
 */
export async function notifyAdminsRateLimit(sock, count, reason = 'unknown') {
  const admins = (config && config.adminJids) || [];
  if (!admins.length) return 0;

  const text = [
    '\u26A0\uFE0F *' + toSmallCaps('Outbound Rate Limit Active') + '*',
    '',
    toSmallCaps('More than') + ' ' + count + ' ' +
      toSmallCaps('outbound blocks in the last 5 minutes.'),
    toSmallCaps('Last reason') + ': ' + reason,
    '',
    toSmallCaps('The bot is protecting against spam flags.')
  ].join('\n');

  let delivered = 0;
  for (const jid of admins) {
    try {
      await sock.sendMessage(jid, { text });
      delivered++;
    } catch (err) {
      logger.warn({ err, jid }, '[OUTBOUND_RATE_LIMIT] admin warning failed');
    }
  }
  return delivered;
}