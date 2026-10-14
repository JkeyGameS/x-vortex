// User-facing Reset / Delete account flows.
//
// Both live under the Settings menu and are also reachable as /reset and
// /delete (see accountCommands.js). The Danger Zone reuses the same entry
// points with an admin actor.
//
// Flow shape for each operation:
//   *_intent  -> "here is what this does, do you want it?"   (1 yes / 2 no / 0 back)
//   *_word    -> "type RESET to confirm"                     (word / 0 back)
//
// Two wrong confirmation words auto-cancel, so a stray message cannot leave a
// user parked in a destructive prompt. Every state returns true; the router
// must never fall through to chat rules from here.
import sessionManager from '../utils/sessionManager.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { getUserByJid } from '../services/userService.js';
import config from '../config/config.js';
import { resetAccount, deleteAccount, isLastBotAdmin } from '../services/accountService.js';
import { notifyAdmins } from '../utils/notifyAdmins.js';

export const RESET_INTENT = 'settings_reset_confirm_intent';
export const RESET_WORD = 'settings_reset_confirm_word';
export const DELETE_INTENT = 'settings_delete_confirm_intent';
export const DELETE_WORD = 'settings_delete_confirm_word';

export const CONFIRM_STATES = [RESET_INTENT, RESET_WORD, DELETE_INTENT, DELETE_WORD];

const CHECK = '\u2705';
const CROSS = '\u274C';

function languageOf(context) {
  return context.user?.language || context.language || 'en';
}

function setState(context, state, extra = {}) {
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    currentMenu: state,
    confirmAttempts: 0,
    ...extra
  });
}

/**
 * Where a cancelled confirmation should send the user back to.
 *
 * These confirmation states are shared by two entry points: the user's own
 * Settings menu, and the admin Danger Zone (dangerResetSelf / dangerDeleteSelf
 * set accountReturnMenu before delegating here). Without this, cancelling from
 * the Danger Zone dropped the admin into Settings -- a menu they did not open
 * and, being admin-only flows, one they were never on.
 *
 * The origin is read from the live session rather than from context.session,
 * because setState merges and the caller's snapshot of the session can be
 * stale by the time a later keystroke arrives. It is cleared immediately after
 * reading so the next flow starts from the default.
 *
 * @param {object} context
 * @returns {Promise<'danger_zone'|'settings'>} the menu id to re-send
 */
async function backToAccountOrigin(context, note) {
  const chatId = context.chatId || context.sender;
  const live = sessionManager.getSession(context.sender, chatId) || {};
  const origin = live.accountReturnMenu === 'danger_zone' ? 'danger_zone' : 'settings';
  sessionManager.setState(context.sender, chatId, {
    currentMenu: null,
    accountReturnMenu: null,
    confirmAttempts: 0
  });
  if (note) await sendText(context.sock, context.sender, note);

  const { sendMenuById } = await import('../utils/menuSender.js');
  const { getUserByJid } = await import('../services/userService.js');
  const user = await getUserByJid(context.sender);
  return sendMenuById(
    origin,
    {
      sock: context.sock,
      sender: context.sender,
      chatId: context.chatId,
      user,
      language: user?.language || context.language
    },
    origin === 'danger_zone' ? 'system_settings' : 'main_to_settings',
    { sessionMenu: origin }
  );
}

