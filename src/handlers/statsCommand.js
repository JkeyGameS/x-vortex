import config from '../config/config.js';
import sessionManager from '../utils/sessionManager.js';
import { sendMenuById } from '../utils/menuSender.js';
import { registerDashboardResolver } from '../utils/menuResolvers.js';
import { sendText } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import {
  getUserByJid,
  getCommandsThisWeek,
  getFavoriteCommand,
  getDaysSinceJoined
} from '../services/userService.js';
import { relativeTime } from './profileCommand.js';
import {
  getGlobalStats,
  getTopCommands,
  getTopUsers,
  getLanguageDistribution,
  getFeatureUsage,
  getPeakUsageHour,
  getSuccessErrorRate,
  getFeedbackTrend,
  getTopSuggestionKeywords
} from '../services/statsService.js';
import { getFeedbackStats } from '../services/feedbackService.js';
import { buildMainMenu } from './startCommand.js';
import { sendFeedbackAdmin } from './feedbackCommand.js';

const TOP_PAGE_SIZE = 10;

const LANG_FLAGS = { en: '🇬🇧', fr: '🇫🇷', de: '🇩🇪', es: '🇪🇸', ar: '🇸🇦' };
const LANG_NAME_KEYS = {
  en: 'statsMenu.langEnglish',
  fr: 'statsMenu.langFrench',
  de: 'statsMenu.langGerman',
  es: 'statsMenu.langSpanish',
  ar: 'statsMenu.langArabic'
};

function L(language, key, params = {}) {
  return toSmallCaps(t(language, key, params));
}

function isAdmin(sender) {
  return (config.adminJids || []).includes(sender);
}

async function languageOf(sender) {
  try {
    const user = await getUserByJid(sender);
    return user?.language || config.defaultLanguage;
  } catch {
    return config.defaultLanguage;
  }
}

export function buildMyStats(language, user) {
  const stats = user?.stats || {};
  const favorite = getFavoriteCommand(user);
  const rel = (() => {
    const res = relativeTime(stats.lastCommandTime);
    if (!res) return '';
    return toSmallCaps(t(language, res.key, res.params || {}));
  })();
  return buildMenu(
    t(language, 'statsMenu.myTitle'),
    '',
    [
      { static: '📩 *' + toSmallCaps(t(language, 'stats.messagesSent')) + '*: ', dynamic: String(stats.messagesSent || 0) },
      { static: '🤖 *' + toSmallCaps(t(language, 'stats.commandsUsed')) + '*: ', dynamic: String(stats.commandsUsed || 0) },
      { static: '📈 *' + toSmallCaps(t(language, 'stats.commandsThisWeek')) + '*: ', dynamic: String(getCommandsThisWeek(user)) },
      { static: '💬 *' + toSmallCaps(t(language, 'stats.favoriteCommand')) + '*: ', dynamic: (favorite || t(language, 'stats.none')) },
      { static: '🕒 *' + toSmallCaps(t(language, 'stats.lastCommand')) + ':* ', dynamic: ((stats.lastCommand || t(language, 'stats.none')) + (rel ? ` (${rel})` : '')) },
      { static: '📅 *' + toSmallCaps(t(language, 'stats.daysSinceJoined')) + '*: ', dynamic: String(getDaysSinceJoined(user)) },
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.replyPrompt')
    ]
  );
}

