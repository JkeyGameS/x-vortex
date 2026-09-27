import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { isMenuMigrated } from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import settingsService from '../services/settingsService.js';
import * as blockedUsers from '../services/blockedUsersService.js';
import * as templateService from '../services/templateService.js';
import * as analyticsService from '../services/analyticsService.js';
import { ensureUserProfile, getUserByJid, getUserByJidSync, getAllUsers, getUsersObject, getStats, deleteTestUsers, deleteUserByJid, updateUser, replaceAllUsers, findUser, setNotifyRequest } from '../services/userService.js';
import { sendText, sendError } from '../services/messageService.js';
import { getSettings as getChatSettingsState, getIgnoreList as getChatIgnoreList } from '../services/chatSettingsService.js';
import { getTypingSettings as getTypingSettingsState } from '../services/typingSettingsService.js';
import { sendMenuById } from '../utils/menuSender.js';
import { registerBodyResolver, registerDashboardResolver, registerSummaryResolver } from '../utils/menuResolvers.js';
import * as reportService from '../services/reportService.js';
import * as scheduleService from '../services/scheduleService.js';
import { t } from '../services/localeService.js';
import { logAdminAction, getRecentAdminActions } from '../services/adminLogService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { buildMenuHelp } from '../utils/menuHelp.js';
import { askConfirmation } from '../utils/confirmationHelper.js';
import { buildMainMenu } from './startCommand.js';
import { startRestore, handleRestoreData } from './restoreCommand.js';
import { sendChatPanel, handleChatReply, openEditChat, executeDeleteChatRule, executeImportChatRules } from './chatCommand.js';
import { sendFaqPanel, handleFaqReply, openEditFaq, executeDeleteFaqEntry, executeImportFaqEntries } from './faqCommand.js';
import { sendExportsPanel, executeExport, handleExportsListReply, handleExportsDetailReply, handleExportsRenameInput, startImport, handleImportPolicy, executeActivateExport, executeDeleteExport, openExportDetails } from './exportCommand.js';
import { addError, getRecentErrors } from '../services/errorLogService.js';
import * as featureFlagService from '../services/featureFlagService.js';
import * as featureScheduleService from '../services/featureScheduleService.js';
import { getWindows as getMaintenanceWindows, scheduleWindow as scheduleMaintenanceWindow, updateWindow as updateMaintenanceWindow, deleteWindow as deleteMaintenanceWindow } from '../services/maintenanceScheduleService.js';
import { menus, resolveMenuOption } from '../config/menuConfig.js';
import { DEFAULT_STATUS_MARKERS } from '../config/features.js';
import * as conversationService from '../services/conversationService.js';
import * as chatNotifyService from '../services/chatNotifyService.js';
import { getRecentFeedbackCount } from '../services/feedbackService.js';
import { getScheduledTasksCount } from '../services/scheduledTasksService.js';
import { getRole, hasPermission, isOwner } from '../services/rolesService.js';
import { showTryTimerSelection, endTrySession } from './tryCommand.js';
import { sendFeedbackAdmin } from './feedbackCommand.js';

function resolveLanguage(sender) {
  try {
    const u = getUserByJidSync(sender) || {};
    return u.language || config.defaultLanguage;
  } catch {
    return config.defaultLanguage;
  }
}

// Localized helper: translate a key to small caps. `language` must be resolved first.
function L(language, key, params = {}) {
  return toSmallCaps(t(language, key, params));
}

function isAdmin(sender) {
  return (config.adminJids || []).includes(sender);
}

function notAuthorized(sock, sender, language) {
  return sendText(sock, sender, toSmallCaps(t(language, 'admin.notAuthorized')));
}

// ---------------------------------------------------------------------------
// Menu builders
// ---------------------------------------------------------------------------

function formatUptime() {
  const totalMinutes = Math.max(0, Math.floor(process.uptime() / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return (days > 0 ? days + 'd ' : '') + hours + 'h ' + minutes + 'm';
}

function isBotOnline() {
  const sock = sessionManager.sock;
  if (!sock) return false;
  if (sock.ws && typeof sock.ws.isOpen === 'boolean') return sock.ws.isOpen;
  return !!sock.user;
}

function dashboardLines(language) {
  const online = isBotOnline();
  const stats = getStats();
  let recentFeedback = 0;
  let scheduled = 0;
  try {
    recentFeedback = getRecentFeedbackCount();
  } catch { /* ignore */ }
  try {
    scheduled = getScheduledTasksCount();
  } catch { /* ignore */ }
  return [
    (online ? '🟢 ' : '🔴 ') + L(language, 'admin.dashboard.status') + ': ' + L(language, online ? 'admin.dashboard.online' : 'admin.dashboard.offline'),
    '⏱️ ' + L(language, 'admin.dashboard.uptime') + ': ' + formatUptime(),
    `👥 ${L(language, 'admin.dashboard.users')}: ${stats.total}`,
    `⛔ ${L(language, 'admin.dashboard.blocked')}: ${stats.blocked}`,
    `🧪 ${L(language, 'admin.dashboard.test')}: ${stats.testUsers}`,
    `📮 ${L(language, 'admin.dashboard.recentFeedback')}: ${recentFeedback} (${L(language, 'admin.dashboard.last24h')})`,
    `📅 ${L(language, 'admin.dashboard.scheduled')}: ${scheduled}`
  ];
}

const ADMIN_PANEL_OPTIONS = [
  { number: '1', labelKey: 'admin.optionQuickActions', perm: 'quick' },
  { number: '2', labelKey: 'admin.optionStats', perm: 'stats.view' },
  { number: '3', labelKey: 'admin.optionBroadcast', perm: 'broadcast' },
  { number: '4', labelKey: 'admin.optionUserManagement', perm: 'users.manage' },
  { number: '5', labelKey: 'admin.optionSettings', perm: 'settings' },
  { number: '6', labelKey: 'admin.optionChatFaq', perm: 'chatfaq' },
  { number: '7', labelKey: 'admin.optionBackupRestore', perm: 'backup' },
  { number: '8', labelKey: 'admin.optionFeedbackManagement', perm: 'feedback.reply' },
  { number: '9', labelKey: 'admin.optionTest', perm: 'test' },
  { number: '10', labelKey: 'admin.optionAnalytics', perm: 'stats.view' },
  { number: '11', labelKey: 'admin.optionSearch', perm: 'search' },
  { number: '12', labelKey: 'admin.optionScheduled', perm: 'scheduled.view' },
  { number: '13', labelKey: 'menuHelp.option', perm: null }
];

function relAgo(iso) {
  const ms = Date.now() - new Date(iso || 0).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortJid(jid) {
  const s = String(jid || '');
  const at = s.indexOf('@');
  const local = at >= 0 ? s.slice(0, at) : s;
  return local.length > 12 ? local.slice(0, 12) + '…' : local;
}

function activityFeedLines(language) {
  let entries = [];
  try {
    entries = getRecentAdminActions(3);
  } catch { /* ignore */ }
  const lines = ['📋 ' + L(language, 'admin.dashboard.lastActions') + ':'];
  if (!entries.length) {
    lines.push('· ' + L(language, 'admin.dashboard.noActions'));
    return lines;
  }
  for (const e of entries) {
    const action = toSmallCaps(String(e.action || '').replace(/_/g, ' '));
    const ago = e.timestamp ? ` (${relAgo(e.timestamp)})` : '';
    if (e.adminJid && e.adminJid !== '-') {
      lines.push({ static: `· ${action} ` + toSmallCaps(t(language, 'admin.dashboard.by')) + ' ', dynamic: `@${shortJid(e.adminJid)}${ago}` });
    } else {
      lines.push(`· ${action}${ago}`);
    }
  }
  return lines;
}

export function buildAdminPanel(language, resultLine = '', senderJid = null) {
  const options = ADMIN_PANEL_OPTIONS.map((opt) => {
    const locked = senderJid && opt.perm && !hasPermission(senderJid, opt.perm);
    return opt.number + '. ' + t(language, opt.labelKey) + (locked ? ' 🔒' : '');
  });
  return buildMenu(
    t(language, 'admin.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      ...dashboardLines(language),
      '',
      ...activityFeedLines(language),
      '',
      t(language, 'admin.prompt'),
      '',
      ...options,
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

function groupedMenu(language, heading, lines, prompt = 'admin.replyPrompt') {
  return buildMenu(heading, '', [...lines, '', '0. ' + t(language, 'admin.test.optionBack'), '', t(language, prompt)]);
}

export function buildUserManagementMenu(language) {
  return groupedMenu(language, t(language, 'admin.userManagement.title'), [
    '1. ' + t(language, 'admin.userManagement.search'),
    '2. ' + t(language, 'admin.userManagement.delete'),
    '3. ' + t(language, 'admin.userManagement.block'),
    '4. ' + t(language, 'admin.userManagement.unblock'),
    '5. ' + t(language, 'admin.userManagement.listBlocked'),
    '6. ' + t(language, 'admin.optionPurge')
  ]);
}

export function buildChatFaqMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.chatFaq.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.optionChatResponses'),
      '2. ' + t(language, 'admin.optionFaq'),
      '3. ' + t(language, 'admin.chatFaq.optionSnippets'),
      '4. ' + t(language, 'admin.chatFaq.optionStats'),
      '5. ' + t(language, 'admin.chatFaq.optionUnmatched'),
      '6. ' + t(language, 'admin.chatFaq.optionImportExport'),
      '7. ' + t(language, 'admin.chatFaq.optionTest'),
      '8. 🧹 ' + toSmallCaps(t(language, 'admin.chatFaq.optionCleanup')),
      '9. ⚙️ ' + toSmallCaps(t(language, 'admin.chatFaq.optionChatSettings')),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

export async function sendChatFaqStatsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getChatRuleHits, getFaqHits } = await import('../services/chatStatsService.js');
  const { getAllRules } = await import('../services/chatRuleService.js');
  const { getAllEntries } = await import('../services/faqService.js');
  const { getUnmatched } = await import('../services/unmatchedService.js');
  const { countCooldownHits } = await import('../services/triggerStatsService.js');
  const unmatchedCount = getUnmatched(true).length;
  const cooldownHits24h = countCooldownHits();
  const ruleHits = getChatRuleHits();
  const faqHits = getFaqHits();
  const rules = getAllRules();
  const entries = getAllEntries();
  const topRules = [...rules]
    .sort((a, b) => (ruleHits[b.id] || 0) - (ruleHits[a.id] || 0))
    .slice(0, 5);
  const topFaq = [...entries]
    .sort((a, b) => (faqHits[b.id] || 0) - (faqHits[a.id] || 0))
    .slice(0, 5);
  const hasUsage = topRules.some((r) => (ruleHits[r.id] || 0) > 0) || topFaq.some((e) => (faqHits[e.id] || 0) > 0);

  sessionManager.setState(sender, chatId, { currentMenu: 'chat_stats', pendingAction: null, pendingData: null });

  const text = buildMenu(
    t(language, 'admin.chatFaq.statsTitle'),
    '',
    [
      { static: '💬 ' + toSmallCaps(t(language, 'admin.chatFaq.chatRulesLabel')) + ': ', dynamic: String(rules.length) },
      { static: '📚 ' + toSmallCaps(t(language, 'admin.chatFaq.faqEntriesLabel')) + ': ', dynamic: String(entries.length) },
      { static: '📝 ' + toSmallCaps(t(language, 'admin.chatFaq.unmatchedLabel')) + ': ', dynamic: String(unmatchedCount) },
      '',
      '🔝 ' + toSmallCaps(t(language, 'admin.chatFaq.topChatRules')) + ':',
      '',
      ...(hasUsage ? [
        ...topRules.map((r, i) => ({ static: `${i + 1}. `, dynamic: `"${(r.triggers[0] || r.id)}" – ${ruleHits[r.id] || 0} ${t(language, 'admin.chatFaq.triggersWord')}` })),
        '',
        '🔝 ' + toSmallCaps(t(language, 'admin.chatFaq.topFaq')) + ':',
        '',
        ...topFaq.map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${e.question.slice(0, 50)}" – ${faqHits[e.id] || 0} ${t(language, 'admin.chatFaq.matchesWord')}` }))
      ] : [toSmallCaps(t(language, 'admin.chatFaq.noUsage'))]),
      '',
      { static: '🚫 ' + toSmallCaps(t(language, 'admin.chatFaq.cooldownHits24h')) + ': ', dynamic: String(cooldownHits24h) },
      '',
      '1. 📈 ' + toSmallCaps(t(language, 'admin.chatFaq.performanceTitle')),
      '2. 📈 ' + toSmallCaps(t(language, 'admin.chatFaq.replyAnalyticsTitle')),
      '3. 🚦 ' + toSmallCaps(t(language, 'admin.chatFaq.rateLimitLogTitle')),
      '4. 🧪 ' + toSmallCaps(t(language, 'admin.chatFaq.dryRunLogTitle')),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text,
    transitionKey: opts.transitionKey || 'chat_stats'
  });
}

export async function sendRulePerformancePanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getChatRuleHits } = await import('../services/chatStatsService.js');
  const { getAllRules } = await import('../services/chatRuleService.js');
  const { topCooldownRules } = await import('../services/triggerStatsService.js');
  const hits = getChatRuleHits();
  const rules = getAllRules();
  const totalHits = Object.values(hits).reduce((a, b) => a + (Number(b) || 0), 0);
  const byStatus = { enabled: 0, disabled: 0, draft: 0 };
  for (const r of rules) {
    if (r.status === 'draft') byStatus.draft += 1;
    else if (r.enabled === false || r.status === 'disabled') byStatus.disabled += 1;
    else byStatus.enabled += 1;
  }
  const top = [...rules].sort((a, b) => (hits[b.id] || 0) - (hits[a.id] || 0)).slice(0, 5);
  const zeroHit = rules.filter((r) => !(hits[r.id] > 0)).slice(0, 8);
  const ruleById = Object.fromEntries(rules.map((r) => [r.id, r]));
  const topCooldown = topCooldownRules(5).map((c) => ({ ...c, rule: ruleById[c.ruleId] })).filter((c) => c.rule);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_performance_dashboard', pendingAction: null, pendingData: null });
  const text = buildMenu(
    '📈 ' + toSmallCaps(t(language, 'admin.chatFaq.performanceTitle')),
    '',
    [
      { static: '🔝 ' + toSmallCaps(t(language, 'admin.chatFaq.perfTopRules')) + ': ', dynamic: '' },
      ...top.map((r, i) => ({ static: `${i + 1}. `, dynamic: `"${(r.triggers || []).join(' / ').slice(0, 45)}" – ${hits[r.id] || 0}` })),
      '',
      { static: '💤 ' + toSmallCaps(t(language, 'admin.chatFaq.perfZeroHit')) + ': ', dynamic: String(rules.filter((r) => !(hits[r.id] > 0)).length) },
      ...zeroHit.map((r, i) => ({ static: `${i + 1}. `, dynamic: `"${(r.triggers || []).join(' / ').slice(0, 45)}"` })),
      '',
      { static: '📊 ' + toSmallCaps(t(language, 'admin.chatFaq.perfTotalHits')) + ': ', dynamic: String(totalHits) },
      { static: '✅/❌/📝 ', dynamic: `${byStatus.enabled}/${byStatus.disabled}/${byStatus.draft}` },
      '',
      { static: '🚫 ' + toSmallCaps(t(language, 'admin.chatFaq.perfTopCooldown')) + ': ', dynamic: '' },
      ...(topCooldown.length
        ? topCooldown.map((c, i) => ({ static: `${i + 1}. `, dynamic: `"${(c.rule.triggers || []).join(' / ').slice(0, 45)}" – ${c.hits}` }))
        : [toSmallCaps(t(language, 'admin.chatFaq.perfNoCooldown'))]),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: opts.transitionKey || 'chat_performance_dashboard' });
}

export function buildChatFaqImportExport(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.chatFaq.importExportTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.chatFaq.exportAll'),
      '2. ' + t(language, 'admin.chatFaq.importAll'),
      '3. ' + t(language, 'admin.chatFaq.exportChat'),
      '4. ' + t(language, 'admin.chatFaq.importChat'),
      '5. ' + t(language, 'admin.chatFaq.exportFaq'),
      '6. ' + t(language, 'admin.chatFaq.importFaq'),
      '7. 📤 ' + toSmallCaps(t(language, 'admin.chatFaq.exportAnalytics')),
      '8. 📥 ' + toSmallCaps(t(language, 'admin.chatFaq.importAnalytics')),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

function analyticsRuleLabel(rule) {
  const triggers = Array.isArray(rule?.triggers) ? rule.triggers.join('/') : '';
  return (triggers || rule?.id || '?').slice(0, 40);
}

function analyticsPct(sent, engagements) {
  if (!(sent > 0)) return '0%';
  return `${Math.round((engagements / sent) * 100)}%`;
}

export async function showReplyAnalyticsMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getAllAnalytics } = await import('../services/replyAnalyticsService.js');
  const { getRule } = await import('../services/chatRuleService.js');
  const all = getAllAnalytics();
  const rows = Object.entries(all)
    .map(([ruleId, stats]) => ({ ruleId, rule: getRule(ruleId), ...stats }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 10);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_reply_analytics',
    pendingAction: null,
    pendingData: { ids: rows.map((r) => r.ruleId) }
  });
  const lines = rows.length
    ? rows.map((r, i) => ({
      static: `${i + 1}. `,
      dynamic: `"${analyticsRuleLabel(r.rule)}" — ${r.sent} ${toSmallCaps(t(language, 'admin.chatFaq.analyticsSent'))} · ${r.engagements} ${toSmallCaps(t(language, 'admin.chatFaq.analyticsEngagements'))} (${analyticsPct(r.sent, r.engagements)})`
    }))
    : [toSmallCaps(t(language, 'admin.chatFaq.analyticsEmpty'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '📈 ' + toSmallCaps(t(language, 'admin.chatFaq.replyAnalyticsTitle')),
      '',
      [...lines, '', '0. ' + t(language, 'admin.test.optionBack')]
    ),
    transitionKey: opts.transitionKey || 'chat_reply_analytics'
  });
}

export async function handleReplyAnalyticsMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatFaqStatsPanel(context);
  const id = (session.pendingData?.ids || [])[Number(trimmed) - 1];
  if (!id) return showReplyAnalyticsMenu(context);
  return showRuleAnalyticsDetail(context, { ruleId: id });
}

export async function showRuleAnalyticsDetail(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const ruleId = opts.ruleId || session.pendingData?.detailId;
  const { getRuleAnalytics } = await import('../services/replyAnalyticsService.js');
  const { getRule } = await import('../services/chatRuleService.js');
  const rule = ruleId ? getRule(ruleId) : null;
  if (!rule) return showReplyAnalyticsMenu(context);
  const { replies, byStyle } = getRuleAnalytics(ruleId);
  const mode = session.pendingData?.analyticsMode || 'all';
  const weekAgo = Date.now() - 7 * 86400000;
  const inScope = (r) => mode !== 'week' || (r.lastSentAt && new Date(r.lastSentAt).getTime() >= weekAgo);
  let shown = replies.filter(inScope);
  if (mode === 'top') shown = [...shown].sort((a, b) => (b.rate - a.rate)).slice(0, 10);
  else if (mode === 'worst') shown = [...shown].sort((a, b) => (a.rate - b.rate)).slice(0, 10);
  else shown = [...shown].sort((a, b) => (b.sent - a.sent)).slice(0, 10);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_reply_analytics_detail',
    pendingAction: null,
    pendingData: { detailId: ruleId, analyticsMode: mode }
  });
  const lines = [
    { static: toSmallCaps(t(language, 'admin.chatFaq.analyticsVariants')) + ': ', dynamic: '' },
    ...(shown.length ? shown.map((r, i) => ({
      static: `${i + 1}. `,
      dynamic: `"${r.text.slice(0, 50)}" — ${r.sent} ${toSmallCaps(t(language, 'admin.chatFaq.analyticsSent'))} · ${r.engagements} ${toSmallCaps(t(language, 'admin.chatFaq.analyticsEngagements'))} (${analyticsPct(r.sent, r.engagements)})`
    })) : [toSmallCaps(t(language, 'admin.chatFaq.analyticsEmpty'))]),
    '',
    { static: toSmallCaps(t(language, 'admin.chatFaq.analyticsByStyle')) + ': ', dynamic: '' },
    ...Object.entries(byStyle).map(([style, cell]) => ({
      static: '', dynamic: `· ${style}: ${analyticsPct(cell.sent, cell.engagements)} (${cell.sent} ${toSmallCaps(t(language, 'admin.chatFaq.analyticsSent'))})`
    })),
    '',
    `1. 📊 ` + toSmallCaps(t(language, 'admin.chatFaq.analyticsTop')),
    `2. 📉 ` + toSmallCaps(t(language, 'admin.chatFaq.analyticsWorst')),
    `3. 🗓️ ` + toSmallCaps(t(language, 'admin.chatFaq.analyticsWeek')),
    `4. ⏱️ ` + toSmallCaps(t(language, 'admin.chatFaq.analyticsAllTime')),
    `5. 🔄 ` + toSmallCaps(t(language, 'admin.chatFaq.analyticsReset')),
    '',
    '0. ' + t(language, 'admin.test.optionBack')
  ];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📈 ' + toSmallCaps(t(language, 'admin.chatFaq.analyticsRuleTitle', { rule: analyticsRuleLabel(rule) })), '', lines),
    transitionKey: 'chat_reply_analytics_detail'
  });
}

export async function handleRuleAnalyticsDetail(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const ruleId = session.pendingData?.detailId;
  if (trimmed === '0') return showReplyAnalyticsMenu(context);
  if (trimmed === '1' || trimmed === '2' || trimmed === '3' || trimmed === '4') {
    const mode = trimmed === '1' ? 'top' : trimmed === '2' ? 'worst' : trimmed === '3' ? 'week' : 'all';
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_reply_analytics_detail', pendingAction: null, pendingData: { detailId: ruleId, analyticsMode: mode } });
    return showRuleAnalyticsDetail(context, { ruleId });
  }
  if (trimmed === '5') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_reply_analytics_reset', pendingAction: null, pendingData: { detailId: ruleId } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('📈 ' + toSmallCaps(t(language, 'admin.chatFaq.replyAnalyticsTitle')), '', [
        toSmallCaps(t(language, 'admin.chatFaq.analyticsResetConfirm')),
        '',
        '1. ✅ ' + t(language, 'admin.yes'),
        '2. ❌ ' + t(language, 'admin.no'),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]),
      transitionKey: 'chat_reply_analytics_reset'
    });
  }
  return showRuleAnalyticsDetail(context, { ruleId });
}

export async function handleReplyAnalyticsReset(context, input) {
  const sender = context.sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '1') {
    const { resetAnalytics } = await import('../services/replyAnalyticsService.js');
    resetAnalytics();
    logAdminAction(sender, 'chat_analytics', 'reply analytics reset');
  }
  return showReplyAnalyticsMenu(context);
}

export async function sendChatFaqImportExport(context, opts = {}) {
  return sendNewChatFaqImportExport(context, opts);
}

export async function sendCombinedExport(context, scope) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { exportRules } = await import('../services/chatRuleService.js');
  const { exportEntries } = await import('../services/faqService.js');
  const payload = {};
  if (scope === 'all' || scope === 'chat') payload.chatRules = exportRules();
  if (scope === 'all' || scope === 'faq') payload.faqEntries = exportEntries();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = scope === 'all' ? 'chat-faq' : scope;
  await context.sock.sendMessage(chatId, {
    document: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    mimetype: 'application/json',
    fileName: `${name}-export-${stamp}.json`,
    caption: toSmallCaps(t(language, 'admin.chatFaq.exported'))
  });
  logAdminAction(sender, 'chatfaq_export', scope);
}

export async function promptCombinedImport(context, scope) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'chat_ie_import', pendingAction: null, pendingData: { scope } });

  const text = buildMenu(
    t(language, 'admin.chatFaq.importTitle'),
    '',
    [
      toSmallCaps(t(language, 'admin.chatFaq.importPrompt')),
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_ie_import' });
}

export async function handleCombinedImportInput(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await sendChatFaqImportExport(context);
    return;
  }
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.importInvalid')));
    await promptCombinedImport(context, session.pendingData?.scope || 'all');
    return;
  }
  const scope = session.pendingData?.scope || 'all';
  const chatRules = scope === 'faq' ? null : (Array.isArray(data) ? data : data.chatRules);
  const faqEntries = scope === 'chat' ? null : (Array.isArray(data) ? null : data.faqEntries);
  if ((chatRules !== null && !Array.isArray(chatRules)) || (faqEntries !== null && !Array.isArray(faqEntries))) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.importInvalid')));
    await promptCombinedImport(context, scope);
    return;
  }
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_ie_policy',
    pendingAction: null,
    pendingData: { scope, chatRules: chatRules || [], faqEntries: faqEntries || [] }
  });
  const text = buildMenu(
    t(language, 'admin.chatFaq.importPolicyTitle'),
    '',
    [
      '1. ' + t(language, 'admin.chatFaq.policySkip'),
      '2. ' + t(language, 'admin.chatFaq.policyOverwrite'),
      '3. ' + t(language, 'admin.chatFaq.policyKeepBoth'),
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]
  );
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_ie_policy' });
}

export async function handleCombinedImportPolicy(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const pending = session.pendingData || {};
  const policy = { 1: 'skip', 2: 'overwrite', 3: 'keepBoth' }[selectedNumber];

  if (selectedNumber === '0') {
    await sendChatFaqImportExport(context);
    return;
  }
  if (!policy) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
    return;
  }
  const { importRules, isDuplicateRule, getAllRules, deleteRule, addRule } = await import('../services/chatRuleService.js');
  const { importEntries, findDuplicateEntry, getAllEntries, deleteEntry, addEntry } = await import('../services/faqService.js');
  try {
    const { saveSnapshot } = await import('../services/snapshotService.js');
    saveSnapshot('chatfaq-import');
  } catch { /* snapshots must never break imports */ }
  let chatCount = 0;
  let faqCount = 0;

  if (pending.scope === 'all' && policy !== 'skip') {
    // Full replace only when the payload carries both arrays.
    if (pending.chatRules.length || pending.faqEntries.length) {
      importRules(pending.chatRules);
      importEntries(pending.faqEntries);
      chatCount = pending.chatRules.length;
      faqCount = pending.faqEntries.length;
    }
  } else {
    for (const raw of pending.chatRules || []) {
      const dupe = getAllRules().find((e) => isDuplicateRule({ ...raw, triggers: raw.triggers || [], language: raw.language || 'all' }, e));
      if (dupe) {
        if (policy === 'skip') continue;
        if (policy === 'overwrite') deleteRule(dupe.id);
        if (policy === 'keepBoth') delete raw.id;
      }
      addRule(raw);
      chatCount++;
    }
    for (const raw of pending.faqEntries || []) {
      const dupe = findDuplicateEntry({ ...raw, question: raw.question || '', language: raw.language || 'all' });
      if (dupe) {
        if (policy === 'skip') continue;
        if (policy === 'overwrite') deleteEntry(dupe.id);
        if (policy === 'keepBoth') delete raw.id;
      }
      addEntry(raw);
      faqCount++;
    }
  }
  logAdminAction(sender, 'chatfaq_import', `${pending.scope}/${policy} chat=${chatCount} faq=${faqCount}`);
  await sendChatFaqImportExport(context, { resultLine: null });
  await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.importDone', { chat: chatCount, faq: faqCount })));
}

export async function handleChatFaqImportExportReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendChatFaqMenu(context);
      break;
    case '1':
      await sendCombinedExport(context, 'all');
      break;
    case '2':
      await promptCombinedImport(context, 'all');
      break;
    case '3':
      await sendCombinedExport(context, 'chat');
      break;
    case '4':
      await promptCombinedImport(context, 'chat');
      break;
    case '5':
      await sendCombinedExport(context, 'faq');
      break;
    case '6':
      await promptCombinedImport(context, 'faq');
      break;
    case '7':
      await sendAnalyticsExport(context);
      break;
    case '8':
      await promptAnalyticsImport(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 8 }));
      break;
  }
}

export async function sendAnalyticsExport(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getAllAnalytics } = await import('../services/replyAnalyticsService.js');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await context.sock.sendMessage(chatId, {
    document: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), analytics: getAllAnalytics() }, null, 2), 'utf8'),
    mimetype: 'application/json',
    fileName: `reply-analytics-export-${stamp}.json`,
    caption: toSmallCaps(t(language, 'admin.chatFaq.exported'))
  });
  logAdminAction(sender, 'chat_analytics', 'analytics exported');
}

export async function promptAnalyticsImport(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_analytics_import', pendingAction: null, pendingData: null });
  const text = buildMenu(
    t(language, 'admin.chatFaq.importAnalyticsTitle'),
    '',
    [
      toSmallCaps(t(language, 'admin.chatFaq.importAnalyticsPrompt')),
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]
  );
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_analytics_import' });
}

export async function handleAnalyticsImportInput(context, content) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();
  if (trimmed === '0') {
    await sendChatFaqImportExport(context);
    return;
  }
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.importInvalid')));
    return;
  }
  const packs = data && typeof data === 'object' && !Array.isArray(data) ? (data.analytics || data) : null;
  if (!packs || typeof packs !== 'object') {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.importInvalid')));
    return;
  }
  const { importAnalytics } = await import('../services/replyAnalyticsService.js');
  const count = importAnalytics(packs);
  logAdminAction(sender, 'chat_analytics', `analytics imported (${count} rules)`);
  await sendChatFaqImportExport(context, { resultLine: t(language, 'admin.chatFaq.analyticsImported', { count }) });
}

export async function showRateLimitLogMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getRateLimitLog } = await import('../services/rateLimitService.js');
  const rows = getRateLimitLog(20);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_rate_limit_log', pendingAction: null, pendingData: null });
  const lines = rows.length
    ? rows.map((r, i) => ({
      static: `${i + 1}. `,
      dynamic: `${String(r.userId || '?').slice(0, 30)} — ${r.count} ${toSmallCaps(t(language, 'admin.chatFaq.rateLimitMessages'))} · ${String(r.timestamp || '').slice(0, 19).replace('T', ' ')}`
    }))
    : [toSmallCaps(t(language, 'admin.chatFaq.rateLimitEmpty'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🚦 ' + toSmallCaps(t(language, 'admin.chatFaq.rateLimitLogTitle')),
      '',
      [...lines, '', '0. ' + t(language, 'admin.test.optionBack')]
    ),
    transitionKey: opts.transitionKey || 'chat_rate_limit_log'
  });
}

function dryRunSummary(entry) {
  const when = String(entry.timestamp || '').slice(5, 16).replace('T', ' ');
  return `${when} · ${(entry.ruleTriggers || [])[0] || entry.ruleId || '?'} → "${String(entry.selectedReply || '').slice(0, 45)}"`;
}

export async function showDryRunLogMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getDryRunLog } = await import('../services/chatSettingsService.js');
  const rows = getDryRunLog().slice(-10).reverse();
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_dryrun_log',
    pendingAction: null,
    pendingData: { ids: rows.map((_, i) => i) }
  });
  const lines = rows.length
    ? rows.map((r, i) => ({ static: `${i + 1}. `, dynamic: dryRunSummary(r) }))
    : [toSmallCaps(t(language, 'admin.chatFaq.dryRunEmpty'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🧪 ' + toSmallCaps(t(language, 'admin.chatFaq.dryRunLogTitle')),
      '',
      [
        ...lines,
        '',
        '11. 📤 ' + toSmallCaps(t(language, 'admin.chatFaq.dryRunExport')),
        '12. 🗑️ ' + toSmallCaps(t(language, 'admin.chatFaq.dryRunClear')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_dryrun_log'
  });
}

export async function handleDryRunLogMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatFaqStatsPanel(context);
  if (trimmed === '11') return sendDryRunExport(context);
  if (trimmed === '12') {
    const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_dryrun_log_clear', pendingAction: null, pendingData: null });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(
        '🧪 ' + toSmallCaps(t(language, 'admin.chatFaq.dryRunLogTitle')),
        '',
        [
          toSmallCaps(t(language, 'admin.chatFaq.dryRunClearConfirm')),
          '',
          '1. ' + toSmallCaps(t(language, 'chatResponses.confirmYes')),
          '',
          '0. ' + t(language, 'admin.test.optionBack')
        ]
      ),
      transitionKey: 'chat_dryrun_log_clear'
    });
  }
  const { getDryRunLog } = await import('../services/chatSettingsService.js');
  const rows = getDryRunLog().slice(-10).reverse();
  const entry = rows[Number(trimmed) - 1];
  if (!entry) return showDryRunLogMenu(context);
  return showDryRunLogDetail(context, { index: rows.length - 1 - (Number(trimmed) - 1) });
}

export async function showDryRunLogDetail(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getDryRunLog } = await import('../services/chatSettingsService.js');
  const rows = getDryRunLog();
  const entry = rows[Number(opts.index)];
  if (!entry) return showDryRunLogMenu(context);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_dryrun_log_detail', pendingAction: null, pendingData: null });
  const kv = (label, value) => ({ static: toSmallCaps(t(language, label)) + ': ', dynamic: String(value ?? '—').slice(0, 160) });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🧪 ' + toSmallCaps(t(language, 'admin.chatFaq.dryRunDetailTitle')),
      '',
      [
        kv('admin.chatFaq.dryRunTimestamp', String(entry.timestamp || '').replace('T', ' ').slice(0, 19)),
        kv('admin.chatFaq.dryRunUser', entry.userId),
        kv('admin.chatFaq.dryRunMessage', entry.message),
        kv('admin.chatFaq.dryRunRule', entry.ruleId),
        kv('admin.chatFaq.dryRunTriggers', (entry.ruleTriggers || []).join(', ')),
        kv('admin.chatFaq.dryRunReply', entry.selectedReply),
        kv('admin.chatFaq.dryRunStyle', entry.styleUsed),
        kv('admin.chatFaq.dryRunContext', `${entry.contextBefore || '—'} → ${entry.contextAfter || '—'}`),
        kv('admin.chatFaq.dryRunToneTime', `${entry.detectedTone || '—'} / ${entry.timeOfDay || '—'}`),
        kv('admin.chatFaq.dryRunPriority', entry.effectivePriority),
        kv('admin.chatFaq.dryRunBonus', entry.engagementBonus),
        kv('admin.chatFaq.dryRunFilters', (entry.filtersApplied || []).join(', ') || '—'),
        kv('admin.chatFaq.dryRunFollowUp', entry.followUpUsed ? entry.followUpText : '—'),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_dryrun_log_detail'
  });
}

export async function handleDryRunLogClear(context, input) {
  const sender = context.sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '1') {
    const { clearDryRunLog } = await import('../services/chatSettingsService.js');
    clearDryRunLog();
    logAdminAction(sender, 'chat_dryrun', 'dry-run log cleared');
  }
  return showDryRunLogMenu(context);
}

export async function sendDryRunExport(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getDryRunLog } = await import('../services/chatSettingsService.js');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await context.sock.sendMessage(chatId, {
    document: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), entries: getDryRunLog() }, null, 2), 'utf8'),
    mimetype: 'application/json',
    fileName: `dryrun-log-export-${stamp}.json`,
    caption: toSmallCaps(t(language, 'admin.chatFaq.exported'))
  });
  logAdminAction(sender, 'chat_dryrun', 'dry-run log exported');
}

registerBodyResolver('testPanelBody', async (user, language) => [
  t(language, 'admin.chatFaq.testPrompt'),
  t(language, 'admin.chatFaq.testContextHint'),
  t(language, 'admin.chatFaq.testCommandsHint'),
  '',
  '0. ' + t(language, 'admin.test.optionBack')
]);

async function sendNewChatFaqMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_faq_menu', pendingAction: null, pendingData: null });
  await sendMenuById('chat_faq', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'chat_faq_menu', { resultLine: opts.resultLine, sessionMenu: 'chat_faq_menu' });
}

async function sendNewChatSettingsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings', pendingAction: null, pendingData: null });
  await sendMenuById('chat_settings', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'chat_settings', { resultLine: opts.resultLine, sessionMenu: 'chat_settings' });
}

async function sendNewChatTestPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_test_panel', pendingAction: null, pendingData: null });
  await sendMenuById('test_panel', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'chat_test_panel', { resultLine: opts.resultLine, sessionMenu: 'chat_test_panel' });
}

async function sendNewChatFaqImportExport(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_import_export', pendingAction: null, pendingData: null });
  await sendMenuById('chat_import_export', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'chat_import_export', { resultLine: opts.resultLine, sessionMenu: 'chat_import_export' });
}

export async function sendChatTestPanel(context, opts = {}) {
  return sendNewChatTestPanel(context, opts);
}

