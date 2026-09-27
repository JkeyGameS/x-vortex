import sessionManager from '../utils/sessionManager.js';
import { sendMenu } from '../utils/messageHelper.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import config from '../config/config.js';
import { getUserByJid, getTutorialProgress, updateTutorialProgress } from '../services/userService.js';
import { sendMenuById } from '../utils/menuSender.js';
import { registerBodyResolver, registerProgressResolver } from '../utils/menuResolvers.js';

const PAGE_SIZE = 8;
const SEARCH_PAGE_SIZE = 8;
const QUICK_TIPS = [
  'Use /id to copy your user ID.',
  'Use /settings for account-level settings.',
  'Use /preferences for bot behavior preferences.',
  'Use /help to see available commands.',
  'Use /feedback to report a bug or suggest an improvement.',
  'Reply with 0 to return from a submenu.',
  'Use /lang to change the bot language.',
  'Tutorial sections show a checkmark after you view them.'
];
const PROGRESS_BY_OPTION = {
  '1': 'gettingStarted',
  '2': 'usefulCommands',
  '3': 'profileGuide',
  '4': 'settingsPrefs',
  '5': 'selfDestruct',
  '6': 'feedback'
};

function title(language, key) {
  return t(language, `tutorial.${key}`);
}

function staticLine(language, key) {
  return toSmallCaps(title(language, key));
}

function backLine(language) {
  return '0. ' + staticLine(language, 'back');
}

function menuText(language, headingKey, lines) {
  return buildMenu(title(language, headingKey), '', [...lines, '', backLine(language)]);
}

function submenuHeadingKey(menu) {
  return {
    tutorial_getting_started: 'gettingStartedTitle',
    tutorial_commands: 'commandsTitle',
    tutorial_profile_guide: 'profileGuideTitle',
    tutorial_settings: 'settingsTitle',
    tutorial_selfdestruct: 'selfDestructTitle',
    tutorial_feedback: 'feedbackTitle'
  }[menu] || 'title';
}

function commandEntries(commands, isAdmin) {
  const seen = new Set();
  return [...commands.values()]
    .filter((command) => {
      if (!command?.name || seen.has(command.name)) return false;
      seen.add(command.name);
      return isAdmin || command.adminOnly !== true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function commandLine(command) {
  return {
    segments: [
      { static: '' },
      { dynamic: `*/${command.name}* - ` },
      { dynamic: command.description || '' }
    ]
  };
}

function commandsText(language, commands, isAdmin, page) {
  const entries = commandEntries(commands, isAdmin);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, pageCount - 1));
  const pageEntries = entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const lines = pageEntries.map((command, index) => ({
    segments: [
      { static: `*${index + 1}. ` },
      { dynamic: `/${command.name}*` },
      { static: ' - ' },
      { dynamic: command.description || '' }
    ]
  }));

  if (currentPage < pageCount - 1) lines.push('', `9. ${title(language, 'next')}`);
  if (currentPage > 0) lines.push(`10. ${title(language, 'previous')}`);
  lines.push(backLine(language));
  lines.push('', title(language, 'replyPrompt'));

  return {
    text: buildMenu(title(language, 'commandsTitle'), '', lines),
    page: currentPage,
    pageCount
  };
}

// ---------------------------------------------------------------------------
// New-renderer resolvers + senders (Phase 7). Verbatim copies of legacy
// fragments; progress marks resolve live per user.
// ---------------------------------------------------------------------------

registerProgressResolver('tutorialProgress', async (user, language, progressId) => {
  try {
    const progress = await getTutorialProgress(user?.jid || user?.sender || '');
    return progress && progress[progressId] ? '✅' : '⬜';
  } catch {
    return '⬜';
  }
});

const TUT_SUB_BODIES = {
  tutGettingStartedBody: ['gettingStarted1', 'gettingStarted2', 'gettingStarted3'],
  tutProfileGuideBody: ['profileGuide1', 'profileGuide2', 'profileGuide3'],
  tutSettingsPrefsBody: ['settings1', 'settings2', 'settings3'],
  tutSelfDestructBody: ['selfDestruct1', 'selfDestruct2', 'selfDestruct3'],
  tutFeedbackBody: ['feedback1', 'feedback2'],
  tutWhatsNewBody: null // dynamic changelog, built below
};

for (const [name, keys] of Object.entries(TUT_SUB_BODIES)) {
  if (!keys) continue;
  registerBodyResolver(name, async (user, language) => [
    ...keys.map((key) => staticLine(language, key)),
    '',
    backLine(language)
  ]);
}

registerBodyResolver('tutWhatsNewBody', async (user, language) => {
  const entries = (config.changelog || []).map((key) => t(language, key));
  const lines = entries.slice(0, 8).map((entry) => '• ' + entry);
  return [...lines, '', backLine(language)];
});

async function showTutorialMenu(context, language) {
  const { sender, chatId } = context;
  const user = await getUserByJid(sender).catch(() => null);
  await sendMenuById('tutorial', { sock: context.sock, sender, chatId, user, language }, 'tutorial_main', { sessionMenu: 'tutorial_main' });
}

async function markProgress(sender, key) {
  if (key) await updateTutorialProgress(sender, { [key]: true });
}

function tipsText(language) {
  const tip = QUICK_TIPS[Math.floor(Math.random() * QUICK_TIPS.length)];
  return buildMenu(title(language, 'quickTipTitle'), '', [toSmallCaps(tip), '', backLine(language)]);
}

function changelogText(language, page = 0) {
  const entries = (config.changelog || []).map((key) => t(language, key));
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, pageCount - 1));
  const lines = entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((entry) => '• ' + entry);
  if (currentPage < pageCount - 1) lines.push(`9. ${title(language, 'next')}`);
  if (currentPage > 0) lines.push(`10. ${title(language, 'previous')}`);
  return { text: buildMenu(title(language, 'whatNewTitle'), '', [...lines, '', backLine(language)]), page, pageCount };
}

