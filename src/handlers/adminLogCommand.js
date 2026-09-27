import { sendText, sendError } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import config from '../config/config.js';
import { getUserByJid } from '../services/userService.js';
import { getRecentAdminActions } from '../services/adminLogService.js';
import { addError } from '../services/errorLogService.js';

export const command = {
  name: 'adminlog',
  description: 'Show recent admin actions (admin only)',
  usage: '/adminlog',
  aliases: [],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    try {
      const sender = context.sender;
      const user = await getUserByJid(sender);
      const language = user?.language || config.defaultLanguage;
      const tr = (key) => toSmallCaps(t(language, key));
      const entries = getRecentAdminActions(10);

      const lines = entries.length === 0
        ? [tr('adminlog.noActions')]
        : entries.map((e, i) => {
            const time = e.timestamp
              ? e.timestamp.replace('T', ' ').slice(0, 16)
              : '';
            const detail = e.details ? ': ' + e.details : '';
            return `${i + 1}. [${time}] ${e.adminJid} – ${e.action}${detail}`;
          });

      const text = [
        '> *' + tr('adminlog.heading') + '*',
        '',
        ...lines
      ].join('\n');

      await sendText(context.sock, sender, text);
      return { success: true };
    } catch (error) {
      addError(error);
      await sendError(context.sock, context.sender, 'Failed to load admin log.');
      throw error;
    }
  },
};
