// Sends pending dev-changes entries to admins at startup.
//
// Deliberate detail: when the toggle is off the state is STILL advanced, so
// switching the toggle back on does not replay a backlog of old entries.
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { sendText } from './messageService.js';
import { isBotNotifyEnabled } from '../config/notificationToggles.js';
import { getPendingChanges, saveNotifiedState } from './devChangesService.js';
import { getCurrentVersion } from './changelogService.js';
import { addDraft, getDraftById } from './changelogDraftService.js';
import { suggestVersionBump } from '../utils/versionBump.js';
import { formatSingleChange, formatAggregatedChanges } from '../utils/devChangeFormatter.js';

/**
 * Turn one dev-change into a reviewable draft, or null when a draft for it
 * already exists. The suggested version chains off the *current* changelog
 * version bumped by the change type.
 */
function draftFromChange(change, suggestedVersion, suggestedType) {
  const draftId = 'draft-' + change.id;
  if (getDraftById(draftId)) return null;
  return {
    id: draftId,
    sourceChangeId: change.id,
    version: suggestedVersion,
    type: suggestedType,
    date: new Date().toISOString().slice(0, 10),
    changes: change.changes || [],
    status: 'pending',
    createdAt: new Date().toISOString()
  };
}

/**
 * Create drafts for the given changes, newest first. Each suggestion is based
 * on the version the previous entry would produce, so two pending features
 * don't both suggest the same number.
 * @returns {object[]} the drafts actually created
 */
export function createDraftsFromChanges(changes) {
  const list = Array.isArray(changes) ? changes : [];
  const created = [];
  let version = getCurrentVersion();
  for (const change of list) {
    const type = change.type || 'improvement';
    const bumped = suggestVersionBump(version, type);
    const draft = draftFromChange(change, bumped, type);
    if (draft) {
      addDraft(draft);
      created.push(draft);
    }
    // Advance even when the draft already existed, so numbering stays stable.
    version = bumped;
  }
  return created;
}

export async function notifyPendingDevChanges(sock) {
  const pending = getPendingChanges();
  if (pending.length === 0) {
    logger.info('[DEV_CHANGES] no pending changes');
    return { sent: 0, pending: 0, drafts: 0, skipped: false };
  }

  // Drafts are created regardless of the toggle: the admin review queue is
  // about content, not about whether a notification was pushed.
  const drafts = createDraftsFromChanges(pending);
  if (drafts.length) {
    logger.info({ drafts: drafts.length }, '[DEV_CHANGES] drafts created for review');
  }

  const enabled = isBotNotifyEnabled('onCodeChange');
  if (!enabled) {
    // Mark as seen anyway: a disabled toggle must not build up a backlog.
    saveNotifiedState(pending[0].id);
    logger.info({ pending: pending.length }, '[DEV_CHANGES] notifications disabled; state advanced');
    return { sent: 0, pending: pending.length, drafts: drafts.length, skipped: true };
  }

  const text = pending.length === 1
    ? formatSingleChange(pending[0])
    : formatAggregatedChanges(pending);

  let sent = 0;
  for (const jid of config.adminJids || []) {
    try {
// type 'silent' skips the typing indicator for a machine notification.
        // bypassRateLimit: this is a system notification, not user-facing chat.
        const ok = await sendText(sock, jid, text, { type: 'silent', bypassRateLimit: true });
      if (ok !== false) sent++;
    } catch (err) {
      // One unreachable admin must not stop the others.
      logger.warn({ err, jid }, '[DEV_CHANGES] failed to notify admin');
    }
  }

  saveNotifiedState(pending[0].id);
  logger.info({ pending: pending.length, sent, drafts: drafts.length, aggregated: pending.length > 1 }, '[DEV_CHANGES] notifications sent');
  return { sent, pending: pending.length, drafts: drafts.length, skipped: false };
}