async function testSnippetLines(language, userLanguage, styledPreview, user) {
  try {
    if (!styledPreview) return [];
    const { expandSnippets } = await import('../utils/snippetExpander.js');
    const { replacePlaceholders } = await import('../utils/matchUtils.js');
    const raw = styledPreview.baseReply ? styledPreview.baseReply.text : styledPreview.reply.text;
    if (!/\{snippet:[A-Za-z0-9_]{1,30}\}/.test(raw)) return [];
    const expanded = expandSnippets(raw, userLanguage);
    let final = expanded;
    try {
      final = replacePlaceholders(expanded, user || {}, config);
    } catch { /* preview must never break */ }
    return [
      { static: toSmallCaps(t(language, 'admin.chatFaq.testReplyRaw')) + ': ', dynamic: `"${raw.slice(0, 120)}"` },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testReplyExpanded')) + ': ', dynamic: `"${expanded.slice(0, 120)}"` },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testReplyFinal')) + ': ', dynamic: `"${final.slice(0, 120)}"` }
    ];
  } catch {
    return [];
  }
}

async function testRateLimitLine(language, sender, chatId) {
  try {
    const { getSettings } = await import('../services/chatSettingsService.js');
    const s = getSettings();
    if (s.rateLimitEnabled === false) return [];
    const max = Math.max(1, Math.floor(Number(s.rateLimitMaxReplies) || 10));
    const win = Math.max(1000, Math.floor(Number(s.rateLimitWindowMs) || 60000));
    const sess = sessionManager.getSession(sender, chatId) || {};
    const now = Date.now();
    const list = (Array.isArray(sess.chatRepliesInWindow) ? sess.chatRepliesInWindow : []).filter((ts) => now - Number(ts) < win);
    const limited = list.length >= max;
    return [{
      static: toSmallCaps(t(language, 'admin.chatFaq.testRateLimited')) + ': ',
      dynamic: (limited ? toSmallCaps(t(language, 'admin.chatFaq.testYes')) : toSmallCaps(t(language, 'admin.chatFaq.testNo'))) + ` (${list.length}/${max})`
    }];
  } catch {
    return [];
  }
}

async function testEngagementLines(language, chatMatch, testInput) {
  try {
    const { getBonusFor } = await import('../services/replyAnalyticsService.js');
    const { normalizeReplies, replyText } = await import('../services/replySelector.js');
    const first = normalizeReplies(chatMatch.rule.replies)[0];
    if (!first) return [];
    const info = getBonusFor(chatMatch.rule.id, first.text);
    const eff = chatMatch.effectivePriority != null ? chatMatch.effectivePriority : (chatMatch.rule.priority || 0);
    return [
      { static: toSmallCaps(t(language, 'admin.chatFaq.testEffectivePriority')) + ': ', dynamic: String(eff) },
      {
        static: toSmallCaps(t(language, 'admin.chatFaq.testEngagementRate')) + ': ',
        dynamic: `${Math.round(info.rate * 100)}% (w: ${(1 + info.bonus).toFixed(1)})`
      }
    ];
  } catch {
    return [];
  }
}

export async function handleChatTestPanelReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await sendChatFaqMenu(context);
    return;
  }
  if (!trimmed) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return;
  }
  const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2) {
    await handleChatBatchTest(context, lines.slice(0, 20));
    return;
  }
  if (/^tone\s+/i.test(trimmed)) {
    const { detectTone } = await import('../utils/toneDetector.js');
    const sample = trimmed.replace(/^tone\s+/i, '');
    const tone = detectTone(sample);
    logAdminAction(sender, 'chat_test_tone', sample.slice(0, 60));
    const text = buildMenu(t(language, 'admin.chatFaq.testResult'), '', [
      { static: toSmallCaps(t(language, 'admin.chatFaq.testInput')) + ': ', dynamic: `"${sample.slice(0, 80)}"` },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testDetectedTone')) + ': ', dynamic: toSmallCaps(t(language, 'admin.chatFaq.testTone_' + tone)) },
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]);
    await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
    return;
  }
  if (/^engage$/i.test(trimmed)) {
    const session = sessionManager.getSession(sender, chatId) || {};
    const last = session.pendingData?.testLastMatch;
    if (!last || !last.ruleId || !last.replyText) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.testEngageNone')));
      return;
    }
    const { recordEngagement } = await import('../services/replyAnalyticsService.js');
    recordEngagement(last.ruleId, last.replyText);
    logAdminAction(sender, 'chat_test_engage', `${last.ruleId}`);
    const text = buildMenu(t(language, 'admin.chatFaq.testResult'), '', [
      { static: toSmallCaps(t(language, 'admin.chatFaq.testEngageDone')) + ': ', dynamic: `"${String(last.replyText).slice(0, 80)}"` },
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]);
    await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
    return;
  }
  if (/^context:/i.test(trimmed)) {
    const wanted = trimmed.replace(/^context:/i, '').trim();
    const prev = (sessionManager.getSession(sender, chatId) || {}).pendingData || {};
    if (/^(off|clear|none)$/i.test(wanted)) {
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_test_panel', pendingAction: null, pendingData: { ...prev, testContext: null } });
      logAdminAction(sender, 'chat_test_context_clear', '');
    } else {
      const { isValidContextName } = await import('../services/contextRegistry.js');
      if (!wanted || !isValidContextName(wanted)) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.testContextInvalid')));
        return;
      }
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_test_panel', pendingAction: null, pendingData: { ...prev, testContext: wanted } });
      logAdminAction(sender, 'chat_test_context', wanted);
    }
    const cur = (sessionManager.getSession(sender, chatId) || {}).pendingData?.testContext;
    const text = buildMenu(t(language, 'admin.chatFaq.testResult'), '', [
      { static: toSmallCaps(t(language, 'admin.chatFaq.testPendingContext')) + ': ', dynamic: cur || toSmallCaps(t(language, 'admin.chatFaq.testNoContext')) },
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]);
    await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
    return;
  }
  if (/^dryrun(\s+clear)?$/i.test(trimmed)) {
    const { getDryRunLog, clearDryRunLog } = await import('../services/chatSettingsService.js');
    if (/clear/i.test(trimmed)) {
      clearDryRunLog();
      logAdminAction(sender, 'chat_test_dryrun_clear', '');
      const text = buildMenu(t(language, 'admin.chatFaq.testResult'), '', [
        toSmallCaps(t(language, 'admin.chatFaq.dryRunCleared')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]);
      await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
      return;
    }
    const rows = getDryRunLog().slice(-10).reverse();
    const text = buildMenu(t(language, 'admin.chatFaq.testResult'), '', [
      { static: toSmallCaps(t(language, 'admin.chatFaq.dryRunLogTitle')) + ': ', dynamic: String(getDryRunLog().length) },
      ...(rows.length ? rows.map((r, i) => ({ static: `${i + 1}. `, dynamic: dryRunSummary(r) })) : [toSmallCaps(t(language, 'admin.chatFaq.dryRunEmpty'))]),
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]);
    await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
    return;
  }
  if (/^style\s+\w+/i.test(trimmed)) {
    const wanted = trimmed.replace(/^style\s+/i, '').trim().toLowerCase();
    const styles = ['friendly', 'formal', 'casual', 'minimal', 'detailed'];
    if (wanted === 'off' || wanted === 'clear') {
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_test_panel', pendingAction: null, pendingData: null });
      logAdminAction(sender, 'chat_test_style_clear', '');
    } else if (styles.includes(wanted)) {
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_test_panel', pendingAction: null, pendingData: { testStyle: wanted } });
      logAdminAction(sender, 'chat_test_style', wanted);
    } else {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.chatFaq.testStyleInvalid')));
      return;
    }
    const text = buildMenu(t(language, 'admin.chatFaq.testResult'), '', [
      { static: toSmallCaps(t(language, 'admin.chatFaq.testUserStyle')) + ': ', dynamic: wanted === 'off' || wanted === 'clear' ? toSmallCaps(t(language, 'admin.chatFaq.testStyleCleared')) : wanted },
      '',
      '0. ' + t(language, 'admin.test.optionBack')
    ]);
    await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
    return;
  }
  const user = getUserByJidSync(sender) || {};
  const userLanguage = user.language || config.defaultLanguage;
  const { matchRule } = await import('../services/chatRuleService.js');
  const { matchFaq } = await import('../services/faqService.js');
  // Optional simulated context: "[contextName] message".
  let simulatedContext = null;
  let testInput = trimmed;
  const ctxOpen = trimmed.indexOf(']');
  if (trimmed.startsWith('[') && ctxOpen > 1) {
    const maybeCtx = trimmed.slice(1, ctxOpen).trim();
    const rest = trimmed.slice(ctxOpen + 1).trim();
    if (maybeCtx && rest) {
      const { isValidContextName } = await import('../services/contextRegistry.js');
      if (isValidContextName(maybeCtx)) {
        simulatedContext = maybeCtx;
        testInput = rest;
      }
    }
  }
  const session = sessionManager.getSession(sender, chatId) || {};
  let pendingContext = simulatedContext;
  let contextSource = simulatedContext ? 'simulated' : 'session';
  if (!pendingContext) {
    try {
      const { resolvePendingContext } = await import('../services/chatRuleService.js');
      pendingContext = resolvePendingContext(session);
    } catch { /* test must never break */ }
  }
  if (session.pendingData && Object.prototype.hasOwnProperty.call(session.pendingData, 'testContext')) {
    pendingContext = session.pendingData.testContext || null;
    contextSource = 'test';
  }
  const chatMatch = matchRule(testInput, userLanguage, { pendingContext });
  const { replyText, normalizeReplies, pickReply } = await import('../services/replySelector.js');
  const { detectTone } = await import('../utils/toneDetector.js');
  const { getTimeOfDay } = await import('../utils/timeOfDay.js');
  const detectedTone = detectTone(testInput);
  const bucket = getTimeOfDay(new Date(), user?.timezone || 'UTC');
  const testSession = sessionManager.getSession(sender, chatId) || {};
  const testStyle = typeof testSession.pendingData?.testStyle === 'string' ? testSession.pendingData.testStyle : null;
  const effectiveStyle = testStyle || user?.preferences?.replyStyle || 'friendly';
  let body;
  if (chatMatch) {
    const reply = replyText(chatMatch.rule.replies && chatMatch.rule.replies[0]);
    const aware = chatMatch.contextMatch ? ` (${toSmallCaps(t(language, 'admin.chatFaq.testContextAware'))})` : '';
    const wouldSet = chatMatch.rule.setsContext ? chatMatch.rule.setsContext : toSmallCaps(t(language, 'admin.chatFaq.testContextCleared'));
    const tagged = normalizeReplies(chatMatch.rule.replies).filter((r) => (r.time && r.time !== 'any') || (r.emotion && r.emotion !== 'any'));
    let styledPreview = null;
    try {
      styledPreview = await pickReply(chatMatch.rule, { preferences: { replyStyle: effectiveStyle } }, userLanguage, { message: testInput, timezone: user?.timezone || 'UTC', jid: null, antiRepetition: false });
    } catch { /* preview must never break tests */ }
    body = [
      { static: toSmallCaps(t(language, 'admin.chatFaq.testInput')) + ': ', dynamic: `"${testInput}"` },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testDetectedTone')) + ': ', dynamic: toSmallCaps(t(language, 'admin.chatFaq.testTone_' + detectedTone)) },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testTimeOfDay')) + ': ', dynamic: toSmallCaps(t(language, 'admin.chatFaq.testTime_' + bucket)) },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testPendingContext')) + ': ', dynamic: (pendingContext || toSmallCaps(t(language, 'admin.chatFaq.testNoContext'))) + (contextSource === 'test' ? ' (test)' : '') },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testMatched')) + ': ', dynamic: `💬 "${chatMatch.matchedTrigger}"${aware}` },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testReply')) + ': ', dynamic: `"${reply}"` },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testUserStyle')) + ': ', dynamic: effectiveStyle },
      ...(await testEngagementLines(language, chatMatch, testInput)),
      ...(styledPreview ? [
        { static: toSmallCaps(t(language, 'admin.chatFaq.testStyledReply')) + ': ', dynamic: `"${styledPreview.reply.text.slice(0, 120)}"` },
        { static: toSmallCaps(t(language, 'admin.chatFaq.testFollowUp')) + ': ', dynamic: styledPreview.followUpUsed ? `(used) "${(styledPreview.followUpText || '').slice(0, 80)}"` : toSmallCaps(t(language, 'admin.chatFaq.testFollowUpNone')) }
      ] : []),
      ...(await testSnippetLines(language, userLanguage, styledPreview, user)),
      ...(await testRateLimitLine(language, sender, chatId)),
      { static: toSmallCaps(t(language, 'admin.chatFaq.testFiltersApplied')) + ': ', dynamic: tagged.length ? toSmallCaps(t(language, 'admin.chatFaq.testFiltersToneTime')) : toSmallCaps(t(language, 'admin.chatFaq.testFiltersNone')) },
      { static: toSmallCaps(t(language, 'admin.chatFaq.testNewContext')) + ': ', dynamic: wouldSet }
    ];
  } else {
    const faqResult = matchFaq(trimmed, userLanguage);
    const entry = faqResult && !faqResult.multiple ? faqResult.entry : (faqResult?.candidates?.[0] || null);
    if (!entry) {
      body = [toSmallCaps(t(language, 'admin.chatFaq.testNoMatch'))];
    } else {
      body = [
        { static: toSmallCaps(t(language, 'admin.chatFaq.testInput')) + ': ', dynamic: `"${trimmed}"` },
        { static: toSmallCaps(t(language, 'admin.chatFaq.testMatched')) + ': ', dynamic: `📚 "${entry.question}"` },
        { static: toSmallCaps(t(language, 'admin.chatFaq.testReply')) + ': ', dynamic: `"${entry.answer}"` }
      ];
    }
  }
  logAdminAction(sender, 'chat_test_panel', trimmed.slice(0, 60));
  if (chatMatch) {
    const { replyText: lastReplyText } = await import('../services/replySelector.js');
    const firstReply = lastReplyText(chatMatch.rule.replies && chatMatch.rule.replies[0]);
    sessionManager.setState(sender, chatId, {
      currentMenu: 'chat_test_panel',
      pendingAction: null,
      pendingData: { ...(sessionManager.getSession(sender, chatId)?.pendingData || {}), testLastMatch: { ruleId: chatMatch.rule.id, replyText: firstReply } }
    });
  }
  const text = buildMenu(t(language, 'admin.chatFaq.testResult'), '', [...body, '', '0. ' + t(language, 'admin.test.optionBack')]);
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
}

export async function handleChatBatchTest(context, lines) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const user = getUserByJidSync(sender) || {};
  const userLanguage = user.language || config.defaultLanguage;
  const { matchRule } = await import('../services/chatRuleService.js');
  const { matchFaq } = await import('../services/faqService.js');
  const { replyText: batchReplyText } = await import('../services/replySelector.js');
  const rows = lines.slice(0, 20).map((line) => {
    const chatMatch = matchRule(line, userLanguage);
    if (chatMatch) {
      const reply = batchReplyText(chatMatch.rule.replies && chatMatch.rule.replies[0]);
      return {
        static: '',
        dynamic: `"${line.slice(0, 40)}" → 💬 ${toSmallCaps(t(language, 'admin.chatFaq.batchChatRule'))} "${chatMatch.rule.packId || chatMatch.matchedTrigger || chatMatch.rule.id}" → "${reply.slice(0, 60)}"`
      };
    }
    const faqResult = matchFaq(line, userLanguage);
    const entry = faqResult && !faqResult.multiple ? faqResult.entry : (faqResult?.candidates?.[0] || null);
    if (entry) {
      return { static: '', dynamic: `"${line.slice(0, 40)}" → 📚 "${entry.question.slice(0, 40)}"` };
    }
    return { static: '', dynamic: `"${line.slice(0, 40)}" → ❌ ` + toSmallCaps(t(language, 'admin.chatFaq.testNoMatch')) };
  });
  logAdminAction(sender, 'chat_batch_test', `${rows.length} line(s)`);
  const text = buildMenu('🧪 ' + toSmallCaps(t(language, 'admin.chatFaq.batchTestTitle')), '', [...rows, '', '0. ' + t(language, 'admin.test.optionBack')]);
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_panel' });
}

export function buildAdminBackupMenu(language) {
  return groupedMenu(language, t(language, 'admin.backupRestore.title'), [
    '1. ' + t(language, 'admin.backupRestore.optionBackup'),
    '2. ' + t(language, 'admin.backupRestore.optionRestore'),
    '3. ' + t(language, 'admin.optionExports')
  ]);
}

export function buildAdminLogsMenu(language) {
  return groupedMenu(language, t(language, 'admin.logs.title'), [
    '1. ' + t(language, 'admin.logs.adminLog'),
    '2. ' + t(language, 'admin.logs.errorLog')
  ]);
}

export function buildTestMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.test.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      t(language, 'admin.test.prompt'),
      '',
      '1. ' + t(language, 'admin.test.optionNewUser'),
      '2. ' + t(language, 'admin.test.optionSpam'),
      '3. ' + t(language, 'admin.test.optionBug'),
      '4. ' + t(language, 'admin.test.optionSecurity'),
      '5. ' + t(language, 'admin.test.optionSummary'),
      '9. ' + t(language, 'menuHelp.option'),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.test.replyPrompt')
    ]
  );
}

// ---------------------------------------------------------------------------
// Sending helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// New-renderer resolvers + senders (Phase 6). Verbatim copies of legacy
// fragments; dynamic values resolve live at render time.
// ---------------------------------------------------------------------------

registerDashboardResolver('adminDashboard', async (user, language) => [
  ...dashboardLines(language),
  '',
  ...activityFeedLines(language),
  '',
  t(language, 'admin.prompt'),
  ''
]);

registerSummaryResolver('userMgmtSummary', async (user, language) => {
  const { getAllUsers } = await import('../services/userService.js');
  const { getBlockedUsers } = await import('../services/blockedUsersService.js');
  const users = await getAllUsers();
  let blocked = [];
  try {
    blocked = getBlockedUsers();
  } catch { /* count stays 0 */ }
  const testCount = users.filter((u) => u && u.isTest === true).length;
  return [
    `${toSmallCaps(t(language, 'admin.userManagement.total'))}: ${users.length}`,
    `${toSmallCaps(t(language, 'admin.userManagement.blocked'))}: ${blocked.length}`,
    `${toSmallCaps(t(language, 'admin.userManagement.test'))}: ${testCount}`,
    ''
  ];
});

registerBodyResolver('scheduledTasksBody', async (user, language, ctx) => {
  const { listScheduledTasks } = await import('../services/scheduledTasksService.js');
  const tasks = listScheduledTasks();
  const session = sessionManager.getSession(ctx?.sender || '', ctx?.chatId || ctx?.sender || '') || {};
  const page = session.pendingData?.page || 0;
  const start = page * SCHEDULED_PAGE_SIZE;
  const visible = tasks.slice(start, start + SCHEDULED_PAGE_SIZE);
  const lines = visible.map((task, i) => scheduledTaskLine(start + i + 1, task));
  const hasNext = start + SCHEDULED_PAGE_SIZE < tasks.length;
  const hasPrev = page > 0;
  const body = tasks.length === 0 ? [toSmallCaps(t(language, 'admin.scheduled.empty')), ''] : [...lines, ''];
  if (hasNext) body.push('9. ' + t(language, 'admin.search.next'));
  if (hasPrev) body.push('10. ' + t(language, 'admin.search.previous'));
  if (hasNext || hasPrev) body.push('');
  body.push('0. ' + t(language, 'admin.systemSettings.optionBack'));
  return body;
});

registerBodyResolver('adminSearchBody', async (user, language) => [
  toSmallCaps(t(language, 'admin.search.prompt')),
  '· ' + toSmallCaps(t(language, 'admin.search.scopeUsers')),
  '· ' + toSmallCaps(t(language, 'admin.search.scopeFeedback')),
  '· ' + toSmallCaps(t(language, 'admin.search.scopeCommands')),
  '· ' + toSmallCaps(t(language, 'admin.search.scopeLogs')),
  '',
  '0. ' + t(language, 'admin.systemSettings.optionBack')
]);

async function sendNewAdminPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = opts.language || resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'admin', pendingAction: null, pendingData: null });
  await sendMenuById('adminPanel', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'admin_panel', { resultLine: opts.resultLine, sessionMenu: 'admin' });
}

export async function sendAdminPanel(context, opts = {}) {
  return sendNewAdminPanel(context, opts);
}

export async function sendAdminPanelResult(context, resultLine) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildAdminPanel(language, toSmallCaps(resultLine), sender),
    transitionKey: 'admin_return'
  });
}

function denyNoPermission(sock, sender, language) {
  return sendText(sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
}

function requirePanelPerm(sender, perm) {
  if (!perm) return true;
  return hasPermission(sender, perm);
}

async function sendGroupedAdminMenu(context, menu, text, transitionKey) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: menu, pendingAction: null, pendingData: null });
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey });
}

export async function sendUserManagementMenu(context) {
  const { sendUserManagementMenu: sendComprehensiveUserManagementMenu } = await import('./userManagementCommand.js');
  return sendComprehensiveUserManagementMenu(context);
}

export async function sendChatFaqMenu(context, opts = {}) {
  return sendNewChatFaqMenu(context);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_faq_menu', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildChatFaqMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'chat_faq_menu'
  });
}

// ---------------------------------------------------------------------------
// Chat Settings submenu (global chat system controls)
// ---------------------------------------------------------------------------

function getChatIgnoreCount() {
  try {
    return getChatIgnoreList().length;
  } catch {
    return 0;
  }
}

function chatSettingsValueText(language, key, value) {
  const onOff = (v) => toSmallCaps(t(language, v ? 'admin.systemSettings.enabled' : 'admin.systemSettings.disabled'));
  switch (key) {
    case 'chatEnabled':
    case 'autoTranslate':
    case 'contextAwareness':
    case 'dryRunMode':
    case 'logChatMatches':
    case 'contextAwarenessEnabled':
    case 'replyStylePersonalization':
    case 'followUps':
    case 'rateLimitEnabled':
      return onOff(value === true);
    case 'rateLimitMaxReplies':
      return `${value}/window`;
    case 'rateLimitWindowMs':
      return `${Math.round((Number(value) || 60000) / 1000)}s`;
    case 'rateLimitBehavior':
      return toSmallCaps(t(language, `chatSettings.rateLimitBehavior_${value === 'polite' ? 'polite' : 'silent'}`));
    case 'typingGlobal':
    case 'typingOverride':
    case 'typingReceipts':
      return onOff(value === true);
    case 'typingTargeting': {
      const n = value && typeof value === 'object'
        ? ['mainMenu', 'submenuTransition', 'chatReply', 'confirmation', 'error'].filter((k) => value[k] === true).length
        : 0;
      return `${n}/5`;
    }
    case 'typingDefaultType':
      return toSmallCaps(t(language, `typing.type_${value === 'recording' ? 'recording' : 'composing'}`));
    case 'followUpChance':
      return `${Math.round((Number(value) || 0) * 100)}%`;
    case 'contextExpiryMs':
      return `${Math.round((Number(value) || 120000) / 1000)}s`;
    case 'fuzzyMatching':
    case 'fallbackBehavior':
    case 'priorityMode':
      return toSmallCaps(t(language, `chatSettings.${key}Value_${value}`));
    case 'defaultCooldownSeconds':
      return value > 0 ? `${value}s` : toSmallCaps(t(language, 'chatSettings.valueNone'));
    case 'maxRepliesPerMinute':
      return value > 0 ? `${value}/min` : toSmallCaps(t(language, 'chatSettings.valueUnlimited'));
    case 'languageFilter': {
      const all = ['en', 'fr', 'de', 'es', 'ar'];
      const list = Array.isArray(value) ? value : all;
      return list.length >= all.length ? toSmallCaps(t(language, 'chatSettings.valueAll')) : list.join(',');
    }
    case 'chatReplyDelayMs':
      return value == null ? toSmallCaps(t(language, 'chatSettings.valueGlobal')) : `${value}ms`;
    default:
      return String(value ?? '');
  }
}

export function buildChatSettingsMenu(language, resultLine = '') {
  const s = getChatSettingsState();
  let typingState;
  try {
    typingState = getTypingSettingsState();
  } catch {
    typingState = { globalEnabled: true, allowUserOverride: true, readReceiptsEnabled: true, defaults: { typingType: 'composing', targeting: {} } };
  }
  return buildMenu(
    t(language, 'chatSettings.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. 🔛 ' + toSmallCaps(t(language, 'chatSettings.optChatSystem')) + ': ' + chatSettingsValueText(language, 'chatEnabled', s.chatEnabled),
      '2. 🎯 ' + toSmallCaps(t(language, 'chatSettings.optFuzzy')) + ': ' + chatSettingsValueText(language, 'fuzzyMatching', s.fuzzyMatching),
      '3. ⏱️ ' + toSmallCaps(t(language, 'chatSettings.optCooldown')) + ': ' + chatSettingsValueText(language, 'defaultCooldownSeconds', s.defaultCooldownSeconds),
      '4. 🌊 ' + toSmallCaps(t(language, 'chatSettings.optFallback')) + ': ' + chatSettingsValueText(language, 'fallbackBehavior', s.fallbackBehavior),
      '5. ⚡ ' + toSmallCaps(t(language, 'chatSettings.optPriority')) + ': ' + chatSettingsValueText(language, 'priorityMode', s.priorityMode),
      '6. 🌐 ' + toSmallCaps(t(language, 'chatSettings.optAutoTranslate')) + ': ' + chatSettingsValueText(language, 'autoTranslate', s.autoTranslate),
      '7. 🧠 ' + toSmallCaps(t(language, 'chatSettings.optContext')) + ': ' + chatSettingsValueText(language, 'contextAwareness', s.contextAwareness),
      '8. 🔢 ' + toSmallCaps(t(language, 'chatSettings.optMaxReplies')) + ': ' + chatSettingsValueText(language, 'maxRepliesPerMinute', s.maxRepliesPerMinute),
      '9. 🚫 ' + toSmallCaps(t(language, 'chatSettings.optIgnoreList')) + ` (${getChatIgnoreCount()})`,
      '10. 🧪 ' + toSmallCaps(t(language, 'chatSettings.optDryRun')) + ': ' + chatSettingsValueText(language, 'dryRunMode', s.dryRunMode),
      '11. 📊 ' + toSmallCaps(t(language, 'chatSettings.optLogMatches')) + ': ' + chatSettingsValueText(language, 'logChatMatches', s.logChatMatches),
      '12. 🌍 ' + toSmallCaps(t(language, 'chatSettings.optLanguageFilter')) + ': ' + chatSettingsValueText(language, 'languageFilter', s.languageFilter),
      '13. ⏳ ' + toSmallCaps(t(language, 'chatSettings.optDelayOverride')) + ': ' + chatSettingsValueText(language, 'chatReplyDelayMs', s.chatReplyDelayMs),
      '14. 🔁 ' + toSmallCaps(t(language, 'chatSettings.optAntiRepetition')) + ': ' + chatSettingsValueText(language, 'antiRepetition', s.antiRepetition),
      '15. ⚖️ ' + toSmallCaps(t(language, 'chatSettings.optWeightedRandom')) + ': ' + chatSettingsValueText(language, 'weightedRandom', s.weightedRandom),
      '16. 🧠 ' + toSmallCaps(t(language, 'chatSettings.optContextAwareness')) + ': ' + chatSettingsValueText(language, 'contextAwarenessEnabled', s.contextAwarenessEnabled),
      '17. ⏱️ ' + toSmallCaps(t(language, 'chatSettings.optContextExpiry')) + ': ' + chatSettingsValueText(language, 'contextExpiryMs', s.contextExpiryMs),
      '18. 🧠 ' + toSmallCaps(t(language, 'chatSettings.optManageContexts')),
      '19. 🎭 ' + toSmallCaps(t(language, 'chatSettings.optToneDetection')) + ': ' + chatSettingsValueText(language, 'toneDetection', s.toneDetection),
      '20. 🕒 ' + toSmallCaps(t(language, 'chatSettings.optTimeAwareness')) + ': ' + chatSettingsValueText(language, 'timeAwareness', s.timeAwareness),
      '21. 📝 ' + toSmallCaps(t(language, 'chatSettings.optToneWords')),
      '22. 🎨 ' + toSmallCaps(t(language, 'chatSettings.optReplyStyle')) + ': ' + chatSettingsValueText(language, 'replyStylePersonalization', s.replyStylePersonalization),
      '23. 💬 ' + toSmallCaps(t(language, 'chatSettings.optFollowUps')) + ': ' + chatSettingsValueText(language, 'followUps', s.followUps),
      '24. 🎲 ' + toSmallCaps(t(language, 'chatSettings.optFollowUpChance')) + ': ' + chatSettingsValueText(language, 'followUpChance', s.followUpChance),
      '25. 📊 ' + toSmallCaps(t(language, 'chatSettings.optAbTesting')) + ': ' + chatSettingsValueText(language, 'abTesting', s.abTesting),
      '26. 🎯 ' + toSmallCaps(t(language, 'chatSettings.optContextBoost')) + ': ' + chatSettingsValueText(language, 'contextPriorityBoost', s.contextPriorityBoost),
      '27. 🚦 ' + toSmallCaps(t(language, 'chatSettings.optRateLimit')) + ': ' + chatSettingsValueText(language, 'rateLimitEnabled', s.rateLimitEnabled),
      '28. 🔢 ' + toSmallCaps(t(language, 'chatSettings.optRateLimitMax')) + ': ' + chatSettingsValueText(language, 'rateLimitMaxReplies', s.rateLimitMaxReplies),
      '29. ⏱️ ' + toSmallCaps(t(language, 'chatSettings.optRateLimitWindow')) + ': ' + chatSettingsValueText(language, 'rateLimitWindowMs', s.rateLimitWindowMs),
      '30. 🧩 ' + toSmallCaps(t(language, 'chatSettings.optSnippetDepth')) + ': ' + chatSettingsValueText(language, 'snippetMaxDepth', s.snippetMaxDepth),
      '31. ⌨️ ' + toSmallCaps(t(language, 'chatSettings.optTypingAnimation')) + ': ' + chatSettingsValueText(language, 'typingGlobal', typingState.globalEnabled),
      '32. 🎛️ ' + toSmallCaps(t(language, 'chatSettings.optTypingTargeting')) + ': ' + chatSettingsValueText(language, 'typingTargeting', typingState.defaults.targeting),
      '33. 🔒 ' + toSmallCaps(t(language, 'chatSettings.optTypingOverride')) + ': ' + chatSettingsValueText(language, 'typingOverride', typingState.allowUserOverride),
      '34. 📖 ' + toSmallCaps(t(language, 'chatSettings.optTypingReceipts')) + ': ' + chatSettingsValueText(language, 'typingReceipts', typingState.readReceiptsEnabled),
      '35. 🎙️ ' + toSmallCaps(t(language, 'chatSettings.optTypingDefaultType')) + ': ' + chatSettingsValueText(language, 'typingDefaultType', typingState.defaults.typingType),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

export async function sendChatSettingsPanel(context, opts = {}) {
  return sendNewChatSettingsPanel(context, opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildChatSettingsMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'chat_settings'
  });
}

export async function handleChatSettingsReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const n = String(selectedNumber);
  if (n === '0') return sendChatFaqMenu(context);
  if (n === '1') return toggleChatSystemSetting(context, 'chatEnabled');
  if (n === '2') return showChatSettingsFuzzy(context);
  if (n === '3') return showChatSettingsCooldown(context);
  if (n === '4') return showChatSettingsFallback(context);
  if (n === '5') return showChatSettingsPriority(context);
  if (n === '6') return toggleChatSystemSetting(context, 'autoTranslate');
  if (n === '7') return toggleChatSystemSetting(context, 'contextAwareness');
  if (n === '8') return showChatSettingsMaxReplies(context);
  if (n === '9') return showChatSettingsIgnoreList(context);
  if (n === '10') return toggleChatSystemSetting(context, 'dryRunMode');
  if (n === '11') return toggleChatSystemSetting(context, 'logChatMatches');
  if (n === '12') return showChatSettingsLanguageFilter(context);
  if (n === '13') return showChatSettingsDelayOverride(context);
  if (n === '14') return toggleChatSystemSetting(context, 'antiRepetition');
  if (n === '15') return toggleChatSystemSetting(context, 'weightedRandom');
  if (n === '16') return toggleChatSystemSetting(context, 'contextAwarenessEnabled');
  if (n === '17') return showChatSettingsContextExpiry(context);
  if (n === '18') return showContextRegistry(context);
  if (n === '19') return toggleChatSystemSetting(context, 'toneDetection');
  if (n === '20') return toggleChatSystemSetting(context, 'timeAwareness');
  if (n === '21') return showToneWordsMenu(context);
  if (n === '22') return toggleChatSystemSetting(context, 'replyStylePersonalization');
  if (n === '23') return toggleChatSystemSetting(context, 'followUps');
  if (n === '24') return showFollowUpChanceMenu(context);
  if (n === '25') return toggleChatSystemSetting(context, 'abTesting');
  if (n === '26') return showContextBoostMenu(context);
  if (n === '27') return toggleChatSystemSetting(context, 'rateLimitEnabled');
  if (n === '28') return showRateLimitMaxMenu(context);
  if (n === '29') return showRateLimitWindowMenu(context);
  if (n === '30') return showSnippetDepthMenu(context);
  if (n === '31') return toggleTypingAdminSetting(context, 'globalEnabled');
  if (n === '32') return showTypingTargetingMenu(context);
  if (n === '33') return toggleTypingAdminSetting(context, 'allowUserOverride');
  if (n === '34') return toggleTypingAdminSetting(context, 'readReceiptsEnabled');
  if (n === '35') return showTypingDefaultTypeMenu(context);
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 35 }));
  return sendChatSettingsPanel(context);
}

export async function showContextBoostMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().contextPriorityBoost;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_context_boost', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🎯 ' + toSmallCaps(t(language, 'chatSettings.contextBoostTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: current })),
        '',
        toSmallCaps(t(language, 'chatSettings.contextBoostPrompt')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_context_boost'
  });
}

export async function handleContextBoostMenu(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const n = Number(trimmed);
  if (!trimmed || !Number.isFinite(n) || n <= 0) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: 10000 }));
    return showContextBoostMenu(context);
  }
  const { updateSetting } = await import('../services/chatSettingsService.js');
  updateSetting('contextPriorityBoost', Math.min(10000, Math.floor(n)));
  logAdminAction(sender, 'chat_settings', `contextPriorityBoost → ${Math.min(10000, Math.floor(n))}`);
  return sendChatSettingsPanel(context);
}

export async function showFollowUpChanceMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().followUpChance;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_followup_chance', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🎲 ' + toSmallCaps(t(language, 'chatSettings.followUpChanceTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: `${Math.round((Number(current) || 0) * 100)}%` })),
        '',
        toSmallCaps(t(language, 'chatSettings.followUpChancePrompt')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_followup_chance'
  });
}

export async function handleFollowUpChanceMenu(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const pct = Number(trimmed);
  if (!trimmed || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 100 }));
    return showFollowUpChanceMenu(context);
  }
  const { updateSetting } = await import('../services/chatSettingsService.js');
  updateSetting('followUpChance', pct / 100);
  logAdminAction(sender, 'chat_settings', `followUpChance → ${pct / 100}`);
  return sendChatSettingsPanel(context);
}

export async function showToneWordsMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getToneWords } = await import('../utils/toneDetector.js');
  const words = getToneWords();
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_tone_words', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '📝 ' + toSmallCaps(t(language, 'chatSettings.toneWordsTitle')),
      '',
      [
        ...(opts.resultLine ? [toSmallCaps(opts.resultLine), ''] : []),
        `1. 📋 ${toSmallCaps(t(language, 'chatSettings.toneWordsPositive'))} (${words.positive.length})`,
        `2. 📋 ${toSmallCaps(t(language, 'chatSettings.toneWordsNegative'))} (${words.negative.length})`,
        `3. ➕ ` + toSmallCaps(t(language, 'chatSettings.toneWordsAdd')),
        `4. ➖ ` + toSmallCaps(t(language, 'chatSettings.toneWordsRemove')),
        `5. 🔄 ` + toSmallCaps(t(language, 'chatSettings.toneWordsReset')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_tone_words'
  });
}

