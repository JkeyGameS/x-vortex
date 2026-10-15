// Danger Zone sub-states (admin-only).
//
// Options 1 and 2 are thin wrappers: they drop the admin into the exact same
// confirmation states Settings uses, so there is one implementation of the
// reset/delete flow rather than two that can drift. They set
// accountReturnMenu first, which is what makes a cancelled confirmation return
// to the Danger Zone instead of to Settings.
// Option 3 (purge snapshots) is destructive in the other direction: it throws
// away the account snapshots. It gets its own confirmation.
import sessionManager from '../utils/sessionManager.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { logAdminAction } from '../services/adminLogService.js';
import { purgeUserSnapshots, listUserSnapshots } from '../services/accountService.js';

export const PURGE_INTENT = 'danger_purge_confirm';

const CHECK = '\u2705';
const CROSS = '\u274C';

// Same reasoning as settingsHandlers: these are menu-like panels, so they are
// typed as submenu transitions and never flash a typing indicator.
const PANEL_OPTS = { type: 'submenuTransition' };

/** Send a panel/note as a menu transition: no typing indicator. */
function sendPanel(sock, jid, text) {
  return sendText(sock, jid, text, PANEL_OPTS);
}

function setState(context, state, extra = {}) {
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    currentMenu: state,
    confirmAttempts: 0,
    ...extra
  });
}

/**
 * Return to System Settings.
 *
 * This sends the menu directly rather than delegating to
 * handleSystemSettingsReply(context, '0'). That handler's "0" means "back from
 * System Settings", i.e. it calls sendAdminPanel() -- so delegating landed the
 * user in the Admin Panel, two levels up from where they actually were. The
 * Danger Zone declares parent: 'system_settings', so that is where "back" has
 * to mean.
 */
async function backToSystemSettings(context, note) {
  const { sendMenuById } = await import('../utils/menuSender.js');
  const chatId = context.chatId || context.sender;
  sessionManager.setState(context.sender, chatId, {
    currentMenu: null,
    accountReturnMenu: null,
    confirmAttempts: 0
  });
  if (note) await sendPanel(context.sock, context.sender, note);
  const { getUserByJid } = await import('../services/userService.js');
  const user = await getUserByJid(context.sender);
  return sendMenuById(
    'system_settings',
    {
      sock: context.sock,
      sender: context.sender,
      chatId: context.chatId,
      user,
      language: user?.language || context.language
    },
    'system_settings',
    { sessionMenu: 'system_settings' }
  );
}

/** Re-send the Danger Zone menu. Used by purge cancel and purge success. */
async function backToDangerZone(context, note) {
  const { sendMenuById } = await import('../utils/menuSender.js');
  const chatId = context.chatId || context.sender;
  sessionManager.setState(context.sender, chatId, {
    currentMenu: null,
    confirmAttempts: 0
  });
  if (note) await sendPanel(context.sock, context.sender, note);
  const { getUserByJid } = await import('../services/userService.js');
  const user = await getUserByJid(context.sender);
  return sendMenuById(
    'danger_zone',
    {
      sock: context.sock,
      sender: context.sender,
      chatId: context.chatId,
      user,
      language: user?.language || context.language
    },
    'system_settings',
    { sessionMenu: 'danger_zone' }
  );
}

/** Bad input must not eject the user from the panel they are working in. */
async function invalidChoice(context) {
  return sendPanel(context.sock, context.sender,
    '\u274C ' + toSmallCaps('Invalid choice.'));
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
  await sendPanel(context.sock, context.sender, [
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
      return backToDangerZone(context, CROSS + ' ' + toSmallCaps('Cancelled.'));
    }
    // Bad input stays on the purge panel. Bailing out here used to strand the
    // admin in System Settings with no way back and no idea what happened.
    if (value !== '1') {
      await invalidChoice(context);
      return dangerPurgeSnapshots(context);
    }
    const removed = purgeUserSnapshots();
    logAdminAction(context.sender, 'snapshots_purged', String(removed));
    return backToDangerZone(
      context,
      CHECK + ' ' + toSmallCaps('Snapshots purged:') + ' *' + removed + '*'
    );
  }

  if (state === 'danger_zone') {
    if (value === '0') return backToSystemSettings(context);
    if (value === '1') return dangerResetSelf(context);
    if (value === '2') return dangerDeleteSelf(context);
    if (value === '3') return dangerPurgeSnapshots(context);
    await invalidChoice(context);
    return backToDangerZone(context);
  }

  return false;
}