/** A snapshot that cannot be written means the data is gone for good. */
function snapshotFailedNotice() {
  return CROSS + ' ' + toSmallCaps('Operation failed.')
    + '\n\n' + toSmallCaps('Nothing was changed. Please try again later.');
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetPanel() {
  return [
    '> *\u267B\uFE0F ' + toSmallCaps('Reset account') + '*',
    '',
    toSmallCaps('This will clear:'),
    '',
    '\u2699\uFE0F ' + toSmallCaps('Settings & preferences'),
    '\uD83D\uDCCA ' + toSmallCaps('Statistics & history'),
    '\uD83D\uDC65 ' + toSmallCaps('Group membership data'),
    '\uD83D\uDD14 ' + toSmallCaps('Notification requests'),
    '\uD83D\uDCDA ' + toSmallCaps('Tutorial progress'),
    '',
    toSmallCaps('Will be kept:'),
    '',
    '\uD83C\uDD11 ' + toSmallCaps('Your user id'),
    '\uD83C\uDF0D ' + toSmallCaps('Your language'),
    '',
    `1. ${CHECK} ` + toSmallCaps('Reset my account'),
    `2. ${CROSS} ` + toSmallCaps('Cancel'),
    '',
    `0. ` + toSmallCaps('Back')
  ].join('\n');
}

function resetWordPrompt() {
  const word = config.account?.confirmationWordReset || 'RESET';
  return [
    toSmallCaps('Type') + ' *' + word + '* ' + toSmallCaps('to confirm.'),
    toSmallCaps('Or send 0 to cancel.'),
    '',
    `0. ` + toSmallCaps('Back')
  ].join('\n');
}

function resetSuccess() {
  return [
    CHECK + ' ' + toSmallCaps('Account reset.'),
    '',
    toSmallCaps('All preferences and stats are clear.'),
    toSmallCaps('Send /start to reach the menu.')
  ].join('\n');
}

export async function settingsResetAccount(context) {
  setState(context, RESET_INTENT);
  await sendText(context.sock, context.sender, resetPanel());
  return true;
}

async function onResetIntent(context, input) {
  if (input === '0') return backToAccountOrigin(context);
  if (input === '2') return backToAccountOrigin(context, CROSS + ' ' + toSmallCaps('Cancelled.'));
  if (input !== '1') return backToAccountOrigin(context);
  setState(context, RESET_WORD);
  await sendText(context.sock, context.sender, resetWordPrompt());
  return true;
}

async function onResetWord(context, input) {
  const language = languageOf(context);
  if (input === '0' || input === '2') return backToAccountOrigin(context, CROSS + ' ' + toSmallCaps('Cancelled.'));

  const word = (config.account?.confirmationWordReset || 'RESET').toLowerCase();
  if (input.trim().toLowerCase() === word) {
    const result = await resetAccount(context.sender, {
      actorJid: context.sender,
      pushName: context.pushName
    });
    if (!result.success) {
      await sendText(context.sock, context.sender, snapshotFailedNotice());
      return backToAccountOrigin(context);
    }
    sessionManager.setState(context.sender, context.chatId || context.sender, {
      currentMenu: 'main',
      confirmAttempts: 0
    });
    await sendText(context.sock, context.sender, resetSuccess());
    return true;
  }
  return wrongAttempt(context, RESET_WORD, resetWordPrompt, language);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function deletePanel() {
  return [
    '> *\uD83D\uDDD1\uFE0F ' + toSmallCaps('Delete account') + '*',
    '',
    toSmallCaps('This will permanently remove:'),
    '',
    '\uD83D\uDC64 ' + toSmallCaps('Your profile & name'),
    '\u2699\uFE0F ' + toSmallCaps('All settings & preferences'),
    '\uD83D\uDCCA ' + toSmallCaps('All statistics'),
    '\uD83D\uDC65 ' + toSmallCaps('All group data'),
    '\uD83D\uDCEA ' + toSmallCaps('Your feedback (anonymized, not deleted)'),
    '',
    '\u26A0\uFE0F ' + toSmallCaps('This action cannot be undone.'),
    '',
    `1. ${CHECK} ` + toSmallCaps('Delete my account'),
    `2. ${CROSS} ` + toSmallCaps('Cancel'),
    '',
    `0. ` + toSmallCaps('Back')
  ].join('\n');
}

function deleteWordPrompt() {
  const word = config.account?.confirmationWordDelete || 'DELETE';
  return [
    toSmallCaps('Type') + ' *' + word + '* ' + toSmallCaps('to confirm permanent deletion.'),
    toSmallCaps('Or send 0 to cancel.'),
    '',
    `0. ` + toSmallCaps('Back')
  ].join('\n');
}

function deleteSuccess() {
  return [
    CHECK + ' ' + toSmallCaps('Your account has been deleted.'),
    '',
    toSmallCaps('Send /start to register again.')
  ].join('\n');
}

function lastAdminBlock() {
  return [
    '\u26A0\uFE0F ' + toSmallCaps('You are the only bot admin.'),
    '',
    toSmallCaps('Deleting your account would leave the bot without admins.'),
    '',
    `1. ` + toSmallCaps('Add another admin first'),
    `0. ` + toSmallCaps('Back')
  ].join('\n');
}

export async function settingsDeleteAccount(context) {
  setState(context, DELETE_INTENT);
  await sendText(context.sock, context.sender, deletePanel());
  return true;
}

async function onDeleteIntent(context, input) {
  if (input === '0' || input === '2') return backToAccountOrigin(context, CROSS + ' ' + toSmallCaps('Cancelled.'));
  if (input !== '1') return backToAccountOrigin(context);
  if (isLastBotAdmin(context.sender)) {
    setState(context, DELETE_INTENT);
    await sendText(context.sock, context.sender, lastAdminBlock());
    return true;
  }
  setState(context, DELETE_WORD);
  await sendText(context.sock, context.sender, deleteWordPrompt());
  return true;
}

async function onDeleteWord(context, input) {
  if (input === '0' || input === '2') return backToAccountOrigin(context, CROSS + ' ' + toSmallCaps('Cancelled.'));

  const word = (config.account?.confirmationWordDelete || 'DELETE').toLowerCase();
  if (input.trim().toLowerCase() === word) {
    if (isLastBotAdmin(context.sender)) {
      await sendText(context.sock, context.sender, lastAdminBlock());
      setState(context, DELETE_INTENT);
      return true;
    }
    const user = await getUserByJid(context.sender);
    const name = context.pushName || user?.name || context.sender;
    const result = await deleteAccount(context.sender, { actorJid: context.sender });
    if (!result.success) {
      await sendText(context.sock, context.sender, snapshotFailedNotice());
      return backToAccountOrigin(context);
    }
    sessionManager.clear(context.sender, context.chatId || context.sender);
    await sendText(context.sock, context.sender, deleteSuccess());

    if (config.account?.notifyAdminsOnDelete) {
      const stamp = new Date().toISOString();
      await notifyAdmins(context.sock, [
        '\uD83D\uDDD1\uFE0F *' + toSmallCaps('User deleted') + '*',
        '',
        '\uD83C\uDD11 ' + context.sender,
        '\uD83D\uDCDB ' + name,
        '\uD83D\uDD52 ' + stamp,
        '',
        '_' + toSmallCaps('Via self-deletion') + '_'
      ].join('\n'));
    }
    return true;
  }
  return wrongAttempt(context, DELETE_WORD, deleteWordPrompt, languageOf(context));
}

// ---------------------------------------------------------------------------
// Shared: wrong-word throttle
// ---------------------------------------------------------------------------

/**
 * Count a wrong confirmation word. Two strikes (configurable) auto-cancels
 * back to Settings so a confused user is not stuck re-typing forever.
 */
async function wrongAttempt(context, state, promptFn) {
  const max = config.account?.maxWrongConfirmAttempts || 2;
  const attempts = (Number(context.session?.confirmAttempts) || 0) + 1;
  if (attempts >= max) {
    await backToAccountOrigin(context, CROSS + ' ' + toSmallCaps('Too many attempts. Cancelled.'));
    return true;
  }
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    currentMenu: state,
    confirmAttempts: attempts
  });
  await sendText(context.sock, context.sender, promptFn());
  return true;
}

// ---------------------------------------------------------------------------
// Dispatcher for the four confirm states
// ---------------------------------------------------------------------------

/**
 * Handle one input while sitting in a settings reset/delete confirmation state.
 * Always returns true so the router cannot reach chat rules.
 *
 * @param {object} context { sock, sender, chatId, pushName, user, session }
 * @param {string} state session.currentMenu
 * @param {string} input trimmed message text
 * @returns {Promise<boolean>} true when the state owned the input
 */
export async function handleAccountConfirmReply(context, state, input) {
  const value = String(input ?? '').trim();
  if (state === RESET_INTENT) return onResetIntent(context, value);
  if (state === RESET_WORD) return onResetWord(context, value);
  if (state === DELETE_INTENT) return onDeleteIntent(context, value);
  if (state === DELETE_WORD) return onDeleteWord(context, value);
  return false;
}

/** True when this state belongs to the reset/delete confirmation flow. */
export function isAccountConfirmState(state) {
  return CONFIRM_STATES.includes(state);
}