export async function handleToneWordsMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const mode = session.pendingData?.toneWordsMode || null;
  const { getToneWords, addToneWord, removeToneWord, resetToneWords } = await import('../utils/toneDetector.js');
  if (!mode) {
    if (trimmed === '0') return sendChatSettingsPanel(context);
    if (trimmed === '1' || trimmed === '2') {
      const words = getToneWords();
      const list = trimmed === '1' ? words.positive : words.negative;
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_tone_words', pendingAction: null, pendingData: { toneWordsMode: 'list' } });
      return sendMenu({
        sock: context.sock, sender, chatId,
        text: buildMenu(
          '📝 ' + toSmallCaps(t(language, 'chatSettings.toneWordsTitle')),
          '',
          [...(list.length ? list.map((w, i) => ({ static: `${i + 1}. `, dynamic: w })) : [toSmallCaps(t(language, 'chatSettings.toneWordsEmpty'))]), '', '0. ' + t(language, 'admin.test.optionBack')]
        ),
        transitionKey: 'chat_settings_tone_words'
      });
    }
    if (trimmed === '3' || trimmed === '4') {
      const mode = trimmed === '3' ? 'add' : 'remove';
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_tone_words', pendingAction: null, pendingData: { toneWordsMode: mode } });
      const lines = [toSmallCaps(t(language, mode === 'add' ? 'chatSettings.toneWordsAddPrompt' : 'chatSettings.toneWordsRemovePrompt')), ''];
      if (mode === 'remove') {
        const words = getToneWords();
        const all = [...words.positive.map((w) => ({ w, cat: '+' })), ...words.negative.map((w) => ({ w, cat: '−' }))];
        lines.push(...all.slice(0, 60).map((x, i) => ({ static: `${i + 1}. [${x.cat}] `, dynamic: x.w })));
        lines.push('');
      }
      return sendMenu({
        sock: context.sock, sender, chatId,
        text: buildMenu(
          '📝 ' + toSmallCaps(t(language, 'chatSettings.toneWordsTitle')),
          '',
          [...lines, '0. ' + t(language, 'admin.test.optionBack')]
        ),
        transitionKey: 'chat_settings_tone_words'
      });
    }
    if (trimmed === '5') {
      resetToneWords();
      logAdminAction(sender, 'chat_settings', 'tone words reset');
      return showToneWordsMenu(context, { resultLine: t(language, 'chatSettings.toneWordsResetDone') });
    }
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 5 }));
    return showToneWordsMenu(context);
  }
  if (trimmed === '0') return showToneWordsMenu(context);
  if (mode === 'list') return showToneWordsMenu(context);
  if (mode === 'add') {
    const parts = trimmed.split(/\s+/);
    const category = parts[parts.length - 1].toLowerCase().startsWith('neg') ? 'negative' : parts[parts.length - 1].toLowerCase().startsWith('pos') ? 'positive' : null;
    const word = category ? parts.slice(0, -1).join(' ') : trimmed;
    const cat = category || 'positive';
    if (!addToneWord(word, cat)) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'chatSettings.toneWordsAddInvalid')));
      return showToneWordsMenu(context);
    }
    logAdminAction(sender, 'chat_settings', `tone word added: ${word} (${cat})`);
    return showToneWordsMenu(context);
  }
  if (mode === 'remove') {
    const words = getToneWords();
    const all = [...words.positive.map((w) => ({ w, cat: 'positive' })), ...words.negative.map((w) => ({ w, cat: 'negative' }))];
    const picked = all[Number(trimmed) - 1];
    if (!picked || !removeToneWord(picked.w, picked.cat)) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: all.length }));
      return showToneWordsMenu(context);
    }
    logAdminAction(sender, 'chat_settings', `tone word removed: ${picked.w}`);
    return showToneWordsMenu(context);
  }
  return showToneWordsMenu(context);
}

export async function showChatSettingsContextExpiry(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().contextExpiryMs;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_context_expiry', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '⏱️ ' + toSmallCaps(t(language, 'chatSettings.contextExpiryTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: `${Math.round((Number(current) || 120000) / 1000)}s` })),
        '',
        toSmallCaps(t(language, 'chatSettings.contextExpiryPrompt')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_context_expiry'
  });
}

export async function handleChatSettingsContextExpiry(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const secs = Math.floor(Number(trimmed) || 0);
  if (!trimmed || Number.isNaN(Number(trimmed)) || secs <= 0) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: 3600 }));
    return showChatSettingsContextExpiry(context);
  }
  const { updateSetting } = await import('../services/chatSettingsService.js');
  updateSetting('contextExpiryMs', Math.min(3600000, secs * 1000));
  logAdminAction(sender, 'chat_settings', `contextExpiryMs → ${secs * 1000}`);
  return sendChatSettingsPanel(context);
}

export async function showContextRegistry(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getContexts } = await import('../services/contextRegistry.js');
  const names = Object.keys(getContexts()).sort();
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_context_registry', pendingAction: null, pendingData: { names } });
  const lines = names.length
    ? names.map((name, i) => ({ static: `${i + 1}. `, dynamic: name }))
    : [toSmallCaps(t(language, 'chatSettings.registryEmpty'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🧠 ' + toSmallCaps(t(language, 'chatSettings.registryTitle')),
      '',
      [
        ...lines,
        '',
        `${names.length + 1}. ➕ ` + toSmallCaps(t(language, 'chatSettings.registryAdd')),
        `${names.length + 2}. ✏️ ` + toSmallCaps(t(language, 'chatSettings.registryRename')),
        `${names.length + 3}. 🗑️ ` + toSmallCaps(t(language, 'chatSettings.registryDelete')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_context_registry'
  });
}

export async function handleContextRegistry(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const names = session.pendingData?.names || [];
  const mode = session.pendingData?.mode || null;
  if (!mode) {
    if (trimmed === '0') return sendChatSettingsPanel(context);
    const n = Number(trimmed);
    if (n === names.length + 1 || n === names.length + 2 || n === names.length + 3) {
      const next = n === names.length + 1 ? 'add' : n === names.length + 2 ? 'rename' : 'delete';
      if (next !== 'add' && !names.length) return showContextRegistry(context);
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_context_registry', pendingAction: null, pendingData: { names, mode: next } });
      return sendMenu({
        sock: context.sock, sender, chatId,
        text: buildMenu(
          '🧠 ' + toSmallCaps(t(language, 'chatSettings.registryTitle')),
          '',
          [toSmallCaps(t(language, next === 'add' ? 'chatSettings.registryAddPrompt' : next === 'rename' ? 'chatSettings.registryRenamePrompt' : 'chatSettings.registryDeletePrompt')), '', '0. ' + t(language, 'admin.test.optionBack')]
        ),
        transitionKey: 'chat_context_registry'
      });
    }
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: names.length + 3 }));
    return showContextRegistry(context);
  }
  if (trimmed === '0') return showContextRegistry(context);
  const { registerContext, renameContext, deleteContext, isValidContextName } = await import('../services/contextRegistry.js');
  if (mode === 'add') {
    if (!isValidContextName(trimmed)) {
      await sendText(context.sock, sender, L(language, 'chatResponses.contextInvalidName'));
      return showContextRegistry(context);
    }
    registerContext(trimmed, { createdBy: sender });
    logAdminAction(sender, 'chat_context_register', trimmed);
    return showContextRegistry(context);
  }
  if (mode === 'delete') {
    const name = names[Number(trimmed) - 1];
    if (!name || !deleteContext(name)) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: names.length }));
      return showContextRegistry(context);
    }
    logAdminAction(sender, 'chat_context_delete', name);
    return showContextRegistry(context);
  }
  // rename: "oldNumber newName" or "oldName newName"
  const parts = trimmed.split(/\s+/);
  const first = parts[0] || '';
  const oldName = /^\d+$/.test(first) ? names[Number(first) - 1] : first;
  const target = parts.slice(1).join(' ').trim();
  if (!oldName || !isValidContextName(target) || !renameContext(oldName, target)) {
    await sendText(context.sock, sender, L(language, 'chatSettings.registryRenameInvalid'));
    return showContextRegistry(context);
  }
  logAdminAction(sender, 'chat_context_rename', `${oldName} → ${target}`);
  return showContextRegistry(context);
}

export async function toggleChatSystemSetting(context, key) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const { updateSetting, getSettings } = await import('../services/chatSettingsService.js');
  const next = !(getSettings()[key] === true);
  updateSetting(key, next);
  logger.info({ sender, [key]: next }, '[CHAT SETTINGS] toggled setting');
  logAdminAction(sender, 'chat_settings', `${key} → ${next ? 'on' : 'off'}`);
  return sendChatSettingsPanel(context);
}

export async function showChatSettingsFuzzy(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().fuzzyMatching;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_fuzzy', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🎯 ' + toSmallCaps(t(language, 'chatSettings.fuzzyTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: t(language, `chatSettings.fuzzyMatchingValue_${current}`) })),
        '',
        '1. ' + toSmallCaps(t(language, 'chatSettings.fuzzyStrict')),
        '2. ' + toSmallCaps(t(language, 'chatSettings.fuzzyNormal')),
        '3. ' + toSmallCaps(t(language, 'chatSettings.fuzzyLoose')),
        '4. ' + toSmallCaps(t(language, 'chatSettings.fuzzyOff')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_fuzzy'
  });
}

export async function handleChatSettingsFuzzy(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const map = { 1: 'strict', 2: 'normal', 3: 'loose', 4: 'off' };
  if (String(selectedNumber) === '0') return sendChatSettingsPanel(context);
  const value = map[Number(selectedNumber)];
  if (!value) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
    return showChatSettingsFuzzy(context);
  }
  const { updateSetting } = await import('../services/chatSettingsService.js');
  updateSetting('fuzzyMatching', value);
  logAdminAction(sender, 'chat_settings', `fuzzyMatching → ${value}`);
  return sendChatSettingsPanel(context);
}

const COOLDOWN_PRESETS = { 1: 0, 2: 30, 3: 60, 4: 300, 5: 1800 };

export async function showChatSettingsCooldown(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().defaultCooldownSeconds;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_cooldown', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '⏱️ ' + toSmallCaps(t(language, 'chatSettings.cooldownTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: current > 0 ? `${current}s` : t(language, 'chatSettings.valueNone') })),
        '',
        toSmallCaps(t(language, 'chatSettings.cooldownHint')),
        '',
        '1. ' + toSmallCaps(t(language, 'chatSettings.cooldownNone')),
        '2. ' + toSmallCaps(t(language, 'chatSettings.cooldown30s')),
        '3. ' + toSmallCaps(t(language, 'chatSettings.cooldown1m')),
        '4. ' + toSmallCaps(t(language, 'chatSettings.cooldown5m')),
        '5. ' + toSmallCaps(t(language, 'chatSettings.cooldown30m')),
        '6. ' + toSmallCaps(t(language, 'chatSettings.cooldownCustom')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_cooldown'
  });
}

export async function handleChatSettingsCooldown(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const { updateSetting } = await import('../services/chatSettingsService.js');
  if (session.pendingData?.awaitingCustom) {
    const seconds = Math.min(86400, Math.max(0, Math.floor(Number(trimmed) || 0)));
    if (!trimmed || Number.isNaN(Number(trimmed))) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 86400 }));
      return showChatSettingsCooldown(context);
    }
    updateSetting('defaultCooldownSeconds', seconds);
    logAdminAction(sender, 'chat_settings', `defaultCooldownSeconds → ${seconds}`);
    return sendChatSettingsPanel(context);
  }
  if (trimmed === '6') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_cooldown', pendingAction: null, pendingData: { awaitingCustom: true } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('⏱️ ' + toSmallCaps(t(language, 'chatSettings.cooldownTitle')), '', [toSmallCaps(t(language, 'chatSettings.cooldownCustomPrompt')), '', '0. ' + t(language, 'admin.test.optionBack')]),
      transitionKey: 'chat_settings_cooldown'
    });
  }
  if (!(trimmed in { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 })) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return showChatSettingsCooldown(context);
  }
  updateSetting('defaultCooldownSeconds', COOLDOWN_PRESETS[trimmed]);
  logAdminAction(sender, 'chat_settings', `defaultCooldownSeconds → ${COOLDOWN_PRESETS[trimmed]}`);
  return sendChatSettingsPanel(context);
}

export async function showChatSettingsFallback(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().fallbackBehavior;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_fallback', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🌊 ' + toSmallCaps(t(language, 'chatSettings.fallbackTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: t(language, `chatSettings.fallbackBehaviorValue_${current}`) })),
        '',
        '1. ' + toSmallCaps(t(language, 'chatSettings.fallbackFriendly')),
        '2. ' + toSmallCaps(t(language, 'chatSettings.fallbackSilent')),
        '3. ' + toSmallCaps(t(language, 'chatSettings.fallbackAskAdmin')),
        '4. ' + toSmallCaps(t(language, 'chatSettings.fallbackHelpOnly')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_fallback'
  });
}

export async function handleChatSettingsFallback(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const map = { 1: 'friendly', 2: 'silent', 3: 'ask_admin', 4: 'help_only' };
  if (String(selectedNumber) === '0') return sendChatSettingsPanel(context);
  const value = map[Number(selectedNumber)];
  if (!value) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
    return showChatSettingsFallback(context);
  }
  const { updateSetting } = await import('../services/chatSettingsService.js');
  updateSetting('fallbackBehavior', value);
  logAdminAction(sender, 'chat_settings', `fallbackBehavior → ${value}`);
  return sendChatSettingsPanel(context);
}

export async function showChatSettingsPriority(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().priorityMode;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_priority', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '⚡ ' + toSmallCaps(t(language, 'chatSettings.priorityTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: t(language, `chatSettings.priorityModeValue_${current}`) })),
        '',
        '1. ' + toSmallCaps(t(language, 'chatSettings.priorityStrict')),
        '2. ' + toSmallCaps(t(language, 'chatSettings.priorityRandom')),
        '3. ' + toSmallCaps(t(language, 'chatSettings.priorityHighest')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_priority'
  });
}

export async function handleChatSettingsPriority(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const map = { 1: 'strict', 2: 'random', 3: 'highest' };
  if (String(selectedNumber) === '0') return sendChatSettingsPanel(context);
  const value = map[Number(selectedNumber)];
  if (!value) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
    return showChatSettingsPriority(context);
  }
  const { updateSetting } = await import('../services/chatSettingsService.js');
  updateSetting('priorityMode', value);
  logAdminAction(sender, 'chat_settings', `priorityMode → ${value}`);
  return sendChatSettingsPanel(context);
}

const MAX_REPLIES_PRESETS = { 1: 0, 2: 3, 3: 5, 4: 10, 5: 20 };

export async function showChatSettingsMaxReplies(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().maxRepliesPerMinute;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_max_replies', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🔢 ' + toSmallCaps(t(language, 'chatSettings.maxRepliesTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: current > 0 ? `${current}/min` : t(language, 'chatSettings.valueUnlimited') })),
        '',
        '1. ' + toSmallCaps(t(language, 'chatSettings.maxRepliesNone')),
        '2. 3',
        '3. 5',
        '4. 10',
        '5. 20',
        '6. ' + toSmallCaps(t(language, 'chatSettings.maxRepliesCustom')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_max_replies'
  });
}

export async function handleChatSettingsMaxReplies(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const { updateSetting } = await import('../services/chatSettingsService.js');
  if (session.pendingData?.awaitingCustom) {
    if (!trimmed || Number.isNaN(Number(trimmed)) || Number(trimmed) < 0) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 1000 }));
      return showChatSettingsMaxReplies(context);
    }
    updateSetting('maxRepliesPerMinute', Math.min(1000, Math.floor(Number(trimmed))));
    logAdminAction(sender, 'chat_settings', `maxRepliesPerMinute → ${trimmed}`);
    return sendChatSettingsPanel(context);
  }
  if (trimmed === '6') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_max_replies', pendingAction: null, pendingData: { awaitingCustom: true } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🔢 ' + toSmallCaps(t(language, 'chatSettings.maxRepliesTitle')), '', [toSmallCaps(t(language, 'chatSettings.maxRepliesCustomPrompt')), '', '0. ' + t(language, 'admin.test.optionBack')]),
      transitionKey: 'chat_settings_max_replies'
    });
  }
  if (!(trimmed in { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 })) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return showChatSettingsMaxReplies(context);
  }
  updateSetting('maxRepliesPerMinute', MAX_REPLIES_PRESETS[trimmed]);
  logAdminAction(sender, 'chat_settings', `maxRepliesPerMinute → ${MAX_REPLIES_PRESETS[trimmed]}`);
  return sendChatSettingsPanel(context);
}

const RATE_LIMIT_MAX_PRESETS = { 1: 3, 2: 5, 3: 10, 4: 20 };

export async function showRateLimitMaxMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const s = getSettings();
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_rate_limit_max', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🔢 ' + toSmallCaps(t(language, 'chatSettings.rateLimitMaxTitle')),
      '',
      [
        { static: toSmallCaps(t(language, 'chatSettings.currentValue', { value: `${s.rateLimitMaxReplies}/window` })) + ' · ', dynamic: toSmallCaps(t(language, `chatSettings.rateLimitBehavior_${s.rateLimitBehavior === 'polite' ? 'polite' : 'silent'}`)) },
        '',
        '1. 3',
        '2. 5',
        '3. 10',
        '4. 20',
        '5. ' + toSmallCaps(t(language, 'chatSettings.rateLimitMaxCustom')),
        '6. 🔇 ' + toSmallCaps(t(language, 'chatSettings.rateLimitSilent')),
        '7. 🗣️ ' + toSmallCaps(t(language, 'chatSettings.rateLimitPolite')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_rate_limit_max'
  });
}

export async function handleRateLimitMaxMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const { updateSetting } = await import('../services/chatSettingsService.js');
  if (session.pendingData?.awaitingCustom) {
    const n = Math.floor(Number(trimmed));
    if (!trimmed || Number.isNaN(n) || n < 1 || n > 1000) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: 1000 }));
      return showRateLimitMaxMenu(context);
    }
    updateSetting('rateLimitMaxReplies', n);
    logAdminAction(sender, 'chat_settings', `rateLimitMaxReplies → ${n}`);
    return sendChatSettingsPanel(context);
  }
  if (trimmed === '5') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_rate_limit_max', pendingAction: null, pendingData: { awaitingCustom: true } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🔢 ' + toSmallCaps(t(language, 'chatSettings.rateLimitMaxTitle')), '', [toSmallCaps(t(language, 'chatSettings.rateLimitMaxCustomPrompt')), '', '0. ' + t(language, 'admin.test.optionBack')]),
      transitionKey: 'chat_settings_rate_limit_max'
    });
  }
  if (trimmed === '6' || trimmed === '7') {
    const behavior = trimmed === '7' ? 'polite' : 'silent';
    updateSetting('rateLimitBehavior', behavior);
    logAdminAction(sender, 'chat_settings', `rateLimitBehavior → ${behavior}`);
    return showRateLimitMaxMenu(context);
  }
  if (!(trimmed in RATE_LIMIT_MAX_PRESETS)) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 7 }));
    return showRateLimitMaxMenu(context);
  }
  updateSetting('rateLimitMaxReplies', RATE_LIMIT_MAX_PRESETS[trimmed]);
  logAdminAction(sender, 'chat_settings', `rateLimitMaxReplies → ${RATE_LIMIT_MAX_PRESETS[trimmed]}`);
  return sendChatSettingsPanel(context);
}

const RATE_LIMIT_WINDOW_PRESETS = { 1: 15000, 2: 30000, 3: 60000, 4: 120000, 5: 300000 };

export async function showRateLimitWindowMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().rateLimitWindowMs;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_rate_limit_window', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '⏱️ ' + toSmallCaps(t(language, 'chatSettings.rateLimitWindowTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: `${Math.round(current / 1000)}s` })),
        '',
        '1. 15s',
        '2. 30s',
        '3. 60s',
        '4. 120s',
        '5. 300s',
        '6. ' + toSmallCaps(t(language, 'chatSettings.rateLimitWindowCustom')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_rate_limit_window'
  });
}

export async function handleRateLimitWindowMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const { updateSetting } = await import('../services/chatSettingsService.js');
  if (session.pendingData?.awaitingCustom) {
    const n = Math.floor(Number(trimmed));
    if (!trimmed || Number.isNaN(n) || n < 5 || n > 3600) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 5, max: 3600 }));
      return showRateLimitWindowMenu(context);
    }
    updateSetting('rateLimitWindowMs', n * 1000);
    logAdminAction(sender, 'chat_settings', `rateLimitWindowMs → ${n * 1000}`);
    return sendChatSettingsPanel(context);
  }
  if (trimmed === '6') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_rate_limit_window', pendingAction: null, pendingData: { awaitingCustom: true } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('⏱️ ' + toSmallCaps(t(language, 'chatSettings.rateLimitWindowTitle')), '', [toSmallCaps(t(language, 'chatSettings.rateLimitWindowCustomPrompt')), '', '0. ' + t(language, 'admin.test.optionBack')]),
      transitionKey: 'chat_settings_rate_limit_window'
    });
  }
  if (!(trimmed in RATE_LIMIT_WINDOW_PRESETS)) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return showRateLimitWindowMenu(context);
  }
  updateSetting('rateLimitWindowMs', RATE_LIMIT_WINDOW_PRESETS[trimmed]);
  logAdminAction(sender, 'chat_settings', `rateLimitWindowMs → ${RATE_LIMIT_WINDOW_PRESETS[trimmed]}`);
  return sendChatSettingsPanel(context);
}

export async function showSnippetDepthMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().snippetMaxDepth;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_snippet_depth', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🧩 ' + toSmallCaps(t(language, 'chatSettings.snippetDepthTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: current })),
        '',
        toSmallCaps(t(language, 'chatSettings.snippetDepthPrompt')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_snippet_depth'
  });
}

export async function toggleTypingAdminSetting(context, key) {
  const sender = context.sender;
  const { updateTypingSetting, getTypingSettings } = await import('../services/typingSettingsService.js');
  const next = !(getTypingSettings()[key] === true);
  updateTypingSetting(key, next);
  logger.info({ sender, [key]: next }, '[CHAT SETTINGS] toggled typing setting');
  logAdminAction(sender, 'chat_settings', `typing ${key} → ${next ? 'on' : 'off'}`);
  return sendChatSettingsPanel(context);
}

const TYPING_TARGET_ADMIN_KEYS = ['mainMenu', 'submenuTransition', 'chatReply', 'confirmation', 'error'];

export async function showTypingTargetingMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getTypingSettings } = await import('../services/typingSettingsService.js');
  const admin = getTypingSettings();
  const tg = (admin.defaults && admin.defaults.targeting) || {};
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_typing_targeting', pendingAction: null, pendingData: null });
  const onOff = (v) => toSmallCaps(v ? t(language, 'common.onFlag') : t(language, 'common.offFlag'));
  const rows = [
    ['🏠', 'typing.target_mainMenu', tg.mainMenu],
    ['📂', 'typing.target_submenu', tg.submenuTransition],
    ['💬', 'typing.target_chat', tg.chatReply],
    ['✅', 'typing.target_confirm', tg.confirmation],
    ['⚠️', 'typing.target_errors', tg.error]
  ];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🎛️ ' + toSmallCaps(t(language, 'chatSettings.typingTargetingTitle')),
      '',
      [
        ...rows.map(([emoji, key, val], i) => `${i + 1}. ${emoji} ` + toSmallCaps(t(language, key)) + ': ' + onOff(val === true)),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_typing_targeting'
  });
}

export async function handleTypingTargetingMenu(context, input) {
  const sender = context.sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const idx = Number(trimmed) - 1;
  const language = resolveLanguage(sender);
  if (!TYPING_TARGET_ADMIN_KEYS[idx]) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 5 }));
    return showTypingTargetingMenu(context);
  }
  const { toggleTypingTarget } = await import('../services/typingSettingsService.js');
  const next = toggleTypingTarget(TYPING_TARGET_ADMIN_KEYS[idx]);
  logAdminAction(sender, 'chat_settings', `typing targeting ${TYPING_TARGET_ADMIN_KEYS[idx]} → ${next.defaults.targeting[TYPING_TARGET_ADMIN_KEYS[idx]]}`);
  return showTypingTargetingMenu(context);
}

export async function showTypingDefaultTypeMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_typing_type', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🎙️ ' + toSmallCaps(t(language, 'typing.typeTitle')),
      '',
      [
        '1. ⌨️ ' + toSmallCaps(t(language, 'typing.type_composing')),
        '2. 🎙️ ' + toSmallCaps(t(language, 'typing.type_recording')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: opts.transitionKey || 'chat_settings_typing_type'
  });
}

export async function handleTypingDefaultTypeMenu(context, input) {
  const sender = context.sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const language = resolveLanguage(sender);
  if (trimmed !== '1' && trimmed !== '2') {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
    return showTypingDefaultTypeMenu(context);
  }
  const { updateTypingSetting } = await import('../services/typingSettingsService.js');
  updateTypingSetting('typingType', trimmed === '2' ? 'recording' : 'composing');
  logAdminAction(sender, 'chat_settings', `typing default type → ${trimmed === '2' ? 'recording' : 'composing'}`);
  return sendChatSettingsPanel(context);
}

export async function handleSnippetDepthMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const n = Math.floor(Number(trimmed));
  if (!trimmed || Number.isNaN(n) || n < 1 || n > 10) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: 10 }));
    return showSnippetDepthMenu(context);
  }
  const { updateSetting } = await import('../services/chatSettingsService.js');
  updateSetting('snippetMaxDepth', n);
  logAdminAction(sender, 'chat_settings', `snippetMaxDepth → ${n}`);
  return sendChatSettingsPanel(context);
}

export async function showChatSettingsIgnoreList(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_ignore_list', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🚫 ' + toSmallCaps(t(language, 'chatSettings.ignoreTitle')),
      '',
      [
        '1. 📋 ' + toSmallCaps(t(language, 'chatSettings.ignoreView')),
        '2. ➕ ' + toSmallCaps(t(language, 'chatSettings.ignoreAdd')),
        '3. ➖ ' + toSmallCaps(t(language, 'chatSettings.ignoreRemove')),
        '4. 🗑️ ' + toSmallCaps(t(language, 'chatSettings.ignoreClear')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_ignore_list'
  });
}

export async function handleChatSettingsIgnoreList(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const svc = await import('../services/chatSettingsService.js');
  const awaiting = session.pendingData?.awaiting;
  if (awaiting === 'add') {
    if (trimmed === '0') return showChatSettingsIgnoreList(context);
    const added = svc.addIgnore(trimmed);
    logAdminAction(sender, 'chat_settings', `ignore add ${trimmed} → ${added}`);
    return showChatSettingsIgnoreList(context);
  }
  if (awaiting === 'remove') {
    if (trimmed === '0') return showChatSettingsIgnoreList(context);
    const list = svc.getIgnoreList();
    const jid = list[Number(trimmed) - 1];
    if (jid) {
      svc.removeIgnore(jid);
      logAdminAction(sender, 'chat_settings', `ignore remove ${jid}`);
    }
    return showChatSettingsIgnoreList(context);
  }
  if (awaiting === 'clear') {
    if (trimmed === '1') {
      svc.clearIgnoreList();
      logAdminAction(sender, 'chat_settings', 'ignore list cleared');
    }
    return showChatSettingsIgnoreList(context);
  }
  if (trimmed === '0') return sendChatSettingsPanel(context);
  if (trimmed === '1') {
    const list = svc.getIgnoreList();
    const text = buildMenu(
      '🚫 ' + toSmallCaps(t(language, 'chatSettings.ignoreTitle')),
      '',
      [...(list.length ? list.map((j, i) => ({ static: `${i + 1}. `, dynamic: j })) : [toSmallCaps(t(language, 'chatSettings.ignoreEmpty'))]), '', '0. ' + t(language, 'admin.test.optionBack')]
    );
    return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_settings_ignore_list' });
  }
  if (trimmed === '2' || trimmed === '3' || trimmed === '4') {
    const mode = trimmed === '2' ? 'add' : trimmed === '3' ? 'remove' : 'clear';
    if (mode === 'remove') {
      const list = svc.getIgnoreList();
      if (!list.length) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'chatSettings.ignoreEmpty')));
        return showChatSettingsIgnoreList(context);
      }
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_ignore_list', pendingAction: null, pendingData: { awaiting: mode } });
      const text = buildMenu(
        '🚫 ' + toSmallCaps(t(language, 'chatSettings.ignoreTitle')),
        '',
        [...list.map((j, i) => ({ static: `${i + 1}. `, dynamic: j })), '', '0. ' + t(language, 'admin.test.optionBack')]
      );
      return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_settings_ignore_list' });
    }
    if (mode === 'clear') {
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_ignore_list', pendingAction: null, pendingData: { awaiting: mode } });
      const text = buildMenu(
        '🚫 ' + toSmallCaps(t(language, 'chatSettings.ignoreTitle')),
        '',
        [toSmallCaps(t(language, 'chatSettings.ignoreClearConfirm')), '', '1. ✅ ' + t(language, 'admin.yes'), '2. ❌ ' + t(language, 'admin.no'), '', '0. ' + t(language, 'admin.test.optionBack')]
      );
      return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_settings_ignore_list' });
    }
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_ignore_list', pendingAction: null, pendingData: { awaiting: mode } });
    const text = buildMenu(
      '🚫 ' + toSmallCaps(t(language, 'chatSettings.ignoreTitle')),
      '',
      [toSmallCaps(t(language, 'chatSettings.ignoreAddPrompt')), '', '0. ' + t(language, 'admin.test.optionBack')]
    );
    return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_settings_ignore_list' });
  }
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
  return showChatSettingsIgnoreList(context);
}

export async function showChatSettingsLanguageFilter(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const active = getSettings().languageFilter;
  const langs = [['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ar', 'العربية']];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_language_filter', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '🌍 ' + toSmallCaps(t(language, 'chatSettings.languageFilterTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.languageFilterHint')),
        '',
        ...langs.map(([code, label], i) => `${i + 1}. ${(active.includes(code) ? '✅' : '❌')} ${label}`),
        `6. ${(active.length >= 5 ? '✅' : '➕')} ` + toSmallCaps(t(language, 'chatSettings.languageFilterAll')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_language_filter'
  });
}

export async function handleChatSettingsLanguageFilter(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const n = String(selectedNumber);
  if (n === '0') return sendChatSettingsPanel(context);
  const { getSettings, updateSetting } = await import('../services/chatSettingsService.js');
  const codes = ['en', 'fr', 'de', 'es', 'ar'];
  if (n === '6') {
    const active = getSettings().languageFilter;
    updateSetting('languageFilter', active.length >= 5 ? [] : [...codes]);
    logAdminAction(sender, 'chat_settings', 'languageFilter → all toggle');
    return showChatSettingsLanguageFilter(context);
  }
  const code = codes[Number(n) - 1];
  if (!code) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return showChatSettingsLanguageFilter(context);
  }
  const active = getSettings().languageFilter;
  const next = active.includes(code) ? active.filter((l) => l !== code) : [...active, code];
  updateSetting('languageFilter', next);
  logAdminAction(sender, 'chat_settings', `languageFilter ${code} → ${next.includes(code) ? 'on' : 'off'}`);
  return showChatSettingsLanguageFilter(context);
}

const DELAY_PRESETS = { 2: 0, 3: 300, 4: 600, 5: 1500 };

export async function showChatSettingsDelayOverride(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getSettings } = await import('../services/chatSettingsService.js');
  const current = getSettings().chatReplyDelayMs;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_delay_override', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '⏳ ' + toSmallCaps(t(language, 'chatSettings.delayTitle')),
      '',
      [
        toSmallCaps(t(language, 'chatSettings.delayHint')),
        '',
        toSmallCaps(t(language, 'chatSettings.currentValue', { value: current == null ? t(language, 'chatSettings.valueGlobal') : `${current}ms` })),
        '',
        '1. ' + toSmallCaps(t(language, 'chatSettings.delayGlobal')),
        '2. ' + toSmallCaps(t(language, 'chatSettings.delayInstant')),
        '3. ' + toSmallCaps(t(language, 'chatSettings.delayFast')),
        '4. ' + toSmallCaps(t(language, 'chatSettings.delayNatural')),
        '5. ' + toSmallCaps(t(language, 'chatSettings.delaySlow')),
        '6. ' + toSmallCaps(t(language, 'chatSettings.delayCustom')),
        '',
        '0. ' + t(language, 'admin.test.optionBack')
      ]
    ),
    transitionKey: 'chat_settings_delay_override'
  });
}

export async function handleChatSettingsDelayOverride(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatSettingsPanel(context);
  const { updateSetting } = await import('../services/chatSettingsService.js');
  if (session.pendingData?.awaitingCustom) {
    if (!trimmed || Number.isNaN(Number(trimmed)) || Number(trimmed) < 0) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 10000 }));
      return showChatSettingsDelayOverride(context);
    }
    updateSetting('chatReplyDelayMs', Math.min(10000, Math.floor(Number(trimmed))));
    logAdminAction(sender, 'chat_settings', `chatReplyDelayMs → ${trimmed}`);
    return sendChatSettingsPanel(context);
  }
  if (trimmed === '1') {
    updateSetting('chatReplyDelayMs', null);
    logAdminAction(sender, 'chat_settings', 'chatReplyDelayMs → global');
    return sendChatSettingsPanel(context);
  }
  if (trimmed === '6') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_settings_delay_override', pendingAction: null, pendingData: { awaitingCustom: true } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('⏳ ' + toSmallCaps(t(language, 'chatSettings.delayTitle')), '', [toSmallCaps(t(language, 'chatSettings.delayCustomPrompt')), '', '0. ' + t(language, 'admin.test.optionBack')]),
      transitionKey: 'chat_settings_delay_override'
    });
  }
  if (!(trimmed in DELAY_PRESETS)) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return showChatSettingsDelayOverride(context);
  }
  updateSetting('chatReplyDelayMs', DELAY_PRESETS[trimmed]);
  logAdminAction(sender, 'chat_settings', `chatReplyDelayMs → ${DELAY_PRESETS[trimmed]}`);
  return sendChatSettingsPanel(context);
}

async function sendNewAdminBackupMenu(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'admin_backup', pendingAction: null, pendingData: null });
  await sendMenuById('backup_restore', { sock: context.sock, sender, chatId, user, language }, 'admin_to_backup', { sessionMenu: 'admin_backup' });
}

async function sendNewAdminLogsMenu(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'admin_logs', pendingAction: null, pendingData: null });
  await sendMenuById('logs', { sock: context.sock, sender, chatId, user, language }, 'admin_to_logs', { sessionMenu: 'admin_logs' });
}

export async function sendAdminBackupMenu(context) {
  return sendNewAdminBackupMenu(context);
}

export async function sendAdminLogsMenu(context) {
  return sendNewAdminLogsMenu(context);
}

export async function handleGroupedAdminReply(context, menu, selectedNumber) {
  if (menu === 'admin_users') {
    const { handleUserManagementReply } = await import('./userManagementCommand.js');
    return handleUserManagementReply(context, selectedNumber);
  }
  if (menu === 'chat_faq_menu') {
    if (selectedNumber === '0') return sendAdminPanel(context, { transitionKey: 'chat_faq_to_admin' });
    if (selectedNumber === '1') return sendChatPanel(context, { transitionKey: 'admin_to_chat' });
    if (selectedNumber === '2') {
      const { sendFaqMainPanel } = await import('./faqCommand.js');
      return sendFaqMainPanel(context, { transitionKey: 'admin_to_faq' });
    }
    if (selectedNumber === '3') {
      const { sendSnippetsMenu } = await import('./chatCommand.js');
      return sendSnippetsMenu(context);
    }
    if (selectedNumber === '4') return sendChatFaqStatsPanel(context);
    if (selectedNumber === '5') {
      const { showUnmatchedList } = await import('./chatCommand.js');
      return showUnmatchedList(context, { returnTo: 'chat_faq_menu' });
    }
    if (selectedNumber === '6') return sendChatFaqImportExport(context);
    if (selectedNumber === '7') return sendChatTestPanel(context);
    if (selectedNumber === '8') {
      const { showCleanupSuggestions } = await import('./chatCommand.js');
      return showCleanupSuggestions(context);
    }
    if (selectedNumber === '9') {
      return sendChatSettingsPanel(context);
    }
    return sendChatFaqMenu(context);
  }
  if (menu === 'chat_stats' || menu === 'chat_import_export') {
    if (selectedNumber === '0') return sendChatFaqMenu(context);
    if (menu === 'chat_import_export') return handleChatFaqImportExportReply(context, selectedNumber);
    if (selectedNumber === '1') return sendRulePerformancePanel(context);
    if (selectedNumber === '2') return showReplyAnalyticsMenu(context);
    if (selectedNumber === '3') return showRateLimitLogMenu(context);
    if (selectedNumber === '4') return showDryRunLogMenu(context);
    return sendChatFaqMenu(context);
  }
  if (menu === 'admin_backup') {
    if (selectedNumber === '0') return sendAdminPanel(context, { transitionKey: 'backup_to_admin' });
    if (selectedNumber === '1') return handleBackupRestoreReply(context, '1');
    if (selectedNumber === '2') return handleBackupRestoreReply(context, '2');
    if (selectedNumber === '3') return sendExportsPanel(context, { transitionKey: 'admin_to_exports' });
    return sendAdminBackupMenu(context);
  }
  if (menu === 'admin_logs') {
    if (selectedNumber === '0') return sendAdminPanel(context, { transitionKey: 'logs_to_admin' });
    if (selectedNumber === '1') return import('./adminLogCommand.js').then(({ command }) => command.execute(context));
    if (selectedNumber === '2') return showErrorLog(context, { transitionKey: 'admin_to_errors' });
    return sendAdminLogsMenu(context);
  }
}

