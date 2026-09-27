import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText, sendError } from '../services/messageService.js';
import { getRecentErrors, addError } from '../services/errorLogService.js';
import { t } from '../services/localeService.js';
import config from '../config/config.js';
import { getUserByJid } from '../services/userService.js';

function formatErrorLog(language) {
  const tr = (key) => toSmallCaps(t(language, key));
  const errors = getRecentErrors(5);
  if (errors.length === 0) {
    return '> *' + tr('admin.errorLog.heading') + '*\n\n' + tr('admin.errorLog.none');
  }
  const pad = (n) => String(n).padStart(2, '0');
  const lines = errors.map((e, i) => {
    const d = new Date(e.timestamp);
    const label = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const firstLine = (e.message || '').split('\n')[0] || String(e.message);
    return `${i + 1}. [${label}] ${firstLine}`;
  });
  return '> *' + tr('admin.errorLog.heading') + '*\n\n' + lines.join('\n');
}

export const command = {
  name: 'errorlog',
  description: 'Show recent errors (admin only)',
  usage: '/errorlog',
  aliases: ['errors'],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    try {
      const user = await getUserByJid(context.sender);
      const language = user?.language || config.defaultLanguage;
      await sendText(context.sock, context.sender, formatErrorLog(language));
      return { success: true };
    } catch (error) {
      addError(error);
      await sendError(context.sock, context.sender, 'Failed to load error log.');
      throw error;
    }
  }
};