export function buildTopCommands(language, page = 0) {
  const all = getTopCommands(1000);
  const totalPages = Math.max(1, Math.ceil(all.length / TOP_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * TOP_PAGE_SIZE;
  const visible = all.slice(start, start + TOP_PAGE_SIZE);
  const lines = visible.map((c, i) => ({ static: `${start + i + 1}. /`, dynamic: `${c.name} - ${c.total}` }));
  const hasNext = start + TOP_PAGE_SIZE < all.length;
  const hasPrev = safePage > 0;
  const body = all.length === 0 ? [L(language, 'statsMenu.noData'), ''] : [...lines, ''];
  if (hasNext) body.push('11. ' + t(language, 'statsMenu.next'));
  if (hasPrev) body.push('12. ' + t(language, 'statsMenu.previous'));
  if (hasNext || hasPrev) body.push('');
  return buildMenu(
    t(language, 'statsMenu.topCommandsTitle'),
    '',
    [...body, '0. ' + t(language, 'statsMenu.back'), '', t(language, 'statsMenu.replyPrompt')]
  );
}

export function buildTopUsers(language) {
  const top = getTopUsers(10);
  const lines = top.map((u, i) => {
    const label = u.username ? `@${u.username}` : (u.name || u.jid);
    return { static: `${i + 1}. `, dynamic: `${label} - ${u.commandsUsed} ${t(language, 'statsMenu.commandsWord')}` };
  });
  return buildMenu(
    t(language, 'statsMenu.topUsersTitle'),
    '',
    [
      ...(lines.length ? lines : [L(language, 'statsMenu.noData')]),
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.replyPrompt')
    ]
  );
}

export function buildFeedbackSummary(language) {
  const stats = getFeedbackStats();
  return buildMenu(
    t(language, 'statsMenu.feedbackTitle'),
    '',
    [
      { static: '📊 *' + toSmallCaps(t(language, 'statsMenu.totalRatings')) + ':* ', dynamic: String(stats.ratings) },
      { static: '⭐ *' + toSmallCaps(t(language, 'statsMenu.average')) + ':* ', dynamic: String(stats.average) },
      { static: '🐛 *' + toSmallCaps(t(language, 'statsMenu.bugReports')) + ':* ', dynamic: String(stats.bugReports) },
      { static: '💡 *' + toSmallCaps(t(language, 'statsMenu.suggestions')) + ':* ', dynamic: String(stats.suggestions) },
      '',
      '1. ' + t(language, 'statsMenu.openFeedback'),
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.replyPrompt')
    ]
  );
}

export function buildAdvancedMenu(language) {
  return buildMenu(
    t(language, 'statsMenu.advancedTitle'),
    '',
    [
      '1. ' + t(language, 'statsMenu.advLanguage'),
      '2. ' + t(language, 'statsMenu.advFeatures'),
      '3. ' + t(language, 'statsMenu.advPeak'),
      '4. ' + t(language, 'statsMenu.advRate'),
      '5. ' + t(language, 'statsMenu.advTrend'),
      '6. ' + t(language, 'statsMenu.advKeywords'),
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.replyPrompt')
    ]
  );
}

export function buildAdvLanguage(language) {
  const dist = getLanguageDistribution();
  return buildMenu(
    t(language, 'statsMenu.languageDistribution'),
    '',
    [
      ...['en', 'fr', 'de', 'es', 'ar'].map((code) => ({ static: `${LANG_FLAGS[code]} ` + toSmallCaps(t(language, LANG_NAME_KEYS[code])) + ': ', dynamic: String(dist[code]) })),
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.reply0Back')
    ]
  );
}

export function buildAdvFeatures(language) {
  const usage = getFeatureUsage().slice(0, 15);
  const lines = usage.map((u, i) => ({ static: `${i + 1}. `, dynamic: `${u.feature} - ${u.count}` }));
  return buildMenu(
    t(language, 'statsMenu.featureUsage'),
    '',
    [
      ...(lines.length ? lines : [L(language, 'statsMenu.noData')]),
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.reply0Back')
    ]
  );
}

export function buildAdvPeak(language) {
  const peak = getPeakUsageHour();
  const body = peak.total === 0
    ? [L(language, 'statsMenu.noData'), '']
    : [{ static: '⏰ *' + toSmallCaps(t(language, 'statsMenu.peakHour')) + ':* ', dynamic: `${String(peak.hour).padStart(2, '0')}:00 (${peak.count})` }];
  return buildMenu(
    t(language, 'statsMenu.peakUsageTime'),
    '',
    [...body, '0. ' + t(language, 'statsMenu.back'), '', t(language, 'statsMenu.reply0Back')]
  );
}

export function buildAdvRate(language) {
  const r = getSuccessErrorRate();
  return buildMenu(
    t(language, 'statsMenu.advRate'),
    '',
    [
      { static: '✅ ', dynamic: `${r.success}` },
      { static: '❌ ', dynamic: `${r.error}` },
      { static: '📊 *' + toSmallCaps(t(language, 'statsMenu.successRate')) + ':* ', dynamic: `${r.successRate}%` },
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.reply0Back')
    ]
  );
}

export function buildAdvTrend(language) {
  const trend = getFeedbackTrend();
  const sign = trend.delta > 0 ? '+' : '';
  return buildMenu(
    t(language, 'statsMenu.feedbackTrend'),
    '',
    [
      { static: '📈 *' + toSmallCaps(t(language, 'statsMenu.last7d')) + ':* ', dynamic: `${trend.last7d.average} (${trend.last7d.count})` },
      { static: '📉 *' + toSmallCaps(t(language, 'statsMenu.prev7d')) + ':* ', dynamic: `${trend.prev7d.average} (${trend.prev7d.count})` },
      { static: '📊 ', dynamic: `${sign}${trend.delta}` },
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.reply0Back')
    ]
  );
}

export function buildAdvKeywords(language) {
  const kws = getTopSuggestionKeywords(10);
  const lines = kws.map((k, i) => ({ static: `${i + 1}. `, dynamic: `${k.word} - ${k.count}` }));
  return buildMenu(
    t(language, 'statsMenu.topKeywords'),
    '',
    [
      ...(lines.length ? lines : [L(language, 'statsMenu.noData')]),
      '',
      '0. ' + t(language, 'statsMenu.back'),
      '',
      t(language, 'statsMenu.reply0Back')
    ]
  );
}

registerDashboardResolver('statsDashboard', async (user, language) => {
  const g = getGlobalStats();
  const dist = getLanguageDistribution();
  const L = (key) => toSmallCaps(t(language, key));
  return [
    { static: '👥 *' + toSmallCaps(t(language, 'statsMenu.totalUsers')) + ':* ', dynamic: String(g.totalUsers) },
    { static: '🤖 *' + toSmallCaps(t(language, 'statsMenu.totalCommands')) + ':* ', dynamic: String(g.totalCommands) },
    { static: '💬 *' + toSmallCaps(t(language, 'statsMenu.totalMessages')) + ':* ', dynamic: String(g.totalMessages) },
    { static: '⭐ *' + toSmallCaps(t(language, 'statsMenu.avgRating')) + ':* ', dynamic: `${g.avgRating} (${g.ratingCount})` },
    { static: '🆕 *' + toSmallCaps(t(language, 'statsMenu.newUsers7d')) + ':* ', dynamic: String(g.newUsers7d) },
    { static: '👥 *' + toSmallCaps(t(language, 'statsMenu.activeUsers24h')) + ':* ', dynamic: String(g.activeUsers24h) },
    '🌐 *' + L('statsMenu.languages') + ':*',
    ...['en', 'fr', 'de', 'es', 'ar'].map((code) => `> ${L(LANG_NAME_KEYS[code])} :${dist[code]} · ${LANG_FLAGS[code]}`),
    ''
  ];
});

async function sendStatsMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender).catch(() => null);
  const language = opts.language || await languageOf(sender);
  sessionManager.setState(sender, chatId, { pendingStatsPage: 0 });
  await sendMenuById('statistics', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'stats_menu', { resultLine: opts.resultLine, sessionMenu: 'stats_main' });
}