export async function sendTestPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'test_submenu', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildTestMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'test_submenu'
  });
}

export async function sendTestPanelResult(context, resultLine) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'test_submenu', pendingAction: null, pendingData: null });

  const text =
    toSmallCaps(resultLine) + '\n\n' +
    toSmallCaps(t(language, 'admin.test.chooseNewTest')) + '\n\n' +
    buildMenu(t(language, 'admin.test.title'), '', [
      '1. ' + t(language, 'admin.test.optionNewUser'),
      '2. ' + t(language, 'admin.test.optionSpam'),
      '3. ' + t(language, 'admin.test.optionBug'),
      '4. ' + t(language, 'admin.test.optionSecurity'),
      '5. ' + t(language, 'admin.test.optionSummary'),
      '9. ' + t(language, 'menuHelp.option'),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.test.replyPrompt')
    ]);

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text,
    transitionKey: 'test_return'
  });
}

// ---------------------------------------------------------------------------
// Admin panel actions
// ---------------------------------------------------------------------------

export async function showStats(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getStats } = await import('../services/userService.js');
  const stats = getStats();

  const text = buildMenu(
    t(language, 'admin.optionStats'),
    '',
    [
      '👥 ' + t(language, 'admin.stats.totalUsers') + ': ' + stats.total,
      '🧪 ' + t(language, 'admin.stats.testUsers') + ': ' + stats.testUsers,
      '⛔ ' + t(language, 'admin.stats.blocked') + ': ' + stats.blocked,
      '🕒 ' + t(language, 'admin.stats.activeToday') + ': ' + stats.activeToday,
      '⚡ ' + t(language, 'admin.stats.commandsUsed') + ': ' + stats.commandsUsed
    ]
  );

  // Show stats then return to admin panel at the bottom.
  await sendText(context.sock, sender, text);
  await sendAdminPanel(context);
}

function buildBroadcastPrompt(language) {
  return buildMenu(
    t(language, 'admin.optionBroadcast'),
    '',
    [
      toSmallCaps(t(language, 'admin.broadcastPrompt')),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

async function promptBroadcastInput(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'broadcast_input', broadcastReply: true });

  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildBroadcastPrompt(language),
    transitionKey: 'broadcast_input'
  });
}

export async function handleBroadcastInput(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();

  if (trimmed === '0') {
    sessionManager.setState(sender, chatId, { currentMenu: 'admin', broadcastReply: false });
    await sendAdminPanel(context);
    return;
  }

  // Ask confirmation before broadcasting.
  await askConfirmation({ sock: context.sock, sender, chatId }, 'broadcast', {
    text: trimmed,
    returnTo: 'admin'
  });
}

function performBroadcast(sock, users, text) {
  let sent = 0;
  for (const u of users) {
    if (!u.jid || u.blocked === true) continue;
    try {
      sock.sendMessage(u.jid, { text });
      sent++;
    } catch (err) {
      logger.warn({ err, jid: u.jid }, '[BROADCAST] failed to send to user');
    }
  }
  return sent;
}

async function executeBroadcast(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const users = await getAllUsers();
  const sent = performBroadcast(context.sock, users, data.text);
  logger.info({ sent, sender }, '[BROADCAST] broadcast complete');
  const result = t(language, 'admin.broadcastDone', { count: sent });
  logAdminAction(sender, 'broadcast', 'sent to ' + sent + ' user(s)');
  await sendAdminPanelResult(context, result);
}

// ---------------------------------------------------------------------------
// Broadcast submenu (send now / schedule)
// ---------------------------------------------------------------------------

function formatTimeLabel(sendAt) {
  const d = new Date(sendAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildBroadcastSubmenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.optionBroadcast'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.broadcast.optionSendNow'),
      '2. ' + t(language, 'admin.broadcast.optionSchedule'),
      '3. 📁 ' + t(language, 'admin.broadcast.optionTemplates'),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

export async function sendNewBroadcastSubmenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'broadcast_submenu', pendingAction: null, pendingData: null });
  await sendMenuById('broadcast', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'broadcast_submenu', { resultLine: opts.resultLine, sessionMenu: 'broadcast_submenu' });
}

export async function sendBroadcastSubmenu(context, opts = {}) {
  if (isMenuMigrated('broadcast')) return sendNewBroadcastSubmenu(context, opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'broadcast_submenu', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildBroadcastSubmenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'broadcast_submenu'
  });
}

function broadcastCancel(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  return sendBroadcastSubmenu(context, { resultLine: t(language, 'admin.cancelled') });
}

async function promptScheduleText(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'broadcast_schedule_text' });

  const text = buildMenu(
    t(language, 'admin.schedule.title'),
    '',
    [
      t(language, 'admin.schedule.textPrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'broadcast_schedule_text' });
}

export function parseScheduleTime(str) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec((str || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const dt = new Date(+y, +mo - 1, +d, +h, +mi, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

// Word number parser for relative time expressions ("a", "an", "one" -> 1).
function parseWordNumber(str) {
  const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, twelve: 12 };
  if (words[str] !== undefined) return words[str];
  const n = parseInt(str, 10);
  return isNaN(n) ? null : n;
}

// Normalize a clock expression like "9am", "9:30 am", "15:00" into [h, m].
function parseClock(str) {
  const s = (str || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  return [hour, minute];
}

// Parse a relative/ad-hoc time expression into an epoch-ms timestamp.
// Supports: "3 minutes", "in 2 hours", "1 week", "tomorrow HH:MM", "today HH:MM".
export function parseRelativeTime(str, now = Date.now()) {
  const s = (str || '').trim().toLowerCase();
  if (!s) return null;

  // [in] X minutes|hours|days|weeks|months|years (X = digit or word number)
  let m = /^(in\s+)?(\w+)\s+(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years)$/.exec(s);
  if (m) {
    const n = parseWordNumber(m[2]);
    if (n === null || n <= 0) return null;
    const unit = m[3].replace(/s$/, '').replace(/^(min|mins)$/, 'minute').replace(/^(hr|hrs)$/, 'hour');
    const mult = unit === 'minute' ? 60000
      : unit === 'hour' ? 3600000
      : unit === 'day' ? 86400000
      : unit === 'week' ? 7 * 86400000
      : unit === 'month' ? 30 * 86400000
      : 365 * 86400000;
    return now + n * mult;
  }

  // tomorrow HH:MM / today HH:MM
  m = /^(tomorrow|today)\s+(.*)$/.exec(s);
  if (m) {
    const clock = parseClock(m[2]);
    if (!clock) return null;
    const base = new Date(now);
    if (m[1] === 'tomorrow') base.setDate(base.getDate() + 1);
    base.setHours(clock[0], clock[1], 0, 0);
    return base.getTime();
  }

  return null;
}

export function applySchedulePreset(choice) {
  const now = new Date();
  switch (choice) {
    case '1':
      return new Date(now.getTime() + 3600000).getTime(); // now + 1 hour
    case '2':
      return new Date(now.getTime() + 3 * 3600000).getTime(); // now + 3 hours
    case '3': { // tomorrow 9:00 AM
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }
    case '4': { // tomorrow 6:00 PM
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      return d.getTime();
    }
    default:
      return null;
  }
}

async function promptScheduleTime(context, text, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'broadcast_schedule_time',
    pendingData: Object.assign({ text }, opts)
  });

  const prompt = buildMenu(
    t(language, 'admin.schedule.title'),
    '',
    [
      t(language, 'admin.schedule.timePrompt'),
      '',
      '1. ' + t(language, 'admin.schedule.preset1h'),
      '2. ' + t(language, 'admin.schedule.preset3h'),
      '3. ' + t(language, 'admin.schedule.presetTomorrow9'),
      '4. ' + t(language, 'admin.schedule.presetTomorrow6'),
      '5. ' + t(language, 'admin.schedule.presetCustom'),
      '',
      '0. ' + t(language, 'admin.schedule.scheduleBack'),
      '',
      t(language, 'admin.schedule.timeHint')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text: prompt, transitionKey: 'broadcast_schedule_time' });
}

export async function handleBroadcastScheduleText(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await sendScheduleSubmenu(context);
    return;
  }
  if (!trimmed) {
    const language = resolveLanguage(sender);
    await sendText(context.sock, sender, L(language, 'common.emptyMessage'));
    await promptScheduleText(context);
    return;
  }

  await promptScheduleTime(context, trimmed);
}

export async function handleBroadcastScheduleTime(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = (content || '').trim();
  const session = sessionManager.getSession(sender, chatId) || {};
  const pending = session.pendingData || {};
  const text = pending.text || '';
  const editId = pending.editId || null;

  if (trimmed === '0') {
    if (editId) {
      await showScheduleDetail(context, editId);
    } else {
      await sendScheduleSubmenu(context);
    }
    return;
  }

  // Option 5 = custom: prompt for manual YYYY-MM-DD HH:mm entry.
  if (trimmed === '5') {
    await promptManualScheduleTime(context, text, { editId });
    return;
  }

  let sendAtMs = null;

  // 1-4 preset selection.
  if (/^[1-4]$/.test(trimmed)) {
    sendAtMs = applySchedulePreset(trimmed);
  } else {
    // Manual YYYY-MM-DD HH:mm typed directly — accept.
    const manual = parseScheduleTime(trimmed);
    if (manual) sendAtMs = manual.getTime();
  }

  if (sendAtMs === null) {
    // Not a preset or manual date — try the relative-time parser.
    sendAtMs = parseRelativeTime(trimmed);
  }

  if (sendAtMs === null || sendAtMs <= Date.now()) {
    if (editId) {
      await promptEditTime(context, editId, text);
    } else {
      const language = resolveLanguage(sender);
      await sendText(context.sock, sender, L(language, 'admin.schedule.parseError'));
      await promptScheduleTime(context, text, { editId });
    }
    return;
  }

  await confirmScheduleTime(context, text, sendAtMs, editId);
}

async function confirmScheduleTime(context, text, sendAtMs, editId) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  if (editId) {
    await askConfirmation({ sock: context.sock, sender, chatId }, 'editSchedule', {
      editId,
      field: 'sendAt',
      text,
      sendAt: sendAtMs,
      timeLabel: formatTimeLabel(sendAtMs),
      returnTo: 'schedule'
    });
  } else {
    await promptScheduleRepeat(context, { text, sendAt: sendAtMs });
  }
}

function formatRecurrence(recurrence, language) {
  switch (recurrence) {
    case 'hourly': return L(language, 'admin.schedule.recurrence.hourly');
    case 'daily': return L(language, 'admin.schedule.recurrence.daily');
    case 'weekly': return L(language, 'admin.schedule.recurrence.weekly');
    case 'monthly': return L(language, 'admin.schedule.recurrence.monthly');
    default: return L(language, 'admin.schedule.recurrence.once');
  }
}

// Repeat selection — runs after time is chosen (add flow) or when editing
// an existing schedule's recurrence.
async function promptScheduleRepeat(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'broadcast_schedule_repeat',
    pendingData: opts
  });

  const text = buildMenu(
    t(language, 'admin.schedule.title'),
    '',
    [
      t(language, 'admin.schedule.repeatPrompt'),
      '',
      '1. ' + t(language, 'admin.schedule.repeatOnce'),
      '2. ' + t(language, 'admin.schedule.repeatHourly'),
      '3. ' + t(language, 'admin.schedule.repeatDaily'),
      '4. ' + t(language, 'admin.schedule.repeatWeekly'),
      '5. ' + t(language, 'admin.schedule.repeatMonthly'),
      '',
      '0. ' + t(language, 'admin.schedule.scheduleBack'),
      '',
      t(language, 'admin.schedule.replyNumber')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'broadcast_schedule_repeat' });
}

export async function handleBroadcastScheduleRepeat(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const pending = session.pendingData || {};
  const text = pending.text || '';
  const editId = pending.editId || null;

  let recurrence;
  switch (selectedNumber) {
    case '0':
      if (editId) {
        const entry = scheduleService.getScheduleById(editId);
        if (entry) await showScheduleDetail(context, editId);
        else await sendScheduleSubmenu(context);
      } else {
        await promptScheduleTime(context, text, { editId: null });
      }
      return;
    case '1': recurrence = 'once'; break;
    case '2': recurrence = 'hourly'; break;
    case '3': recurrence = 'daily'; break;
    case '4': recurrence = 'weekly'; break;
    case '5': recurrence = 'monthly'; break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 5 }));
      return;
  }

  if (editId) {
    await askConfirmation({ sock: context.sock, sender, chatId }, 'editSchedule', {
      editId,
      field: 'recurrence',
      recurrence,
      recurrenceLabel: formatRecurrence(recurrence, language),
      text,
      returnTo: 'schedule'
    });
  } else {
    await askConfirmation({ sock: context.sock, sender, chatId }, 'scheduleBroadcast', {
      text,
      sendAt: pending.sendAt,
      timeLabel: formatTimeLabel(pending.sendAt),
      recurrence,
      recurrenceLabel: formatRecurrence(recurrence, language),
      returnTo: 'schedule'
    });
  }
}

// Custom (manual) time entry — accepts YYYY-MM-DD HH:mm or a relative time.
async function promptManualScheduleTime(context, text, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'broadcast_schedule_manual',
    pendingData: Object.assign({ text }, opts)
  });

  const prompt = buildMenu(
    t(language, 'admin.schedule.title'),
    '',
    [
      t(language, 'admin.schedule.manualPrompt'),
      '',
      L(language, 'common.reply0Back')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text: prompt, transitionKey: 'broadcast_schedule_manual' });
}

export async function handleBroadcastScheduleManual(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = (content || '').trim();
  const session = sessionManager.getSession(sender, chatId) || {};
  const pending = session.pendingData || {};
  const text = pending.text || '';
  const editId = pending.editId || null;

  if (trimmed === '0') {
    if (editId) {
      await showScheduleDetail(context, editId);
    } else {
      await sendScheduleSubmenu(context);
    }
    return;
  }

  let sendAtMs = null;
  const dt = parseScheduleTime(trimmed);
  if (dt) {
    sendAtMs = dt.getTime();
  } else {
    sendAtMs = parseRelativeTime(trimmed);
  }

  if (sendAtMs === null || sendAtMs <= Date.now()) {
    const language = resolveLanguage(sender);
    await sendText(context.sock, sender, L(language, 'admin.schedule.manualInvalid'));
    await promptManualScheduleTime(context, text, { editId });
    return;
  }

  await confirmScheduleTime(context, text, sendAtMs, editId);
}

async function executeScheduleBroadcast(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const entry = await scheduleService.scheduleBroadcast({
    adminJid: sender,
    text: data.text,
    sendAt: data.sendAt,
    recurrence: data.recurrence || 'once'
  });
  const recurrence = data.recurrence || 'once';
  const recurrenceNote = recurrence !== 'once' ? ' 🔁 ' + formatRecurrence(recurrence, language) : '';
  logAdminAction(sender, 'broadcast_schedule', 'scheduled for ' + formatTimeLabel(data.sendAt) + ' repeat=' + recurrence);
  logger.info({ sender, id: entry.id, sendAt: data.sendAt, recurrence }, '[BROADCAST] scheduled broadcast created');
  const done = '✅ ' + L(language, 'admin.schedule.scheduledFor') + ' ' + formatTimeLabel(data.sendAt) + recurrenceNote;
  await sendScheduleSubmenu(context, { resultLine: done });
}

export async function handleBroadcastReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context, { transitionKey: 'broadcast_to_admin' });
      break;
    case '1': {
      const bLang = resolveLanguage(sender);
      if (settingsService.getSettings().emergencyBroadcastsDisabled === true) {
        await sendText(context.sock, sender, toSmallCaps(t(bLang, 'admin.emergency.broadcastsDisabled', { count: 0 })));
        await sendBroadcastSubmenu(context);
        break;
      }
      await promptBroadcastInput(context);
      break;
    }
    case '2':
      await sendScheduleSubmenu(context, { transitionKey: 'broadcast_to_schedule' });
      break;
    case '3':
      await sendTemplateSubmenu(context, { transitionKey: 'broadcast_to_templates' });
      break;
    default:
      const language = resolveLanguage(sender);
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
      break;
  }
}

// ---------------------------------------------------------------------------
// Schedule submenu (admin) — add / view / clear all
// ---------------------------------------------------------------------------

function buildScheduleSubmenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.schedule.submenuTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ➕ ' + t(language, 'admin.schedule.optionAdd'),
      '2. 📋 ' + t(language, 'admin.schedule.optionView'),
      '3. 🗑️ ' + t(language, 'admin.schedule.optionClear'),
      '',
      '0. ' + t(language, 'admin.schedule.scheduleBack'),
      '',
      t(language, 'admin.schedule.replyNumber')
    ]
  );
}

export async function sendScheduleSubmenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'broadcast_schedule', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildScheduleSubmenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'broadcast_schedule'
  });
}

export async function handleScheduleReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendBroadcastSubmenu(context, { transitionKey: 'schedule_to_broadcast' });
      break;
    case '1': {
      const sLang = resolveLanguage(sender);
      if (settingsService.getSettings().emergencyBroadcastsDisabled === true) {
        await sendText(context.sock, sender, toSmallCaps(t(sLang, 'admin.emergency.broadcastsDisabled', { count: 0 })));
        await sendScheduleSubmenu(context);
        break;
      }
      await promptScheduleText(context);
      break;
    }
    case '2':
      await viewSchedules(context);
      break;
    case '3':
      await requestClearAll(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
      break;
  }
}

async function scheduleCancel(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  return sendScheduleSubmenu(context, { resultLine: toSmallCaps(t(language, 'admin.cancelled')) });
}

// --- View schedules ---

function scheduleEntryLine(entry, index) {
  const rec = entry.recurrence && entry.recurrence !== 'once' ? ' 🔁 ' + entry.recurrence : '';
  return `${index}. [${formatTimeLabel(entry.sendAt)}]${rec} ` + (entry.text.length > 40 ? entry.text.slice(0, 40) + '…' : entry.text);
}

function buildScheduleDetail(entry, language) {
  return buildMenu(
    t(language, 'admin.schedule.detailsTitle'),
    '',
    [
      '🆔 ' + L(language, 'admin.schedule.fieldId') + ': ' + entry.id,
      '📝 ' + L(language, 'admin.schedule.fieldMessage') + ': ' + entry.text,
      '🕒 ' + L(language, 'admin.schedule.fieldScheduledTime') + ': ' + formatTimeLabel(entry.sendAt),
      '🔁 ' + L(language, 'admin.schedule.fieldRepeat') + ': ' + formatRecurrence(entry.recurrence, language),
      '👤 ' + L(language, 'admin.schedule.fieldCreatedBy') + ': ' + (entry.adminJid || '-'),
      '📅 ' + L(language, 'admin.schedule.fieldCreatedAt') + ': ' + (entry.createdAt ? formatTimeLabel(entry.createdAt) : '-'),
      '',
      '1. ✏️ ' + t(language, 'admin.schedule.optionEdit'),
      '2. 🗑️ ' + t(language, 'admin.schedule.optionDelete'),
      '',
      '0. ' + t(language, 'admin.schedule.scheduleBack')
    ]
  );
}

async function showScheduleDetail(context, id) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const entry = scheduleService.getScheduleById(id);

  if (!entry) {
    await sendText(context.sock, sender, L(language, 'admin.schedule.notFound'));
    await viewSchedules(context);
    return;
  }

  sessionManager.setState(sender, chatId, {
    currentMenu: 'broadcast_schedule_detail',
    pendingAction: null,
    pendingData: { scheduleId: id }
  });

  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildScheduleDetail(entry, language),
    transitionKey: 'broadcast_schedule_detail'
  });
}

export async function viewSchedules(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const all = scheduleService.listScheduled().sort((a, b) => a.sendAt - b.sendAt);

  if (all.length === 0) {
    await sendScheduleEmptyNotice(context, { heading: t(language, 'admin.schedule.submenuTitle'), notice: L(language, 'admin.schedule.none') });
    return;
  }

  if (all.length === 1) {
    await showScheduleDetail(context, all[0].id);
    return;
  }

  sessionManager.setState(sender, chatId, {
    currentMenu: 'broadcast_schedule_list',
    pendingAction: null,
    pendingData: { scheduleIds: all.map(e => e.id) }
  });

  const lines = all.map((e, i) => scheduleEntryLine(e, i + 1));
  const text = buildMenu(
    t(language, 'admin.schedule.submenuTitle'),
    '',
    [
      ...lines,
      '',
      '0. ' + t(language, 'admin.schedule.scheduleBack'),
      '',
      t(language, 'admin.schedule.viewPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'broadcast_schedule_list' });
}

export async function handleScheduleListReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();
  const session = sessionManager.getSession(sender, chatId) || {};
  const ids = session.pendingData?.scheduleIds || [];

  if (trimmed === '0') {
    await sendScheduleSubmenu(context);
    return;
  }

  const idx = parseInt(trimmed, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= ids.length) {
    await sendText(context.sock, sender, L(language, 'common.invalidSelection'));
    await viewSchedules(context);
    return;
  }

  await showScheduleDetail(context, ids[idx]);
}

export async function handleScheduleDetailReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.pendingData?.scheduleId;
  const entry = id ? scheduleService.getScheduleById(id) : undefined;

  switch (selectedNumber) {
    case '0':
      await sendScheduleSubmenu(context);
      break;
    case '1':
      if (entry) await promptScheduleEdit(context, entry);
      break;
    case '2':
      if (entry) await requestDeleteSchedule(context, entry);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoice'));
      break;
  }
}

// --- Edit schedule ---

async function promptScheduleEdit(context, entry) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'broadcast_schedule_edit',
    pendingAction: null,
    pendingData: { scheduleId: entry.id }
  });

  const text = buildMenu(
    t(language, 'admin.schedule.editTitle'),
    '',
    [
      t(language, 'admin.schedule.editPrompt'),
      '',
      '1. ✏️ ' + t(language, 'admin.schedule.editMessage'),
      '2. 🕒 ' + t(language, 'admin.schedule.editTime'),
      '3. 🔁 ' + t(language, 'admin.schedule.editRepeat'),
      '',
      '0. ' + t(language, 'admin.schedule.scheduleBack')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'broadcast_schedule_edit' });
}

export async function handleScheduleEditReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.pendingData?.scheduleId;
  const entry = id ? scheduleService.getScheduleById(id) : undefined;

  if (!entry) {
    await sendText(context.sock, sender, L(language, 'admin.schedule.notFound'));
    await viewSchedules(context);
    return;
  }

  switch (selectedNumber) {
    case '0':
      await showScheduleDetail(context, id);
      break;
    case '1':
      await promptEditMessage(context, entry);
      break;
    case '2':
      await promptEditTime(context, id, entry.text);
      break;
    case '3':
      await promptEditRepeat(context, entry);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoice'));
      break;
  }
}

async function promptEditRepeat(context, entry) {
  await promptScheduleRepeat(context, { text: entry.text, sendAt: entry.sendAt, editId: entry.id });
}

async function promptEditMessage(context, entry) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'broadcast_schedule_edit_message',
    pendingAction: null,
    pendingData: { scheduleId: entry.id }
  });

  const text = buildMenu(
    t(language, 'admin.schedule.editTitle'),
    '',
    [
      t(language, 'admin.schedule.editMessagePrompt'),
      '',
      '> ' + entry.text
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'broadcast_schedule_edit_message' });
}

export async function handleScheduleEditMessage(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.pendingData?.scheduleId;

  if (trimmed === '0') {
    const entry = id ? scheduleService.getScheduleById(id) : undefined;
    if (entry) await promptScheduleEdit(context, entry);
    else await sendScheduleSubmenu(context);
    return;
  }
  if (!trimmed) {
    await sendText(context.sock, sender, L(language, 'common.emptyMessage'));
    const entry = id ? scheduleService.getScheduleById(id) : undefined;
    if (entry) await promptEditMessage(context, entry);
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'editSchedule', {
    editId: id,
    field: 'text',
    text: trimmed,
    sendAt: null,
    timeLabel: null,
    returnTo: 'schedule'
  });
}

async function promptEditTime(context, id, text) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  await promptScheduleTime(context, text, { editId: id });
}

async function requestDeleteSchedule(context, entry) {
  const sender = context.sender;
  await askConfirmation({ sock: context.sock, sender, chatId: context.chatId || context.sender }, 'deleteSchedule', {
    editId: entry.id,
    text: entry.text,
    returnTo: 'schedule'
  });
}

async function requestClearAll(context) {
  const sender = context.sender;
  const all = scheduleService.listScheduled().sort((a, b) => a.sendAt - b.sendAt);

  // Nothing to clear — show an empty notice with a 0. back option.
  if (all.length === 0) {
    await sendScheduleEmptyNotice(context);
    return;
  }

  const headlines = all.map((e, i) => scheduleEntryLine(e, i + 1));
  await askConfirmation({ sock: context.sock, sender, chatId: context.chatId || context.sender }, 'clearSchedules', {
    returnTo: 'schedule',
    headlines
  });
}

// Empty notice for the schedule flows — lists nothing, offers only 0. back.
export async function sendScheduleEmptyNotice(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'broadcast_schedule_empty', pendingAction: null, pendingData: null });

  const text = buildMenu(
    opts.heading || t(language, 'admin.schedule.submenuTitle'),
    '',
    [
      opts.notice || L(language, 'admin.schedule.noneToClear'),
      '',
      '0. ' + t(language, 'admin.schedule.scheduleBack')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'broadcast_schedule_empty' });
}

export async function handleScheduleEmptyReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  if (selectedNumber === '0') {
    await sendScheduleSubmenu(context);
  } else {
    await sendText(context.sock, sender, L(language, 'admin.schedule.emptyInvalid'));
  }
}

async function executeDeleteSchedule(context, data = {}) {
  const sender = context.sender;
  const id = data.editId;
  if (!id) {
    await scheduleCancel(context);
    return;
  }
  const removed = await scheduleService.cancelSchedule(id);
  const lang = resolveLanguage(sender);
  const msg = removed
    ? '🗑️ ' + L(lang, 'admin.schedule.deleted')
    : toSmallCaps(t(lang, 'admin.cancelled'));
  logAdminAction(sender, 'broadcast_schedule_delete', 'removed schedule ' + id);
  await sendScheduleSubmenu(context, { resultLine: msg });
}

async function executeClearSchedules(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const count = await scheduleService.clearAllSchedules();
  logAdminAction(sender, 'broadcast_schedule_clear', 'cleared ' + count + ' schedule(s)');
  const msg = '✅ ' + L(language, 'admin.schedule.allCleared');
  await sendScheduleSubmenu(context, { resultLine: msg });
}

async function executeEditSchedule(context, data = {}) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const id = data.editId;
  const entry = id ? scheduleService.getScheduleById(id) : undefined;
  if (!entry) {
    await sendText(context.sock, sender, L(language, 'admin.schedule.notFound'));
    await viewSchedules(context);
    return;
  }

  const updates = {};
  if (data.field === 'text' && data.text) updates.text = data.text;
  if (data.field === 'sendAt' && data.sendAt) updates.sendAt = data.sendAt;
  if (data.field === 'recurrence' && data.recurrence) updates.recurrence = data.recurrence;

  await scheduleService.updateSchedule(id, updates);
  logAdminAction(sender, 'broadcast_schedule_edit', data.field + ' on schedule ' + id);
  const done = '✅ ' + L(language, 'admin.schedule.updated');
  await sendScheduleSubmenu(context, { resultLine: done });
}

// ---------------------------------------------------------------------------
// Templates submenu (admin)
// ---------------------------------------------------------------------------

function buildTemplateSubmenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.templates.menuTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.templates.optionUse'),
      '2. ' + t(language, 'admin.templates.optionSave'),
      '3. ' + t(language, 'admin.templates.optionDelete'),
      '',
      '0. ' + t(language, 'admin.templates.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

export async function sendTemplateSubmenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'templates', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildTemplateSubmenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'templates'
  });
}

export async function handleTemplateReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendBroadcastSubmenu(context, { transitionKey: 'templates_to_broadcast' });
      break;
    case '1':
      await promptTemplateUseList(context);
      break;
    case '2':
      await promptTemplateName(context);
      break;
    case '3':
      await promptTemplateDeleteList(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
      break;
  }
}

async function promptTemplateUseList(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const names = templateService.getTemplateNames();

  if (names.length === 0) {
    await sendText(context.sock, sender, L(language, 'admin.templates.none'));
    await sendTemplateSubmenu(context);
    return;
  }

  const lines = names.map((name, i) => `${i + 1}. ${name}`);
  const text = buildMenu(
    t(language, 'admin.templates.optionUse'),
    '',
    [
      t(language, 'admin.templates.selectUse'),
      '',
      ...lines,
      '',
      '0. ' + t(language, 'admin.templates.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  sessionManager.setState(sender, chatId, { currentMenu: 'template_use_list' });

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'template_use_list' });
}

export async function handleTemplateUseList(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();
  const language = resolveLanguage(sender);

  if (trimmed === '0') {
    await sendTemplateSubmenu(context);
    return;
  }

  const index = parseInt(trimmed, 10) - 1;
  const entry = templateService.getTemplateByIndex(index);
  if (!entry) {
    await sendText(context.sock, sender, L(language, 'common.invalidSelection'));
    await promptTemplateUseList(context);
    return;
  }

  const text = buildMenu(
    t(language, 'admin.templates.previewTitle'),
    '',
    [
      t(language, 'admin.templates.fieldName') + ': ' + entry.name,
      '',
      '> ' + entry.text,
      '',
      '1. ' + t(language, 'admin.templates.previewBroadcast'),
      '2. ' + t(language, 'admin.templates.previewEdit'),
      '',
      '0. ' + t(language, 'admin.templates.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  sessionManager.setState(sender, chatId, {
    currentMenu: 'template_preview',
    pendingData: { templateName: entry.name, templateText: entry.text }
  });

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'template_preview' });
}

export async function handleTemplatePreview(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();
  const session = sessionManager.getSession(sender, chatId) || {};
  const templateText = session.pendingData?.templateText;

  switch (trimmed) {
    case '0':
      await sendTemplateSubmenu(context);
      break;
    case '1':
      await askConfirmation({ sock: context.sock, sender, chatId }, 'broadcast', {
        text: templateText,
        returnTo: 'templates'
      });
      break;
    case '2': {
      sessionManager.setState(sender, chatId, {
        currentMenu: 'template_edit',
        pendingData: session.pendingData
      });
      const language = resolveLanguage(sender);
      const text = buildMenu(
        t(language, 'admin.templates.editTitle'),
        '',
        [
          t(language, 'admin.templates.editPrompt'),
          '',
          t(language, 'admin.replyPrompt')
        ]
      );
      await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'template_edit' });
      break;
    }
    default:
      await sendText(context.sock, sender, L(resolveLanguage(sender), 'admin.templates.previewInvalid'));
      break;
  }
}

export async function handleTemplateEdit(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();

  if (trimmed === '0') {
    await sendTemplateSubmenu(context);
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'broadcast', {
    text: trimmed,
    returnTo: 'templates'
  });
}

async function promptTemplateName(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'template_save_name', pendingData: {} });

  const text = buildMenu(
    t(language, 'admin.templates.optionSave'),
    '',
    [
      t(language, 'admin.templates.namePrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'template_save_name' });
}

export async function handleTemplateNameInput(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();
  const language = resolveLanguage(sender);

  if (trimmed === '0') {
    await sendTemplateSubmenu(context);
    return;
  }

  if (!trimmed || trimmed.length > 50) {
    await sendText(context.sock, sender, L(language, 'admin.templates.nameInvalid'));
    await promptTemplateName(context);
    return;
  }

  sessionManager.setState(sender, chatId, {
    currentMenu: 'template_save_text',
    pendingData: { templateName: trimmed }
  });

  const text = buildMenu(
    t(language, 'admin.templates.optionSave'),
    '',
    [
      t(language, 'admin.templates.fieldName') + ': ' + trimmed,
      '',
      t(language, 'admin.templates.textPrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'template_save_text' });
}

export async function handleTemplateTextInput(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();
  const session = sessionManager.getSession(sender, chatId) || {};
  const templateName = session.pendingData?.templateName;

  if (trimmed === '0') {
    await sendTemplateSubmenu(context);
    return;
  }

  if (!trimmed) {
    await sendText(context.sock, sender, L(resolveLanguage(sender), 'admin.templates.textEmpty'));
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'saveTemplate', {
    name: templateName,
    text: trimmed,
    returnTo: 'templates'
  });
}

async function promptTemplateDeleteList(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const names = templateService.getTemplateNames();

  if (names.length === 0) {
    await sendText(context.sock, sender, L(language, 'admin.templates.none'));
    await sendTemplateSubmenu(context);
    return;
  }

  const lines = names.map((name, i) => `${i + 1}. ${name}`);
  const text = buildMenu(
    t(language, 'admin.templates.optionDelete'),
    '',
    [
      t(language, 'admin.templates.selectDelete'),
      '',
      ...lines,
      '',
      '0. ' + t(language, 'admin.templates.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  sessionManager.setState(sender, chatId, { currentMenu: 'template_delete_list' });

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'template_delete_list' });
}

export async function handleTemplateDeleteList(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();
  const language = resolveLanguage(sender);

  if (trimmed === '0') {
    await sendTemplateSubmenu(context);
    return;
  }

  const index = parseInt(trimmed, 10) - 1;
  const entry = templateService.getTemplateByIndex(index);
  if (!entry) {
    await sendText(context.sock, sender, L(language, 'common.invalidSelection'));
    await promptTemplateDeleteList(context);
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'deleteTemplate', {
    name: entry.name,
    returnTo: 'templates'
  });
}

async function executeSaveTemplate(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const { name, text } = data;
  if (name && text) {
    templateService.saveTemplate(name, text);
    logAdminAction(sender, 'template_save', name);
  }
  await sendTemplateSubmenu(context, { resultLine: toSmallCaps(t(language, 'admin.templates.saved', { name: name || '' })) });
}

async function executeDeleteTemplate(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const name = data?.name;
  if (name) {
    templateService.deleteTemplate(name);
    logAdminAction(sender, 'template_delete', name);
  }
  await sendTemplateSubmenu(context, { resultLine: toSmallCaps(t(language, 'admin.templates.deleted', { name: name || '' })) });
}

// ---------------------------------------------------------------------------
// Command Analytics (admin)
// ---------------------------------------------------------------------------

async function sendNewCommandAnalytics(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
  await sendMenuById('analytics', { sock: context.sock, sender, chatId, user, language }, 'command_analytics', { sessionMenu: 'command_analytics' });
}

export async function showCommandAnalytics(context) {
  if (isMenuMigrated('analytics')) return sendNewCommandAnalytics(context);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const top = analyticsService.getTopCommands(10);

  let body = '';
  if (top.length === 0) {
    body = L(language, 'admin.analytics.none');
  } else {
    const lines = top.map((entry, i) =>
      `${i + 1}. /${entry.name} – ${entry.total}` +
      (entry.uniqueUsers > 0 ? ` (${entry.uniqueUsers} ${L(language, 'admin.analytics.users')})` : '')
    );
    body = lines.join('\n');
  }

  const text = buildMenu(
    '📊 ' + L(language, 'admin.analytics.title'),
    '',
    [
      '1. ' + t(language, 'admin.analytics.optionTop'),
      '2. ' + t(language, 'admin.analytics.optionResponseTime'),
      '',
      '0. ' + L(language, 'admin.analytics.back')
    ]
  );

  sessionManager.setState(sender, chatId, { currentMenu: 'command_analytics' });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text,
    transitionKey: 'command_analytics'
  });
}

export async function showTopCommandsPanel(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const top = analyticsService.getTopCommands(10);

  let body = '';
  if (top.length === 0) {
    body = L(language, 'admin.analytics.none');
  } else {
    const lines = top.map((entry, i) =>
      `${i + 1}. /${entry.name} – ${entry.total}` +
      (entry.uniqueUsers > 0 ? ` (${entry.uniqueUsers} ${L(language, 'admin.analytics.users')})` : '')
    );
    body = lines.join('\n');
  }

  const text = buildMenu(
    '🔝 ' + L(language, 'admin.analytics.topCommands'),
    '',
    [
      L(language, 'admin.analytics.topCommands') + ':',
      '',
      body,
      '',
      '0. ' + L(language, 'admin.analytics.back')
    ]
  );

  sessionManager.setState(sender, chatId, { currentMenu: 'command_analytics_top' });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text,
    transitionKey: 'command_analytics_top'
  });
}

export async function showResponseTimePanel(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getStats, getPerCommandStats } = await import('../services/responseTimeService.js');
  const stats = getStats();
  const top = getPerCommandStats(5);

  const lines = [
    { static: toSmallCaps(t(language, 'admin.analytics.avgLabel')) + ': ', dynamic: `${stats.avg}ms` },
    { static: toSmallCaps(t(language, 'admin.analytics.minLabel')) + ': ', dynamic: `${stats.min}ms` },
    { static: toSmallCaps(t(language, 'admin.analytics.maxLabel')) + ': ', dynamic: `${stats.max}ms` },
    { static: toSmallCaps(t(language, 'admin.analytics.samplesLabel')) + ': ', dynamic: String(stats.count) },
    '',
    toSmallCaps(t(language, 'admin.analytics.topSlow')),
    '',
    ...(top.length ? top.map((entry, i) => ({ static: `${i + 1}. /`, dynamic: `${entry.command} – ${entry.avg}ms` })) : [toSmallCaps(t(language, 'admin.analytics.none'))]),
    '',
    '0. ' + L(language, 'admin.analytics.back')
  ];

  const text = buildMenu(
    '⏱️ ' + L(language, 'admin.analytics.responseTime'),
    '',
    lines
  );

  sessionManager.setState(sender, chatId, { currentMenu: 'command_analytics_response' });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text,
    transitionKey: 'command_analytics_response'
  });
}

