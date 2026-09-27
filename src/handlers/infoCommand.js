import config from '../config/config.js';
import sessionManager from '../utils/sessionManager.js';
import { sendMenuById } from '../utils/menuSender.js';
import { registerDashboardResolver, registerBodyResolver } from '../utils/menuResolvers.js';
import { sendText } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { getUserByJid } from '../services/userService.js';
import { getFeatureNames, getFeature } from '../services/featureFlagService.js';
import { buildMainMenu } from './startCommand.js';

function L(language, key, params = {}) {
  return toSmallCaps(t(language, key, params));
}

/**
 * Count features per status from the live registry.
 * @returns {{ availableCount: number, comingSoonCount: number, unavailableCount: number, maintenanceCount: number }}
 */
export function getFeatureSummary() {
  const names = getFeatureNames();
  let availableCount = 0;
  let comingSoonCount = 0;
  let unavailableCount = 0;
  let maintenanceCount = 0;
  for (const name of names) {
    const status = getFeature(name)?.status;
    if (status === 'available') availableCount++;
    else if (status === 'coming_soon') comingSoonCount++;
    else if (status === 'unavailable') unavailableCount++;
    else if (status === 'maintenance') maintenanceCount++;
  }
  return { availableCount, comingSoonCount, unavailableCount, maintenanceCount };
}

export function buildInfoMenu(language) {
  const { availableCount, comingSoonCount, unavailableCount, maintenanceCount } = getFeatureSummary();
  return buildMenu(
    t(language, 'info.title'),
    '',
    [
      '📊 ' + L(language, 'info.features') + ':',
      `*${availableCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.available')} ✅`,
      `*${comingSoonCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.coming_soon')} 🔆`,
      `*${unavailableCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.unavailable')} ⛔️`,
      `*${maintenanceCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.maintenance')} ⚠️`,
      '',
      '1. ' + t(language, 'info.optionAbout'),
      '2. ' + t(language, 'info.optionVersion'),
      '3. ' + t(language, 'info.optionDeveloper'),
      '4. ' + t(language, 'info.optionWebsite'),
      '',
      '0. ' + t(language, 'info.back'),
      '',
      t(language, 'info.replyPrompt')
    ]
  );
}

export function buildAboutBot(language) {
  return buildMenu(
    t(language, 'info.aboutTitle'),
    '',
    [
      { static: '*' + toSmallCaps(config.botName), dynamic: '*' },
      '',
      t(language, 'info.aboutDescription'),
      '',
      '0. ' + t(language, 'info.back'),
      '',
      t(language, 'info.reply0Back')
    ]
  );
}

export function buildVersionHistory(language) {
  const changes = (config.changelog || []).slice(0, 3).map((key) => '• ' + t(language, key));
  return buildMenu(
    t(language, 'info.versionTitle'),
    '',
    [
      { static: t(language, 'info.currentVersion') + ': *', dynamic: String(config.botVersion) + '*' },
      '',
      t(language, 'info.latestChanges') + ':',
      ...changes,
      '',
      '0. ' + t(language, 'info.back'),
      '',
      t(language, 'info.reply0Back')
    ]
  );
}

export function buildDeveloper(language) {
  const dev = config.developer || {};
  return buildMenu(
    t(language, 'info.developerTitle'),
    '',
    [
      { static: t(language, 'info.developedBy') + ': *', dynamic: String(dev.name || '-') + '*' },
      '',
      { static: t(language, 'info.support') + ': ', dynamic: String(dev.email || '-') },
      { static: t(language, 'info.github') + ': ', dynamic: String(dev.github || '-') },
      '',
      '0. ' + t(language, 'info.back'),
      '',
      t(language, 'info.reply0Back')
    ]
  );
}

export function buildWebsite(language) {
  return buildMenu(
    t(language, 'info.websiteTitle'),
    '',
    [
      { static: t(language, 'info.officialWebsite') + ': *', dynamic: String(config.website || '-') + '*' },
      '',
      '0. ' + t(language, 'info.back'),
      '',
      t(language, 'info.reply0Back')
    ]
  );
}

