import config from '../config/config.js';
import logger from '../utils/logger.js';
import { sendText } from '../services/messageService.js';
import * as reportService from '../services/reportService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { getUserByJid } from '../services/userService.js';
import { logAdminAction } from '../services/adminLogService.js';
import { sendChatSettingsPanel } from './adminCommand.js';

function resolveLanguage(sender, user) {
  return user?.language || config.defaultLanguage;
}

async function showSettingsList(context, language) {
  const { getSettings } = await import('../services/chatSettingsService.js');
  const s = getSettings();
  const lines = [
    `chatEnabled: ${s.chatEnabled}`,
    `fuzzyMatching: ${s.fuzzyMatching}`,
    `defaultCooldownSeconds: ${s.defaultCooldownSeconds}`,
    `fallbackBehavior: ${s.fallbackBehavior}`,
    `priorityMode: ${s.priorityMode}`,
    `autoTranslate: ${s.autoTranslate}`,
    `contextAwareness: ${s.contextAwareness}`,
    `maxRepliesPerMinute: ${s.maxRepliesPerMinute}`,
    `dryRunMode: ${s.dryRunMode}`,
    `logChatMatches: ${s.logChatMatches}`,
    `languageFilter: ${(s.languageFilter || []).join(',')}`,
    `chatReplyDelayMs: ${s.chatReplyDelayMs == null ? 'global' : s.chatReplyDelayMs}`,
    `rateLimitEnabled: ${s.rateLimitEnabled}`,
    `rateLimitMaxReplies: ${s.rateLimitMaxReplies}`,
    `rateLimitWindowMs: ${s.rateLimitWindowMs}`,
    `rateLimitBehavior: ${s.rateLimitBehavior}`,
    `snippetMaxDepth: ${s.snippetMaxDepth}`
  ];
  await sendText(context.sock, context.sender, lines.join('\n'));
}

export const commands = [
  {
    name: 'chatsettings',
    description: 'Open chat settings',
    usage: '/chatsettings',
    aliases: ['cs'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      try {
        const sender = context.sender;
        const user = await getUserByJid(sender);
        const language = resolveLanguage(sender, user);
        const isAdmin = (config.adminJids || []).includes(sender);
        if (!isAdmin) {
          reportService.reportToAdmins('security', {
            user: sender,
            action: 'admin_command_attempt',
            details: 'chatsettings'
          });
          await sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
          return;
        }
        const args = context.args || [];
        const sub = String(args[0] || '').toLowerCase();
        if (sub === 'on' || sub === 'off') {
          const { updateSetting } = await import('../services/chatSettingsService.js');
          updateSetting('chatEnabled', sub === 'on');
          logger.info({ sender, chatEnabled: sub === 'on' }, '[CHAT SETTINGS] toggled via command');
          logAdminAction(sender, 'chat_settings', `chatEnabled → ${sub} (command)`);
          await sendChatSettingsPanel(context);
          return;
        }
        if (sub === 'list') {
          await showSettingsList(context, language);
          return;
        }
        if (sub === 'reset') {
          const { askConfirmation } = await import('../utils/confirmationHelper.js');
          await askConfirmation({ sock: context.sock, sender, chatId: context.chatId || sender }, 'resetChatSettings', {
            language,
            returnTo: 'chat_settings'
          });
          return;
        }
        // Default: open the settings menu (edit mode replaces any open menu).
        await sendChatSettingsPanel(context);
      } catch (err) {
        logger.error({ err }, 'chatsettings command failed');
      }
    }
  }
];