export async function handleAnalyticsReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context);
      break;
    case '1':
      await showTopCommandsPanel(context);
      break;
    case '2':
      await showResponseTimePanel(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
      break;
  }
}

export async function handleAnalyticsDetailReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  if (selectedNumber === '0') {
    await showCommandAnalytics(context);
    return;
  }
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 0 }));
}

// ---------------------------------------------------------------------------
// Test submenu actions
// ---------------------------------------------------------------------------

function sendTestReport(type, data) {
  reportService.reportToAdmins(type, data, 'critical');
}

async function runTestAction(context, type, reportData) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  // 1. Send the report as a separate message to admins.
  sendTestReport(type, reportData);
  logAdminAction(sender, 'test', 'sent ' + type + ' test report');

  // 2. Delete the old test menu and send success + test submenu again.
  await sendTestPanelResult(context, t(language, 'admin.test.testSent'));
}

// ---------------------------------------------------------------------------
// Backup & Restore submenu (admin)
// ---------------------------------------------------------------------------

function buildBackupRestoreMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.backupRestore.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      t(language, 'admin.backupRestore.prompt'),
      '',
      '1. ' + t(language, 'admin.backupRestore.optionBackup'),
      '2. ' + t(language, 'admin.backupRestore.optionRestore'),
      '',
      '0. ' + t(language, 'admin.backupRestore.optionBack'),
      '',
      t(language, 'admin.backupRestore.replyPrompt')
    ]
  );
}

export async function sendBackupRestorePanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'backup_restore' });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildBackupRestoreMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'backup_restore'
  });
}

async function runBackup(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const users = getUsersObject();
  const count = Object.keys(users).length;
  const data = JSON.stringify(users, null, 2);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
  await context.sock.sendMessage(chatId, {
    document: Buffer.from(data, 'utf8'),
    mimetype: 'application/json',
    fileName: `backup-${stamp}.json`,
    caption: toSmallCaps(t(language, 'admin.backupRestore.optionBackup') + ' ✅ (' + count + ' users)')
  });
  logAdminAction(sender, 'backup', 'exported ' + count + ' user(s)');
  const msg = t(language, 'admin.backupRestore.optionBackup') + ' ✅ (' + count + ' users)';
  await sendBackupRestorePanel(context, { resultLine: msg });
}

export async function handleBackupRestoreReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context, { transitionKey: 'backup_to_admin' });
      break;
    case '1':
      await runBackup(context);
      break;
    case '2':
      await startRestore(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
      break;
  }
}

// ---------------------------------------------------------------------------
// System Settings submenu (admin)
// ---------------------------------------------------------------------------

function statusText(language, flag) {
  return flag ? L(language, 'admin.systemSettings.statusOn') : L(language, 'admin.systemSettings.statusOff');
}

function conversationStatusText(language) {
  const conv = conversationService.isConversationEnabled();
  if (conv.enabled) return L(language, 'admin.systemSettings.statusOn');
  if (conv.temporary) return L(language, 'admin.systemSettings.conversationTemp');
  return L(language, 'admin.systemSettings.statusOff');
}

function buildSystemSettingsMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.systemSettings.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.systemSettings.optionGeneral'),
      '2. ' + t(language, 'admin.systemSettings.optionAdminAccess'),
      '3. ' + t(language, 'admin.systemSettings.optionFeatureFlags'),
      '4. ' + t(language, 'admin.systemSettings.optionNotifications'),
      '5. ' + t(language, 'admin.systemSettings.optionConversation'),
      '6. ' + t(language, 'admin.systemSettings.optionUpdates'),
      '7. ' + t(language, 'admin.systemSettings.optionDataManagement'),
      '8. ' + t(language, 'admin.systemSettings.optionLogs'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

async function sendNewSystemSettingsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'system_settings', pendingAction: null, pendingData: null });
  await sendMenuById('system_settings', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'system_settings', { resultLine: opts.resultLine, sessionMenu: 'system_settings' });
}

export async function sendSystemSettingsPanel(context, opts = {}) {
  return sendNewSystemSettingsPanel(context, opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'system_settings', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildSystemSettingsMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'system_settings'
  });
}

function buildGeneralSettingsMenu(language, resultLine = '') {
  const settings = settingsService.getSettings();
  return buildMenu(
    t(language, 'admin.systemSettings.generalTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.systemSettings.optionMaintenance') + ': ' + maintenanceStatusText(language),
      '2. ' + toSmallCaps(t(language, 'admin.systemSettings.optionSleepAnimation')) + ': ' + toSmallCaps(statusText(language, settings.sleepAnimationEnabled)),
      '3. ' + t(language, 'admin.systemSettings.optionBotName'),
      '4. ⌨️ ' + toSmallCaps(t(language, 'admin.systemSettings.optionTyping')) + ': ' + toSmallCaps(statusText(language, settings.typingIndicatorEnabled !== false)),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendGeneralSettingsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'general_settings', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildGeneralSettingsMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'system_general'
  });
}

function buildAdminAccessMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.systemSettings.adminAccessTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.systemSettings.viewAdmins'),
      '2. ' + t(language, 'admin.systemSettings.addAdmin'),
      '3. ' + t(language, 'admin.systemSettings.removeAdmin'),
      '4. ' + t(language, 'admin.roles.manageRoles'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendAdminAccessPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_access', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildAdminAccessMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'system_admins'
  });
}

function buildNotificationsMenu(language, resultLine = '') {
  const settings = settingsService.getSettings();
  return buildMenu(
    t(language, 'admin.systemSettings.notificationsTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.systemSettings.optionReports') + ': ' + statusText(language, settings.reportsEnabled),
      '2. ' + t(language, 'admin.systemSettings.reportAggregation') + ' (' + toSmallCaps(t(language, 'admin.systemSettings.comingSoon')) + ')',
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendNotificationsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'notifications', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildNotificationsMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'system_notifications'
  });
}

function buildUpdatesMenu(language) {
  return buildMenu(
    t(language, 'admin.systemSettings.updatesTitle'),
    '',
    [
      '1. ' + t(language, 'admin.systemSettings.optionUpdates'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendUpdatesPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'updates', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildUpdatesMenu(language),
    transitionKey: opts.transitionKey || 'system_updates'
  });
}

function buildDataMenu(language, resultLine = '') {
  const settings = settingsService.getSettings();
  return buildMenu(
    t(language, 'admin.systemSettings.dataTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.systemSettings.optionSessionSave') + ': ' + statusText(language, settings.sessionSaveEnabled),
      '2. ' + t(language, 'admin.systemSettings.resetSettings') + ' (' + toSmallCaps(t(language, 'admin.systemSettings.comingSoon')) + ')',
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendDataPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'data_management', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildDataMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'system_data'
  });
}

function buildLogsMenu(language) {
  return buildMenu(
    t(language, 'admin.systemSettings.logsTitle'),
    '',
    [
      '1. ' + t(language, 'admin.logs.adminLog'),
      '2. ' + t(language, 'admin.logs.errorLog'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

async function sendNewLogsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'logs', pendingAction: null, pendingData: null });
  await sendMenuById('logs', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'system_logs', { resultLine: opts.resultLine, sessionMenu: 'logs' });
}

export async function sendLogsPanel(context, opts = {}) {
  if (isMenuMigrated('logs')) return sendNewLogsPanel(context, opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'logs', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildLogsMenu(language),
    transitionKey: opts.transitionKey || 'system_logs'
  });
}

function maintenanceStatusText(language) {
  const settings = settingsService.getSettings();
  if (settings.maintenanceMode) return statusText(language, true);
  try {
    const now = Date.now();
    if (getMaintenanceWindows().some((w) => w.endAt > now)) {
      return toSmallCaps(t(language, 'admin.systemSettings.maintenanceScheduled'));
    }
  } catch { /* ignore */ }
  return statusText(language, false);
}

async function setMaintenanceMode(context, enabled) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const settings = settingsService.updateSettings({ maintenanceMode: enabled });
  logger.info({ sender, maintenanceMode: settings.maintenanceMode }, '[SYSTEM] maintenance mode set');
  logAdminAction(sender, 'settings_change', 'maintenance mode ' + (settings.maintenanceMode ? 'on' : 'off'));
  return settings.maintenanceMode
    ? t(language, 'admin.systemSettings.maintenanceOn')
    : t(language, 'admin.systemSettings.maintenanceOff');
}

function buildMaintenanceMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.systemSettings.maintTitle'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      toSmallCaps(t(language, 'admin.systemSettings.maintCurrent')) + ': ' + maintenanceStatusText(language),
      '',
      '1. ' + t(language, 'admin.systemSettings.maintEnable'),
      '2. ' + t(language, 'admin.systemSettings.maintDisable'),
      '3. ' + t(language, 'admin.systemSettings.maintSchedule'),
      '4. ' + t(language, 'admin.systemSettings.maintView'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendMaintenancePanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'maint_menu', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMaintenanceMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'maint_menu'
  });
}

function parseWindowTime(input) {
  const trimmed = (input || '').trim();
  if (/^[1-4]$/.test(trimmed)) return applySchedulePreset(trimmed);
  const manual = parseScheduleTime(trimmed);
  if (manual) return manual.getTime();
  return parseRelativeTime(trimmed);
}

async function promptMaintTime(context, stage, extra = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};

  sessionManager.setState(sender, chatId, {
    currentMenu: stage === 'start' ? 'maint_schedule_start' : 'maint_schedule_end',
    pendingAction: null,
    pendingData: { ...(session.pendingData || {}), ...extra }
  });

  const text = buildMenu(
    t(language, 'admin.systemSettings.maintTitle'),
    '',
    [
      toSmallCaps(t(language, stage === 'start' ? 'admin.systemSettings.maintStartPrompt' : 'admin.systemSettings.maintEndPrompt')),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'maint_schedule_time' });
}

export async function handleMaintMenuReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendGeneralSettingsPanel(context);
      break;
    case '1': {
      const msg = await setMaintenanceMode(context, true);
      await sendMaintenancePanel(context, { resultLine: msg });
      break;
    }
    case '2': {
      const msg = await setMaintenanceMode(context, false);
      await sendMaintenancePanel(context, { resultLine: msg });
      break;
    }
    case '3':
      await promptMaintTime(context, 'start', {});
      break;
    case '4': {
      const windows = getMaintenanceWindows();
      if (!windows.length) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.systemSettings.maintNoWindows')));
        await sendMaintenancePanel(context);
        break;
      }
      const sender2 = context.sender;
      const chatId2 = context.chatId || sender2;
      sessionManager.setState(sender2, chatId2, { currentMenu: 'maint_windows', pendingAction: null, pendingData: null });
      const lines = windows.map((w, i) => ({ static: `${i + 1}. `, dynamic: `${formatTaskTime(w.startAt)} → ${formatTaskTime(w.endAt)}` }));
      const text = buildMenu(t(language, 'admin.systemSettings.maintView'), '', [...lines, '', '0. ' + t(language, 'admin.systemSettings.optionBack')]);
      await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'maint_windows' });
      break;
    }
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
      break;
  }
}

export async function handleMaintScheduleReply(context, content, stage) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await sendMaintenancePanel(context);
    return;
  }
  const ms = parseWindowTime(trimmed);
  if (ms === null || ms <= Date.now()) {
    await sendText(context.sock, sender, L(language, 'admin.schedule.parseError'));
    await promptMaintTime(context, stage, { ...(session.pendingData || {}) });
    return;
  }
  if (stage === 'start') {
    await promptMaintTime(context, 'end', { ...(session.pendingData || {}), startAt: ms, editId: session.pendingData?.editId || null });
    return;
  }
  const startAt = session.pendingData?.startAt;
  const editId = session.pendingData?.editId || null;
  if (typeof startAt !== 'number' || ms <= startAt) {
    await sendText(context.sock, sender, L(language, 'admin.schedule.parseError'));
    await promptMaintTime(context, 'end', { ...(session.pendingData || {}) });
    return;
  }
  if (editId) {
    updateMaintenanceWindow(editId, { startAt, endAt: ms });
    logAdminAction(sender, 'maintenance_window_edit', editId);
  } else {
    const entry = scheduleMaintenanceWindow(startAt, ms);
    logAdminAction(sender, 'maintenance_window_add', entry ? `${formatTaskTime(startAt)} → ${formatTaskTime(ms)}` : '-');
  }
  await sendMaintenancePanel(context, { resultLine: t(language, 'admin.systemSettings.maintScheduled') });
}

export async function handleMaintWindowsReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = (content || '').trim();
  const windows = getMaintenanceWindows();

  if (trimmed === '0') {
    await sendMaintenancePanel(context);
    return;
  }
  const idx = parseInt(trimmed, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= windows.length) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: windows.length }));
    return;
  }
  const w = windows[idx];
  sessionManager.setState(sender, chatId, { currentMenu: 'maint_window_detail', pendingAction: null, pendingData: { editId: w.id } });
  const text = buildMenu(
    t(language, 'admin.systemSettings.maintView'),
    '',
    [
      { static: '', dynamic: `${formatTaskTime(w.startAt)} → ${formatTaskTime(w.endAt)}` },
      '',
      '1. ' + t(language, 'admin.systemSettings.maintEdit'),
      '2. ' + t(language, 'admin.systemSettings.maintDelete'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack')
    ]
  );
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'maint_window_detail' });
}

export async function handleMaintWindowDetailReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = (content || '').trim();
  const editId = session.pendingData?.editId;

  if (trimmed === '0' || !editId) {
    await handleMaintMenuReply(context, '4');
    return;
  }
  if (trimmed === '1') {
    await promptMaintTime(context, 'start', { editId });
    return;
  }
  if (trimmed === '2') {
    deleteMaintenanceWindow(editId);
    logAdminAction(sender, 'maintenance_window_delete', editId);
    await handleMaintMenuReply(context, '4');
    return;
  }
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
}

async function checkUpdates(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const current = config.botVersion || '1.0.0';
  const latest = config.LATEST_VERSION || current;
  const isUpdate = latest !== current;

  const lines = [
    '📌 ' + L(language, 'admin.systemSettings.currentVersion') + ': ' + current,
    '🚀 ' + L(language, 'admin.systemSettings.latestVersion') + ': ' + latest,
    '',
    isUpdate
      ? toSmallCaps(t(language, 'admin.systemSettings.updateAvailable'))
      : toSmallCaps(t(language, 'admin.systemSettings.upToDate'))
  ];

  const text = buildMenu(t(language, 'admin.systemSettings.optionUpdates'), '', lines);
  await sendText(context.sock, sender, text);
  await sendUpdatesPanel(context);
}

async function promptSleepAnimationToggle(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  await askConfirmation({ sock: context.sock, sender, chatId }, 'toggleSleepAnimation', {
    language,
    current: settingsService.getSettings().sleepAnimationEnabled,
    returnTo: 'general_settings'
  });
}

async function showSleepAnimationStatus(context, { enabled, already }) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const title = '> *' + toSmallCaps(t(language, 'admin.systemSettings.optionSleepAnimation')) + '*';
  const stateWord = enabled ? t(language, 'admin.systemSettings.enabled') : t(language, 'admin.systemSettings.disabled');

  const body = already
    ? '🫥 ' + toSmallCaps(t(language, 'admin.systemSettings.sleepAnimationAlready')) + ' *' + toSmallCaps(stateWord) + '* ' + (enabled ? '✅' : '❌')
    : (enabled ? '✅ ' : '❌ ') + toSmallCaps(t(language, enabled ? 'admin.systemSettings.sleepTurnedOn' : 'admin.systemSettings.sleepTurnedOff'));

  const text = title + '\n\n' + body + '\n\n' + '0. ' + toSmallCaps(t(language, 'admin.systemSettings.optionBack'));

  sessionManager.setState(sender, chatId, {
    currentMenu: 'confirmation',
    pendingAction: 'toggleSleepAnimation',
    pendingData: { language, current: enabled, returnTo: 'general_settings' }
  });

  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text,
    transitionKey: 'confirmation_done'
  });
}

async function executeToggleSleepAnimation(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const current = settingsService.getSettings().sleepAnimationEnabled;
  const nextValue = !current;
  const settings = settingsService.updateSettings({ sleepAnimationEnabled: nextValue });
  logger.info({ sender, sleepAnimationEnabled: settings.sleepAnimationEnabled }, '[SYSTEM] toggled sleep animation');
  logAdminAction(sender, 'settings_change', 'sleep animation ' + (settings.sleepAnimationEnabled ? 'on' : 'off'));
  await showSleepAnimationStatus(context, { enabled: settings.sleepAnimationEnabled, already: false });
}

async function toggleReports(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const settings = settingsService.updateSettings({ reportsEnabled: !settingsService.getSettings().reportsEnabled });
  logger.info({ sender, reportsEnabled: settings.reportsEnabled }, '[SYSTEM] toggled reports');
  logAdminAction(sender, 'settings_change', 'reports ' + (settings.reportsEnabled ? 'on' : 'off'));
  const msg = settings.reportsEnabled
    ? t(language, 'admin.systemSettings.reportsOn')
    : t(language, 'admin.systemSettings.reportsOff');
  await sendNotificationsPanel(context, { resultLine: msg });
}

async function toggleSessionSave(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const settings = settingsService.updateSettings({ sessionSaveEnabled: !settingsService.getSettings().sessionSaveEnabled });
  logger.info({ sender, sessionSaveEnabled: settings.sessionSaveEnabled }, '[SYSTEM] toggled session save');
  logAdminAction(sender, 'settings_change', 'session save ' + (settings.sessionSaveEnabled ? 'on' : 'off'));
  const msg = settings.sessionSaveEnabled
    ? t(language, 'admin.systemSettings.sessionSaveOn')
    : t(language, 'admin.systemSettings.sessionSaveOff');
  await sendDataPanel(context, { resultLine: msg });
}

async function promptBotName(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'system_settings_name_input' });

  const text = buildMenu(
    t(language, 'admin.systemSettings.optionBotName'),
    '',
    [
      toSmallCaps(t(language, 'admin.systemSettings.namePrompt')),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );

  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text,
    transitionKey: 'system_name_input'
  });
}

export async function handleSystemSettingsNameInput(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await sendGeneralSettingsPanel(context);
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'changeBotName', {
    name: trimmed,
    returnTo: 'general_settings'
  });
}

async function executeChangeBotName(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const newName = (data?.name || '').trim() || settingsService.getBotName();
  settingsService.updateSettings({ botName: newName });
  logger.info({ sender, botName: newName }, '[SYSTEM] bot name changed');
  logAdminAction(sender, 'settings_change', 'bot name changed to ' + newName);
  await sendGeneralSettingsPanel(context, { resultLine: t(language, 'admin.systemSettings.nameChanged', { name: newName }) });
}

export async function handleSystemSettingsReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context, { transitionKey: 'system_to_admin' });
      break;
    case '1':
      await sendGeneralSettingsPanel(context);
      break;
    case '2':
      await sendAdminAccessPanel(context);
      break;
    case '3':
      await sendFeatureFlagsPanel(context, { transitionKey: 'system_to_flags' });
      break;
    case '4':
      await sendNotificationsPanel(context);
      break;
    case '5':
      await sendConversationSettingsPanel(context, { transitionKey: 'system_to_conversation' });
      break;
    case '6':
      await sendUpdatesPanel(context);
      break;
    case '7':
      await sendDataPanel(context);
      break;
    case '8':
      await sendLogsPanel(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 8 }));
      break;
  }
}

export async function handleGeneralSettingsReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendSystemSettingsPanel(context);
      break;
    case '1':
      await sendMaintenancePanel(context);
      break;
    case '2':
      await promptSleepAnimationToggle(context);
      break;
    case '3':
      await promptBotName(context);
      break;
    case '4':
      await toggleTypingIndicator(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
      break;
  }
}

async function toggleTypingIndicator(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const settings = settingsService.updateSettings({ typingIndicatorEnabled: !(settingsService.getSettings().typingIndicatorEnabled !== false) });
  logger.info({ sender, typingIndicatorEnabled: settings.typingIndicatorEnabled }, '[SYSTEM] toggled typing indicator');
  logAdminAction(sender, 'settings_change', 'typing indicator ' + (settings.typingIndicatorEnabled ? 'on' : 'off'));
  const msg = settings.typingIndicatorEnabled
    ? t(language, 'admin.systemSettings.typingOn')
    : t(language, 'admin.systemSettings.typingOff');
  await sendGeneralSettingsPanel(context, { resultLine: msg });
}

export async function handleNotificationsReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendSystemSettingsPanel(context);
      break;
    case '1':
      await toggleReports(context);
      break;
    case '2':
      await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.systemSettings.comingSoon')));
      await sendNotificationsPanel(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
      break;
  }
}

export async function handleUpdatesReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendSystemSettingsPanel(context);
      break;
    case '1':
      await checkUpdates(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 1 }));
      break;
  }
}

export async function handleDataReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendSystemSettingsPanel(context);
      break;
    case '1':
      await toggleSessionSave(context);
      break;
    case '2':
      await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.systemSettings.comingSoon')));
      await sendDataPanel(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
      break;
  }
}

const ADMIN_JID_RE = /^[0-9]+@(lid|s\.whatsapp\.net)$/;

function persistAdminJids(jids) {
  config.adminJids = [...jids];
  const configFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../config/config.js');
  const text = fs.readFileSync(configFile, 'utf8');
  const next = text.replace(/adminJids:\s*\[[^\]]*\]/, `adminJids: [${jids.map((j) => `'${j}'`).join(', ')}]`);
  if (next !== text) fs.writeFileSync(configFile, next);
}

function adminListLines() {
  return (config.adminJids || []).map((jid, i) => {
    const username = getUserByJidSync(jid)?.username;
    // Object form: JIDs/usernames stay in normal case, only static text is small-capped.
    return { static: `${i + 1}. `, dynamic: `${jid}${username ? ` (@${username})` : ''}` };
  });
}

async function showAdminList(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const lines = adminListLines();
  const text = buildMenu(
    t(language, 'admin.systemSettings.viewAdmins'),
    '',
    [...lines, '', '0. ' + t(language, 'admin.systemSettings.optionBack')]
  );
  await sendText(context.sock, sender, text);
  await sendAdminAccessPanel(context);
}

async function promptAdminAdd(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_access_add' });

  const text = buildMenu(
    t(language, 'admin.systemSettings.addAdmin'),
    '',
    [
      toSmallCaps(t(language, 'admin.systemSettings.adminJidPrompt')),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'system_admin_add' });
}

export async function handleAdminAccessAddInput(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await sendAdminAccessPanel(context);
    return;
  }
  if (!ADMIN_JID_RE.test(trimmed)) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.systemSettings.adminInvalidJid')));
    await promptAdminAdd(context);
    return;
  }
  if ((config.adminJids || []).includes(trimmed)) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.systemSettings.adminExists')));
    await promptAdminAdd(context);
    return;
  }
  persistAdminJids([...(config.adminJids || []), trimmed]);
  logAdminAction(sender, 'admin_access', 'added admin ' + trimmed);
  await sendAdminAccessPanel(context, { resultLine: t(language, 'admin.systemSettings.adminAdded', { jid: trimmed }) });
}

async function promptAdminRemove(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_access_remove', pendingData: null });

  const text = buildMenu(
    t(language, 'admin.systemSettings.removeAdmin'),
    '',
    [
      ...adminListLines(),
      '',
      toSmallCaps(t(language, 'admin.systemSettings.adminRemovePrompt')),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'system_admin_remove' });
}

export async function handleAdminAccessRemoveReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();
  const jids = config.adminJids || [];

  if (trimmed === '0') {
    await sendAdminAccessPanel(context);
    return;
  }
  const idx = parseInt(trimmed, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= jids.length) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: jids.length }));
    await promptAdminRemove(context);
    return;
  }
  if (jids.length <= 1) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.systemSettings.adminLastWarn')));
    await sendAdminAccessPanel(context);
    return;
  }
  const jid = jids[idx];
  sessionManager.setState(sender, chatId, { currentMenu: 'admin_access_remove_confirm', pendingData: { jid } });

  const text = buildMenu(
    t(language, 'admin.systemSettings.removeAdmin'),
    '',
    [
      toSmallCaps(t(language, 'admin.systemSettings.adminConfirmRemove', { jid })),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'system_admin_remove_confirm' });
}

export async function handleAdminAccessRemoveConfirm(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const jid = session.pendingData?.jid;

  if (selectedNumber === '1' && jid) {
    persistAdminJids((config.adminJids || []).filter((j) => j !== jid));
    logAdminAction(sender, 'admin_access', 'removed admin ' + jid);
    await sendAdminAccessPanel(context, { resultLine: t(language, 'admin.systemSettings.adminRemoved', { jid }) });
    return;
  }
  await sendAdminAccessPanel(context);
}

export async function handleAdminAccessReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendSystemSettingsPanel(context);
      break;
    case '1':
      await showAdminList(context);
      break;
    case '2':
      await promptAdminAdd(context);
      break;
    case '3':
      await promptAdminRemove(context);
      break;
    case '4':
      await sendRolesPanel(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
      break;
  }
}

export async function handleLogsReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendSystemSettingsPanel(context);
      break;
    case '1':
      await import('./adminLogCommand.js').then(({ command }) => command.execute(context));
      break;
    case '2':
      await showErrorLog(context, { transitionKey: 'system_to_errors' });
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
      break;
  }
}

// ---------------------------------------------------------------------------
// Conversation Chat submenu (admin)
// ---------------------------------------------------------------------------

function humanDuration(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  return `${hrs} h`;
}

export function buildConversationSettingsMenu(language, resultLine = '') {
  const conv = conversationService.isConversationEnabled();
  const status = conv.enabled ? '🟢' : conv.temporary ? '⏳' : '🔴';
  const statusLine = '⚡ ' + t(language, 'admin.conversation.status') + ': ' + status + ' ' + conversationStatusText(language);
  return buildMenu(
    t(language, 'admin.conversation.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      statusLine,
      '',
      '1. 🟢 ' + t(language, 'admin.conversation.optionEnable'),
      '2. 🔴 ' + t(language, 'admin.conversation.optionDisable'),
      '3. ⏳ ' + t(language, 'admin.conversation.optionTempDisable'),
      '4. 📋 ' + t(language, 'admin.conversation.optionNotify'),
      '9. ' + t(language, 'menuHelp.option'),
      '',
      '0. ' + t(language, 'admin.conversation.optionBack'),
      '',
      t(language, 'admin.conversation.replyPrompt')
    ]
  );
}

export async function sendConversationSettingsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'conversation_settings', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildConversationSettingsMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'conversation_settings'
  });
}

async function sendConversationSettingsResult(context, resultLine) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'conversation_settings', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildConversationSettingsMenu(language, toSmallCaps(resultLine)),
    transitionKey: 'conversation_settings'
  });
}

async function enableConversation(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  settingsService.updateSettings({ conversationEnabled: true, conversationDisabledUntil: null });
  conversationService.cancelConversationAutoEnable();
  const notified = await chatNotifyService.notifyWaitingUsers().catch(err => {
    logger.error({ err }, '[CONVERSATION] notify waiting users failed on enable');
    return [];
  });
  logger.info({ sender, notified: notified.length }, '[SYSTEM] conversation chat enabled');
  logAdminAction(sender, 'settings_change', 'conversation chat enabled');
  const msg = notified.length > 0
    ? t(language, 'admin.systemSettings.conversationEnabled', { count: notified.length })
    : t(language, 'admin.systemSettings.conversationEnabledEmpty');
  await sendConversationSettingsResult(context, msg);
}

async function disableConversation(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  settingsService.updateSettings({ conversationEnabled: false, conversationDisabledUntil: null });
  conversationService.cancelConversationAutoEnable();
  logger.info({ sender }, '[SYSTEM] conversation chat disabled');
  logAdminAction(sender, 'settings_change', 'conversation chat disabled');
  await sendConversationSettingsResult(context, t(language, 'admin.systemSettings.conversationDisabled'));
}

async function promptTempDisable(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'conversation_temp_duration' });

  const text = buildMenu(t(language, 'admin.conversation.title'), '', [
    toSmallCaps(t(language, 'admin.systemSettings.conversationTempPrompt')),
    '',
    '1. ⏰ ' + t(language, 'admin.systemSettings.conversationTemp30'),
    '2. ⏰ ' + t(language, 'admin.systemSettings.conversationTemp1h'),
    '3. ⏰ ' + t(language, 'admin.systemSettings.conversationTemp2h'),
    '4. 🎛️ ' + t(language, 'admin.systemSettings.conversationTempCustomOption'),
    '',
    '0. ' + t(language, 'admin.conversation.optionBack'),
    '',
    t(language, 'admin.conversation.replyPrompt')
  ]);

  await sendMenu({
    sock: context.sock, sender, chatId,
    text,
    transitionKey: 'conversation_temp_duration'
  });
}

async function promptTempCustom(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'conversation_temp_custom' });

  const text = buildMenu(t(language, 'admin.conversation.title'), '', [
    toSmallCaps(t(language, 'admin.systemSettings.conversationTempCustom')),
    '',
    t(language, 'admin.conversation.replyPrompt')
  ]);

  await sendMenu({
    sock: context.sock, sender, chatId,
    text,
    transitionKey: 'conversation_temp_custom'
  });
}

function durationLabelFor(language, mins) {
  if (mins === 30) return t(language, 'admin.systemSettings.conversationTemp30');
  if (mins === 60) return t(language, 'admin.systemSettings.conversationTemp1h');
  if (mins === 120) return t(language, 'admin.systemSettings.conversationTemp2h');
  return t(language, 'admin.systemSettings.conversationTempMinutes', { count: mins });
}

async function applyTempDisable(context, durationMs) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const mins = Math.max(1, Math.round(durationMs / 60000));
  const settings = settingsService.updateSettings({ conversationEnabled: true, conversationDisabledUntil: Date.now() + durationMs });
  conversationService.scheduleConversationAutoEnable(settings.conversationDisabledUntil, sender);
  logger.info({ sender, durationMs, until: settings.conversationDisabledUntil }, '[SYSTEM] conversation chat temporarily disabled');
  logAdminAction(sender, 'settings_change', 'conversation chat temporarily disabled (' + humanDuration(durationMs) + ')');
  await sendConversationSettingsResult(context, t(language, 'admin.systemSettings.conversationTempSet', { duration: durationLabelFor(language, mins) }));
}

async function handleTempCustomInput(context, trimmedText, language) {
  const sender = context.sender;
  if (trimmedText === '0') {
    await sendConversationSettingsPanel(context);
    return;
  }
  const minutes = /^\d+$/.test(trimmedText) ? parseInt(trimmedText, 10) : NaN;
  if (!minutes || minutes < 1) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.systemSettings.conversationTempCustomInvalid')));
    await promptTempCustom(context);
    return;
  }
  await applyTempDisable(context, minutes * 60 * 1000);
}

async function showNotifyList(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'conversation_notify_list', pendingAction: null, pendingData: null });

  const requests = await chatNotifyService.getRequests();
  const lines = [];
  if (requests.length > 0) {
    lines.push(toSmallCaps(t(language, 'admin.systemSettings.conversationNotifyWaiting', { count: requests.length })));
    lines.push('');
    lines.push(...requests.map(jid => ({ static: '👤 ', dynamic: jid })));
    lines.push('');
    lines.push('1. ⚡ ' + t(language, 'admin.systemSettings.conversationNotifyNow'));
    lines.push('2. 🧹 ' + t(language, 'admin.systemSettings.conversationNotifyClear'));
  } else {
    lines.push(toSmallCaps(t(language, 'admin.systemSettings.conversationNotifyEmpty')));
  }
  lines.push('');
  lines.push('0. ' + t(language, 'admin.conversation.optionBack'));
  lines.push('');
  lines.push(t(language, 'admin.conversation.replyPrompt'));

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(t(language, 'admin.conversation.title'), '', lines),
    transitionKey: 'conversation_notify_list'
  });
}

async function handleNotifyListReply(context, trimmedText) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (trimmedText) {
    case '0':
      await sendConversationSettingsPanel(context);
      break;
    case '1': {
      const notified = await chatNotifyService.notifyWaitingUsers();
      logAdminAction(sender, 'settings_change', 'conversation chat: notified ' + notified.length + ' waiting user(s)');
      const msg = notified.length > 0
        ? t(language, 'admin.systemSettings.conversationNotifySent', { count: notified.length })
        : t(language, 'admin.systemSettings.conversationNotifyEmpty');
      await sendConversationSettingsResult(context, msg);
      break;
    }
    case '2':
      await chatNotifyService.clearRequests();
      logAdminAction(sender, 'settings_change', 'conversation chat: notification requests cleared');
      await sendConversationSettingsResult(context, t(language, 'admin.systemSettings.conversationNotifyCleared'));
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
      break;
  }
}

export async function handleConversationReply(context, trimmedText) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};

  if (session.currentMenu === 'conversation_temp_custom') {
    await handleTempCustomInput(context, trimmedText, language);
    return;
  }
  if (session.currentMenu === 'conversation_temp_duration') {
    switch (trimmedText) {
      case '0': return sendConversationSettingsPanel(context);
      case '1': return applyTempDisable(context, 30 * 60 * 1000);
      case '2': return applyTempDisable(context, 60 * 60 * 1000);
      case '3': return applyTempDisable(context, 2 * 60 * 60 * 1000);
      case '4': return promptTempCustom(context);
      default:
        await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
        return;
    }
  }
  if (session.currentMenu === 'conversation_notify_list') {
    return handleNotifyListReply(context, trimmedText);
  }

  switch (trimmedText) {
    case '0':
      await sendSystemSettingsPanel(context, { transitionKey: 'conversation_to_system' });
      break;
    case '1':
      await enableConversation(context);
      break;
    case '2':
      await disableConversation(context);
      break;
    case '3':
      await promptTempDisable(context);
      break;
    case '4':
      await showNotifyList(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
      break;
  }
}

// ---------------------------------------------------------------------------
// Feature Management submenu (admin)
// ---------------------------------------------------------------------------

const PRESET_MARKERS = ['✅', '⛔️', '🔅', '⚠️'];

function featureLabel(language, featureName) {
  return featureFlagService.getFeatureLabel(language, featureName);
}

function featureStatusLabel(language, status) {
  return t(language, 'admin.featureStatus.' + status);
}

const FEATURE_STATUSES_ORDER = ['available', 'unavailable', 'coming_soon', 'maintenance'];
const STATUS_MARKER_ICONS = { available: '✅', unavailable: '⛔️', coming_soon: '🔅', maintenance: '⚠️' };

const FEATURE_MESSAGE_SLOT_LABEL_KEYS = {
  unavailable: 'admin.flags.msgUnavailable',
  notifyPrompt: 'admin.flags.msgNotify',
  info: 'admin.flags.msgInfo'
};

const MARKER_PAGE_SIZE = 8;

// Mirror of the user-facing menus (profileCommand.js): Edit Profile and
// Preferences show available features directly and group everything else
// under an "Advanced Options" submenu. Navigation is resolved dynamically
// from the feature registry so a feature moved to `available` automatically
// leaves the Advanced group on next render.
const EDIT_PROFILE_ORDER = ['profileName', 'profileUsername', 'profileBio', 'profileTimezone', 'profilePicture', 'profileCountry', 'profileBirthday'];
const PREFERENCE_ORDER = ['languageSelection', 'notifications', 'announcements', 'messageSettings', 'inlineHelp', 'replyStyle', 'responseDelay', 'replyEmojis', 'progressBars', 'textStyle', 'dailyDigest', 'timezoneAutoDetect', 'privacy', 'greetingResponse', 'typingIndicator', 'helpPrompt', 'friendlyTone'];

