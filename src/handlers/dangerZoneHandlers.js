// Danger Zone sub-states (admin-only).
//
// Options 1 and 2 are thin wrappers: they drop the admin into the exact same
// confirmation states Settings uses, so there is one implementation of the
// reset/delete flow rather than two that can drift. The difference is the
// back target -- from the Danger Zone, 0 returns to System Settings.
//
// Option 3 (purge snapshots) is destructive in the other direction: it throws
// away the Part 2 restore material. It gets its own confirmation.
import sessionManager from '../utils/sessionManager.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { logAdminAction } from '../services/adminLogService.js';
import { purgeUserSnapshots, listUserSnapshots } from '../services/accountService.js';

export const PURGE_INTENT = 'danger_purge_confirm';

const CHECK = '\u2705';
const CROSS = '\u274C';

function setState(context, state, extra = {}) {
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    currentMenu: state,
    confirmAttempts: 0,
    ...extra
  });
}

async function backToSystemSettings(context, note) {
  const { handleSystemSettingsReply } = await import('./adminCommand.js');
  if (note) await sendText(context.sock, context.sender, note);
  return handleSystemSettingsReply(context, '0');
}

/** Enter the shared reset flow but remember we came from the Danger Zone. */
export async function dangerResetSelf(context) {
  const { settingsResetAccount } = await import('./settingsHandlers.js');
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    accountReturnMenu: 'danger_zone'
  });
  return settingsResetAccount(context);
}

export async function dangerDeleteSelf(context) {
  const { settingsDeleteAccount } = await import('./settingsHandlers.js');
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    accountReturnMenu: 'danger_zone'
  });
  return settingsDeleteAccount(context);
}

export async function dangerPurgeSnapshots(context) {
  const count = listUserSnapshots().length;
  setState(context, PURGE_INTENT);
  await sendText(context.sock, context.sender, [
    '> *\uD83D\uDDF9 ' + toSmallCaps('Purge snapshots') + '*',
    '',
    toSmallCaps('This deletes every user snapshot in'),
    '`data/snapshots/users/`',
    '',
    '\u26A0\uFE0F ' + toSmallCaps('Restoring an account afterwards will be impossible.'),
    '',
    toSmallCaps('Snapshots currently stored:') + ' *' + count + '*',
    '',
    `1. ${CHECK} ` + toSmallCaps('Purge all snapshots'),
    `2. ${CROSS} ` + toSmallCaps('Cancel'),
    '',
    `0. ` + toSmallCaps('Back')
  ].join('\n'));
  return true;
}

/**
 * Handle one input in the Danger Zone or its purge confirmation.
 * @returns {Promise<boolean>} true when the state owned the input
 */
export async function handleDangerZoneReply(context, state, input) {
  const value = String(input ?? '').trim();

  if (state === PURGE_INTENT) {
    if (value === '0' || value === '2') {
      return backToSystemSettings(context, CROSS + ' ' + toSmallCaps('Cancelled.'));
    }
    if (value !== '1') return backToSystemSettings(context);
    const removed = purgeUserSnapshots();
    logAdminAction(context.sender, 'snapshots_purged', String(removed));
    return backToSystemSettings(
      context,
      CHECK + ' ' + toSmallCaps('Snapshots purged:') + ' *' + removed + '*'
    );
  }

  if (state === 'danger_zone') {
    if (value === '0') return backToSystemSettings(context);
    if (value === '1') return dangerResetSelf(context);
    if (value === '2') return dangerDeleteSelf(context);
    if (value === '3') return dangerPurgeSnapshots(context);
    const { sendMenuById } = await import('../utils/menuSender.js');
    return sendMenuById('danger_zone', {
      sock: context.sock,
      sender: context.sender,
      chatId: context.chatId,
      user: context.user,
      language: context.user?.language || context.language
    }, 'system_settings');
  }

  return false;
}