export async function openStatsMenu(context, opts = {}) {
  return sendStatsMenu(context, { ...opts, transitionKey: opts.transitionKey || 'main_to_stats' });
}

async function sendStatsState(context, menu, text, transitionKey, extra = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: menu, ...extra });
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey });
}

export async function handleStatsReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = await languageOf(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const menu = session.currentMenu;
  const trimmed = (input || '').trim();
  const admin = isAdmin(sender);

  if (menu === 'stats_main') {
    if (trimmed === '0') {
      const user = await getUserByJid(sender).catch(() => null);
      const displayName = user?.username ? `@${user.username}` : (user?.name || 'User');
      sessionManager.setState(sender, chatId, { currentMenu: 'main' });
      return sendMenu({
        sock: context.sock, sender, chatId,
        text: buildMainMenu(language, displayName, user),
        transitionKey: 'stats_back_to_main'
      });
    }
    if (trimmed === '1') {
      const user = await getUserByJid(sender).catch(() => null);
      return sendStatsState(context, 'stats_my', buildMyStats(language, user), 'stats_to_my');
    }
    if (['2', '3', '4', '5'].includes(trimmed)) {
      if (!admin) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
      }
      if (trimmed === '2') return sendStatsState(context, 'stats_top_commands', buildTopCommands(language, 0), 'stats_to_top', { pendingStatsPage: 0 });
      if (trimmed === '3') return sendStatsState(context, 'stats_top_users', buildTopUsers(language), 'stats_to_users');
      if (trimmed === '4') return sendStatsState(context, 'stats_feedback', buildFeedbackSummary(language), 'stats_to_feedback');
      return sendStatsState(context, 'stats_advanced', buildAdvancedMenu(language), 'stats_to_advanced');
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
  }

  if (menu === 'stats_my') {
    if (trimmed === '0') return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    const user = await getUserByJid(sender).catch(() => null);
    return sendStatsState(context, 'stats_my', buildMyStats(language, user), 'stats_menu');
  }

  if (menu === 'stats_top_commands') {
    const page = session.pendingStatsPage || 0;
    const all = getTopCommands(1000);
    const hasNext = (page + 1) * TOP_PAGE_SIZE < all.length;
    const hasPrev = page > 0;
    if (trimmed === '0') return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
    if (trimmed === '11' && hasNext) {
      return sendStatsState(context, 'stats_top_commands', buildTopCommands(language, page + 1), 'stats_menu', { pendingStatsPage: page + 1 });
    }
    if (trimmed === '12' && hasPrev) {
      return sendStatsState(context, 'stats_top_commands', buildTopCommands(language, page - 1), 'stats_menu', { pendingStatsPage: page - 1 });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendStatsState(context, 'stats_top_commands', buildTopCommands(language, page), 'stats_menu', { pendingStatsPage: page });
  }

  if (menu === 'stats_top_users') {
    if (trimmed === '0') return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendStatsState(context, 'stats_top_users', buildTopUsers(language), 'stats_menu');
  }

  if (menu === 'stats_feedback') {
    if (trimmed === '1') {
      return sendFeedbackAdmin(context, { language, transitionKey: 'stats_to_feedback_admin' });
    }
    return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
  }

  if (menu === 'stats_advanced') {
    const builders = {
      1: ['stats_adv_language', buildAdvLanguage],
      2: ['stats_adv_features', buildAdvFeatures],
      3: ['stats_adv_peak', buildAdvPeak],
      4: ['stats_adv_rate', buildAdvRate],
      5: ['stats_adv_trend', buildAdvTrend],
      6: ['stats_adv_keywords', buildAdvKeywords]
    };
    if (trimmed === '0') return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
    if (builders[trimmed]) {
      const [state, fn] = builders[trimmed];
      return sendStatsState(context, state, fn(language), 'stats_to_advanced_detail');
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendStatsState(context, 'stats_advanced', buildAdvancedMenu(language), 'stats_menu');
  }

  if (['stats_adv_language', 'stats_adv_features', 'stats_adv_peak', 'stats_adv_rate', 'stats_adv_trend', 'stats_adv_keywords'].includes(menu)) {
    if (trimmed === '0') {
      return sendStatsState(context, 'stats_advanced', buildAdvancedMenu(language), 'stats_menu');
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    const rebuild = {
      stats_adv_language: buildAdvLanguage,
      stats_adv_features: buildAdvFeatures,
      stats_adv_peak: buildAdvPeak,
      stats_adv_rate: buildAdvRate,
      stats_adv_trend: buildAdvTrend,
      stats_adv_keywords: buildAdvKeywords
    }[menu];
    return sendStatsState(context, menu, rebuild(language), 'stats_menu');
  }

  return sendStatsMenu(context, { language, transitionKey: 'stats_menu' });
}