const MARKER_NAVIGATION = {
  root: {
    titleKey: 'admin.flags.selectMenu',
    children: [
      { id: 'profile', labelKey: 'onboarding.menuProfile', submenu: true, children: 'profile', markerId: 'profileEditing' },
      { id: 'settings', labelKey: 'onboarding.menuSettings', markerId: 'preferences' },
      { id: 'statistics', labelKey: 'onboarding.menuStatistics', submenu: true, children: 'statistics', markerId: 'statistics' },
      { id: 'tutorial', labelKey: 'onboarding.menuTutorial', markerId: 'tutorial' },
      { id: 'info', labelKey: 'onboarding.menuAbout', submenu: true, children: 'info', markerId: 'info' },
      { id: 'feedback', labelKey: 'onboarding.menuFeedback', submenu: true, children: 'feedback', markerId: 'feedback' },
      { id: 'admin', labelKey: 'onboarding.menuAdmin', submenu: true, children: 'admin', markerId: 'adminPanel' }
    ]
  },
  profile: {
    titleKey: 'admin.flags.changeProfileMarker',
    children: [
      { id: 'editProfile', labelKey: 'profile.optionEdit', prefix: '✏️', submenu: true, children: 'editProfile', markerId: 'profileEditing' },
      { id: 'statistics', labelKey: 'profile.optionStats', prefix: '📊', markerId: 'statistics' },
      { id: 'preferences', labelKey: 'profile.optionPreferences', prefix: '⚙️', submenu: true, children: 'preferences', markerId: 'preferences' },
      { id: 'copyMyId', labelKey: 'profile.optionCopyId', prefix: '🆔', markerId: 'copyMyId' }
    ]
  },
  statistics: {
    titleKey: 'onboarding.menuStatistics',
    children: [
      { id: 'statistics', labelKey: 'admin.flags.labelStatistics', prefix: '📊', markerId: 'statistics' }
    ]
  },
  info: {
    titleKey: 'onboarding.menuAbout',
    children: [
      { id: 'help', labelKey: 'admin.flags.labelHelp', prefix: '❓', markerId: 'help' }
    ]
  },
  feedback: {
    titleKey: 'onboarding.menuFeedback',
    children: [
      { id: 'feedback', labelKey: 'admin.flags.labelFeedback', prefix: '📮', markerId: 'feedback' }
    ]
  },
  admin: {
    titleKey: 'onboarding.menuAdmin',
    children: [
      { id: 'adminPanel', labelKey: 'admin.flags.labelAdminPanel', prefix: '🧰', markerId: 'adminPanel' },
      { id: 'chatResponses', labelKey: 'admin.flags.labelChatResponses', prefix: '💬', markerId: 'chatResponses' },
      { id: 'faq', labelKey: 'admin.flags.labelFaq', prefix: '📚', markerId: 'faq' }
    ]
  },
  editProfile: {
    titleKey: 'profile.editTitle',
    children: []
  },
  editProfile_advanced: {
    titleKey: 'preferences.advancedOptions',
    children: []
  },
  preferences: {
    titleKey: 'preferences.title',
    children: []
  },
  preferences_advanced: {
    titleKey: 'preferences.advancedOptions',
    children: []
  }
};

function dynamicFeatureNode(featureName) {
  const feat = featureFlagService.getFeature(featureName);
  if (!feat) return null;
  return {
    id: featureName,
    labelKey: feat.labelKey,
    prefix: feat.prefix,
    markerId: featureName
  };
}

function advancedNode(childrenId) {
  return { id: 'advanced', labelKey: 'preferences.advancedOptions', prefix: '🔒', submenu: true, children: childrenId };
}

function markerNavigationChildren(nodeId) {
  if (nodeId === 'editProfile') {
    const available = EDIT_PROFILE_ORDER.filter((n) => featureFlagService.getFeature(n)?.status === 'available');
    const unavailable = EDIT_PROFILE_ORDER.filter((n) => featureFlagService.getFeature(n)?.status !== 'available');
    const nodes = available.map(dynamicFeatureNode).filter(Boolean);
    if (unavailable.length) nodes.push(advancedNode('editProfile_advanced'));
    return nodes;
  }
  if (nodeId === 'editProfile_advanced') {
    return EDIT_PROFILE_ORDER.filter((n) => featureFlagService.getFeature(n)?.status !== 'available').map(dynamicFeatureNode).filter(Boolean);
  }
  if (nodeId === 'preferences') {
    const available = PREFERENCE_ORDER.filter((n) => featureFlagService.getFeature(n)?.status === 'available');
    const unavailable = PREFERENCE_ORDER.filter((n) => featureFlagService.getFeature(n)?.status !== 'available');
    const nodes = available.map(dynamicFeatureNode).filter(Boolean);
    if (unavailable.length) nodes.push(advancedNode('preferences_advanced'));
    return nodes;
  }
  if (nodeId === 'preferences_advanced') {
    return PREFERENCE_ORDER.filter((n) => featureFlagService.getFeature(n)?.status !== 'available').map(dynamicFeatureNode).filter(Boolean);
  }
  return MARKER_NAVIGATION[nodeId]?.children || [];
}

function markerNodeMarker(node) {
  return node.markerId ? featureFlagService.getEffectiveMarker(node.markerId) : '';
}

// Single emoji source: registry/node prefix wins; strip any leading emoji
// from the translated label when a prefix is present (avoids "🌐 🌐 ...").
function navChildLine(language, child, number) {
  const marker = markerNodeMarker(child);
  const suffix = child.submenu ? ' >' : (marker ? ' ' + marker : '');
  const rawLabel = t(language, child.labelKey);
  const label = child.prefix ? cleanFeatureLabel(rawLabel) : rawLabel;
  const prefix = child.prefix ? child.prefix + ' ' : '';
  return `${number}. ${toSmallCaps(prefix + label)}${suffix}`;
}

function buildMarkerNavigation(language, nodeId = 'root', page = 0) {
  const node = MARKER_NAVIGATION[nodeId] || MARKER_NAVIGATION.root;
  const children = markerNavigationChildren(nodeId);
  const start = page * MARKER_PAGE_SIZE;
  const visible = children.slice(start, start + MARKER_PAGE_SIZE);
  const lines = visible.map((child, index) => navChildLine(language, child, start + index + 1));
  if (start + MARKER_PAGE_SIZE < children.length) {
    lines.push(`${start + MARKER_PAGE_SIZE + 1}. ${L(language, 'admin.flags.more')}`);
  }
  return buildMenu('🔖 ' + L(language, node.titleKey),
  '', [
    L(language, 'admin.flags.selectFeature'),
    '', ...lines,
    '',
    '0. ' + L(language, 'admin.flags.back'),
    '', t(language, 'admin.replyPrompt')
  ]);
}

function submenuHeading(language, node) {
  const raw = t(language, node.labelKey);
  const label = node.prefix ? cleanFeatureLabel(raw) : raw;
  const prefix = node.prefix ? node.prefix + ' ' : '';
  return toSmallCaps(prefix + label);
}

function buildMarkerSubmenuActions(language, node) {
  return buildMenu(submenuHeading(language, node),
  '', [
    '1. 🏷️ ' + L(language, 'admin.flags.changeThisSubmenuMarker'),
    '2. 📂 ' + L(language, 'admin.flags.viewChildFeatures'),
    '',
    '0. ' + L(language, 'admin.flags.back'),
    '',
    t(language, 'admin.replyPrompt')
  ]);
}

// Custom marker validation: a single emoji or a short symbol (max 2 code points).
function isValidCustomMarker(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (/^\d+$/.test(v)) return false;
  return [...v].length <= 2;
}

