import sessionManager from '../utils/sessionManager.js';
import { sendText } from '../services/messageService.js';

export const command = {
  name: 'id',
  description: 'Get your user ID',
  usage: '/id',
  aliases: ['myid', 'userid'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    // Send only the user's JID in monospace (backticks).
    await sendText(context.sock, context.sender, `\`${context.sender}\``);
    // One-shot command: clear any active interactive session.
    sessionManager.clear(context.sender, context.chatId || context.sender);
    return { success: true };
  }
};