function searchableItems(language, commands, isAdmin) {
  const items = QUICK_TIPS.map((tip) => ({ label: title(language, 'quickTipTitle'), content: tip }));
  for (const command of commandEntries(commands, isAdmin)) {
    items.push({ label: `/${command.name}`, content: command.description || '' });
  }
  const sections = [
    ['gettingStartedTitle', ['gettingStarted1', 'gettingStarted2', 'gettingStarted3']],
    ['profileGuideTitle', ['profileGuide1', 'profileGuide2', 'profileGuide3']],
    ['settingsTitle', ['settings1', 'settings2', 'settings3']],
    ['selfDestructTitle', ['selfDestruct1', 'selfDestruct2', 'selfDestruct3']],
    ['feedbackTitle', ['feedback1', 'feedback2']]
  ];
  for (const [heading, keys] of sections) items.push({ label: title(language, heading), content: keys.map((key) => title(language, key)).join(' ') });
  return items;
}

function searchText(language, items, query, page = 0) {
  const normalized = query.toLocaleLowerCase();
  const matches = items.filter((item) => `${item.label} ${item.content}`.toLocaleLowerCase().includes(normalized));
  const pageCount = Math.max(1, Math.ceil(matches.length / SEARCH_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, pageCount - 1));
  const pageItems = matches.slice(currentPage * SEARCH_PAGE_SIZE, (currentPage + 1) * SEARCH_PAGE_SIZE);
  const lines = pageItems.map((item, index) => ({ segments: [{ static: `${index + 1}. ` }, { dynamic: item.label }, { static: ' - ' }, { dynamic: item.content }] }));
  if (!matches.length) lines.push(staticLine(language, 'noResults'));
  if (currentPage < pageCount - 1) lines.push(`9. ${title(language, 'next')}`);
  if (currentPage > 0) lines.push(`10. ${title(language, 'previous')}`);
  return { text: buildMenu(title(language, 'searchResultsTitle'), '', [...lines, '', backLine(language)]), page: currentPage, pageCount };
}

async function showSearchPrompt(context, language) {
  const { sender, chatId } = context;
  sessionManager.setState(sender, chatId, { currentMenu: 'tutorial_search_prompt' });
  await sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(title(language, 'searchTitle'), '', [title(language, 'searchPrompt'), '', backLine(language)]), transitionKey: 'tutorial_search_prompt' });
}

const TUT_SUB_MENU_IDS = {
  tutorial_getting_started: 'tutorial_getting_started',
  tutorial_profile_guide: 'tutorial_profile_guide',
  tutorial_settings: 'tutorial_settings_prefs',
  tutorial_selfdestruct: 'tutorial_self_destruct',
  tutorial_feedback: 'tutorial_feedback'
};

async function showStaticSubmenu(context, language, menu, headingKey, lineKeys) {
  const newId = TUT_SUB_MENU_IDS[menu];
  if (newId) {
    const { sender, chatId } = context;
    const user = await getUserByJid(sender).catch(() => null);
    await sendMenuById(newId, { sock: context.sock, sender, chatId, user, language }, menu, { sessionMenu: menu });
    return;
  }
  const { sender, chatId } = context;
  sessionManager.setState(sender, chatId, { currentMenu: menu });
  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: menuText(language, headingKey, lineKeys.map((key) => staticLine(language, key))),
    transitionKey: menu
  });
}

async function showCommands(context, language, page = 0) {
  const { sender, chatId } = context;
  const rendered = commandsText(language, context.commands, context.isAdmin, page);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'tutorial_commands',
    tutorialCommandsPage: rendered.page
  });
  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: rendered.text,
    transitionKey: 'tutorial_commands'
  });
}

export async function openTutorial(context) {
  const language = context.language || 'en';
  await showTutorialMenu(context, language);
}

