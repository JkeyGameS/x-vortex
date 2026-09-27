import { toSmallCaps } from '../utils/smallCaps.js';
import { loadCommands } from './commandHandler.js';
import { sendText } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import config from '../config/config.js';
import { getUserByJid, trackFeatureUsage } from '../services/userService.js';
import { addError } from '../services/errorLogService.js';
import { helpOrder } from '../config/menuConfig.js';

const PAGE_SIZE = 5;

// Section meta for the two help sections. Labels are translated; emoji + colon
// are static and identical across languages.
const SECTION_META = {
  user: { emoji: '👤', key: 'help.userCommands' },
  admin: { emoji: '🛡️', key: 'help.adminCommands' }
};

function orderRank(name) {
  const idx = helpOrder.indexOf(name);
  return idx === -1 ? helpOrder.length + 1000 : idx;
}

// Unique primary commands (aliases ignored) in the display order defined in
// menuConfig. Returns entries of { cmd, section }: user commands first, then
// admin commands (only when the recipient is an admin). No feature-flag
// filtering is applied.
function buildEntries(commands, isAdmin) {
  const seen = new Set();
  const list = [];
  for (const cmd of commands.values()) {
    if (seen.has(cmd.name)) continue;
    seen.add(cmd.name);
    list.push(cmd);
  }
  list.sort((a, b) => orderRank(a.name) - orderRank(b.name));
  const user = list.filter((c) => !c.adminOnly).map((cmd) => ({ cmd, section: 'user' }));
  const admin = isAdmin
    ? list.filter((c) => c.adminOnly).map((cmd) => ({ cmd, section: 'admin' }))
    : [];
  return [...user, ...admin];
}

// Localized description; falls back to the hard-coded English description when
// no translation is registered for the command name. Descriptions are dynamic
// text and stay in normal case (only static text is small-capped).
function commandDescription(cmd, language) {
  const localized = t(language, 'commands.' + cmd.name);
  return localized.startsWith('commands.') ? cmd.description : localized;
}

function sectionHeader(section, language) {
  const meta = SECTION_META[section];
  return meta.emoji + ' ' + toSmallCaps(t(language, meta.key)) + ':';
}

function footerLine(language, origin, seeMore) {
  const lines = [];
  if (seeMore != null) {
    lines.push(seeMore + '. ' + toSmallCaps(t(language, 'help.seeMore')));
  }
  const backKey = origin === 'main' ? 'help.back' : 'help.cancel';
  lines.push('0. ' + toSmallCaps(t(language, backKey)));
  return lines;
}

/**
 * Resolve the paged, role-aware help content for one page.
 *
 * @param {object} [opts]
 * @param {string}  opts.language - user language (default: config.defaultLanguage)
 * @param {number}  [opts.page]    - 1-based page (clamped into range)
 * @param {boolean} [opts.isAdmin] - include the admin section (adminOnly commands)
 * @param {string}  [opts.origin]  - 'main' (main menu tutorial, Back) or 'command' (standalone /help, Cancel)
 * @returns {Promise<{ text: string, page: number, totalPages: number, seeMore: number|null, hasMore: boolean, userCount: number, adminCount: number }>}
 */
export async function getHelpPage({
  language = config.defaultLanguage,
  page = 1,
  isAdmin = false,
  origin = 'command'
} = {}) {
  const commands = await loadCommands();
  const entries = buildEntries(commands, isAdmin);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const items = entries.slice(start, start + PAGE_SIZE);
  const hasMore = current < totalPages;
  const seeMore = hasMore ? start + items.length + 1 : null;

  const textParts = [
    '> *' + toSmallCaps(t(language, 'menuHelp.title')) + '*',
    ''
  ];

  let lastSection = null;
  items.forEach((entry, i) => {
    const n = start + i + 1;
    if (entry.section !== lastSection) {
      if (lastSection !== null) textParts.push('');
      textParts.push(sectionHeader(entry.section, language));
      textParts.push('');
      lastSection = entry.section;
    }
    textParts.push('' + n + '. */' + entry.cmd.name + '* - ' + commandDescription(entry.cmd, language));
  });

  textParts.push('');
  textParts.push(...footerLine(language, origin, seeMore));
  textParts.push('');
  textParts.push(toSmallCaps(t(language, origin === 'main' ? 'help.backPrompt' : 'help.cancelPrompt')));

  const userCount = entries.filter((e) => e.section === 'user').length;
  const adminCount = entries.filter((e) => e.section === 'admin').length;

  return { text: textParts.join('\n'), page: current, totalPages, seeMore, hasMore, userCount, adminCount };
}

/**
 * Build the help message text (page 1, standalone-origin by default).
 * Kept separate so the conversation layer and /help reuse the exact same
 * generated content.
 *
 * @param {object} [opts]
 * @param {string} [opts.language]
 * @param {number} [opts.page]
 * @param {boolean} [opts.isAdmin]
 * @param {string} [opts.origin]
 * @returns {Promise<string>}
 */
export async function buildHelpMessage(opts = {}) {
  const info = await getHelpPage({
    language: opts.language || config.defaultLanguage,
    page: Number.isInteger(opts.page) ? opts.page : 1,
    isAdmin: Boolean(opts.isAdmin),
    origin: opts.origin || 'command'
  });
  return info.text;
}

/**
 * Open the interactive, paginated, role-aware help menu.
 * Sets the session to `currentMenu: 'help'`, `helpPage: 1` and remembers the
 * origin ('main' for the main-menu tutorial entry, 'command' for standalone
 * /help) so `0. Back`/`0. Cancel` behave correctly.
 */
export async function openHelp(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = opts.language || user?.language || config.defaultLanguage;
  const origin = opts.origin || 'command';
  const isAdmin = (config.adminJids || []).includes(sender);

  const info = await getHelpPage({ language, page: 1, isAdmin, origin });
  await trackFeatureUsage(sender, 'help');
  const { sendMenu } = await import('../utils/messageHelper.js');
  const sessionManager = (await import('../utils/sessionManager.js')).default;
  sessionManager.setState(sender, chatId, {
    currentMenu: 'help',
    helpPage: 1,
    helpFrom: origin
  });
  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: info.text,
    transitionKey: opts.transitionKey || 'help_show'
  });
  return { success: true };
}

/**
 * Global /help command. Interrupts any active menu and opens the paginated
 * help menu in standalone mode (footer: `0. Cancel`).
 */
export const command = {
  name: 'help',
  description: 'Show available commands and menu options',
  usage: '/help',
  aliases: ['h'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    try {
      return await openHelp(context, { origin: 'command' });
    } catch (err) {
      addError(err);
      const language = ((await getUserByJid(context.sender))?.language) || config.defaultLanguage;
      await sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.couldNotLoadHelp')));
      throw err;
    }
  },
};