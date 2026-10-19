// /debug -- group diagnostics by DM.
//
// Replaces opening the Suga log dashboard to answer "why did the bot ignore
// this?". Admin-only, DM-only, self-expiring; see groupDebugService.js for
// why each of those bounds exists.
import config from '../config/config.js';
import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import {
  enableDebug,
  disableDebug,
  listActiveDebugs
} from '../services/groupDebugService.js';

const USAGE = toSmallCaps('Usage: /debug on [groupJid] | /debug off | /debug status');

function minutes() {
  const ms = config.groupDebug?.autoExpireMs || 600000;
  return Math.round(ms / 60000);
}

export const command = {
  name: 'debug',
  aliases: ['gd'],
  description: 'Toggle group diagnostic debug mode (admin only)',
  usage: '/debug on [groupJid] | /debug off | /debug status',
  adminOnly: true,
  // DM only. Debug lines are delivered by DM, so allowing it in a group would
  // produce a command that appears to do nothing there.
  groupAllowed: false,
  async execute(context) {
    if (!config.groupDebug?.enabled) {
      return sendText(
        context.sock, context.sender,
        '\u274C ' + toSmallCaps('Debug mode is disabled.'),
        { type: 'error' }
      );
    }

    const [action, targetGroupJid] = context.args || [];

    if (!action || action === 'status') {
      const active = listActiveDebugs();
      const lines = ['> *\uD83D\uDD0D ' + toSmallCaps('Group debug status') + '*', ''];
      if (active.length === 0) {
        lines.push(toSmallCaps('No active debug sessions.'));
      } else {
        for (const a of active) {
          lines.push(
            '· ' + a.adminJid + ' → ' + (a.targetGroupJid || toSmallCaps('all groups')) +
            ' (' + a.lineCount + ' ' + toSmallCaps('lines') + ', until ' + a.expiresAt + ')'
          );
        }
      }
      lines.push('', USAGE);
      return sendText(context.sock, context.sender, lines.join('\n'), { type: 'submenuTransition' });
    }

    if (action === 'on') {
      // A fresh enable always resets the line count, so a capped session can be
      // restarted without waiting for the old one to expire.
      enableDebug(context.sender, targetGroupJid || null);
      const scope = targetGroupJid
        ? toSmallCaps('group') + ' ' + targetGroupJid
        : toSmallCaps('all groups');
      return sendText(
        context.sock, context.sender,
        toSmallCaps('Debug enabled for') + ' *' + scope + '*. ' +
        toSmallCaps('Auto-expires in') + ' *' + minutes() + '* ' + toSmallCaps('minutes.'),
        { type: 'confirmation' }
      );
    }

    if (action === 'off') {
      disableDebug(context.sender);
      return sendText(
        context.sock, context.sender,
        '\u2705 ' + toSmallCaps('Debug disabled.'),
        { type: 'confirmation' }
      );
    }

    return sendText(context.sock, context.sender, USAGE, { type: 'error' });
  }
};

export const commands = [command];