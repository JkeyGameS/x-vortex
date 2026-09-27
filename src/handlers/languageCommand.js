import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { ensureUserProfile, getUserByJid, updateUser } from '../services/userService.js';
import { sendText, sendError } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendMenu } from '../utils/messageHelper.js';
import { addError } from '../services/errorLogService.js';
import * as conversationService from '../services/conversationService.js';
import { openLanguageSelection } from './profileCommand.js';

export const onboardingCommand = {
  name: 'language',
  description: 'Change bot language',
  usage: '/language',
  aliases: [],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    try {
      const sender = context.sender;
      logger.info({ senderJid: sender }, '[LANG] /language received');

      await ensureUserProfile({ jid: sender, name: context.pushName });

      const langMenu = buildLanguageMenu();
      await sendMenu({
        sock: context.sock,
        sender,
        chatId: context.chatId || sender,
        text: langMenu,
        transitionKey: context.transitionKey || 'language_selection'
      });
      sessionManager.setState(sender, context.chatId || sender, { currentMenu: 'language_selection' });
      return { success: true };
    } catch (error) {
      addError(error);
      logger.error({ err: error, sender: context.sender, action: 'language_command' }, '[LANG] Failed');
      await sendError(context.sock, context.sender, 'Failed to open language menu.');
      throw error;
    }
  },
};

const langCommand = {
  name: 'lang',
  description: 'Change your language',
  usage: '/lang',
  aliases: ['language'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    const sender = context.sender;
    const chatId = context.chatId || sender;
    const session = sessionManager.getSession(sender, chatId) || {};
    const hasActiveMenu = Boolean(session.currentMenu && session.lastMenuKey);
    const previousMenu = ['main', 'profile', 'profile_edit', 'preferences'].includes(session.currentMenu)
      ? session.currentMenu
      : 'main';
    await openLanguageSelection({
      ...context,
    }, {
      transitionKey: hasActiveMenu ? 'lang_command_active' : 'lang_command_new',
      previousMenu
    });
    return { success: true };
  }
};

export const commands = [langCommand];

export function buildLanguageMenu() {
  const prompt = t(config.defaultLanguage, 'onboarding.languagePrompt');
  const replyPrompt = t(config.defaultLanguage, 'onboarding.languageReplyPrompt');

  const lines = [
    '*' + toSmallCaps(prompt) + '*',
    '',
    '1. ' + toSmallCaps(t('en', 'onboarding.languageEnglish')),
    '2. ' + toSmallCaps(t('fr', 'onboarding.languageFrench')),
    '3. ' + toSmallCaps(t('de', 'onboarding.languageGerman')),
    '4. ' + toSmallCaps(t('es', 'onboarding.languageSpanish')),
    '5. ' + toSmallCaps(t('ar', 'onboarding.languageArabic')),
    '',
    '9. ' + t(config.defaultLanguage, 'menuHelp.option'),
    '',
    toSmallCaps(replyPrompt)
  ];

  const heading = `> *🌐 ${toSmallCaps(t(config.defaultLanguage, 'onboarding.languageTitle'))}*`;
  return [heading, '', ...lines].join('\n');
}

/**
 * Handle the user's reply to the language selection menu (number 1-5).
 * This should be called from the main message handler when the user is in 'language_selection' state.
 */
export async function handleLanguageSelection(context, selectedNumber) {
  const sender = context.sender;
  const languageMap = {
    '1': 'en',
    '2': 'fr',
    '3': 'de',
    '4': 'es',
    '5': 'ar'
  };

  const selectedLang = languageMap[selectedNumber];
  if (!selectedLang) {
    const language = (await getUserByJid(sender))?.language || config.defaultLanguage;
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 1, max: 5 })));
    return;
  }

  const user = await getUserByJid(sender);
  if (!user) {
    await sendError(context.sock, sender, 'User not found.');
    return;
  }
  // First-time onboarding discriminator: the user had no language selected.
  const hadNoLanguage = !user.language;
  await updateUser(sender, { language: selectedLang });

  // Confirmation — always a new message, never an edit
  const langNameKey = {
    en: 'languageEnglish',
    fr: 'languageFrench',
    de: 'languageGerman',
    es: 'languageSpanish',
    ar: 'languageArabic'
  }[selectedLang] || 'languageEnglish';
  const langName = t(selectedLang, `onboarding.${langNameKey}`);
  const confirmText = t(selectedLang, 'onboarding.languageSet', { language: langName });
  await sendMenu({
    sock: context.sock,
    sender,
    chatId: context.chatId || sender,
    text: confirmText,
    transitionKey: 'language_confirmation'
  });

  // Brand-new user: run the welcome intro, then wait for free text before
  // opening the main menu.
  if (hadNoLanguage) {
    const introUser = await getUserByJid(sender) || user;
    const displayName = introUser.username ? `@${introUser.username}` : (introUser.name || 'User');
    await conversationService.sendOnboardingIntro(context, selectedLang, displayName);
    return { success: true };
  }

  // Main menu — new message, do NOT edit the language menu (mode: 'new', language_to_main)
  const startCmd = (await import('./startCommand.js')).command;
  await startCmd.execute({ ...context, transitionKey: 'language_to_main' });
}