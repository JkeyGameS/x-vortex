// Sends pending dev-changes entries to admins at startup.
//
// Deliberate detail: when the toggle is off the state is STILL advanced, so
// switching the toggle back on does not replay a backlog of old entries.
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { sendText } from './messageService.js';
import { isBotNotifyEnabled } from '../config/notificationToggles.js';
import { getPendingChanges, saveNotifiedState } from './devChangesService.js';
import { formatSingleChange, formatAggregatedChanges } from '../utils/devChangeFormatter.js';

export async function notifyPendingDevChanges(sock) {
  const pending = getPendingChanges();
  if (pending.length === 0) {
    logger.info('[DEV_CHANGES] no pending changes');
    return { sent: 0, pending: 0, skipped: false };
  }

  const enabled = isBotNotifyEnabled('onCodeChange');
  if (!enabled) {
    // Mark as seen anyway: a disabled toggle must not build up a backlog.
    saveNotifiedState(pending[0].id);
    logger.info({ pending: pending.length }, '[DEV_CHANGES] notifications disabled; state advanced');
    return { sent: 0, pending: pending.length, skipped: true };
  }

  const text = pending.length === 1
    ? formatSingleChange(pending[0])
    : formatAggregatedChanges(pending);

  let sent = 0;
  for (const jid of config.adminJids || []) {
    try {
      // type 'silent' skips the typing indicator for a machine notification.
      const ok = await sendText(sock, jid, text, { type: 'silent' });
      if (ok !== false) sent++;
    } catch (err) {
      // One unreachable admin must not stop the others.
      logger.warn({ err, jid }, '[DEV_CHANGES] failed to notify admin');
    }
  }

  saveNotifiedState(pending[0].id);
  logger.info({ pending: pending.length, sent, aggregated: pending.length > 1 }, '[DEV_CHANGES] notifications sent');
  return { sent, pending: pending.length, skipped: false };
}