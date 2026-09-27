import sessionManager from './sessionManager.js';
import { sendMenu } from './messageHelper.js';
import { actionConfirmations } from '../config/menuConfig.js';
import { getUserByJid } from '../services/userService.js';
import config from '../config/config.js';

/**
 * Ask the user to confirm an action.
 * Renders the confirmation prompt (editing the current menu if possible),
 * then sets session state so the router knows a confirmation is pending.
 *
 * @param {object} ctx - { sock, sender, chatId }
 * @param {string} actionKey - key in actionConfirmations (e.g. 'broadcast', 'purgeTestUsers')
 * @param {object} [data] - extra data passed to the prompt/action
 * @returns {Promise<{ key: object|null, action: string }>}
 */
export async function askConfirmation({ sock, sender, chatId }, actionKey, data = {}) {
  const confirmation = actionConfirmations[actionKey];
  // Resolve the user's language and attach it to the data so confirmation
  // prompts can localize their text through the same data payload.
  const user = await getUserByJid(sender);
  data.language = user?.language || config.defaultLanguage;
  const text = confirmation
    ? confirmation.prompt(data)
    : (data.text || String(data));

  sessionManager.setState(sender, chatId, {
    currentMenu: 'confirmation',
    pendingAction: actionKey,
    pendingData: data
  });

  return sendMenu({
    sock,
    sender,
    chatId,
    text,
    transitionKey: 'confirmation'
  });
}
