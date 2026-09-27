import { getUserByJidSync, getUserByJid } from '../services/userService.js';

function languageOf(sender) {
  const user = getUserByJidSync(sender);
  return user?.language || 'en';
}

export async function openSettings(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = languageOf(sender);
  const { sendMenuById } = await import('../utils/menuSender.js');
  await sendMenuById('settings', { sock: context.sock, sender, chatId, user, language }, context.transitionKey || 'main_to_settings', { sessionMenu: 'settings' });
}

export const command = {
  name: 'settings',
  description: 'Open settings menu',
  usage: '/settings',
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    await openSettings(context);
    return { success: true };
  }
};

export const commands = [command];
