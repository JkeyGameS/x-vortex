import { getAllMenus } from '../config/menus/registry.js';
import { sendMenuById } from '../utils/menuSender.js';
import { getUserByJid } from '../services/userService.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import { toSmallCaps } from '../utils/smallCaps.js';

/**
 * Build slash-command objects from registered menu definitions that declare
 * a standaloneCommand. No menus are migrated yet, so this currently yields [].
 * @returns {{ commands: object[], skipped: object[] }}
 */
export function buildMenuCommands() {
  const commands = [];
  const skipped = [];
  for (const menu of getAllMenus()) {
    if (!menu.standaloneCommand) continue;
    const toName = (c) => String(c || '').replace(/^\//, '').trim().toLowerCase();
    const commandName = toName(menu.standaloneCommand);
    if (!commandName) {
      skipped.push({ menu: menu.id, reason: 'bad_command' });
      continue;
    }
    const aliases = (menu.aliases || []).map(toName).filter(Boolean);
    commands.push({
      name: commandName,
      aliases,
      description: menu.descriptionKey ? `menu.${menu.id}.description` : `menu.${menu.id}.heading`,
      usage: menu.standaloneCommand,
      adminOnly: menu.adminOnly === true,
      groupAllowed: menu.groupAllowed !== false,
      menuId: menu.id,
      async execute(context) {
        const sender = context?.sender;
        try {
          let user = context?.user || null;
          if (!user && sender) {
            try {
              user = await getUserByJid(sender);
            } catch { /* fallback below */ }
          }
          const language = context?.language || user?.language || config.defaultLanguage;
          await sendMenuById(menu.id, { ...context, user: user || { jid: sender }, language });
          return { success: true };
        } catch (err) {
          logger.error({ err, menuId: menu.id, sender }, '[MENU_CMD] failed to open menu');
          try {
            await context.sock.sendMessage(sender, {
              text: '❌ ' + toSmallCaps('Failed to open this menu. Please try again later.')
            });
          } catch { /* error path must never throw */ }
          return { success: false };
        }
      }
    });
  }
  return { commands, skipped };
}