// Build the root Feature Management menu from the central menu config.
function buildFeatureManagementRoot(language, resultLine = '') {
  const lines = menus.feature_management.options.map((opt) => {
    return toSmallCaps(opt.number + '. ' + t(language, opt.labelKey));
  });
  return buildMenu(
    '🧩 ' + L(language, 'admin.flags.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      toSmallCaps(t(language, 'admin.flags.prompt')),
      '',
      ...lines,
      '',
      '0. ' + t(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

// Feature list / picker: `N. {prefix} {label} {marker}`.
// Status is indicated by the marker, not by text.
// Labels are de-duplicated: the registry prefix is the single emoji source,
// any leading emoji in the translated label is stripped.
const FEATURE_LIST_PAGE_SIZE = 10;

function cleanFeatureLabel(label) {
  if (typeof label !== 'string') return label;
  return label.replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function buildFeaturePicker(language, opts = {}) {
  const page = Math.max(0, opts.page || 0);
  const heading = opts.heading || ('🧩 ' + L(language, 'admin.flags.title'));
  const hint = opts.hint !== undefined ? opts.hint : t(language, 'admin.flags.selectFeature');
  const names = featureFlagService.getFeatureNames();
  const start = page * FEATURE_LIST_PAGE_SIZE;
  const visible = names.slice(start, start + FEATURE_LIST_PAGE_SIZE);
  const lines = visible.map((name, i) => {
    const feat = featureFlagService.getFeature(name);
    const prefix = feat.prefix ? feat.prefix + ' ' : '';
    const label = cleanFeatureLabel(featureLabel(language, name));
    const marker = feat.marker ? ' ' + feat.marker : '';
    return `${i + 1}. ${prefix}${label}${marker}`;
  });
  const hasNext = start + FEATURE_LIST_PAGE_SIZE < names.length;
  const hasPrev = page > 0;
  if (hasNext) {
    lines.push('\n11. Next');
  }
  if (hasPrev) {
    lines.push('12. Previous');
  }
  return buildMenu(
    heading,
    '',
    [
      ...(hint ? [toSmallCaps(hint), ''] : []),
      ...lines,
      '',
      '0. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

// Picker showing the current status + marker, then the 4 status options.
function buildStatusPicker(language, featureName) {
  const feat = featureFlagService.getFeature(featureName);
  const prefix = feat.prefix ? toSmallCaps(feat.prefix) + ' ' : '';
  const heading = prefix + toSmallCaps(featureLabel(language, featureName));
  const statuses = FEATURE_STATUSES_ORDER.map((s, i) => {
    return `${i + 1}. ${DEFAULT_STATUS_MARKERS[s] || ''} ${toSmallCaps(featureStatusLabel(language, s))}`;
  });
  return buildMenu(
    heading,
    '',
    [
      'ℹ️ ' + toSmallCaps(t(language, 'admin.flags.currentStatus')) + ': ' + (feat.marker ? feat.marker + ' ' : '') + toSmallCaps(featureStatusLabel(language, feat.status)),
      '',
      toSmallCaps(t(language, 'admin.flags.selectStatus')),
      '',
      ...statuses,
      '',
      '5. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

// Timing submenu after choosing a new status.
function buildTimingPicker(language, featureName, targetStatus) {
  return buildMenu(
    '> *⏳ ' + L(language, 'admin.flags.applyTitle') + '*',
    '',
    [
      toSmallCaps(featureLabel(language, featureName)) + ' ▸ ' + toSmallCaps(featureStatusLabel(language, targetStatus)),
      '',
      '1. ' + L(language, 'admin.flags.applyNow'),
      '2. ' + L(language, 'admin.flags.applyLater'),
      '',
      '3. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

// Shared Yes/No question (used by the apply/schedule customize step).
function buildYesNoQuestion(language, heading, askKey) {
  return buildMenu(
    heading,
    '',
    [
      L(language, askKey),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );
}

// Broadcast-style time picker for scheduling.
function buildScheduleTimePrompt(language) {
  return buildMenu(
    '⏳ ' + L(language, 'admin.flags.applyTitle'),
    '',
    [
      toSmallCaps(t(language, 'admin.flags.askScheduleTime')),
      '',
      '1. ' + L(language, 'admin.schedule.preset1h'),
      '2. ' + L(language, 'admin.schedule.preset3h'),
      '3. ' + L(language, 'admin.schedule.presetTomorrow9'),
      '4. ' + L(language, 'admin.schedule.presetTomorrow6'),
      '5. ' + L(language, 'admin.schedule.presetCustom'),
      '',
      '6. ◀️ ' + L(language, 'admin.schedule.scheduleBack'),
      '',
      toSmallCaps(t(language, 'admin.schedule.timeHint'))
    ]
  );
}

function buildScheduleTimeManual(language) {
  return buildMenu(
    '⏳ ' + L(language, 'admin.flags.applyTitle'),
    '',
    [
      toSmallCaps(t(language, 'admin.schedule.manualPrompt')),
      '',
      '0. ' + L(language, 'admin.schedule.scheduleBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

// Final confirmation before scheduling.
function buildScheduleConfirm(language, featureName, targetStatus, startAt) {
  return buildMenu(
    '⏳ ' + L(language, 'admin.flags.applyTitle'),
    '',
    [
      { static: toSmallCaps(t(language, 'admin.flags.scheduleConfirmPre')) + ' ', dynamic: formatTimeLabel(startAt) + t(language, 'admin.flags.scheduleConfirmPost') },
      '',
      { static: '> ', dynamic: featureLabel(language, featureName) + ' ▸ ' + featureStatusLabel(language, targetStatus) },
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );
}

// Message customization submenu (step 5).
function buildCustomizeMenu(language, featureName, resultLine = '') {
  return buildMenu(
    '📝 ' + L(language, 'admin.flags.customizeTitle'),
    toSmallCaps(featureLabel(language, featureName)),
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + L(language, 'admin.flags.msgUnavailable'),
      '2. ' + L(language, 'admin.flags.msgNotify'),
      '3. ' + L(language, 'admin.flags.msgInfo'),
      '',
      '4. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

// Message value input prompt (shows the current default).
function buildCustomizeMsgPrompt(language, featureName, slot) {
  const current = featureFlagService.getFeatureMessage(featureName, slot, language);
  return buildMenu(
    '📝 ' + L(language, FEATURE_MESSAGE_SLOT_LABEL_KEYS[slot] || 'admin.flags.msgUnavailable'),
    '',
    [
      L(language, 'admin.flags.msgCurrent') + ':',
      { static: '> ', dynamic: current },
      '',
      L(language, 'admin.flags.msgPrompt'),
      '',
      '0. ' + L(language, 'admin.flags.keepDefault'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

// Confirm a newly typed message before saving.
function buildCustomizeMsgConfirm(language, slot, text) {
  return buildMenu(
    '📝 ' + L(language, FEATURE_MESSAGE_SLOT_LABEL_KEYS[slot] || 'admin.flags.msgUnavailable'),
    '',
    [
      L(language, 'admin.flags.msgConfirmQ'),
      { static: '> ', dynamic: text },
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );
}

// Marker picker (presets 1-4, 5 Remove, 6 Customize, 0 Back).
function buildMarkerPicker(language, featureName, displayLabel) {
  const isBulk = typeof featureName !== 'string';
  const targetLabel = isBulk
    ? featureStatusLabel(language, featureName.status)
    : (displayLabel || featureLabel(language, featureName));
  const lines = PRESET_MARKERS.map((m, i) => `${i + 1}. ${m}`);
  return buildMenu(
    '🔖 ' + L(language, isBulk ? 'admin.flags.bulkMarkerTitle' : 'admin.flags.optionMarker'),
    '',
    [
      toSmallCaps(t(language, isBulk ? 'admin.flags.selectBulkMarker' : 'admin.flags.selectMarker')) + '\n>> *' + toSmallCaps(targetLabel) + '*',
      '',
      ...lines,
      '',
      '5. 🗑️ ' + L(language, 'admin.flags.remove'),
      '6. 🎨 ' + L(language, 'admin.flags.customize'),
      '',
      '0. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

function buildMarkerScopeMenu(language) {
  return buildMenu('🔖 ' + L(language, 'admin.flags.optionMarker'), '', [
    L(language, 'admin.flags.markerScopePrompt'),
    '',
    '1. ' + L(language, 'admin.flags.oneFeature'),
    '2. ' + L(language, 'admin.flags.allFeatures'),
    '',
    '0. ' + L(language, 'admin.flags.back'),
    '',
    t(language, 'admin.replyPrompt')
  ]);
}

function buildBulkMarkerStatusPicker(language) {
  const lines = FEATURE_STATUSES_ORDER.map((status, index) =>
    `${index + 1}. ${STATUS_MARKER_ICONS[status]} ${featureStatusLabel(language, status)}`
  );
  return buildMenu('🔖 ' + L(language, 'admin.flags.bulkMarkerTitle'), '', [
    L(language, 'admin.flags.bulkMarkerStatusPrompt'),
    '',
    ...lines,
    '',
    '0. ' + L(language, 'admin.flags.back'),
    '',
    t(language, 'admin.replyPrompt')
  ]);
}

function buildBulkMarkerConfirm(language, status, count) {
  return buildMenu('🔖 ' + L(language, 'admin.flags.bulkMarkerTitle'), '', [
    L(language, 'admin.flags.bulkMarkerCount', { count, status: featureStatusLabel(language, status) }),
    '',
    '1. ' + L(language, 'admin.flags.continue'),
    '2. ' + L(language, 'admin.flags.cancel')
  ]);
}

function buildBulkMarkerFinalConfirm(language, status, marker) {
  return buildMenu('🔖 ' + L(language, 'admin.flags.bulkMarkerTitle'), '', [
    L(language, 'admin.flags.bulkMarkerFinalQuestion', { status: featureStatusLabel(language, status), marker }),
    '',
    '1. ' + L(language, 'admin.yes'),
    '2. ' + L(language, 'admin.no')
  ]);
}

// Free-text custom marker prompt.
function buildMarkerCustomPrompt(language, target, displayLabel) {
  const isBulk = typeof target !== 'string';
  const targetLabel = isBulk ? featureStatusLabel(language, target.status) : (displayLabel || featureLabel(language, target));
  return buildMenu(
    '🔖 ' + L(language, isBulk ? 'admin.flags.bulkMarkerTitle' : 'admin.flags.optionMarker'),
    '',
    [
      toSmallCaps(t(language, 'admin.flags.customPrompt')) + '\n>> *' + toSmallCaps(targetLabel) + '*',
      '',
      '0. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

function buildMarkerChangeConfirm(language, targetLabel, marker) {
  return buildMenu('🔖 ' + L(language, 'admin.flags.optionMarker'), '', [
    L(language, 'admin.flags.markerConfirmQuestion', { target: targetLabel, marker: marker || L(language, 'admin.flags.remove') }),
    '',
    '1. ' + L(language, 'admin.yes'),
    '2. ' + L(language, 'admin.no')
  ]);
}

function buildMarkerRemoveConfirm(language, targetLabel) {
  return buildMenu('🔖 ' + L(language, 'admin.flags.optionMarker'), '', [
    L(language, 'admin.flags.markerRemoveConfirmQuestion', { target: targetLabel }),
    '',
    '1. ' + L(language, 'admin.yes'),
    '2. ' + L(language, 'admin.no')
  ]);
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function resetFeatureFlow(sender, chatId) {
  sessionManager.setState(sender, chatId, {
    currentMenu: 'feature_flags',
    pendingAction: null,
    pendingFeature: null,
    pendingNewStatus: null,
    pendingMsgSlot: null,
    pendingMsgText: null,
    pendingReturn: null,
    pendingStartAt: null,
    pendingMarkerStatus: null,
    pendingMarkerBulk: false,
    pendingMarkerValue: null,
    pendingMarkerNode: null,
    pendingMarkerNavigation: null,
    pendingMarkerLabel: null,
    pendingListPage: 0,
    pendingStatusListPage: 0,
    markerNavStack: [],
    markerNavNode: 'root',
    markerNavPage: 0,
    pendingStatusFeature: null,
    pendingStatusTarget: null
  });
}

function setFlags(context, extra) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const base = {
    currentMenu: 'feature_flags',
    pendingAction: null,
    pendingFeature: null,
    pendingNewStatus: session.pendingNewStatus,
    pendingMsgSlot: null,
    pendingMsgText: null,
    pendingReturn: session.pendingReturn,
    pendingStartAt: session.pendingStartAt,
    pendingMarkerStatus: session.pendingMarkerStatus,
    pendingMarkerBulk: session.pendingMarkerBulk,
    pendingMarkerValue: session.pendingMarkerValue,
    pendingMarkerNode: session.pendingMarkerNode,
    pendingMarkerNavigation: session.pendingMarkerNavigation,
    pendingMarkerLabel: session.pendingMarkerLabel,
    pendingListPage: session.pendingListPage || 0,
    pendingStatusListPage: session.pendingStatusListPage || 0,
    markerNavStack: session.markerNavStack,
    markerNavNode: session.markerNavNode,
    markerNavPage: session.markerNavPage,
    pendingStatusFeature: session.pendingStatusFeature,
    pendingStatusTarget: session.pendingStatusTarget
  };
  sessionManager.setState(sender, chatId, Object.assign(base, extra));
  return (context.chatId || sender);
}

async function sendFlagsMenu(context, text, transitionKey = 'feature_flags') {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey });
}

export async function sendFeatureFlagsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  resetFeatureFlow(sender, chatId);

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildFeatureManagementRoot(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'feature_flags'
  });
}

// ---------------------------------------------------------------------------
// Stage navigation
// ---------------------------------------------------------------------------

async function showFeatureList(context, page = 0) {
  const names = featureFlagService.getFeatureNames();
  const totalPages = Math.max(1, Math.ceil(names.length / FEATURE_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  setFlags(context, { pendingAction: 'feature_list', pendingListPage: safePage });
  const language = resolveLanguage(context.sender);
  const heading = '📋 ' + L(language, 'admin.flags.listTitle');
  return sendFlagsMenu(context, buildFeaturePicker(language, { heading, page: safePage }));
}

async function handleFeatureListReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const page = session.pendingListPage || 0;
  const names = featureFlagService.getFeatureNames();
  const totalPages = Math.max(1, Math.ceil(names.length / FEATURE_LIST_PAGE_SIZE));
  const start = page * FEATURE_LIST_PAGE_SIZE;
  const visible = names.slice(start, start + FEATURE_LIST_PAGE_SIZE);
  const hasNext = start + FEATURE_LIST_PAGE_SIZE < names.length;
  const hasPrev = page > 0;

  if (input === '0') {
    return sendFeatureFlagsPanel(context, { transitionKey: 'flags_to_system' });
  }
  if (input === '11' && hasNext) {
    return showFeatureList(context, page + 1);
  }
  if (input === '12' && hasPrev) {
    return showFeatureList(context, page - 1);
  }
  if (/^\d+$/.test(input)) {
    const n = parseInt(input, 10);
    if (n >= 1 && n <= visible.length) {
      const name = visible[n - 1];
      const feat = featureFlagService.getFeature(name);
      const prefix = feat.prefix ? feat.prefix + ' ' : '';
      const label = cleanFeatureLabel(featureLabel(language, name));
      const marker = feat.marker ? ' ' + feat.marker : '';
      const info = '' + toSmallCaps(prefix + label) + marker + ' · *' + toSmallCaps(featureStatusLabel(language, feat.status)) + '*';
      await sendText(context.sock, sender, info);
      return showFeatureList(context, page);
    }
  }
  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
  return showFeatureList(context, page);
}

async function pickFeatureForStatus(context, page = 0) {
  return showStatusList(context, page);
}

// Flat feature picker for Toggle Feature Status: `N. {prefix} {label} {marker}`.
// Status is indicated by the marker, not by text.
function buildFeatureStatusList(language, page = 0) {
  const names = featureFlagService.getFeatureNames();
  const start = page * FEATURE_LIST_PAGE_SIZE;
  const visible = names.slice(start, start + FEATURE_LIST_PAGE_SIZE);
  const lines = visible.map((name, i) => {
    const feat = featureFlagService.getFeature(name);
    const prefix = feat.prefix ? feat.prefix + ' ' : '';
    const label = cleanFeatureLabel(featureLabel(language, name));
    const marker = feat.marker ? ' ' + feat.marker : '';
    return `${i + 1}. ${prefix}${label}${marker}`;
  });
  const hasNext = start + FEATURE_LIST_PAGE_SIZE < names.length;
  const hasPrev = page > 0;
  if (hasNext) lines.push('11. Next');
  if (hasPrev) lines.push('12. Previous');
  return buildMenu(
    '⚡ ' + L(language, 'admin.flags.toggleStatus'),
    '',
    [
      L(language, 'admin.flags.selectFeature'),
      '',
      ...lines,
      '',
      '0. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

async function showStatusList(context, page = 0) {
  const names = featureFlagService.getFeatureNames();
  const totalPages = Math.max(1, Math.ceil(names.length / FEATURE_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  setFlags(context, { pendingAction: 'feature_status_list', pendingStatusListPage: safePage });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildFeatureStatusList(language, safePage));
}

async function handleStatusListReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const page = session.pendingStatusListPage || 0;
  const names = featureFlagService.getFeatureNames();
  const start = page * FEATURE_LIST_PAGE_SIZE;
  const visible = names.slice(start, start + FEATURE_LIST_PAGE_SIZE);
  const hasNext = start + FEATURE_LIST_PAGE_SIZE < names.length;
  const hasPrev = page > 0;

  if (input === '0') {
    return sendFeatureFlagsPanel(context);
  }
  if (input === '11' && hasNext) {
    return showStatusList(context, page + 1);
  }
  if (input === '12' && hasPrev) {
    return showStatusList(context, page - 1);
  }
  if (/^\d+$/.test(input)) {
    const n = parseInt(input, 10);
    if (n >= 1 && n <= visible.length) {
      return showStatusChangeMenu(context, visible[n - 1]);
    }
  }
  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
  return showStatusList(context, page);
}

async function showMarkerNavigation(context, nodeId = 'root', stack = [], page = 0) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  setFlags(context, {
    currentMenu: 'marker_nav',
    pendingAction: 'marker_nav',
    markerNavNode: nodeId,
    markerNavStack: stack,
    markerNavPage: page,
    pendingMarkerBulk: false
  });
  const language = resolveLanguage(sender);
  return sendFlagsMenu(context, buildMarkerNavigation(language, nodeId, page), 'marker_nav');
}

async function showMarkerSubmenuActions(context, node, stack) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  setFlags(context, {
    currentMenu: 'marker_submenu_action',
    pendingAction: 'marker_submenu_action',
    pendingMarkerNode: node,
    markerNavNode: stack[stack.length - 1] || 'root',
    markerNavStack: stack
  });
  const language = resolveLanguage(sender);
  return sendFlagsMenu(context, buildMarkerSubmenuActions(language, node), 'marker_submenu_action');
}

async function openMarkerTarget(context, markerId, navigation) {
  const chatId = context.chatId || context.sender;
  const language = resolveLanguage(context.sender);
  sessionManager.setState(context.sender, chatId, {
    pendingMarkerNavigation: navigation,
    pendingMarkerLabel: navigation.label || featureLabel(language, markerId)
  });
  return showMarkerPicker(context, markerId, navigation.label);
}

/**
 * Display name for the status flow: the registry label. Leading emojis
 * are stripped; the result stays in normal case (dynamic value).
 */
function statusDisplayName(language, session, featureName) {
  void session;
  return featureLabel(language, featureName);
}

/**
 * Split a translated template with {feature}/{status} placeholders into
 * render segments so static parts stay small caps and dynamic values stay
 * in normal case regardless of word order in each language.
 */
function templateSegments(template, vars) {
  const segs = [];
  const re = /\{(feature|status)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) segs.push({ static: String(template).slice(last, m.index) });
    segs.push({ dynamic: vars[m[1]] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < String(template).length) segs.push({ static: String(template).slice(last) });
  return segs;
}

function buildStatusChangeMenu(language, featureName, displayName) {
  const feat = featureFlagService.getFeature(featureName);
  const statuses = FEATURE_STATUSES_ORDER.map((s, i) => {
    const icon = STATUS_MARKER_ICONS[s] || '';
    return `${i + 1}. ${icon} ${toSmallCaps(featureStatusLabel(language, s))}`;
  });
  return buildMenu(
    '⚡ ' + L(language, 'admin.flags.toggleStatus'),
    displayName || '',
    [
      { segments: [{ static: '👉 ' + t(language, 'admin.flags.currentStatus') + ': ' }, { dynamic: (feat.marker ? feat.marker + ' ' : '') + featureStatusLabel(language, feat.status) }] },
      '',
      toSmallCaps(t(language, 'admin.flags.selectStatus')),
      '',
      ...statuses,
      '',
      '0. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

function buildStatusConfirmation(language, featureName, targetStatus, displayName) {
  const name = displayName || featureLabel(language, featureName);
  return buildMenu(
    '⚡ ' + L(language, 'admin.flags.toggleStatus'),
    '',
    [
      { segments: templateSegments(t(language, 'admin.flags.confirmStatusChange'), { feature: name, status: featureStatusLabel(language, targetStatus) }) },
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );
}

async function showStatusChangeMenu(context, featureName) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const displayName = statusDisplayName(language, sessionManager.getSession(sender, chatId) || {}, featureName);
  setFlags(context, {
    currentMenu: 'status_change',
    pendingAction: 'status_change_select',
    pendingStatusFeature: featureName
  });
  return sendFlagsMenu(context, buildStatusChangeMenu(language, featureName, displayName), 'status_change');
}

async function showStatusConfirmation(context, featureName, targetStatus) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const displayName = statusDisplayName(language, sessionManager.getSession(sender, chatId) || {}, featureName);
  setFlags(context, {
    currentMenu: 'status_confirm',
    pendingAction: 'status_confirm',
    pendingStatusFeature: featureName,
    pendingStatusTarget: targetStatus
  });
  return sendFlagsMenu(context, buildStatusConfirmation(language, featureName, targetStatus, displayName), 'status_confirm');
}

async function executeStatusChange(context, featureName, targetStatus) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const prev = featureFlagService.getFeature(featureName).status;

  if (targetStatus === prev) {
    await sendText(context.sock, sender, '😅 ' + L(language, 'admin.flags.statusSame'));
    return showStatusChangeMenu(context, featureName);
  }

  featureFlagService.setFeatureStatus(featureName, targetStatus);
  logAdminAction(sender, 'feature_status', featureName + ' → ' + targetStatus);

  if (targetStatus === 'available' && prev !== 'available') {
    await featureScheduleService.notifyFeatureAvailable(featureName);
  }

  const msg = '✅ ' + toSmallCaps(featureLabel(language, featureName)) + ' → ' + toSmallCaps(featureStatusLabel(language, targetStatus));
  await showStatusList(context, session.pendingStatusListPage || 0);
  await sendTransientMarkerResult(context.sock, sender, msg);
}

async function showMarkerScope(context) {
  setFlags(context, { currentMenu: 'change_marker_scope', pendingAction: 'change_marker_scope', pendingMarkerBulk: false });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildMarkerScopeMenu(language), 'change_marker_scope');
}

async function pickMarkerStatusForChange(context) {
  setFlags(context, { currentMenu: 'change_marker_status_list', pendingAction: 'change_marker_status_list', pendingMarkerStatus: null, pendingMarkerBulk: true });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildBulkMarkerStatusPicker(language), 'change_marker_status_list');
}

async function showBulkMarkerConfirm(context, status) {
  setFlags(context, { currentMenu: 'change_marker_bulk_confirm', pendingAction: 'change_marker_bulk_confirm', pendingMarkerStatus: status, pendingMarkerBulk: true });
  const language = resolveLanguage(context.sender);
  const count = featureFlagService.getFeatureNames().filter((name) => featureFlagService.getFeature(name).status === status).length;
  return sendFlagsMenu(context, buildBulkMarkerConfirm(language, status, count), 'change_marker_bulk_confirm');
}

async function pickMarkerStatus(context) {
  setFlags(context, { pendingAction: 'feature_pick_marker_status', pendingMarkerStatus: null });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildMarkerStatusPicker(language));
}

async function showMarkerStatusConfirm(context, status) {
  setFlags(context, { pendingAction: 'feature_toggle_markers_confirm', pendingMarkerStatus: status });
  const language = resolveLanguage(context.sender);
  const enabled = featureFlagService.hasVisibleMarkersByStatus(status);
  return sendFlagsMenu(context, buildMarkerStatusConfirm(language, status, !enabled));
}

function buildMarkerStatusPicker(language) {
  const lines = FEATURE_STATUSES_ORDER.map((status, index) =>
    `${index + 1}. ${STATUS_MARKER_ICONS[status]} ${featureStatusLabel(language, status)}`
  );
  return buildMenu(
    '🔖 ' + L(language, 'admin.flags.optionToggleMarkers'),
    '',
    [
      t(language, 'admin.flags.markerStatusPrompt'),
      '',
      ...lines,
      '',
      '5. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

function buildMarkerStatusConfirm(language, status, enabled) {
  const icon = STATUS_MARKER_ICONS[status];
  const statusLabel = featureStatusLabel(language, status);
  return buildMenu(
    icon + ' ' + statusLabel + ' ' + L(language, 'admin.flags.markers'),
    '',
    [
      L(language, enabled ? 'admin.flags.markerTurnOnQuestion' : 'admin.flags.markerTurnOffQuestion') + ' *"' + statusLabel + '"* ?',
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no'),
      '',
      '0. ' + L(language, 'admin.flags.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

async function showStatusPicker(context, featureName) {
  setFlags(context, { pendingAction: 'feature_set_status_value', pendingFeature: featureName, pendingNewStatus: null, pendingStartAt: null });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildStatusPicker(language, featureName));
}

async function showTimingPicker(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_apply_timing',
    pendingFeature: session.pendingFeature,
    pendingNewStatus: session.pendingNewStatus
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildTimingPicker(language, session.pendingFeature, session.pendingNewStatus));
}

async function showApplyCustomize(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_apply_customize',
    pendingFeature: session.pendingFeature,
    pendingNewStatus: session.pendingNewStatus
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildYesNoQuestion(language, '📝 ' + L(language, 'admin.flags.customizeTitle'), 'admin.flags.askCustomize'));
}

async function showScheduleTimePrompt(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_schedule_time',
    pendingFeature: session.pendingFeature,
    pendingNewStatus: session.pendingNewStatus
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildScheduleTimePrompt(language));
}

async function showScheduleTimeManual(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_schedule_manual',
    pendingFeature: session.pendingFeature,
    pendingNewStatus: session.pendingNewStatus,
    pendingStartAt: null
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildScheduleTimeManual(language));
}

async function showScheduleCustomize(context, startAt) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_schedule_customize',
    pendingFeature: session.pendingFeature,
    pendingNewStatus: session.pendingNewStatus,
    pendingStartAt: startAt
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildYesNoQuestion(language, '📝 ' + L(language, 'admin.flags.customizeTitle'), 'admin.flags.askCustomize'));
}

async function showScheduleFinalConfirm(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_schedule_final_confirm',
    pendingFeature: session.pendingFeature,
    pendingNewStatus: session.pendingNewStatus,
    pendingStartAt: session.pendingStartAt
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildScheduleConfirm(language, session.pendingFeature, session.pendingNewStatus, session.pendingStartAt));
}

async function showCustomizeMenu(context, returnTo, resultLine = '') {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_customize_menu',
    pendingFeature: session.pendingFeature,
    pendingReturn: returnTo || session.pendingReturn
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildCustomizeMenu(language, session.pendingFeature, resultLine));
}

async function showCustomizeMsgPrompt(context, slot) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_customize_msg_input',
    pendingFeature: session.pendingFeature,
    pendingMsgSlot: slot,
    pendingMsgText: null
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildCustomizeMsgPrompt(language, session.pendingFeature, slot));
}

async function showCustomizeMsgConfirm(context, slot, text) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    pendingAction: 'feature_customize_msg_confirm',
    pendingFeature: session.pendingFeature,
    pendingMsgSlot: slot,
    pendingMsgText: text
  });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildCustomizeMsgConfirm(language, slot, text));
}

async function showMarkerPicker(context, featureName, displayLabel) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, { currentMenu: 'marker_picker', pendingAction: 'feature_set_marker_value', pendingFeature: featureName, pendingMarkerLabel: displayLabel || session.pendingMarkerLabel });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildMarkerPicker(language, featureName, displayLabel || session.pendingMarkerLabel), 'marker_picker');
}

async function showMarkerChangeConfirm(context, marker) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const targetLabel = session.pendingMarkerLabel || featureLabel(resolveLanguage(sender), session.pendingFeature);
  setFlags(context, {
    currentMenu: 'marker_change_confirm',
    pendingAction: 'marker_change_confirm',
    pendingFeature: session.pendingFeature,
    pendingMarkerValue: marker,
    pendingMarkerLabel: targetLabel
  });
  const language = resolveLanguage(sender);
  return sendFlagsMenu(
    context,
    buildMarkerChangeConfirm(language, targetLabel, marker),
    'marker_change_confirm'
  );
}

async function showMarkerRemoveConfirm(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const targetLabel = session.pendingMarkerLabel || featureLabel(resolveLanguage(sender), session.pendingFeature);
  setFlags(context, {
    currentMenu: 'marker_change_confirm',
    pendingAction: 'marker_change_confirm',
    pendingFeature: session.pendingFeature,
    pendingMarkerValue: '',
    pendingMarkerLabel: targetLabel
  });
  const language = resolveLanguage(sender);
  return sendFlagsMenu(context, buildMarkerRemoveConfirm(language, targetLabel), 'marker_change_confirm');
}

async function showBulkMarkerPicker(context, status) {
  setFlags(context, { currentMenu: 'change_marker_value', pendingAction: 'change_marker_bulk_value', pendingMarkerStatus: status, pendingMarkerBulk: true });
  const language = resolveLanguage(context.sender);
  return sendFlagsMenu(context, buildMarkerPicker(language, { status }), 'change_marker_value');
}

async function showMarkerCustomPrompt(context, featureName) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  setFlags(context, {
    currentMenu: 'change_marker_custom_input',
    pendingAction: 'feature_marker_custom',
    pendingFeature: featureName,
    pendingMarkerBulk: session.pendingMarkerBulk
  });
  const language = resolveLanguage(context.sender);
  const target = session.pendingMarkerBulk
    ? { status: session.pendingMarkerStatus }
    : featureName;
  const targetLabel = session.pendingMarkerBulk
    ? null
    : session.pendingMarkerLabel;
  return sendFlagsMenu(context, buildMarkerCustomPrompt(language, target, targetLabel), 'change_marker_custom_input');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function invalidAndReShow(context, stage) {
  const language = resolveLanguage(context.sender);
  await sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.invalidChoice')));
  await stage(context);
  return;
}

async function sendTransientMarkerResult(sock, sender, text) {
  try {
    const sent = await sock.sendMessage(sender, { text });
    const key = sent?.key;
    if (key) {
      setTimeout(() => {
        sock.sendMessage(sender, { delete: key }).catch((err) => {
          logger.warn({ err, jid: sender }, '[FEATURE_MARKER] failed to delete transient result');
        });
      }, 10000).unref?.();
    }
  } catch (err) {
    logger.warn({ err, jid: sender }, '[FEATURE_MARKER] failed to send transient result');
  }
}

async function applyMarkerChange(context, marker) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const name = session.pendingFeature;
  const language = resolveLanguage(sender);
  const oldMarker = featureFlagService.getFeature(name)?.marker || '(removed)';

  featureFlagService.setFeatureMarker(name, marker);
  logAdminAction(sender, 'feature_marker', (name + ': ' + oldMarker + ' → ' + (marker || '(removed)')));
  const msg = marker === ''
    ? '✅ ' + L(language, 'admin.flags.markerRemoved') + ': ' + toSmallCaps(featureLabel(language, name))
    : '✅ ' + L(language, 'admin.flags.markerChanged') + ': ' + toSmallCaps(featureLabel(language, name)) + ' → ' + marker;

  resetFeatureFlow(sender, chatId);
  if (session.pendingMarkerNavigation) {
    await showMarkerNavigation(
      context,
      session.pendingMarkerNavigation.node,
      session.pendingMarkerNavigation.stack || [],
      0
    );
    await sendTransientMarkerResult(context.sock, sender, msg);
    return;
  }
  await sendFeatureFlagsPanel(context);
  await sendTransientMarkerResult(context.sock, sender, msg);
}

async function applyBulkMarkerChange(context, marker) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const status = session.pendingMarkerStatus;
  const language = resolveLanguage(sender);
  const names = featureFlagService.getFeatureNames().filter((name) => featureFlagService.getFeature(name).status === status);
  const oldMarkers = names.map((name) => name + '=' + (featureFlagService.getFeature(name).marker || '(removed)')).join(', ');
  const updated = featureFlagService.setMarkerByStatus(status, marker);

  logAdminAction(sender, 'feature_marker_bulk', status + ': [' + oldMarkers + '] → ' + (marker || '(removed)'));
  resetFeatureFlow(sender, chatId);
  await sendFeatureFlagsPanel(context);
  await sendTransientMarkerResult(
    context.sock,
    sender,
    '✅ ' + L(language, 'admin.flags.bulkMarkerChanged', { count: updated, status: featureStatusLabel(language, status), marker: marker || L(language, 'admin.flags.remove') })
  );
}

async function applyImmediateFeature(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const name = session.pendingFeature;
  const newStatus = session.pendingNewStatus;

  if (!name || !newStatus) return sendFeatureFlagsPanel(context);

  const prev = featureFlagService.getFeature(name).status;
  featureFlagService.setFeatureStatus(name, newStatus);
  logAdminAction(sender, 'feature_status', (name + ' → ' + newStatus + ' (immediate)'));

  if (newStatus === 'available' && prev !== 'available') {
    await featureScheduleService.notifyFeatureAvailable(name);
  }

  resetFeatureFlow(sender, chatId);
  return sendFeatureFlagsPanel(context, { resultLine: '✅ ' + L(language, 'admin.flags.statusChangedSuccess') });
}

async function confirmFeatureSchedule(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const name = session.pendingFeature;
  const newStatus = session.pendingNewStatus;
  const startAt = session.pendingStartAt;

  if (!name || !newStatus || typeof startAt !== 'number') return sendFeatureFlagsPanel(context);

  const messages = featureFlagService.getFeatureMessageOverrides(name);
  await featureScheduleService.scheduleFeatureChange({ adminJid: sender, featureId: name, newStatus, startAt, messages });
  logAdminAction(sender, 'feature_schedule', (name + ' → ' + newStatus + ' at ' + formatTimeLabel(startAt)));

  resetFeatureFlow(sender, chatId);
  return sendFeatureFlagsPanel(context, { resultLine: '✅ ' + L(language, 'admin.flags.scheduleSuccess') });
}

// Parse the broadcast-style time input: preset (1-4), manual date, or relative time.
function parseFeatureChangeTime(input) {
  const trimmed = (input || '').trim();
  if (/^[1-4]$/.test(trimmed)) return applySchedulePreset(trimmed);
  const manual = parseScheduleTime(trimmed);
  if (manual) return manual.getTime();
  return parseRelativeTime(trimmed);
}

// ---------------------------------------------------------------------------
// Reply dispatcher
// ---------------------------------------------------------------------------

export async function handleFeatureFlagsReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const action = session.pendingAction;
  const input = (content || '').trim();
  const featureName = session.pendingFeature;
  const names = featureFlagService.getFeatureNames();
  const indexOf = (s) => parseInt(s, 10) - 1;
  const validIndex = (s, len) => /^[0-9]+$/.test(s) && indexOf(s) >= 0 && indexOf(s) < len;

  // Root menu (config-driven).
  if (!action) {
    if (input === '0') return sendSystemSettingsPanel(context, { transitionKey: 'flags_to_system' });
    const resolved = resolveMenuOption('feature_management', input);
    if (!resolved) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeatureFlagsPanel(context);
    }
    switch (resolved.action) {
      case 'features.list': return showFeatureList(context, 0);
      case 'features.select_status': return pickFeatureForStatus(context);
      case 'features.select_marker': return showMarkerScope(context);
      case 'features.change_marker_scope': return showMarkerScope(context);
      case 'features.toggle_markers_status': return pickMarkerStatus(context);
      case 'features.back': return sendSystemSettingsPanel(context, { transitionKey: 'flags_to_system' });
      default: return sendFeatureFlagsPanel(context);
    }
  }

  // Paginated read-only list view.
  if (action === 'feature_list') {
    return handleFeatureListReply(context, input);
  }

  // Flat paginated Toggle Feature Status list.
  if (action === 'feature_status_list') {
    return handleStatusListReply(context, input);
  }

  // Feature pickers.
  if (action === 'feature_pick_status') {
    if (input === '0') return sendFeatureFlagsPanel(context);
    if (!validIndex(input, names.length)) return invalidAndReShow(context, pickFeatureForStatus);
    return showStatusPicker(context, names[indexOf(input)]);
  }
  if (action === 'change_marker_scope') {
    if (input === '0') return sendFeatureFlagsPanel(context);
    if (input === '1') return showMarkerNavigation(context);
    if (input === '2') return pickMarkerStatusForChange(context);
    return invalidAndReShow(context, showMarkerScope);
  }

  if (action === 'marker_nav') {
    const nodeId = session.markerNavNode || 'root';
    const page = session.markerNavPage || 0;
    const children = markerNavigationChildren(nodeId);
    const start = page * MARKER_PAGE_SIZE;
    const moreNumber = start + MARKER_PAGE_SIZE + 1;
    if (input === '0') {
      if (session.markerNavStack?.length) {
        const stack = session.markerNavStack.slice(0, -1);
        return showMarkerNavigation(context, session.markerNavStack[session.markerNavStack.length - 1], stack, 0);
      }
      return showMarkerScope(context);
    }
    if (input === String(moreNumber) && start + MARKER_PAGE_SIZE < children.length) {
      return showMarkerNavigation(context, nodeId, session.markerNavStack || [], page + 1);
    }
    if (!/^\d+$/.test(input)) return invalidAndReShow(context, () => showMarkerNavigation(context, nodeId, session.markerNavStack || [], page));
    const selected = children[parseInt(input, 10) - 1];
    if (!selected) return invalidAndReShow(context, () => showMarkerNavigation(context, nodeId, session.markerNavStack || [], page));
    const navigation = { node: nodeId, stack: session.markerNavStack || [], label: t(language, selected.labelKey) };
    // Virtual grouping nodes (Advanced Options) have no markerId: drill directly.
    if (selected.submenu && !selected.markerId) return showMarkerNavigation(context, selected.children, [...(session.markerNavStack || []), nodeId], 0);
    if (selected.submenu) return showMarkerSubmenuActions(context, selected, [...(session.markerNavStack || []), nodeId]);
    return openMarkerTarget(context, selected.markerId, navigation);
  }

  if (action === 'marker_submenu_action') {
    const node = session.pendingMarkerNode;
    if (!node) return showMarkerNavigation(context);
    const stack = session.markerNavStack || [];
    if (input === '0') {
      const parent = stack[stack.length - 1] || 'root';
      return showMarkerNavigation(context, parent, stack.slice(0, -1), 0);
    }
    if (input === '1') {
      if (!node.markerId) return invalidAndReShow(context, () => showMarkerSubmenuActions(context, node, stack));
      return openMarkerTarget(context, node.markerId, {
        node: session.markerNavNode || 'root',
        stack,
        label: t(language, node.labelKey)
      });
    }
    if (input === '2') return showMarkerNavigation(context, node.children, stack, 0);
    return invalidAndReShow(context, () => showMarkerSubmenuActions(context, node, stack));
  }

  if (action === 'status_change_select') {
    const feature = session.pendingStatusFeature;
    if (input === '0') {
      return showStatusList(context, session.pendingStatusListPage || 0);
    }
    if (!validIndex(input, FEATURE_STATUSES_ORDER.length)) return invalidAndReShow(context, () => showStatusChangeMenu(context, feature));
    const targetStatus = FEATURE_STATUSES_ORDER[indexOf(input)];
    return showStatusConfirmation(context, feature, targetStatus);
  }

  if (action === 'status_confirm') {
    const feature = session.pendingStatusFeature;
    const targetStatus = session.pendingStatusTarget;
    if (input === '1') {
      return executeStatusChange(context, feature, targetStatus);
    }
    if (input === '2' || input === '0') {
      return showStatusChangeMenu(context, feature);
    }
    return invalidAndReShow(context, () => showStatusConfirmation(context, feature, targetStatus));
  }

  if (action === 'change_marker_status_list') {
    if (input === '0') return showMarkerScope(context);
    if (!validIndex(input, FEATURE_STATUSES_ORDER.length)) return invalidAndReShow(context, pickMarkerStatusForChange);
    return showBulkMarkerConfirm(context, FEATURE_STATUSES_ORDER[indexOf(input)]);
  }

  if (action === 'change_marker_bulk_confirm') {
    const status = session.pendingMarkerStatus;
    if (input === '2' || input === '0') return pickMarkerStatusForChange(context);
    if (input !== '1') return invalidAndReShow(context, showBulkMarkerConfirm.bind(null, context, status));
    return showBulkMarkerPicker(context, status);
  }

  if (action === 'feature_pick_marker_status') {
    if (input === '5' || input === '0') return sendFeatureFlagsPanel(context);
    if (!validIndex(input, FEATURE_STATUSES_ORDER.length)) return invalidAndReShow(context, pickMarkerStatus);
    return showMarkerStatusConfirm(context, FEATURE_STATUSES_ORDER[indexOf(input)]);
  }

  if (action === 'feature_toggle_markers_confirm') {
    const status = session.pendingMarkerStatus;
    if (!status) return sendFeatureFlagsPanel(context);
    if (input === '2' || input === '0') return pickMarkerStatus(context);
    if (input !== '1') return invalidAndReShow(context, showMarkerStatusConfirm.bind(null, context, status));

    const enabled = !featureFlagService.hasVisibleMarkersByStatus(status);
    const updated = featureFlagService.setMarkersByStatus(status, enabled);
    logAdminAction(sender, 'feature_markers_status', status + ' → ' + (enabled ? 'on' : 'off'));
    resetFeatureFlow(sender, chatId);
    const resultKey = enabled ? 'markerTurnedOn' : 'markerTurnedOff';
    return sendFeatureFlagsPanel(context, {
      resultLine: '✅ ' + L(language, 'admin.flags.' + resultKey) + ' ' + featureStatusLabel(language, status) + ' (' + updated + ')'
    });
  }

  // Status value selection.
  if (action === 'feature_set_status_value') {
    if (input === '0' || input === '5') return pickFeatureForStatus(context);
    if (!validIndex(input, FEATURE_STATUSES_ORDER.length)) return invalidAndReShow(context, showStatusPicker.bind(null, context, featureName));
    const newStatus = FEATURE_STATUSES_ORDER[indexOf(input)];
    const cur = featureFlagService.getFeature(featureName).status;
    if (newStatus === cur) {
      sessionManager.setState(sender, chatId, { pendingNewStatus: newStatus });
      await sendText(context.sock, sender, '😅 ' + L(language, 'admin.flags.statusSame'));
      return showStatusPicker(context, featureName);
    }
    sessionManager.setState(sender, chatId, { pendingNewStatus: newStatus });
    return showTimingPicker(context);
  }

  // Apply timing submenu.
  if (action === 'feature_apply_timing') {
    if (input === '3' || input === '0') return showStatusPicker(context, featureName);
    if (input === '1') return showApplyCustomize(context);
    if (input === '2') return showScheduleTimePrompt(context);
    return invalidAndReShow(context, showTimingPicker);
  }

  // Customize question (immediate path).
  if (action === 'feature_apply_customize') {
    if (input === '1') return showCustomizeMenu(context, 'apply');
    if (input === '2') return applyImmediateFeature(context);
    return invalidAndReShow(context, showApplyCustomize);
  }

  // Schedule time selection (presets, custom, or free text).
  if (action === 'feature_schedule_time') {
    if (input === '6' || input === '0') return showTimingPicker(context);
    if (input === '5') return showScheduleTimeManual(context);
    const ms = parseFeatureChangeTime(input);
    if (ms === null || ms <= Date.now()) {
      await sendText(context.sock, sender, L(language, 'admin.schedule.parseError'));
      return showScheduleTimePrompt(context);
    }
    return showScheduleCustomize(context, ms);
  }

  // Manual date/time entry for scheduling.
  if (action === 'feature_schedule_manual') {
    if (input === '0') return showScheduleTimePrompt(context);
    const ms = parseFeatureChangeTime(input);
    if (ms === null || ms <= Date.now()) {
      await sendText(context.sock, sender, L(language, 'admin.schedule.parseError'));
      return showScheduleTimeManual(context);
    }
    return showScheduleCustomize(context, ms);
  }

  // Customize question (schedule path).
  if (action === 'feature_schedule_customize') {
    if (input === '1') return showCustomizeMenu(context, 'schedule');
    if (input === '2') return showScheduleFinalConfirm(context);
    return invalidAndReShow(context, showScheduleCustomize.bind(null, context, session.pendingStartAt));
  }

  // Final schedule confirmation.
  if (action === 'feature_schedule_final_confirm') {
    if (input === '1') return confirmFeatureSchedule(context);
    if (input === '2' || input === '0') return showTimingPicker(context);
    return invalidAndReShow(context, showScheduleFinalConfirm);
  }

  // Message customization submenu.
  if (action === 'feature_customize_menu') {
    if (input === '1') return showCustomizeMsgPrompt(context, 'unavailable');
    if (input === '2') return showCustomizeMsgPrompt(context, 'notifyPrompt');
    if (input === '3') return showCustomizeMsgPrompt(context, 'info');
    if (input === '4' || input === '0') {
      if (session.pendingReturn === 'schedule') return showScheduleFinalConfirm(context);
      return applyImmediateFeature(context);
    }
    return invalidAndReShow(context, showCustomizeMenu.bind(null, context, session.pendingReturn));
  }

  // Message value input (0 = keep default, free text otherwise).
  if (action === 'feature_customize_msg_input') {
    if (input === '0') {
      featureFlagService.setFeatureMessage(featureName, session.pendingMsgSlot, null);
      logAdminAction(sender, 'feature_message', (featureName + '.' + session.pendingMsgSlot + ' → (default)'));
      return showCustomizeMenu(context, session.pendingReturn);
    }
    if (!input) {
      await sendText(context.sock, sender, L(language, 'common.emptyMessage'));
      return showCustomizeMsgPrompt(context, session.pendingMsgSlot);
    }
    return showCustomizeMsgConfirm(context, session.pendingMsgSlot, input);
  }

  // Message value confirmation.
  if (action === 'feature_customize_msg_confirm') {
    if (input === '1') {
      featureFlagService.setFeatureMessage(featureName, session.pendingMsgSlot, session.pendingMsgText);
      logAdminAction(sender, 'feature_message', (featureName + '.' + session.pendingMsgSlot + ' → ' + session.pendingMsgText));
      return showCustomizeMenu(context, session.pendingReturn, '✅ ' + L(language, 'admin.flags.msgUpdated'));
    }
    if (input === '2') return showCustomizeMsgPrompt(context, session.pendingMsgSlot);
    return invalidAndReShow(context, showCustomizeMsgConfirm.bind(null, context, session.pendingMsgSlot, session.pendingMsgText));
  }

  // Marker value selection (presets, remove, customize, back).
  if (action === 'feature_set_marker_value') {
    if (input === '0') {
      if (session.pendingMarkerNavigation) {
        return showMarkerNavigation(context, session.pendingMarkerNavigation.node, session.pendingMarkerNavigation.stack || [], 0);
      }
      return showMarkerNavigation(context);
    }
    const presetIndex = indexOf(input);
    if (presetIndex >= 0 && presetIndex < PRESET_MARKERS.length) {
      return showMarkerChangeConfirm(context, PRESET_MARKERS[presetIndex]);
    }
    if (input === '5') return showMarkerRemoveConfirm(context);
    if (input === '6') return showMarkerCustomPrompt(context, featureName);
    return invalidAndReShow(context, showMarkerPicker.bind(null, context, featureName));
  }

  if (action === 'marker_change_confirm') {
    if (input === '2' || input === '0') {
      return showMarkerPicker(context, featureName, session.pendingMarkerLabel);
    }
    if (input !== '1') return invalidAndReShow(context, () => showMarkerChangeConfirm(context, session.pendingMarkerValue));
    return applyMarkerChange(context, session.pendingMarkerValue);
  }

  if (action === 'change_marker_bulk_value') {
    if (input === '0') return pickMarkerStatusForChange(context);
    const presetIndex = indexOf(input);
    if (presetIndex >= 0 && presetIndex < PRESET_MARKERS.length) {
      sessionManager.setState(sender, chatId, { currentMenu: 'change_marker_bulk_confirm_value', pendingAction: 'change_marker_bulk_confirm_value', pendingMarkerValue: PRESET_MARKERS[presetIndex] });
      return sendFlagsMenu(context, buildBulkMarkerFinalConfirm(language, session.pendingMarkerStatus, PRESET_MARKERS[presetIndex]), 'change_marker_bulk_confirm_value');
    }
    if (input === '5') {
      sessionManager.setState(sender, chatId, { currentMenu: 'change_marker_bulk_confirm_value', pendingAction: 'change_marker_bulk_confirm_value', pendingMarkerValue: '' });
      return sendFlagsMenu(context, buildBulkMarkerFinalConfirm(language, session.pendingMarkerStatus, L(language, 'admin.flags.remove')), 'change_marker_bulk_confirm_value');
    }
    if (input === '6') return showMarkerCustomPrompt(context, null);
    return invalidAndReShow(context, showBulkMarkerPicker.bind(null, context, session.pendingMarkerStatus));
  }

  if (action === 'change_marker_bulk_confirm_value') {
    if (input === '1') return applyBulkMarkerChange(context, session.pendingMarkerValue);
    if (input === '2' || input === '0') return showBulkMarkerPicker(context, session.pendingMarkerStatus);
    return invalidAndReShow(context, () => sendFlagsMenu(context, buildBulkMarkerFinalConfirm(language, session.pendingMarkerStatus, session.pendingMarkerValue || L(language, 'admin.flags.remove')), 'change_marker_bulk_confirm_value'));
  }

  // Free-text custom marker (0 = back, otherwise a single emoji/short symbol).
  if (action === 'feature_marker_custom') {
    if (input === '0') return session.pendingMarkerBulk
      ? showBulkMarkerPicker(context, session.pendingMarkerStatus)
      : showMarkerPicker(context, featureName);
    const value = isValidCustomMarker(input) ? input.trim() : null;
    if (value === null) {
      await sendText(context.sock, sender, L(language, 'admin.flags.markerInvalid'));
      return showMarkerCustomPrompt(context, session.pendingMarkerBulk ? null : featureName);
    }
    if (session.pendingMarkerBulk) {
      sessionManager.setState(sender, chatId, { currentMenu: 'change_marker_bulk_confirm_value', pendingAction: 'change_marker_bulk_confirm_value', pendingMarkerValue: value });
      return sendFlagsMenu(context, buildBulkMarkerFinalConfirm(language, session.pendingMarkerStatus, value), 'change_marker_bulk_confirm_value');
    }
    return showMarkerChangeConfirm(context, value);
  }

  return sendFeatureFlagsPanel(context);
}

// ---------------------------------------------------------------------------
// Error Log viewer (admin)
// ---------------------------------------------------------------------------

export async function showErrorLog(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const errors = getRecentErrors(5);

  let body;
  if (errors.length === 0) {
    body = L(language, 'admin.errorLog.none');
  } else {
    const pad = (n) => String(n).padStart(2, '0');
    body = errors.map((e, i) => {
      const d = new Date(e.timestamp);
      const label = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const firstLine = (e.message || '').split('\n')[0] || String(e.message);
      return `${i + 1}. [${label}] ${firstLine}`;
    }).join('\n');
  }

  const text = buildMenu(
    '📂 ' + L(language, 'admin.errorLog.heading'),
    '',
    [
      L(language, 'admin.errorLog.recent') + ':',
      '',
      body,
      '',
      '0. ' + L(language, 'admin.errorLog.back')
    ]
  );

  sessionManager.setState(sender, chatId, { currentMenu: 'error_log' });

  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'error_log' });
}

// ---------------------------------------------------------------------------
// Confirmation handling
// ---------------------------------------------------------------------------

export async function handleConfirmationReply(context, selected) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const { pendingAction, pendingData } = session;

  if (!pendingAction) {
    await sendAdminPanel(context);
    return;
  }

  if (selected === '0') {
    await cancelConfirmation(context);
    return;
  }

  if (pendingAction === 'toggleSleepAnimation') {
    if (selected === '1') {
      if (settingsService.getSettings().sleepAnimationEnabled) {
        await showSleepAnimationStatus(context, { enabled: true, already: true });
      } else {
        await executeToggleSleepAnimation(context, pendingData || {});
      }
    } else if (selected === '2') {
      if (settingsService.getSettings().sleepAnimationEnabled) {
        await executeToggleSleepAnimation(context, pendingData || {});
      } else {
        await showSleepAnimationStatus(context, { enabled: false, already: true });
      }
    } else {
      await cancelConfirmation(context);
    }
    return;
  }

  if (selected === '2') {
    await cancelConfirmation(context);
    return;
  }

  // Yes (selected === '1')
  switch (pendingAction) {
    case 'broadcast':
      await executeBroadcast(context, pendingData || {});
      break;
    case 'purgeTestUsers':
      await executePurge(context);
      break;
    case 'deleteUser':
      await executeDeleteUser(context, pendingData || {});
      break;
    case 'blockUser':
      await executeSetBlock(context, pendingData || {}, true);
      break;
    case 'unblockUser':
      await executeSetBlock(context, pendingData || {}, false);
      break;
    case 'restoreBackup':
      await executeRestore(context, pendingData || {});
      break;
    case 'changeBotName':
      await executeChangeBotName(context, pendingData || {});
      break;
    case 'toggleSleepAnimation':
      // The custom toggle logic is handled above before the generic switch.
      break;
    case 'tryStart':
      if (selected === '1') {
        if (pendingData?.replaceActive) await endTrySession(context, true);
        await showTryTimerSelection(context);
      } else {
        if (pendingData?.replaceActive) {
          sessionManager.setState(sender, chatId, { currentMenu: 'try_active', pendingAction: null, pendingData: null });
        } else {
          await cancelConfirmation(context);
        }
      }
      break;
    case 'scheduleBroadcast':
      await executeScheduleBroadcast(context, pendingData || {});
      break;
    case 'deleteSchedule':
      await executeDeleteSchedule(context, pendingData || {});
      break;
    case 'clearSchedules':
      await executeClearSchedules(context);
      break;
    case 'editSchedule':
      await executeEditSchedule(context, pendingData || {});
      break;
    case 'saveTemplate':
      await executeSaveTemplate(context, pendingData || {});
      break;
    case 'deleteTemplate':
      await executeDeleteTemplate(context, pendingData || {});
      break;
    case 'deleteChatRule':
      await executeDeleteChatRule(context, pendingData || {});
      break;
    case 'resetChatSettings': {
      const { resetSettings } = await import('../services/chatSettingsService.js');
      resetSettings();
      logger.info({ sender }, '[CHAT SETTINGS] reset to defaults via command');
      logAdminAction(sender, 'chat_settings', 'reset to defaults (command)');
      await sendChatSettingsPanel(context);
      break;
    }
    case 'deleteFaqEntry':
      await executeDeleteFaqEntry(context, pendingData || {});
      break;
    case 'importChatRules':
      await executeImportChatRules(context, pendingData || {});
      break;
    case 'importFaqEntries':
      await executeImportFaqEntries(context, pendingData || {});
      break;
    case 'activateExport':
      await executeActivateExport(context, pendingData || {});
      break;
    case 'deleteExport':
      await executeDeleteExport(context, pendingData || {});
      break;
    default:
      await sendAdminPanel(context);
      break;
  }
}

async function cancelConfirmation(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};

  const returnTo = session.pendingData?.returnTo || 'admin';
  const cancelledText = t(language, 'admin.cancelled');

  if (returnTo === 'test') {
    await sendTestPanel(context, { resultLine: toSmallCaps(cancelledText) });
  } else if (returnTo === 'general_settings') {
    await sendGeneralSettingsPanel(context, { resultLine: cancelledText });
  } else if (returnTo === 'manage_users') {
    await sendManageUsersPanel(context, { resultLine: cancelledText });
  } else if (returnTo === 'broadcast') {
    await broadcastCancel(context);
  } else if (returnTo === 'schedule') {
    await scheduleCancel(context);
  } else if (returnTo === 'templates') {
    await sendTemplateSubmenu(context, { resultLine: toSmallCaps(cancelledText) });
  } else if (returnTo === 'blocked_users_menu') {
    await sendBlockedUsersPanel(context, { resultLine: toSmallCaps(cancelledText) });
  } else if (returnTo === 'chatSubmenu') {
    await sendChatPanel(context, { resultLine: toSmallCaps(cancelledText) });
  } else if (returnTo === 'faqSubmenu') {
    await sendFaqPanel(context, { resultLine: toSmallCaps(cancelledText) });
  } else if (returnTo === 'chatEdit') {
    await openEditChat(context, session.pendingData?.id);
  } else if (returnTo === 'faqEdit') {
    await openEditFaq(context, session.pendingData?.id);
  } else if (returnTo === 'chat_settings') {
    await sendChatSettingsPanel(context, { resultLine: cancelledText });
  } else if (returnTo === 'exportsDetail') {
    await openExportDetails(context, session.pendingData?.filename);
  } else {
    await sendAdminPanelResult(context, cancelledText);
  }
}

// ---------------------------------------------------------------------------
// Execute helpers for confirmations
// ---------------------------------------------------------------------------

async function executePurge(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  if (!hasPermission(sender, 'purge')) {
    await denyNoPermission(context.sock, sender, language);
    await sendAdminPanel(context);
    return;
  }
  const removed = await deleteTestUsers();
  logger.info({ removed, sender }, '[ADMIN] purge test users');
  logAdminAction(sender, 'user_purge', 'removed ' + removed + ' test user(s)');
  await sendAdminPanelResult(context, t(language, 'admin.purgeDone', { count: removed }));
}

async function executeDeleteUser(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const target = data.jid;
  const returnTo = data.returnTo || 'admin';
  if (target) {
    await deleteUserByJid(target);
    if (blockedUsers.isBlocked(target)) blockedUsers.unblockUser(target);
  }
  logAdminAction(sender, 'user_delete', data.name || target || '-');
  const done = t(language, 'admin.userDeleted', { name: data.name || target || '-' });
  if (returnTo === 'manage_users') {
    await sendManageUsersPanel(context, { resultLine: toSmallCaps(done) });
  } else {
    await sendAdminPanelResult(context, done);
  }
}

async function executeSetBlock(context, data, block) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const target = data.jid;
  const returnTo = data.returnTo || 'admin';
  if (target) {
    await updateUser(target, { blocked: block });
    if (block) blockedUsers.blockUser(target, data.reason || '');
    else blockedUsers.unblockUser(target);
  }
  const key = block ? 'admin.userBlocked' : 'admin.userUnblocked';
  const logDetail = data.reason ? (data.name || target || '-') + ' (' + data.reason + ')' : (data.name || target || '-');
  logAdminAction(sender, block ? 'user_block' : 'user_unblock', logDetail);
  const done = t(language, key, { name: data.name || target || '-' });
  if (returnTo === 'manage_users') {
    await sendManageUsersPanel(context, { resultLine: toSmallCaps(done) });
  } else if (returnTo === 'blocked_users_menu') {
    await sendBlockedUsersPanel(context, { resultLine: toSmallCaps(done) });
  } else {
    await sendAdminPanelResult(context, done);
  }
}

async function executeRestore(context, data) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const count = (data && data.users) ? Object.keys(data.users).length : 0;
  try {
    await replaceAllUsers(data.users || {});
    logger.info({ sender, count }, '[RESTORE] users restored');
    logAdminAction(sender, 'restore', 'restored ' + count + ' user(s)');
    const result = t(language, 'admin.restoreDone', { count });
    await sendAdminPanelResult(context, result);
  } catch (err) {
    logger.error({ err, sender }, '[RESTORE] failed to apply restore');
    await sendText(context.sock, sender, L(language, 'restore.failed'));
  }
}

// ---------------------------------------------------------------------------
// Quick Actions submenu (admin)
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = [
  { number: '1', labelKey: 'admin.quick.broadcast', perm: 'broadcast' },
  { number: '2', labelKey: 'admin.quick.maintenance', perm: 'settings' },
  { number: '3', labelKey: 'admin.quick.purge', perm: 'purge' },
  { number: '4', labelKey: 'admin.quick.notifications', perm: 'settings' },
  { number: '5', labelKey: 'admin.quick.emergency', perm: 'emergency' }
];

function buildQuickActionsMenu(language, sender, resultLine = '') {
  const settings = settingsService.getSettings();
  const stateOf = (on) => statusText(language, on);
  const lines = QUICK_ACTIONS.map((opt) => {
    const locked = !hasPermission(sender, opt.perm);
    let label = t(language, opt.labelKey);
    if (opt.number === '2') label += ': ' + stateOf(settings.maintenanceMode);
    if (opt.number === '4') label += ': ' + stateOf(settings.adminNotificationsEnabled !== false);
    return opt.number + '. ' + label + (locked ? ' 🔒' : '');
  });
  return buildMenu(
    t(language, 'admin.quick.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      ...lines,
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

async function sendNewQuickActionsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'admin_quick_actions', pendingAction: null, pendingData: null });
  await sendMenuById('quick_actions', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'admin_quick_actions', { resultLine: opts.resultLine, sessionMenu: 'admin_quick_actions' });
}

export async function sendQuickActionsPanel(context, opts = {}) {
  return sendNewQuickActionsPanel(context, opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_quick_actions', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildQuickActionsMenu(language, sender, opts.resultLine),
    transitionKey: opts.transitionKey || 'admin_quick_actions'
  });
}

async function quickConfirm(context, action, questionKey) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_quick_confirm', pendingAction: null, pendingData: { action } });

  const text = buildMenu(
    t(language, 'admin.quick.title'),
    '',
    [
      toSmallCaps(t(language, questionKey)),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_quick_confirm' });
}

export async function handleQuickActionsReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  const gated = async (perm, fn) => {
    if (!hasPermission(sender, perm)) {
      await denyNoPermission(context.sock, sender, language);
      await sendQuickActionsPanel(context);
      return;
    }
    await fn();
  };

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context);
      break;
    case '1':
      await gated('broadcast', async () => {
        if (settingsService.getSettings().emergencyBroadcastsDisabled === true) {
          await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.emergency.broadcastsDisabled')));
          await sendQuickActionsPanel(context);
          return;
        }
        await promptBroadcastInput(context);
      });
      break;
    case '2':
      await gated('settings', async () => quickConfirm(context, 'maintenance', 'admin.quick.maintenanceConfirm'));
      break;
    case '3':
      await gated('purge', async () => quickConfirm(context, 'purge', 'admin.quick.purgeConfirm'));
      break;
    case '4':
      await gated('settings', async () => {
        const settings = settingsService.updateSettings({ adminNotificationsEnabled: !(settingsService.getSettings().adminNotificationsEnabled !== false) });
        logAdminAction(sender, 'settings_change', 'admin notifications ' + (settings.adminNotificationsEnabled !== false ? 'on' : 'off'));
        await sendQuickActionsPanel(context, { resultLine: t(language, 'admin.quick.notificationsToggled') });
      });
      break;
    case '5':
      await gated('emergency', async () => sendEmergencyPanel(context));
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 5 }));
      break;
  }
}

export async function handleQuickConfirmReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const action = session.pendingData?.action;

  if (selectedNumber === '1' && action === 'maintenance') {
    const settings = settingsService.updateSettings({ maintenanceMode: !settingsService.getSettings().maintenanceMode });
    logAdminAction(sender, 'settings_change', 'maintenance mode ' + (settings.maintenanceMode ? 'on' : 'off'));
    await sendQuickActionsPanel(context, { resultLine: settings.maintenanceMode ? t(language, 'admin.systemSettings.maintenanceOn') : t(language, 'admin.systemSettings.maintenanceOff') });
    return;
  }
  if (selectedNumber === '1' && action === 'purge') {
    const removed = await deleteTestUsers();
    logAdminAction(sender, 'user_purge', 'removed ' + removed + ' test user(s)');
    await sendQuickActionsPanel(context, { resultLine: t(language, 'admin.purgeDone', { count: removed }) });
    return;
  }
  await sendQuickActionsPanel(context);
}

// ---------------------------------------------------------------------------
// Admin Search (users, feedback, commands, logs)
// ---------------------------------------------------------------------------

const ADMIN_SEARCH_PAGE_SIZE = 8;

function buildAdminSearchPrompt(language) {
  return buildMenu(
    t(language, 'admin.search.title'),
    '',
    [
      toSmallCaps(t(language, 'admin.search.prompt')),
      '· ' + toSmallCaps(t(language, 'admin.search.scopeUsers')),
      '· ' + toSmallCaps(t(language, 'admin.search.scopeFeedback')),
      '· ' + toSmallCaps(t(language, 'admin.search.scopeCommands')),
      '· ' + toSmallCaps(t(language, 'admin.search.scopeLogs')),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack')
    ]
  );
}

async function sendNewAdminSearchPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, { currentMenu: 'admin_search', pendingAction: null, pendingData: null });
  await sendMenuById('admin_search', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'admin_search', { resultLine: opts.resultLine, sessionMenu: 'admin_search' });
}

export async function sendAdminSearchPanel(context, opts = {}) {
  if (isMenuMigrated('admin_search')) return sendNewAdminSearchPanel(context, opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_search', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildAdminSearchPrompt(language),
    transitionKey: opts.transitionKey || 'admin_search'
  });
}