export async function handleTutorialReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = context.language || 'en';
  const session = sessionManager.getSession(sender, chatId) || {};
  const value = String(input || '').trim();

  if (session.currentMenu === 'tutorial_main') {
    if (value === '0') {
      const { sendMigratedMainMenu } = await import('./startCommand.js');
      const user = context.user || {};
      sessionManager.setState(sender, chatId, { currentMenu: 'main' });
      return sendMigratedMainMenu({ sock: context.sock, sender, chatId, user, language, transitionKey: 'tutorial_to_main' });
    }
    const submenu = {
      '1': ['tutorial_getting_started', 'gettingStartedTitle', ['gettingStarted1', 'gettingStarted2', 'gettingStarted3']],
      '3': ['tutorial_profile_guide', 'profileGuideTitle', ['profileGuide1', 'profileGuide2', 'profileGuide3']],
      '4': ['tutorial_settings', 'settingsTitle', ['settings1', 'settings2', 'settings3']],
      '5': ['tutorial_selfdestruct', 'selfDestructTitle', ['selfDestruct1', 'selfDestruct2', 'selfDestruct3']],
      '6': ['tutorial_feedback', 'feedbackTitle', ['feedback1', 'feedback2']]
    }[value];
    if (submenu) {
      await markProgress(sender, PROGRESS_BY_OPTION[value]);
      return showStaticSubmenu(context, language, ...submenu);
    }
    if (value === '2') {
      await markProgress(sender, PROGRESS_BY_OPTION[value]);
      return showCommands(context, language, 0);
    }
    if (value === '7') {
      await updateTutorialProgress(sender, { quickTips: true });
      return sendMenu({ sock: context.sock, sender, chatId, text: tipsText(language), transitionKey: 'tutorial_quick_tips' });
    }
    if (value === '8') {
      await updateTutorialProgress(sender, { whatNew: true });
      const rendered = changelogText(language);
      sessionManager.setState(sender, chatId, { currentMenu: 'tutorial_what_new', tutorialChangelogPage: rendered.page });
      const user = await getUserByJid(sender).catch(() => null);
      await sendMenuById('tutorial_whats_new', { sock: context.sock, sender, chatId, user, language }, 'tutorial_what_new', { sessionMenu: 'tutorial_what_new' });
      return;
    }
    if (value === '9') return showSearchPrompt(context, language);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(title(language, 'title'), '', [title(language, 'invalidChoice'), '', backLine(language)]), transitionKey: 'tutorial_main' });
  }

  if (session.currentMenu === 'tutorial_commands') {
    const page = Number(session.tutorialCommandsPage || 0);
    const entries = commandEntries(context.commands, context.isAdmin);
    const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    if (value === '0') return showTutorialMenu(context, language);
    if (value === '9' && page < pageCount - 1) return showCommands(context, language, page + 1);
    if (value === '10' && page > 0) return showCommands(context, language, page - 1);
    return showCommands(context, language, page);
  }

  if (session.currentMenu === 'tutorial_what_new') {
    const page = Number(session.tutorialChangelogPage || 0);
    const rendered = changelogText(language, page);
    if (value === '0') return showTutorialMenu(context, language);
    if (value === '9' && page < rendered.pageCount - 1) rendered.page++;
    if (value === '10' && page > 0) rendered.page--;
    sessionManager.setState(sender, chatId, { tutorialChangelogPage: rendered.page });
    return sendMenu({ sock: context.sock, sender, chatId, text: changelogText(language, rendered.page).text, transitionKey: 'tutorial_what_new' });
  }

  if (session.currentMenu === 'tutorial_search_prompt') {
    if (value === '0') return showTutorialMenu(context, language);
    const rendered = searchText(language, searchableItems(language, context.commands, context.isAdmin), value);
    sessionManager.setState(sender, chatId, { currentMenu: 'tutorial_search_results', tutorialSearchQuery: value, tutorialSearchPage: rendered.page });
    return sendMenu({ sock: context.sock, sender, chatId, text: rendered.text, transitionKey: 'tutorial_search_results' });
  }

  if (session.currentMenu === 'tutorial_search_results') {
    if (value === '0') return showTutorialMenu(context, language);
    const query = session.tutorialSearchQuery || '';
    const rendered = searchText(language, searchableItems(language, context.commands, context.isAdmin), query, Number(session.tutorialSearchPage || 0));
    if (value === '9' && rendered.page < rendered.pageCount - 1) rendered.page++;
    if (value === '10' && rendered.page > 0) rendered.page--;
    sessionManager.setState(sender, chatId, { tutorialSearchPage: rendered.page });
    return sendMenu({ sock: context.sock, sender, chatId, text: searchText(language, searchableItems(language, context.commands, context.isAdmin), query, rendered.page).text, transitionKey: 'tutorial_search_results' });
  }

  if (value === '0') return showTutorialMenu(context, language);
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: menuText(language, submenuHeadingKey(session.currentMenu), [staticLine(language, 'invalidChoice')]),
    transitionKey: session.currentMenu
  });
}

export const command = {
  name: 'tutorial',
  description: 'Open the tutorial menu',
  usage: '/tutorial',
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    const user = await getUserByJid(context.sender);
    const commands = context.commands || new Map();
    const isAdmin = context.isAdmin ?? (config.adminJids || []).includes(context.sender);
    await openTutorial({
      ...context,
      language: user?.language || config.defaultLanguage,
      commands,
      isAdmin,
      user
    });
    return { success: true };
  }
};
