import config from '../config/config.js';
import { sendText, sendError } from '../services/messageService.js';
import * as reportService from '../services/reportService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { getStats, getUserByJid } from '../services/userService.js';
import { getLastError, getLastErrorAt } from '../utils/errorTracker.js';
import { addError } from '../services/errorLogService.js';

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

export const command = {
  name: 'health',
  description: 'Show bot health and statistics (admin only)',
  usage: '/health',
  aliases: [],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    try {
      const sender = context.sender;
      const user = await getUserByJid(sender);
      const language = user?.language || config.defaultLanguage;
      const tr = (key, params) => toSmallCaps(t(language, key, params));
      const isAdmin = (config.adminJids || []).includes(sender);
      if (!isAdmin) {
        reportService.reportToAdmins('security', {
          user: sender,
          action: 'admin_command_attempt',
          details: 'health'
        });
        await sendText(context.sock, sender, tr('common.notAuthorized'));
        return { success: false };
      }

      const stats = getStats();
      const mem = process.memoryUsage();
      const lastError = getLastError();
      const lastErrorAt = getLastErrorAt();

      const text = [
        '> *' + tr('health.heading') + '*',
        '',
        '⏱️ ' + tr('health.uptime') + ': ' + formatUptime(process.uptime()),
        '💾 ' + tr('health.memory') + ': ' + (mem.heapUsed / 1024 / 1024).toFixed(1) + ' mb (rss ' + (mem.rss / 1024 / 1024).toFixed(1) + ' mb)',
        '👥 ' + tr('health.totalUsers') + ': ' + stats.total,
        '❌ ' + tr('health.lastError') + ': ' + (lastError ? `${lastError}${lastErrorAt ? ' @ ' + lastErrorAt : ''}` : tr('health.none')),
        '',
        '_' + tr('health.reportedBy') + '_'
      ].join('\n');

      await sendText(context.sock, sender, text);
      return { success: true };
    } catch (error) {
      addError(error);
      await sendError(context.sock, context.sender, 'Failed to gather health info.');
      throw error;
    }
  },
};