async function runAdminSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const results = [];
  if (!q) return results;
  try {
    const users = await getAllUsers();
    for (const u of users) {
      if ([u.name, u.username, u.jid].some((v) => String(v || '').toLowerCase().includes(q))) {
        results.push({ type: 'user', ref: u.jid, label: (u.username ? '@' + u.username : (u.name || u.jid)) });
      }
      if (results.length >= 60) break;
    }
  } catch { /* ignore */ }
  try {
    const { searchFeedback } = await import('../services/feedbackService.js');
    for (const item of searchFeedback(query).slice(0, 20)) {
      const text = item.kind === 'rating' ? `${item.entry.rating}/5` : (item.entry.description || '');
      results.push({ type: 'feedback', ref: item.entry.id, label: `${item.kind}: ${text}`.slice(0, 60) });
    }
  } catch { /* ignore */ }
  try {
    const { loadCommands } = await import('./commandHandler.js');
    const commands = await loadCommands();
    const seen = new Set();
    for (const cmd of commands.values()) {
      if (!cmd?.name || seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      if (cmd.name.toLowerCase().includes(q) || String(cmd.description || '').toLowerCase().includes(q)) {
        results.push({ type: 'command', ref: cmd.name, label: `/${cmd.name}` });
      }
      if (results.length >= 80) break;
    }
  } catch { /* ignore */ }
  try {
    const { getRecentAdminActions } = await import('../services/adminLogService.js');
    const { getRecentErrors } = await import('../services/errorLogService.js');
    for (const e of getRecentAdminActions(50)) {
      const text = `${e.adminJid} ${e.action} ${e.details || ''}`;
      if (text.toLowerCase().includes(q)) results.push({ type: 'log', ref: 'admin:' + (e.timestamp || ''), label: text.slice(0, 60) });
    }
    for (const e of getRecentErrors(50)) {
      const text = String(e.message || '').split('\n')[0];
      if (text.toLowerCase().includes(q)) results.push({ type: 'log', ref: 'error:' + (e.timestamp || ''), label: text.slice(0, 60) });
    }
  } catch { /* ignore */ }
  return results.slice(0, 60);
}

const SEARCH_TYPE_EMOJI = { user: '👤', feedback: '📮', command: '🤖', log: '📋' };

function buildAdminSearchResults(language, results, page) {
  const start = page * ADMIN_SEARCH_PAGE_SIZE;
  const visible = results.slice(start, start + ADMIN_SEARCH_PAGE_SIZE);
  const lines = visible.map((r, i) => ({ static: `${start + i + 1}. ${SEARCH_TYPE_EMOJI[r.type] || '·'} `, dynamic: r.label }));
  const hasNext = start + ADMIN_SEARCH_PAGE_SIZE < results.length;
  const hasPrev = page > 0;
  const body = results.length === 0 ? [toSmallCaps(t(language, 'admin.search.noResults')), ''] : [...lines, ''];
  if (hasNext) body.push('9. ' + t(language, 'admin.search.next'));
  if (hasPrev) body.push('10. ' + t(language, 'admin.search.previous'));
  if (hasNext || hasPrev) body.push('');
  return buildMenu(
    t(language, 'admin.search.resultsTitle'),
    '',
    [...body, '0. ' + t(language, 'admin.systemSettings.optionBack')]
  );
}

export async function handleAdminSearchReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await sendAdminPanel(context);
    return;
  }
  if (!trimmed) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    await sendAdminSearchPanel(context);
    return;
  }
  const results = await runAdminSearch(trimmed);
  sessionManager.setState(sender, chatId, { currentMenu: 'admin_search_results', pendingAction: null, pendingData: { query: trimmed, results, page: 0 } });
  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildAdminSearchResults(language, results, 0),
    transitionKey: 'admin_search_results'
  });
}

function findSearchItem(session, n) {
  const results = session.pendingData?.results || [];
  const page = session.pendingData?.page || 0;
  const start = page * ADMIN_SEARCH_PAGE_SIZE;
  if (n < 1 || n > Math.min(ADMIN_SEARCH_PAGE_SIZE, results.length - start)) return null;
  return results[start + n - 1];
}

export async function handleAdminSearchResultsReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const results = session.pendingData?.results || [];
  const page = session.pendingData?.page || 0;
  const query = session.pendingData?.query || '';
  const trimmed = (content || '').trim();
  const hasNext = (page + 1) * ADMIN_SEARCH_PAGE_SIZE < results.length;
  const hasPrev = page > 0;

  const reshow = async (nextPage) => {
    sessionManager.setState(sender, chatId, { currentMenu: 'admin_search_results', pendingAction: null, pendingData: { query, results, page: nextPage } });
    await sendMenu({
      sock: context.sock, sender, chatId,
      text: buildAdminSearchResults(language, results, nextPage),
      transitionKey: 'admin_search_results'
    });
  };

  if (trimmed === '0') {
    await sendAdminPanel(context);
    return;
  }
  if (trimmed === '9' && hasNext) {
    await reshow(page + 1);
    return;
  }
  if (trimmed === '10' && hasPrev) {
    await reshow(page - 1);
    return;
  }
  if (/^\d+$/.test(trimmed)) {
    const item = findSearchItem(session, parseInt(trimmed, 10));
    if (item) {
      await showAdminSearchDetail(context, item);
      return;
    }
  }
  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
  await reshow(page);
}

async function showAdminSearchDetail(context, item) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  if (item.type === 'user') {
    const user = getUserByJidSync(item.ref) || {};
    const text = buildMenu(
      t(language, 'admin.search.userTitle'),
      '',
      [
        { static: '👤 *' + toSmallCaps(t(language, 'profile.name')) + ':* ', dynamic: String(user.name || '-') },
        { static: '🌟 *' + toSmallCaps(t(language, 'profile.username')) + ':* ', dynamic: user.username ? '@' + user.username : '-' },
        { static: '🆔 *' + toSmallCaps(t(language, 'profile.id')) + ':* ', dynamic: String(user.jid || item.ref) },
        { static: '🌐 *' + toSmallCaps(t(language, 'profile.language')) + ':* ', dynamic: String(user.language || '-') },
        { static: '🤖 *' + toSmallCaps(t(language, 'stats.commandsUsed')) + ':* ', dynamic: String(user.stats?.commandsUsed || 0) },
        '',
        '0. ' + t(language, 'admin.systemSettings.optionBack')
      ]
    );
    sessionManager.setState(sender, chatId, { currentMenu: 'admin_search_detail', pendingAction: null, pendingData: null });
    await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_search_detail' });
    return;
  }
  if (item.type === 'feedback') {
    const { buildFeedbackDetail } = await import('./feedbackCommand.js');
    const { findFeedbackById } = await import('../services/feedbackService.js');
    const found = findFeedbackById(item.ref);
    if (!found) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.search.noResults')));
      return;
    }
    sessionManager.setState(sender, chatId, {
      currentMenu: 'feedback_admin_detail',
      pendingAction: null,
      pendingData: null,
      pendingDetailKind: found.kind,
      pendingDetailId: found.entry.id,
      pendingAdminFilter: { mode: 'all' },
      pendingAdminTitle: 'feedback.viewAllTitle',
      pendingAdminPage: 0,
      pendingAdminReturn: 'feedback_admin'
    });
    await sendMenu({ sock: context.sock, sender, chatId, text: buildFeedbackDetail(language, found.kind, found.entry), transitionKey: 'feedback_admin_detail' });
    return;
  }
  if (item.type === 'command') {
    const { loadCommands } = await import('./commandHandler.js');
    const cmd = (await loadCommands()).get(item.ref) || {};
    const text = buildMenu(
      t(language, 'admin.search.commandTitle'),
      '',
      [
        { static: '', dynamic: '/' + (cmd.name || item.ref) },
        toSmallCaps(String(cmd.description || '')),
        '',
        '0. ' + t(language, 'admin.systemSettings.optionBack')
      ]
    );
    sessionManager.setState(sender, chatId, { currentMenu: 'admin_search_detail', pendingAction: null, pendingData: null });
    await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_search_detail' });
    return;
  }
  const text = buildMenu(
    t(language, 'admin.search.logTitle'),
    '',
    [
      { static: '', dynamic: item.label },
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack')
    ]
  );
  sessionManager.setState(sender, chatId, { currentMenu: 'admin_search_detail', pendingAction: null, pendingData: null });
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_search_detail' });
}

export async function handleAdminSearchDetailReply(context, content) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  if ((content || '').trim() === '0') {
    await sendAdminPanel(context);
    return;
  }
  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
}

// ---------------------------------------------------------------------------
// Scheduled Tasks overview (admin)
// ---------------------------------------------------------------------------

const SCHEDULED_PAGE_SIZE = 8;

function formatTaskTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scheduledTaskLine(n, task) {
  const emoji = task.kind === 'broadcast' ? '📢' : task.kind === 'feature' ? '🧩' : '🧪';
  const when = formatTaskTime(task.ts);
  return { static: `${n}. ${emoji} `, dynamic: `${task.title}${task.detail ? ' ' + task.detail : ''} @ ${when}` };
}

function buildScheduledTasksMenu(language, tasks, page) {
  const start = page * SCHEDULED_PAGE_SIZE;
  const visible = tasks.slice(start, start + SCHEDULED_PAGE_SIZE);
  const lines = visible.map((task, i) => scheduledTaskLine(start + i + 1, task));
  const hasNext = start + SCHEDULED_PAGE_SIZE < tasks.length;
  const hasPrev = page > 0;
  const body = tasks.length === 0 ? [toSmallCaps(t(language, 'admin.scheduled.empty')), ''] : [...lines, ''];
  if (hasNext) body.push('9. ' + t(language, 'admin.search.next'));
  if (hasPrev) body.push('10. ' + t(language, 'admin.search.previous'));
  if (hasNext || hasPrev) body.push('');
  return buildMenu(
    t(language, 'admin.scheduled.title'),
    '',
    [...body, '0. ' + t(language, 'admin.systemSettings.optionBack')]
  );
}

async function sendNewScheduledTasksPanel(context, opts = {}, page = 0) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { pendingData: { page } });
  await sendMenuById('scheduled_tasks', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'admin_scheduled_tasks', { resultLine: opts.resultLine, sessionMenu: 'admin_scheduled_tasks' });
}

export async function sendScheduledTasksPanel(context, opts = {}) {
  if (isMenuMigrated('scheduled_tasks')) return sendNewScheduledTasksPanel(context, opts, 0);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { listScheduledTasks } = await import('../services/scheduledTasksService.js');
  const tasks = listScheduledTasks();

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_scheduled_tasks', pendingAction: null, pendingData: { page: 0 } });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildScheduledTasksMenu(language, tasks, 0),
    transitionKey: opts.transitionKey || 'admin_scheduled_tasks'
  });
}

async function reshowScheduledTasks(context, page) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { listScheduledTasks } = await import('../services/scheduledTasksService.js');
  const tasks = listScheduledTasks();
  const totalPages = Math.max(1, Math.ceil(tasks.length / SCHEDULED_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  if (isMenuMigrated('scheduled_tasks')) return sendNewScheduledTasksPanel(context, {}, safePage);
  sessionManager.setState(sender, chatId, { currentMenu: 'admin_scheduled_tasks', pendingAction: null, pendingData: { page: safePage } });

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildScheduledTasksMenu(language, tasks, safePage),
    transitionKey: 'admin_scheduled_tasks'
  });
}

export async function handleScheduledTasksReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const page = session.pendingData?.page || 0;
  const trimmed = (content || '').trim();
  const { listScheduledTasks, cancelScheduledTask } = await import('../services/scheduledTasksService.js');
  const tasks = listScheduledTasks();
  const hasNext = (page + 1) * SCHEDULED_PAGE_SIZE < tasks.length;
  const hasPrev = page > 0;

  if (trimmed === '0') {
    await sendAdminPanel(context);
    return;
  }
  if (trimmed === '9' && hasNext) {
    await reshowScheduledTasks(context, page + 1);
    return;
  }
  if (trimmed === '10' && hasPrev) {
    await reshowScheduledTasks(context, page - 1);
    return;
  }
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    const start = page * SCHEDULED_PAGE_SIZE;
    if (n >= 1 && n <= Math.min(SCHEDULED_PAGE_SIZE, tasks.length - start)) {
      const task = tasks[start + n - 1];
      sessionManager.setState(sender, chatId, { currentMenu: 'admin_scheduled_detail', pendingAction: null, pendingData: { kind: task.kind, id: task.id, page } });
      const text = buildMenu(
        t(language, 'admin.scheduled.detailTitle'),
        '',
        [
          { static: '', dynamic: `${task.title}${task.detail ? ' ' + task.detail : ''}` },
          { static: '🕒 ', dynamic: formatTaskTime(task.ts) },
          '',
          '1. ' + t(language, 'admin.scheduled.cancelTask'),
          '',
          '0. ' + t(language, 'admin.systemSettings.optionBack')
        ]
      );
      await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_scheduled_detail' });
      return;
    }
  }
  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
  await reshowScheduledTasks(context, page);
}

export async function handleScheduledTaskDetailReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = (content || '').trim();
  const { kind, id, page } = session.pendingData || {};

  if (trimmed === '0') {
    await reshowScheduledTasks(context, page || 0);
    return;
  }
  if (trimmed === '1' && kind) {
    if (!hasPermission(sender, 'scheduled.manage')) {
      await denyNoPermission(context.sock, sender, language);
      await reshowScheduledTasks(context, page || 0);
      return;
    }
    const { cancelScheduledTask } = await import('../services/scheduledTasksService.js');
    const ok = await cancelScheduledTask(kind, id);
    logAdminAction(sender, 'scheduled_cancel', `${kind}:${id} -> ${ok ? 'cancelled' : 'not-found'}`);
    await sendText(context.sock, sender, toSmallCaps(t(language, ok ? 'admin.scheduled.cancelled' : 'common.invalidChoice')));
    await reshowScheduledTasks(context, page || 0);
    return;
  }
  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
}

// ---------------------------------------------------------------------------
// Emergency Commands submenu (admin, owner/admin only)
// ---------------------------------------------------------------------------

function buildEmergencyMenu(language) {
  return buildMenu(
    t(language, 'admin.emergency.title'),
    '',
    [
      '1. ' + t(language, 'admin.emergency.restart'),
      '2. ' + t(language, 'admin.emergency.disableBroadcasts'),
      '3. ' + t(language, 'admin.emergency.clearTasks'),
      '4. ' + t(language, 'admin.emergency.lockPanel'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendEmergencyPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  if (!hasPermission(sender, 'emergency')) {
    await denyNoPermission(context.sock, sender, language);
    await sendAdminPanel(context);
    return;
  }

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_emergency', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildEmergencyMenu(language),
    transitionKey: opts.transitionKey || 'admin_emergency'
  });
}

async function emergencyConfirm(context, action) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_emergency_confirm', pendingAction: null, pendingData: { action } });

  const text = buildMenu(
    t(language, 'admin.emergency.title'),
    '',
    [
      toSmallCaps(t(language, 'admin.emergency.confirm', { action: t(language, action === 'restart' ? 'admin.emergency.restart' : action === 'disable' ? 'admin.emergency.disableBroadcasts' : action === 'clear' ? 'admin.emergency.clearTasks' : 'admin.emergency.lockPanel') })),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_emergency_confirm' });
}

export async function handleEmergencyReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendQuickActionsPanel(context);
      break;
    case '1':
    case '2':
    case '3':
    case '4': {
      const actions = { 1: 'restart', 2: 'disable', 3: 'clear', 4: 'lock' };
      await emergencyConfirm(context, actions[selectedNumber]);
      break;
    }
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
      break;
  }
}

export async function handleEmergencyConfirmReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const action = session.pendingData?.action;

  if (selectedNumber !== '1' || !action) {
    await sendEmergencyPanel(context);
    return;
  }

  if (action === 'restart') {
    logAdminAction(sender, 'emergency_restart', 'force restart requested');
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.emergency.restarting')));
    setTimeout(() => process.exit(0), 800);
    return;
  }
  if (action === 'disable') {
    settingsService.updateSettings({ emergencyBroadcastsDisabled: true });
    const { clearAllSchedules } = await import('../services/scheduleService.js');
    const removed = await clearAllSchedules();
    logAdminAction(sender, 'emergency_broadcasts', 'disabled broadcasts, removed ' + removed + ' scheduled');
    await sendEmergencyPanel(context, { resultLine: null });
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.emergency.broadcastsDisabled', { count: removed })));
    return;
  }
  if (action === 'clear') {
    const { clearAllScheduledTasks } = await import('../services/scheduledTasksService.js');
    const res = await clearAllScheduledTasks();
    logAdminAction(sender, 'emergency_clear', `broadcasts=${res.broadcasts} features=${res.features} sessions=${res.sessions}`);
    await sendEmergencyPanel(context);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.emergency.tasksCleared', { count: res.broadcasts + res.features + res.sessions })));
    return;
  }
  if (action === 'lock') {
    const locked = !(settingsService.getSettings().adminPanelLocked === true);
    settingsService.updateSettings({ adminPanelLocked: locked });
    logAdminAction(sender, 'emergency_lock', 'admin panel ' + (locked ? 'locked' : 'unlocked'));
    await sendEmergencyPanel(context);
    await sendText(context.sock, sender, toSmallCaps(t(language, locked ? 'admin.emergency.locked' : 'admin.emergency.unlocked')));
  }
}

// ---------------------------------------------------------------------------
// Role Management submenu (System Settings -> Admin Access)
// ---------------------------------------------------------------------------

function buildRolesMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.roles.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.roles.list'),
      '2. ' + t(language, 'admin.roles.setRole'),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack'),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );
}

export async function sendRolesPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  if (!hasPermission(sender, 'roles.manage')) {
    await denyNoPermission(context.sock, sender, language);
    await sendAdminAccessPanel(context);
    return;
  }

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_roles', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildRolesMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'admin_roles'
  });
}

async function showRoleList(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const { listRoles } = await import('../services/rolesService.js');
  const lines = listRoles().map((r, i) => ({ static: `${i + 1}. `, dynamic: `${r.jid} - ${r.role}` }));
  const text = buildMenu(
    t(language, 'admin.roles.list'),
    '',
    [...(lines.length ? lines : [toSmallCaps(t(language, 'admin.search.noResults'))]), '', '0. ' + t(language, 'admin.systemSettings.optionBack')]
  );
  await sendText(context.sock, sender, text);
  await sendRolesPanel(context);
}

async function promptRoleUser(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'admin_roles_user', pendingAction: null, pendingData: null });

  const { listRoles } = await import('../services/rolesService.js');
  const lines = listRoles().map((r, i) => ({ static: `${i + 1}. `, dynamic: `${r.jid} - ${r.role}` }));
  const text = buildMenu(
    t(language, 'admin.roles.setRole'),
    '',
    [
      ...lines,
      '',
      toSmallCaps(t(language, 'admin.roles.pickUser')),
      '',
      t(language, 'admin.systemSettings.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_roles_user' });
}

export async function handleRolesReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendAdminAccessPanel(context);
      break;
    case '1':
      await showRoleList(context);
      break;
    case '2':
      await promptRoleUser(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
      break;
  }
}

export async function handleRolesUserReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();
  const { listRoles } = await import('../services/rolesService.js');
  const roles = listRoles();

  if (trimmed === '0') {
    await sendRolesPanel(context);
    return;
  }
  const idx = parseInt(trimmed, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= roles.length) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: roles.length }));
    await promptRoleUser(context);
    return;
  }
  const target = roles[idx].jid;
  sessionManager.setState(sender, chatId, { currentMenu: 'admin_roles_set', pendingAction: null, pendingData: { jid: target } });

  const text = buildMenu(
    t(language, 'admin.roles.setRole'),
    '',
    [
      { static: '', dynamic: target },
      '',
      ...['owner', 'admin', 'moderator', 'support', 'viewer'].map((r, i) => `${i + 1}. ${r}`),
      '',
      '0. ' + t(language, 'admin.systemSettings.optionBack')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_roles_set' });
}

export async function handleRolesSetReply(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const target = session.pendingData?.jid;
  const trimmed = (content || '').trim();
  const { setRole, canManage, ROLES } = await import('../services/rolesService.js');

  if (trimmed === '0' || !target) {
    await sendRolesPanel(context);
    return;
  }
  const idx = parseInt(trimmed, 10) - 1;
  const choices = ROLES.filter((r) => r !== 'owner');
  if (isNaN(idx) || idx < 0 || idx >= choices.length) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: choices.length }));
    return;
  }
  if (!canManage(sender, target)) {
    await denyNoPermission(context.sock, sender, language);
    await sendRolesPanel(context);
    return;
  }
  setRole(target, choices[idx]);
  logAdminAction(sender, 'role_change', target + ' -> ' + choices[idx]);
  await sendRolesPanel(context, { resultLine: t(language, 'admin.roles.roleSet', { jid: target, role: choices[idx] }) });
}

// ---------------------------------------------------------------------------
// Admin panel reply routing
// ---------------------------------------------------------------------------

export async function handleAdminReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  // Panel lock: only the owner gets in while locked.
  if (settingsService.getSettings().adminPanelLocked === true && !isOwner(sender)) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'admin.locked')));
    return;
  }

  const gated = async (perm, fn) => {
    if (!requirePanelPerm(sender, perm)) {
      await denyNoPermission(context.sock, sender, language);
      await sendAdminPanel(context);
      return;
    }
    await fn();
  };

  switch (selectedNumber) {
    case '0': {
      const user = await getUserByJid(sender);
      const displayName = user?.username ? `@${user.username}` : (user?.name || 'Admin');
      await sendMenu({
        sock: context.sock,
        sender,
        chatId,
        text: buildMainMenu(language, displayName, user),
        transitionKey: 'admin_to_main'
      });
      sessionManager.goToMain(sender, chatId);
      break;
    }
    case '1':
      await gated('quick', async () => sendQuickActionsPanel(context));
      break;
    case '2':
      await gated('stats.view', async () => showStats(context));
      break;
    case '3':
      await gated('broadcast', async () => sendBroadcastSubmenu(context, { transitionKey: 'admin_to_broadcast' }));
      break;
    case '4':
      await gated('users.manage', async () => sendUserManagementMenu(context));
      break;
    case '5':
      await gated('settings', async () => sendSystemSettingsPanel(context, { transitionKey: 'admin_to_system' }));
      break;
    case '6':
      await gated('chatfaq', async () => sendChatFaqMenu(context));
      break;
    case '7':
      await gated('backup', async () => sendAdminBackupMenu(context));
      break;
    case '8':
      await gated('feedback.reply', async () => sendFeedbackAdmin(context, { transitionKey: 'feedback_admin' }));
      break;
    case '9':
      await gated('test', async () => sendTestPanel(context, { transitionKey: 'admin_to_test' }));
      break;
    case '10':
      await gated('stats.view', async () => showCommandAnalytics(context));
      break;
    case '11':
      await gated('search', async () => sendAdminSearchPanel(context));
      break;
    case '12':
      await gated('scheduled.view', async () => sendScheduledTasksPanel(context));
      break;
    case '13': {
      const text = buildMenuHelp('admin', language);
      sessionManager.setState(sender, chatId, { currentMenu: 'help', helpFrom: 'admin' });
      await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'help_show' });
      break;
    }
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 13 }));
      break;
  }
}

export async function handleTestReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context, { transitionKey: 'test_to_admin' });
      break;
    case '1':
      await runTestAction(context, 'system', {
        details: `New-user simulation launched by admin ${sender}`
      });
      break;
    case '2':
      await runTestAction(context, 'spam', {
        user: sender,
        command: 'test',
        count: config.spamThreshold || 5,
        windowMs: config.spamWindowMs || 10000
      });
      break;
    case '3':
      await runTestAction(context, 'bug', {
        user: sender,
        command: 'test',
        error: 'Test bug',
        stack: ''
      });
      break;
    case '4':
      await runTestAction(context, 'security', {
        user: sender,
        action: 'test_security',
        details: 'Test alert'
      });
      break;
    case '5':
      await runTestAction(context, 'system', {
        details: 'Report summary test requested'
      });
      reportService.flushReports();
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 5 }));
      break;
  }
}

// ---------------------------------------------------------------------------
// Manage users / blocked users (simplified search & delete/block)
// ---------------------------------------------------------------------------

function buildManageUsersMenu(language, resultLine = '') {
  return buildMenu(
    t(language, 'admin.optionUsers'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.users.optionSearch'),
      '2. ' + t(language, 'admin.users.optionDelete'),
      '3. ' + t(language, 'admin.users.optionBlock'),
      '',
      '0. ' + t(language, 'admin.test.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

export async function sendManageUsersPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'manage_users', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildManageUsersMenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'admin_panel'
  });
}

async function manageUsersMenu(context) {
  return sendManageUsersPanel(context);
}

function formatUserDetails(user, language) {
  const val = (k) =>
    (user[k] !== undefined && user[k] !== null && user[k] !== '')
      ? user[k]
      : '-';
  const lines = [
    '> *' + L(language, 'admin.users.detailsTitle') + '*',
    '',
    '🆔 ' + L(language, 'admin.users.fieldId') + ': ' + val('jid'),
    '📛 ' + L(language, 'admin.users.fieldName') + ': ' + val('name'),
    '👤 ' + L(language, 'admin.users.fieldUsername') + ': ' + (val('username') === '-' ? val('name') : val('username')),
    '📝 ' + L(language, 'admin.users.fieldBio') + ': ' + val('bio'),
    '🌐 ' + L(language, 'admin.users.fieldLanguage') + ': ' + (user.language || config.defaultLanguage),
    '🕒 ' + L(language, 'admin.users.fieldTimezone') + ': ' + val('timezone'),
    '📅 ' + L(language, 'admin.users.fieldJoined') + ': ' + val('joined'),
    '🔄 ' + L(language, 'admin.users.fieldLastActive') + ': ' + val('lastUpdated'),
    '🏅 ' + L(language, 'admin.users.fieldAccount') + ': ' + val('accountType'),
    '🏆 ' + L(language, 'admin.users.fieldLevel') + ': ' + val('level'),
    '🚫 ' + L(language, 'admin.users.fieldBlocked') + ': ' + (user.blocked === true ? t(language, 'admin.yes') : t(language, 'admin.no')),
    '📊 ' + L(language, 'admin.users.fieldProfileCompleteness') + ': ' + (val('profileCompleteness') === '-' ? 0 : val('profileCompleteness')) + '%',
    '',
    '0. ' + L(language, 'admin.users.backToMenu')
  ];
  return lines.join('\n');
}

async function promptSearchUser(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'manage_users_search_input' });

  const text = buildMenu(
    t(language, 'admin.optionUsers'),
    '',
    [
      t(language, 'admin.users.searchPrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_panel' });
}

export async function handleManageUsersSearch(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await manageUsersMenu(context);
    return;
  }

  const user = await findUser(trimmed);
  if (!user) {
    await sendText(context.sock, sender, L(language, 'common.userNotFound'));
    await manageUsersMenu(context);
    return;
  }

  logAdminAction(sender, 'user_view', user.username || user.name || user.jid);

  sessionManager.setState(sender, chatId, { currentMenu: 'user_details', viewingUser: user.jid });
  await sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: formatUserDetails(user, language),
    transitionKey: 'admin_panel'
  });
}

async function promptDeleteUser(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'manage_users_delete_input' });

  const text = buildMenu(
    t(language, 'admin.optionUsers'),
    '',
    [
      t(language, 'admin.users.deletePrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_panel' });
}

export async function handleManageUsersDelete(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await manageUsersMenu(context);
    return;
  }

  const user = await findUser(trimmed);
  if (!user) {
    await sendText(context.sock, sender, L(language, 'common.userNotFound'));
    await manageUsersMenu(context);
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'deleteUser', {
    jid: user.jid,
    name: user.username || user.name || user.jid,
    returnTo: 'manage_users'
  });
}

async function promptBlockUser(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'manage_users_block_input' });

  const text = buildMenu(
    t(language, 'admin.optionUsers'),
    '',
    [
      t(language, 'admin.users.blockPrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'admin_panel' });
}

export async function handleManageUsersBlock(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = (content || '').trim();

  if (trimmed === '0') {
    await manageUsersMenu(context);
    return;
  }

  const user = await findUser(trimmed);
  if (!user) {
    await sendText(context.sock, sender, L(language, 'common.userNotFound'));
    await manageUsersMenu(context);
    return;
  }

  const action = user.blocked === true ? 'unblockUser' : 'blockUser';
  await askConfirmation({ sock: context.sock, sender, chatId }, action, {
    jid: user.jid,
    name: user.username || user.name || user.jid,
    returnTo: 'manage_users'
  });
}

export async function handleManageUsersReply(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context);
      break;
    case '1':
      await promptSearchUser(context);
      break;
    case '2':
      await promptDeleteUser(context);
      break;
    case '3':
      await promptBlockUser(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
      break;
  }
}

function buildBlockedUsersSubmenu(language, resultLine = '') {
  return buildMenu(
    '⛔ ' + t(language, 'admin.blocked.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'admin.blocked.optionBlock'),
      '2. ' + t(language, 'admin.blocked.optionUnblock'),
      '3. ' + t(language, 'admin.blocked.optionList'),
      '',
      '0. ' + t(language, 'admin.blocked.optionBack'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

export async function sendBlockedUsersPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'blocked_users_menu', pendingAction: null, pendingData: null });

  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildBlockedUsersSubmenu(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'blocked_submenu'
  });
}

export async function handleBlockedUsersMenu(context, selectedNumber) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  switch (selectedNumber) {
    case '0':
      await sendAdminPanel(context, { transitionKey: 'blocked_to_admin' });
      break;
    case '1':
      await promptBlockedBlockJid(context);
      break;
    case '2':
      await promptBlockedUnblockJid(context);
      break;
    case '3':
      await listBlockedUsers(context);
      break;
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
      break;
  }
}

async function promptBlockedBlockJid(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'blocked_block_jid' });

  const text = buildMenu(
    '⛔ ' + t(language, 'admin.blocked.optionBlock'),
    '',
    [
      t(language, 'admin.blocked.blockJidPrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'blocked_block_jid' });
}

export async function handleBlockedBlockJid(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();

  if (trimmed === '0') {
    await sendBlockedUsersPanel(context);
    return;
  }

  const user = await findUser(trimmed);
  if (!user) {
    await sendText(context.sock, sender, L(resolveLanguage(sender), 'common.userNotFound'));
    await promptBlockedBlockJid(context);
    return;
  }

  sessionManager.setState(sender, chatId, {
    currentMenu: 'blocked_block_reason',
    pendingData: { jid: user.jid, name: user.username || user.name || user.jid }
  });

  const language = resolveLanguage(sender);
  const text = buildMenu(
    '⛔ ' + t(language, 'admin.blocked.optionBlock'),
    '',
    [
      L(language, 'admin.blocked.user') + ': ' + (user.username || user.name || user.jid),
      '',
      t(language, 'admin.blocked.reasonPrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'blocked_block_reason' });
}

export async function handleBlockedBlockReason(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();
  const session = sessionManager.getSession(sender, chatId) || {};
  const pendingData = session.pendingData || {};

  const reason = (trimmed === '0') ? '' : trimmed;

  await askConfirmation({ sock: context.sock, sender, chatId }, 'blockUser', {
    jid: pendingData.jid,
    name: pendingData.name,
    reason: reason,
    returnTo: 'blocked_users_menu'
  });
}

async function promptBlockedUnblockJid(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'blocked_unblock_jid' });

  const text = buildMenu(
    '⛔ ' + t(language, 'admin.blocked.optionUnblock'),
    '',
    [
      t(language, 'admin.blocked.unblockJidPrompt'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'blocked_unblock_jid' });
}

export async function handleBlockedUnblockJid(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = content.trim();

  if (trimmed === '0') {
    await sendBlockedUsersPanel(context);
    return;
  }

  const user = await findUser(trimmed);
  if (!user) {
    await sendText(context.sock, sender, L(resolveLanguage(sender), 'common.userNotFound'));
    await promptBlockedUnblockJid(context);
    return;
  }

  await askConfirmation({ sock: context.sock, sender, chatId }, 'unblockUser', {
    jid: user.jid,
    name: user.username || user.name || user.jid,
    returnTo: 'blocked_users_menu'
  });
}

async function listBlockedUsers(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const blocked = blockedUsers.getBlockedUsers();

  let body;
  if (blocked.length === 0) {
    body = [L(language, 'admin.blocked.none')];
  } else {
    body = blocked.map((entry, i) => {
      const reason = entry.reason ? ' – ' + entry.reason : '';
      return `${i + 1}. ${entry.jid}${reason}`;
    });
  }

  const text = buildMenu(
    '⛔ ' + t(language, 'admin.blocked.title'),
    '',
    [
      L(language, 'admin.blocked.total') + ': ' + blocked.length,
      '',
      ...body,
      '',
      '0. ' + t(language, 'admin.blocked.optionBack')
    ]
  );

  sessionManager.setState(sender, chatId, { currentMenu: 'blocked_users_menu' });

  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'blocked_submenu' });
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export const command = {
  name: 'admin',
  description: 'Open the admin panel',
  usage: '/admin',
  aliases: ['panel'],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    try {
      const sender = context.sender;
      const chatId = context.chatId || sender;

      if (!isAdmin(sender)) {
        reportService.reportToAdmins('security', {
          user: sender,
          action: 'admin_command_attempt',
          details: 'admin'
        });
        return notAuthorized(context.sock, sender, resolveLanguage(sender));
      }

      logger.info({ senderJid: sender }, '[ADMIN] /admin received');
      await ensureUserProfile({ jid: sender, name: context.pushName });
      await sendAdminPanel(context, { transitionKey: 'main_to_admin' });
      return { success: true };
    } catch (error) {
      addError(error);
      logger.error({ err: error, sender: context.sender, action: 'admin_command' }, '[ADMIN] Failed');
      await sendError(context.sock, context.sender, 'Failed to open admin panel.');
      throw error;
    }
  },
};

// ---------------------------------------------------------------------------
// Standalone commands for the admin submenus (same senders as numbered nav).
// Each resets the session to the opened menu via the hybrid edit/delete+send
// system. adminOnly flags are centralized in menuConfig.menuCommands.
// ---------------------------------------------------------------------------

const submenuCommand = (def) => ({
  groupAllowed: false,
  adminOnly: true,
  ...def,
  async execute(context) {
    const language = resolveLanguage(context.sender);
    if (!isAdmin(context.sender)) {
      reportService.reportToAdmins('security', {
        user: context.sender,
        action: 'admin_command_attempt',
        details: def.name
      });
      return notAuthorized(context.sock, context.sender, language);
    }
    return def.open(context);
  }
});

const manageUsersMenuCommand = submenuCommand({
  name: 'manageusers',
  description: 'Manage users',
  usage: '/manageusers',
  aliases: ['users'],
  open: (ctx) => sendManageUsersPanel(ctx)
});

const blockedUsersMenuCommand = submenuCommand({
  name: 'blocked',
  description: 'Manage blocked users',
  usage: '/blocked',
  aliases: ['blocklist'],
  open: (ctx) => sendBlockedUsersPanel(ctx)
});

const templatesMenuCommand = submenuCommand({
  name: 'templates',
  description: 'Manage message templates',
  usage: '/templates',
  aliases: ['template'],
  open: (ctx) => sendTemplateSubmenu(ctx)
});

const broadcastMenuCommand = submenuCommand({
  name: 'broadcast',
  description: 'Broadcast a message to all users',
  usage: '/broadcast',
  aliases: ['bc'],
  open: (ctx) => sendBroadcastSubmenu(ctx)
});

const scheduleMenuCommand = submenuCommand({
  name: 'schedule',
  description: 'Manage scheduled broadcasts',
  usage: '/schedule',
  aliases: ['schedules', 'sched'],
  open: (ctx) => sendScheduleSubmenu(ctx)
});

const systemSettingsMenuCommand = submenuCommand({
  name: 'systemsettings',
  description: 'Open system settings',
  usage: '/systemsettings',
  aliases: ['syssettings', 'system'],
  open: (ctx) => sendSystemSettingsPanel(ctx)
});

const conversationMenuCommand = submenuCommand({
  name: 'conversation',
  description: 'Open conversation chat settings',
  usage: '/conversation',
  aliases: ['conv'],
  open: (ctx) => sendConversationSettingsPanel(ctx)
});

const analyticsMenuCommand = submenuCommand({
  name: 'analytics',
  description: 'Show command analytics',
  usage: '/analytics',
  aliases: ['stats-cmd', 'cmdstats'],
  open: (ctx) => showCommandAnalytics(ctx)
});

const testMenuCommand = submenuCommand({
  name: 'test',
  description: 'Open the test submenu',
  usage: '/test',
  aliases: ['testmenu'],
  open: (ctx) => sendTestPanel(ctx)
});

export const commands = [
  command,
  manageUsersMenuCommand,
  blockedUsersMenuCommand,
  templatesMenuCommand,
  broadcastMenuCommand,
  scheduleMenuCommand,
  systemSettingsMenuCommand,
  conversationMenuCommand,
  analyticsMenuCommand,
  testMenuCommand
];
