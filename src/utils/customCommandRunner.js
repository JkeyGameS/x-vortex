import { getMenu } from '../config/menus/registry.js';
import { sendText } from '../services/messageService.js';
import { toSmallCaps } from './smallCaps.js';
import logger from './logger.js';

/**
 * Build an executable command object for an admin-defined custom command.
 * The four action types mirror the admin wizard: send_text, open_menu,
 * invoke_chat_rule, forward_to_admin.
 */
export function buildCustomCommand(cc) {
  if (!cc || !cc.name) return null;
  return {
    name: cc.name,
    aliases: cc.aliases || [],
    description: cc.description || '',
    adminOnly: cc.adminOnly === true,
    groupAllowed: cc.groupAllowed !== false,
    isCustomCommand: true,
    async execute(context) {
      try {
        return await executeCustomCommand(cc, context);
      } catch (err) {
        logger.error({ err, name: cc.name }, '[CUSTOM_CMD] execution failed');
        await sendText(context.sock, context.sender, toSmallCaps('❌ ' + 'the command failed. please try again later.'), { type: 'error' });
        return { success: false };
      }
    }
  };
}

export async function executeCustomCommand(cc, context) {
  const { sock, sender, chatId } = context;
  const cfg = cc.actionConfig || {};
  switch (cc.action) {
    case 'send_text': {
      await sendText(sock, sender, cfg.text || '', { type: 'chatReply' });
      return { success: true };
    }
    case 'open_menu': {
      if (!getMenu(cfg.menuId)) {
        await sendText(sock, sender, toSmallCaps('❌ this menu is unavailable.'), { type: 'error' });
        return { success: false };
      }
      const { sendMenuById } = await import('./menuSender.js');
      const user = context.user || (await import('../services/userService.js')).getUserByJidSync(sender);
      const language = context.language || user?.language || 'en';
      await sendMenuById(cfg.menuId, { sock, sender, chatId, user, language }, 'custom_' + cc.name, { sessionMenu: cfg.menuId });
      return { success: true };
    }
    case 'invoke_chat_rule': {
      const { getRule } = await import('../services/chatRuleService.js');
      const rule = getRule(cfg.ruleId);
      if (!rule) {
        await sendText(sock, sender, toSmallCaps('❌ the rule is unavailable.'), { type: 'error' });
        return { success: false };
      }
      const { pickReply } = await import('../services/replySelector.js');
      const userSvc = await import('../services/userService.js');
      const user = context.user || userSvc.getUserByJidSync(sender);
      const language = context.language || user?.language || 'en';
      const picked = await pickReply(rule, user, language);
      if (!picked?.reply?.text) {
        await sendText(sock, sender, toSmallCaps('❌ the rule produced no reply.'), { type: 'error' });
        return { success: false };
      }
      await sendText(sock, sender, picked.reply.text, { type: 'chatReply' });
      return { success: true };
    }
    case 'forward_to_admin': {
      const reportService = await import('../services/reportService.js');
      reportService.reportToAdmins('support', {
        user: sender,
        action: 'custom_command_forward',
        details: (cfg.prefix || '') + ' [' + cc.name + ']'
      });
      await sendText(sock, sender, toSmallCaps('✅ your message has been forwarded.'), { type: 'confirmation' });
      return { success: true };
    }
    default:
      await sendText(sock, sender, toSmallCaps('❌ unsupported action.'), { type: 'error' });
      return { success: false };
  }
}
