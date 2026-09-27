import config from '../config/config.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendMenuById } from '../utils/menuSender.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { ensureUserProfile, trackUserCommand } from '../services/userService.js';
import { sendError } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { onboardingCommand as languageCmd } from './languageCommand.js';
import { isFeatureEnabled, getEffectiveMarker } from '../services/featureFlagService.js';
import { addError } from '../services/errorLogService.js';
import { buildMessageSettingsStatus } from '../utils/messageSettingsStatus.js';

export const MAIN_MENU_FEATURES = {
  1: 'profileEditing',
  2: null,
  3: 'statistics',
  4: 'tutorial',
  5: 'info',
  6: 'feedback'
};

function mainMenuOption(number, labelKey, language, featureId) {
  const marker = featureId ? getEffectiveMarker(featureId) : '';
  return number + '. ' + t(language, labelKey) + (marker ? ' ' + marker : '');
}

/**
 * Shared main-menu back navigation. Sets state to main, then renders via
 * the config-driven renderer with the caller's original transition key.
 */
export async function sendMainMenuBack(context, transitionKey) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await ensureUserProfile({ jid: sender, name: context.pushName }).then((r) => r.user).catch(() => null)
    || await getUserByJid(sender).catch(() => null);
  const language = user?.language || config.defaultLanguage;
  sessionManager.setState(sender, chatId, { currentMenu: 'main' });
  await sendMigratedMainMenu({ sock: context.sock, sender, chatId, user, language, transitionKey });
}

/**
 * Migrated main menu sender (Phase 3). Renders main_menu via the new
 * renderer with the same status/prompt framing as the legacy builder.
 */
export async function sendMigratedMainMenu(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = context.user || (await ensureUserProfile({ jid: sender, name: context.pushName })).user;
  const language = context.language || user?.language || config.defaultLanguage;
  const status = buildMessageSettingsStatus(language, user);
  const prompt = toSmallCaps(t(language, 'onboarding.mainMenuPrompt'));
  // Mirrors buildMainMenu body framing exactly: [status?, '', prompt, ''].
  const prefixLines = status ? [status, '', prompt, ''] : ['', prompt, ''];
  await sendMenuById(
    'main_menu',
    { sock: context.sock, sender, chatId, user, language },
    context.transitionKey || 'main_menu',
    { prefixLines, sessionMenu: 'main', type: 'mainMenu' }
  );
  return true;
}



export const command = {
  name: 'start',
  description: 'Open the main menu',
  usage: '/start',
  aliases: ['begin', 'menu'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    try {
      const sender = context.sender;
      const chatId = context.chatId || sender;
      logger.info({ senderJid: sender }, '[START] /start received');

      const userResult = await ensureUserProfile({ jid: sender, name: context.pushName });
      const isNewUser = userResult.isNewUser || (userResult.user?.isTest === true && !userResult.user?.language);

      sessionManager.goToMain(sender, chatId);
      await trackUserCommand(sender, 'start');

      if (isNewUser) {
        logger.info({ senderJid: sender }, '[START] New user, sending language selection');
        await languageCmd.execute({
          ...context,
          transitionKey: userResult.user?.isTest === true ? 'try_onboarding' : undefined
        });
        return { success: true };
      }

      const user = userResult.user;
      const language = user.language || config.defaultLanguage;

      let transitionKey = context.transitionKey || 'main_menu';
      if (!context.transitionKey) {
        const session = sessionManager.getSession(sender, chatId);
        if (session?.currentMenu === 'main' && session?.lastMenuKey) {
          transitionKey = 'main_to_main';
        }
      }
      await sendMigratedMainMenu({ ...context, transitionKey });
      logger.info({ senderJid: sender }, '[START] Main menu displayed for existing user');

      return { success: true };
    } catch (error) {
      addError(error);
      logger.error({ err: error, sender: context.sender, action: 'start_command' }, '[START] Main menu failed');
      await sendError(context.sock, context.sender, 'Failed to open main menu. Please try again.');
      throw error;
    }
  },
};