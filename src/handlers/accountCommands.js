// Account lifecycle commands.
//
// /reset and /delete are user-facing and open the same confirmation states as
// Settings > Reset / Delete. /resetuser and /deleteuser are admin-only and act
// on someone else.
//
// Both admin commands re-check isLastBotAdmin on the TARGET at execute time,
// not just at confirm time: the admin list can change between the two steps.
import config from '../config/config.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { resetAccount, deleteAccount, isLastBotAdmin } from '../services/accountService.js';
import { settingsResetAccount, settingsDeleteAccount } from './settingsHandlers.js';

const CONFIRM_KEY = 'accountCommandConfirm';

function usage(context, text) {
  return sendText(context.sock, context.sender, text);
}

/**
 * Two-step admin confirmation for /resetuser and /deleteuser.
 * State lives in the session as accountCommandConfirm = {action, jid}.
 */
async function confirmOrRun(context, action, jid) {
  const session = await import('../utils/sessionManager.js');
  const pending = session.default.getSession(context.sender, context.chatId || context.sender);
  if (pending?.[CONFIRM_KEY] && pending[CONFIRM_KEY].action === action && pending[CONFIRM_KEY].jid === jid) {
    session.default.setState(context.sender, context.chatId || context.sender, { [CONFIRM_KEY]: null });
    return runAdminAction(context, action, jid);
  }
  session.default.setState(context.sender, context.chatId || context.sender, {
    [CONFIRM_KEY]: { action, jid }
  });
  const verb = action === 'reset' ? 'Reset' : 'Delete';
  return sendText(context.sock, context.sender, [
    `⚠️ *${toSmallCaps(verb + ' this user?') }*`,
    '',
    '🆔 ' + jid,
    '',
    toSmallCaps('Send the command again to confirm.'),
    toSmallCaps('Send 0 to cancel.')
  ].join('\n'));
}

async function cancelPending(context) {
  const session = (await import('../utils/sessionManager.js')).default;
  const pending = session.getSession(context.sender, context.chatId || context.sender);
  if (!pending?.[CONFIRM_KEY]) return false;
  session.setState(context.sender, context.chatId || context.sender, { [CONFIRM_KEY]: null });
  await sendText(context.sock, context.sender, '❌ ' + toSmallCaps('Cancelled.'));
  return true;
}

async function runAdminAction(context, action, jid) {
  if (action === 'delete' && isLastBotAdmin(jid)) {
    return sendText(context.sock, context.sender,
      '⚠️ ' + toSmallCaps('That user is the only bot admin and cannot be deleted.'));
  }
  const result = action === 'reset'
    ? await resetAccount(jid, { actorJid: context.sender })
    : await deleteAccount(jid, { actorJid: context.sender });
  if (!result.success) {
    return sendText(context.sock, context.sender,
      '❌ ' + toSmallCaps('Operation failed. Nothing was changed.'));
  }
  return sendText(context.sock, context.sender,
    '✅ ' + toSmallCaps(action === 'reset' ? 'User reset.' : 'User deleted.'));
}

export const command = {
  name: 'reset',
  description: 'Reset your account',
  usage: '/reset',
  aliases: ['resetaccount'],
  adminOnly: false,
  groupAllowed: false,
  async execute(context) {
    if (!config.account?.resetEnabled) {
      return sendText(context.sock, context.sender, '❌ ' + toSmallCaps('Account reset is disabled.'));
    }
    return settingsResetAccount(context);
  }
};

export const commands = [
  command,
  {
    name: 'delete',
    description: 'Delete your account',
    usage: '/delete',
    aliases: ['deleteaccount'],
    adminOnly: false,
    groupAllowed: false,
    async execute(context) {
      if (!config.account?.deleteEnabled) {
        return sendText(context.sock, context.sender, '❌ ' + toSmallCaps('Account deletion is disabled.'));
      }
      return settingsDeleteAccount(context);
    }
  },
  {
    name: 'resetuser',
    description: "Reset another user's account",
    usage: '/resetuser <jid>',
    aliases: [],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const jid = context.args?.[0];
      if (!jid) return usage(context, toSmallCaps('Usage:') + ' /resetuser <jid>');
      if (jid === context.sender) return usage(context, toSmallCaps('Use /reset to reset your own account.'));
      if (String(context.text || '').trim() === '0' && await cancelPending(context)) return true;
      return confirmOrRun(context, 'reset', jid);
    }
  },
  {
    name: 'deleteuser',
    description: "Delete another user's account",
    usage: '/deleteuser <jid>',
    aliases: [],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const jid = context.args?.[0];
      if (!jid) return usage(context, toSmallCaps('Usage:') + ' /deleteuser <jid>');
      if (jid === context.sender) return usage(context, toSmallCaps('Use /delete to delete your own account.'));
      if (isLastBotAdmin(jid)) {
        return sendText(context.sock, context.sender,
          '⚠️ ' + toSmallCaps('That user is the only bot admin and cannot be deleted.'));
      }
      if (String(context.text || '').trim() === '0' && await cancelPending(context)) return true;
      return confirmOrRun(context, 'delete', jid);
    }
  }
];