async function languageOf(sender) {
  try {
    const user = await getUserByJid(sender);
    return user?.language || config.defaultLanguage;
  } catch {
    return config.defaultLanguage;
  }
}

function bodyOf(fullText) {
  return String(fullText || '').split('\n').slice(2);
}

registerDashboardResolver('infoDashboard', async (user, language) => {
  const { availableCount, comingSoonCount, unavailableCount, maintenanceCount } = getFeatureSummary();
  return [
    '📊 ' + L(language, 'info.features') + ':',
    `*${availableCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.available')} ✅`,
    `*${comingSoonCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.coming_soon')} 🔆`,
    `*${unavailableCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.unavailable')} ⛔️`,
    `*${maintenanceCount}* ${t(language, 'info.cmd')} · ${t(language, 'admin.featureStatus.maintenance')} ⚠️`,
    ''
  ];
});

registerBodyResolver('infoAboutBody', async (user, language) => bodyOf(buildAboutBot(language)));
registerBodyResolver('infoVersionBody', async (user, language) => bodyOf(buildVersionHistory(language)));
registerBodyResolver('infoDeveloperBody', async (user, language) => bodyOf(buildDeveloper(language)));
registerBodyResolver('infoWebsiteBody', async (user, language) => bodyOf(buildWebsite(language)));

async function sendNewInfoMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender).catch(() => null);
  const language = opts.language || await languageOf(sender);
  await sendMenuById('info', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'info_menu', { resultLine: opts.resultLine, sessionMenu: 'info' });
}

export async function sendInfoMenu(context, opts = {}) {
  return sendNewInfoMenu(context, opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || await languageOf(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'info' });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildInfoMenu(language),
    transitionKey: opts.transitionKey || 'info_menu'
  });
}

export async function openInfo(context, opts = {}) {
  return sendInfoMenu(context, { ...opts, transitionKey: opts.transitionKey || 'main_to_info' });
}

async function sendInfoSubmenu(context, menu, text, transitionKey) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender).catch(() => null);
  const language = await languageOf(sender);
  await sendMenuById(menu, { sock: context.sock, sender, chatId, user, language }, transitionKey, { sessionMenu: menu });
}

export async function handleInfoReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = await languageOf(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const menu = session.currentMenu;
  const trimmed = (input || '').trim();

  if (menu === 'info') {
    switch (trimmed) {
      case '0': {
        const user = await getUserByJid(sender).catch(() => null);
        const displayName = user?.username ? `@${user.username}` : (user?.name || 'User');
        sessionManager.setState(sender, chatId, { currentMenu: 'main' });
        return sendMenu({
          sock: context.sock,
          sender,
          chatId,
          text: buildMainMenu(language, displayName, user),
          transitionKey: 'info_back_to_main'
        });
      }
      case '1':
        return sendInfoSubmenu(context, 'info_about', buildAboutBot(language), 'info_to_about');
      case '2':
        return sendInfoSubmenu(context, 'info_version', buildVersionHistory(language), 'info_to_version');
      case '3':
        return sendInfoSubmenu(context, 'info_developer', buildDeveloper(language), 'info_to_developer');
      case '4':
        return sendInfoSubmenu(context, 'info_website', buildWebsite(language), 'info_to_website');
      default:
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        return sendInfoMenu(context, { language, transitionKey: 'info_menu' });
    }
  }

  if (['info_about', 'info_version', 'info_developer', 'info_website'].includes(menu)) {
    if (trimmed === '0') {
      return sendInfoMenu(context, { language, transitionKey: 'info_menu' });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    const rebuild = {
      info_about: buildAboutBot,
      info_version: buildVersionHistory,
      info_developer: buildDeveloper,
      info_website: buildWebsite
    }[menu];
    return sendInfoSubmenu(context, menu, rebuild(language), 'info_menu');
  }

  return sendInfoMenu(context, { language, transitionKey: 'info_menu' });
}

export const command = {
  name: 'info',
  description: 'Show bot info and feature summary',
  usage: '/info',
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    try {
      return openInfo(context);
    } catch (error) {
      await sendText(context.sock, context.sender, 'Failed to open info. Please try again.');
      throw error;
    }
  }
};
