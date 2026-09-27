import config from '../config/config.js';
import sessionManager from '../utils/sessionManager.js';
import { sendMenuById } from '../utils/menuSender.js';
import { sendText } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { getUserByJid } from '../services/userService.js';
import {
  BUG_CATEGORIES,
  addRating,
  addBugReport,
  addSuggestion,
  updateRatingComment,
  updateFeedback,
  getUserFeedback,
  getUserFeedbackCounts,
  getLastRating,
  isEditable,
  getAllFeedback,
  getAllCombined,
  getAverageRating,
  getFeedbackStats,
  findFeedbackById,
  toggleResolved,
  deleteFeedback,
  deleteAllFeedback,
  searchFeedback,
  addReply,
  getPresetReplies,
  addPresetReply,
  deletePresetReply,
  checkCooldown,
  recordSubmission,
  formatWait
} from '../services/feedbackService.js';
import { findUserByUsername, findUser } from '../services/userService.js';
import { hasPermission } from '../services/rolesService.js';
import { logAdminAction } from '../services/adminLogService.js';
import { reportToAdmins } from '../services/reportService.js';
import { buildMainMenu } from './startCommand.js';
import { sendAdminPanel } from './adminCommand.js';

const HISTORY_PAGE_SIZE = 5;
const THANKS_KEYS = ['feedback.thanks1', 'feedback.thanks2', 'feedback.thanks3'];

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

function pickThanks(language) {
  const key = THANKS_KEYS[Math.floor(Math.random() * THANKS_KEYS.length)];
  return L(language, key);
}

function anonDisplay(language, entry) {
  return entry.anonymous ? t(language, 'feedback.anonymous') : entry.userId;
}

function findUserEntry(userId, id) {
  if (!id) return null;
  const { combined } = getUserFeedback(userId);
  return combined.find((item) => item.entry.id === id) || null;
}

function shortTs(iso) {
  return String(iso || '').slice(0, 16).replace('T', ' ');
}

function trunc(text, max = 60) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ---------------------------------------------------------------------------
// User builders
// ---------------------------------------------------------------------------

export function buildRatingScale(language) {
  const { average, count } = getAverageRating();
  const avgLine = count === 0
    ? L(language, 'feedback.noRatings')
    : `${L(language, 'feedback.avgRating')}: *${average} ⭐* (${count} ${L(language, 'feedback.ratings')})`;
  return buildMenu(
    t(language, 'feedback.ratingTitle'),
    '',
    [
      avgLine,
      '',
      t(language, 'feedback.ratingPrompt'),
      '',
      '1. ⭐',
      '2. ⭐⭐',
      '3. ⭐⭐⭐',
      '4. ⭐⭐⭐⭐',
      '5. ⭐⭐⭐⭐⭐',
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildRatingThanks(language) {
  return buildMenu(
    t(language, 'feedback.ratingTitle'),
    '',
    [
      pickThanks(language),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.reply0Back')
    ]
  );
}

export function buildLowRatingFollowup(language) {
  return buildMenu(
    t(language, 'feedback.ratingTitle'),
    '',
    [
      L(language, 'feedback.lowRatingPrompt'),
      '',
      '1. 😍 ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

const CONFIRM_KEYS = {
  low: ['feedback.confirmLow1', 'feedback.confirmLow2', 'feedback.confirmLow3'],
  mid: ['feedback.confirmMid1', 'feedback.confirmMid2'],
  high: ['feedback.confirmHigh1', 'feedback.confirmHigh2']
};

const MOTIV_KEYS = {
  high: ['feedback.motivHigh1', 'feedback.motivHigh2', 'feedback.motivHigh3'],
  low: ['feedback.motivLow1', 'feedback.motivLow2', 'feedback.motivLow3']
};

const SAD_KEYS = ['feedback.sadNo1', 'feedback.sadNo2', 'feedback.sadNo3'];

function pickKey(keys, language, params = {}) {
  return L(language, keys[Math.floor(Math.random() * keys.length)], params);
}

export function buildRatingConfirm(language, rating) {
  const band = rating <= 2 ? 'low' : rating === 3 ? 'mid' : 'high';
  return buildMenu(
    t(language, 'feedback.ratingTitle'),
    '',
    [
      pickKey(CONFIRM_KEYS[band], language, { rating }),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildRatingMotivation(language, rating) {
  const band = rating >= 4 ? 'high' : 'low';
  return buildMenu(
    t(language, 'feedback.ratingTitle'),
    '',
    [
      pickKey(MOTIV_KEYS[band], language),
      '',
      '1. ' + L(language, 'feedback.continue'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildRatingFarewell(language) {
  return buildMenu(
    t(language, 'feedback.ratingTitle'),
    '',
    [
      pickKey(SAD_KEYS, language),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.reply0Back')
    ]
  );
}

export function buildBugCategory(language) {
  const cats = BUG_CATEGORIES.map((c, i) => `${i + 1}. ${L(language, 'feedback.bugCat' + c[0].toUpperCase() + c.slice(1))}`);
  return buildMenu(
    t(language, 'feedback.bugTitle'),
    '',
    [
      t(language, 'feedback.bugCategoryPrompt'),
      '',
      ...cats,
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

function bugCatKey(code) {
  return 'feedback.bugCat' + code[0].toUpperCase() + code.slice(1);
}

export function buildAnonPrompt(language, titleKey) {
  return buildMenu(
    t(language, titleKey),
    '',
    [
      L(language, 'feedback.anonPrompt'),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildBugPrompt(language) {
  return buildMenu(
    t(language, 'feedback.bugTitle'),
    '',
    [
      L(language, 'feedback.bugPrompt'),
      '',
      '0. ' + t(language, 'feedback.cancel')
    ]
  );
}

export function buildBugThanks(language) {
  return buildMenu(
    t(language, 'feedback.bugTitle'),
    '',
    [
      pickThanks(language),
      '',
      '0. ' + t(language, 'feedback.cancel')
    ]
  );
}

export function buildSuggestionPrompt(language) {
  return buildMenu(
    t(language, 'feedback.suggestionTitle'),
    '',
    [
      L(language, 'feedback.suggestionPrompt'),
      '',
      '0. ' + t(language, 'feedback.cancel')
    ]
  );
}

export function buildSuggestionThanks(language) {
  return buildMenu(
    t(language, 'feedback.suggestionTitle'),
    '',
    [
      pickThanks(language),
      '',
      '0. ' + t(language, 'feedback.cancel')
    ]
  );
}

export function buildContactSupport(language) {
  const email = config.developer?.email || '-';
  const website = config.website || '-';
  return buildMenu(
    t(language, 'feedback.contactTitle'),
    '',
    [
      { static: '*' + toSmallCaps(t(language, 'feedback.supportEmail')) + ':* ', dynamic: email },
      { static: toSmallCaps(t(language, 'feedback.website')) + ': ', dynamic: website },
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.reply0Back')
    ]
  );
}

export function buildHistoryPage(language, userId, page = 0) {
  const { combined } = getUserFeedback(userId);
  const totalPages = Math.max(1, Math.ceil(combined.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * HISTORY_PAGE_SIZE;
  const visible = combined.slice(start, start + HISTORY_PAGE_SIZE);
  const lines = visible.map((item, i) => {
    const n = i + 1;
    const editableTag = isEditable(item.entry) ? ` (${L(language, 'feedback.editable')})` : '';
    if (item.kind === 'rating') {
      const anon = item.entry.anonymous ? ' · ' + t(language, 'feedback.anonymous') : '';
      return { static: `${n}. ⭐ ` + toSmallCaps(t(language, 'feedback.historyRating')) + `: ${item.entry.rating}${editableTag}${anon} · `, dynamic: shortTs(item.entry.timestamp) };
    }
    if (item.kind === 'bug') {
      const anon = item.entry.anonymous ? ' · ' + t(language, 'feedback.anonymous') : '';
      return { static: `${n}. 🐛 ` + toSmallCaps(t(language, 'feedback.historyBug')) + `${editableTag}: `, dynamic: `${trunc(item.entry.description)}${anon} · ${shortTs(item.entry.timestamp)}` };
    }
    const anon = item.entry.anonymous ? ' · ' + t(language, 'feedback.anonymous') : '';
    return { static: `${n}. 💡 ` + toSmallCaps(t(language, 'feedback.historySuggestion')) + `${editableTag}: `, dynamic: `${trunc(item.entry.description)}${anon} · ${shortTs(item.entry.timestamp)}` };
  });
  const hasNext = start + HISTORY_PAGE_SIZE < combined.length;
  const hasPrev = safePage > 0;
  const body = combined.length === 0
    ? [L(language, 'feedback.historyEmpty'), '']
    : [...lines, ''];
  if (hasNext) body.push(`${HISTORY_PAGE_SIZE + 1}. ` + t(language, 'feedback.next'));
  if (hasPrev) body.push(`${HISTORY_PAGE_SIZE + 2}. ` + t(language, 'feedback.previous'));
  if (hasNext || hasPrev) body.push('');
  return buildMenu(
    t(language, 'feedback.historyTitle'),
    '',
    [
      ...body,
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

function historyDetailSummary(kind, entry) {
  if (kind === 'rating') return `⭐ ${entry.rating}/5`;
  if (kind === 'bug') return `🐛 (${entry.category}) ${trunc(entry.description, 80)}`;
  return `💡 ${trunc(entry.description, 80)}`;
}

export function buildHistoryDetail(language, kind, entry) {
  const titleKey = kind === 'rating' ? 'feedback.ratingTitle' : kind === 'bug' ? 'feedback.bugTitle' : 'feedback.suggestionTitle';
  return buildMenu(
    t(language, titleKey),
    '',
    [
      { static: '', dynamic: historyDetailSummary(kind, entry) },
      '',
      '1. ' + t(language, 'feedback.edit'),
      '2. ' + t(language, 'feedback.delete'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildHistoryEditDesc(language, kind) {
  const titleKey = kind === 'bug' ? 'feedback.bugTitle' : 'feedback.suggestionTitle';
  return buildMenu(
    t(language, titleKey),
    '',
    [
      L(language, 'feedback.editDescPrompt'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildHistoryDeleteConfirm(language, kind, entry) {
  const titleKey = kind === 'rating' ? 'feedback.ratingTitle' : kind === 'bug' ? 'feedback.bugTitle' : 'feedback.suggestionTitle';
  return buildMenu(
    t(language, titleKey),
    '',
    [
      { static: '', dynamic: historyDetailSummary(kind, entry) },
      '',
      L(language, 'feedback.deleteConfirm'),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );
}

// ---------------------------------------------------------------------------
// Admin builders
// ---------------------------------------------------------------------------

export function buildFeedbackAdmin(language) {
  const stats = getFeedbackStats();
  return buildMenu(
    t(language, 'feedback.adminTitle'),
    '',
    [
      { static: '📊 ' + toSmallCaps(t(language, 'feedback.adminTotalRatings')) + ': *', dynamic: String(stats.ratings) + '*' },
      { static: '⭐ ' + toSmallCaps(t(language, 'feedback.adminAverage')) + ': *', dynamic: String(stats.average) + '*' },
      { static: '🐛 ' + toSmallCaps(t(language, 'feedback.adminBugReports')) + ': *', dynamic: String(stats.bugReports) + '*' },
      { static: '💡 ' + toSmallCaps(t(language, 'feedback.adminSuggestions')) + ': *', dynamic: String(stats.suggestions) + '*' },
      '',
      '1. ' + t(language, 'feedback.adminOptAll'),
      '2. ' + t(language, 'feedback.adminOptByType'),
      '3. ' + t(language, 'feedback.adminOptSearch'),
      '4. ' + t(language, 'feedback.adminOptReply'),
      '5. ' + t(language, 'feedback.adminOptDelete'),
      '6. ' + t(language, 'feedback.adminOptDeleteAll'),
      '7. ' + t(language, 'feedback.adminOptExport'),
      '8. ' + t(language, 'feedback.adminOptPresets'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

const ADMIN_PAGE_SIZE = 10;

function adminListEntryLine(n, kind, entry, language) {
  const user = anonDisplay(language, entry);
  const ts = shortTs(entry.timestamp);
  const preview = kind === 'rating' ? `${entry.rating}/5` : trunc(kind === 'bug' ? `(${entry.category}) ${entry.description}` : entry.description, 40);
  const emoji = kind === 'rating' ? '⭐' : kind === 'bug' ? '🐛' : '💡';
  const replied = entry.reply ? ' ↩️' : '';
  const resolved = entry.resolved ? ' ✅' : '';
  return { static: `${n}. ${emoji} `, dynamic: `${user} - ${preview}${replied}${resolved} (${ts})` };
}

function resolveAdminList(filter) {
  if (!filter) return [];
  if (filter.mode === 'all') return getAllCombined();
  if (filter.mode === 'type') {
    const all = getAllFeedback();
    if (filter.type === 'rating') return all.ratings.map((entry) => ({ kind: 'rating', entry })).reverse();
    if (filter.type === 'bug') return all.bugReports.map((entry) => ({ kind: 'bug', entry })).reverse();
    return all.suggestions.map((entry) => ({ kind: 'suggestion', entry })).reverse();
  }
  if (filter.mode === 'search') return searchFeedback(filter.query).slice(0, 50);
  if (filter.mode === 'user') {
    return getUserFeedback(filter.user).combined.slice(0, 50);
  }
  return [];
}

export function buildAdminPage(language, titleKey, filter, page = 0) {
  const items = resolveAdminList(filter);
  const totalPages = Math.max(1, Math.ceil(items.length / ADMIN_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * ADMIN_PAGE_SIZE;
  const visible = items.slice(start, start + ADMIN_PAGE_SIZE);
  const lines = visible.map((item, i) => adminListEntryLine(start + i + 1, item.kind, item.entry, language));
  const hasNext = start + ADMIN_PAGE_SIZE < items.length;
  const hasPrev = safePage > 0;
  const body = items.length === 0 ? [L(language, 'feedback.adminNoResults'), ''] : [...lines, ''];
  if (hasNext) body.push('11. ' + t(language, 'feedback.next'));
  if (hasPrev) body.push('12. ' + t(language, 'feedback.previous'));
  if (hasNext || hasPrev) body.push('');
  return buildMenu(t(language, titleKey), '', [...body, '0. ' + t(language, 'feedback.back'), '', t(language, 'feedback.replyPrompt')]);
}

export function buildViewTypeMenu(language) {
  return buildMenu(
    t(language, 'feedback.viewTypeTitle'),
    '',
    [
      '1. ⭐ ' + t(language, 'feedback.adminRecentRatings'),
      '2. 🐛 ' + t(language, 'feedback.adminRecentBugs'),
      '3. 💡 ' + t(language, 'feedback.adminRecentSuggestions'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildFeedbackDetail(language, kind, entry) {
  const user = anonDisplay(language, entry);
  const lines = [
    { static: '*' + toSmallCaps(t(language, 'feedback.detailType')) + ':* ', dynamic: kind },
    { static: '*' + toSmallCaps(t(language, 'feedback.detailUser')) + ':* ', dynamic: user }
  ];
  if (kind === 'rating') {
    lines.push({ static: '⭐ ', dynamic: `${entry.rating}/5` });
    if (entry.comment) lines.push({ static: '*' + toSmallCaps(t(language, 'feedback.detailComment')) + ':* ', dynamic: entry.comment });
  } else {
    if (kind === 'bug') lines.push({ static: '*' + toSmallCaps(t(language, 'feedback.detailCategory')) + ':* ', dynamic: entry.category });
    lines.push({ static: '*' + toSmallCaps(t(language, 'feedback.detailDescription')) + ':* ', dynamic: entry.description });
  }
  if (entry.reply) {
    lines.push({ static: '*' + toSmallCaps(t(language, 'feedback.detailReply')) + ':* ', dynamic: `${entry.reply.message} (${shortTs(entry.reply.timestamp)})` });
  }
  lines.push('*' + L(language, 'feedback.status') + ':* ' + (entry.resolved ? '✅ ' + L(language, 'feedback.resolved') : L(language, 'feedback.unresolved')));
  lines.push({ static: '*' + toSmallCaps(t(language, 'feedback.detailTime')) + ':* ', dynamic: entry.timestamp });
  return buildMenu(
    t(language, 'feedback.detailTitle'),
    '',
    [
      ...lines,
      '',
      '1. ' + t(language, 'feedback.detailOptReply'),
      '2. ' + t(language, 'feedback.detailOptDelete'),
      '3. ' + t(language, 'feedback.toggleResolved') + ' ✅',
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildReplyMethodMenu(language) {
  return buildMenu(
    t(language, 'feedback.replyTitle'),
    '',
    [
      '1. ' + t(language, 'feedback.replyMethodPreset'),
      '2. ' + t(language, 'feedback.replyMethodCustom'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildPresetList(language, presets) {
  const lines = presets.map((p, i) => ({ static: `${i + 1}. `, dynamic: trunc(p.text, 80) }));
  return buildMenu(
    t(language, 'feedback.replyPresetsTitle'),
    '',
    [
      ...(lines.length ? lines : [L(language, 'feedback.presetEmpty')]),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildReplyConfirm(language, userJid, text) {
  return buildMenu(
    t(language, 'feedback.replyTitle'),
    '',
    [
      { static: '*' + toSmallCaps(t(language, 'feedback.detailUser')) + ':* ', dynamic: userJid },
      { static: '', dynamic: trunc(text, 200) },
      '',
      L(language, 'feedback.replyConfirm'),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );
}

export function buildReplyJidPrompt(language) {
  return buildMenu(
    t(language, 'feedback.replyTitle'),
    '',
    [
      L(language, 'feedback.replyJidPrompt'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildReplyUserEntries(language, userJid, items) {
  const lines = items.map((item, i) => {
    const preview = item.kind === 'rating' ? `${item.entry.rating}/5` : trunc(item.entry.description, 50);
    const emoji = item.kind === 'rating' ? '⭐' : item.kind === 'bug' ? '🐛' : '💡';
    return { static: `${i + 1}. ${emoji} `, dynamic: `${preview} (${shortTs(item.entry.timestamp)})` };
  });
  return buildMenu(
    t(language, 'feedback.replyTitle'),
    '',
    [
      { static: '*' + toSmallCaps(t(language, 'feedback.detailUser')) + ':* ', dynamic: userJid },
      '',
      ...(lines.length ? lines : [L(language, 'feedback.adminNoResults')]),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildReplyCustomPrompt(language) {
  return buildMenu(
    t(language, 'feedback.replyTitle'),
    '',
    [
      L(language, 'feedback.replyCustomPrompt'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildPresetsMenu(language) {
  return buildMenu(
    t(language, 'feedback.presetsTitle'),
    '',
    [
      '1. ' + t(language, 'feedback.presetAdd'),
      '2. ' + t(language, 'feedback.presetList'),
      '3. ' + t(language, 'feedback.presetDelete'),
      '',
      '0. ' + t(language, 'feedback.back'),
      '',
      t(language, 'feedback.replyPrompt')
    ]
  );
}

export function buildPresetAddPrompt(language) {
  return buildMenu(
    t(language, 'feedback.presetAdd'),
    '',
    [
      L(language, 'feedback.presetAddPrompt'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildPresetDeletePrompt(language, presets) {
  const lines = presets.map((p, i) => ({ static: `${i + 1}. `, dynamic: trunc(p.text, 60) }));
  return buildMenu(
    t(language, 'feedback.presetDelete'),
    '',
    [
      ...(lines.length ? lines : [L(language, 'feedback.presetEmpty')]),
      '',
      L(language, 'feedback.presetDeletePrompt'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildAdminSearchPrompt(language) {
  return buildMenu(
    t(language, 'feedback.adminOptSearch'),
    '',
    [
      L(language, 'feedback.adminSearchPrompt'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildAdminDeletePrompt(language) {
  return buildMenu(
    t(language, 'feedback.adminOptDelete'),
    '',
    [
      L(language, 'feedback.adminDeletePrompt'),
      '',
      '0. ' + t(language, 'feedback.back')
    ]
  );
}

export function buildAdminDeleteAllConfirm(language) {
  return buildMenu(
    t(language, 'feedback.adminOptDeleteAll'),
    '',
    [
      L(language, 'feedback.adminDeleteAllConfirm'),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]
  );
}

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

export async function sendFeedbackMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender).catch(() => null);
  const language = opts.language || await languageOf(sender);
  sessionManager.setState(sender, chatId, { pendingRatingId: null, pendingHistoryPage: 0, pendingHistoryEntryId: null });
  await sendMenuById('feedback', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'feedback_menu', { resultLine: opts.resultLine, sessionMenu: 'feedback_main' });
}

export async function openFeedback(context, opts = {}) {
  return sendFeedbackMenu(context, { ...opts, transitionKey: opts.transitionKey || 'main_to_feedback' });
}

export async function sendFeedbackAdmin(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || await languageOf(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'feedback_admin' });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildFeedbackAdmin(language),
    transitionKey: opts.transitionKey || 'feedback_admin'
  });
}

async function sendFeedbackState(context, menu, text, transitionKey, extra = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: menu, ...extra });
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey });
}

function notifyAdmins(kind, userId, description, timestamp, anonymous) {
  try {
    reportToAdmins('feedback', {
      user: anonymous ? 'Anonymous' : userId,
      kind,
      description,
      timestamp
    }, 'immediate');
  } catch { /* reporting must never break the user flow */ }
}

async function sendCooldownWait(sock, sender, language, waitMs) {
  await sendText(sock, sender, '*⚠️ ' + L(language, 'feedback.cooldownWait', { time: formatWait(waitMs) }) + '*');
}

// ---------------------------------------------------------------------------
// User reply dispatcher
// ---------------------------------------------------------------------------

export async function handleFeedbackReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = await languageOf(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const menu = session.currentMenu;
  const trimmed = (input || '').trim();

  if (menu === 'feedback_main') {
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
          transitionKey: 'feedback_back_to_main'
        });
      }
      case '1':
        return sendFeedbackState(context, 'feedback_rating', buildRatingScale(language), 'feedback_to_rating');
      case '2':
        return sendFeedbackState(context, 'feedback_bug_category', buildBugCategory(language), 'feedback_to_bug', { pendingBugReturn: 'feedback_main', pendingRatingId: null });
      case '3':
        return sendFeedbackState(context, 'feedback_suggestion_prompt', buildSuggestionPrompt(language), 'feedback_to_suggestion');
      case '4':
        return sendFeedbackState(context, 'feedback_contact', buildContactSupport(language), 'feedback_to_contact');
      case '5':
        return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, 0), 'feedback_to_history', { pendingHistoryPage: 0 });
      default:
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    }
  }

  if (menu === 'feedback_rating') {
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    if (/^[1-5]$/.test(trimmed)) {
      const cd = checkCooldown(sender, 'rating');
      if (!cd.allowed) {
        await sendCooldownWait(context.sock, sender, language, cd.waitMs);
        return sendFeedbackState(context, 'feedback_rating', buildRatingScale(language), 'feedback_menu');
      }
      const rating = parseInt(trimmed, 10);
      return sendFeedbackState(context, 'feedback_rating_confirm', buildRatingConfirm(language, rating), 'feedback_rating_confirm', { pendingRatingChoice: rating });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_rating', buildRatingScale(language), 'feedback_menu');
  }

  if (menu === 'feedback_rating_confirm') {
    const rating = session.pendingRatingChoice;
    if (!rating) {
      return sendFeedbackState(context, 'feedback_rating', buildRatingScale(language), 'feedback_menu');
    }
    if (trimmed === '1') {
      const entry = addRating(sender, rating);
      if (!entry) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        return sendFeedbackState(context, 'feedback_rating', buildRatingScale(language), 'feedback_menu');
      }
      recordSubmission(sender, 'rating');
      return sendFeedbackState(context, 'feedback_rating_motivation', buildRatingMotivation(language, rating), 'feedback_rating_motivation', {
        pendingRatingId: entry.id,
        pendingMotivationRating: rating
      });
    }
    return sendFeedbackState(context, 'feedback_rating', buildRatingScale(language), 'feedback_menu');
  }

  if (menu === 'feedback_rating_motivation') {
    const rating = session.pendingMotivationRating;
    if (!rating) {
      return sendFeedbackState(context, 'feedback_rating_done', buildRatingThanks(language), 'feedback_menu');
    }
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    if (trimmed === '1') {
      if (rating <= 2) {
        return sendFeedbackState(context, 'feedback_rating_followup', buildLowRatingFollowup(language), 'feedback_menu', { pendingRatingId: session.pendingRatingId });
      }
      return sendFeedbackState(context, 'feedback_rating_done', buildRatingThanks(language), 'feedback_menu');
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_rating_motivation', buildRatingMotivation(language, rating), 'feedback_rating_motivation', {
      pendingRatingId: session.pendingRatingId,
      pendingMotivationRating: rating
    });
  }

  if (menu === 'feedback_rating_followup') {
    if (trimmed === '1') {
      return sendFeedbackState(context, 'feedback_bug_category', buildBugCategory(language), 'feedback_to_bug', { pendingBugReturn: 'feedback_rating_followup', pendingRatingId: session.pendingRatingId });
    }
    if (trimmed === '2') {
      return sendFeedbackState(context, 'feedback_rating_farewell', buildRatingFarewell(language), 'feedback_rating_motivation', { pendingRatingId: session.pendingRatingId });
    }
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_rating_followup', buildLowRatingFollowup(language), 'feedback_menu', { pendingRatingId: session.pendingRatingId });
  }

  if (menu === 'feedback_rating_farewell') {
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_rating_farewell', buildRatingFarewell(language), 'feedback_rating_motivation', { pendingRatingId: session.pendingRatingId });
  }

  if (menu === 'feedback_rating_done') {
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_rating_done', buildRatingThanks(language), 'feedback_menu');
  }

  if (menu === 'feedback_bug_category') {
    if (trimmed === '0') {
      const ret = session.pendingBugReturn === 'feedback_rating_followup' ? 'feedback_rating_followup' : 'feedback_main';
      if (ret === 'feedback_main') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
      return sendFeedbackState(context, ret, buildLowRatingFollowup(language), 'feedback_menu', { pendingRatingId: session.pendingRatingId });
    }
    if (/^[1-4]$/.test(trimmed)) {
      const category = BUG_CATEGORIES[parseInt(trimmed, 10) - 1];
      return sendFeedbackState(context, 'feedback_bug_prompt', buildBugPrompt(language), 'feedback_to_bug', {
        pendingBugCategory: category,
        pendingBugReturn: session.pendingBugReturn || 'feedback_main',
        pendingRatingId: session.pendingRatingId || null
      });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_bug_category', buildBugCategory(language), 'feedback_menu', {
      pendingBugReturn: session.pendingBugReturn || 'feedback_main',
      pendingRatingId: session.pendingRatingId || null
    });
  }

  if (menu === 'feedback_bug_prompt') {
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    if (!trimmed) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_bug_prompt', buildBugPrompt(language), 'feedback_menu', {
        pendingBugCategory: session.pendingBugCategory || 'other',
        pendingBugReturn: session.pendingBugReturn || 'feedback_main',
        pendingRatingId: session.pendingRatingId || null
      });
    }
    return sendFeedbackState(context, 'feedback_bug_anon', buildAnonPrompt(language, 'feedback.bugTitle'), 'feedback_menu', {
      pendingBugCategory: session.pendingBugCategory || 'other',
      pendingBugText: trimmed,
      pendingBugReturn: session.pendingBugReturn || 'feedback_main',
      pendingRatingId: session.pendingRatingId || null
    });
  }

  if (menu === 'feedback_bug_anon') {
    const anonymous = trimmed === '1' ? true : trimmed === '2' ? false : null;
    if (trimmed === '0') {
      return sendFeedbackState(context, 'feedback_bug_prompt', buildBugPrompt(language), 'feedback_menu', {
        pendingBugCategory: session.pendingBugCategory || 'other',
        pendingBugReturn: session.pendingBugReturn || 'feedback_main',
        pendingRatingId: session.pendingRatingId || null
      });
    }
    if (anonymous === null) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_bug_anon', buildAnonPrompt(language, 'feedback.bugTitle'), 'feedback_menu', {
        pendingBugCategory: session.pendingBugCategory || 'other',
        pendingBugText: session.pendingBugText,
        pendingBugReturn: session.pendingBugReturn || 'feedback_main',
        pendingRatingId: session.pendingRatingId || null
      });
    }
    const cd = checkCooldown(sender, 'bug');
    const text = session.pendingBugText || '';
    if (!cd.allowed) {
      await sendCooldownWait(context.sock, sender, language, cd.waitMs);
      if (session.pendingRatingId) updateRatingComment(session.pendingRatingId, text);
      return sendFeedbackState(context, 'feedback_rating_done', buildRatingThanks(language), 'feedback_menu');
    }
    const entry = addBugReport(sender, session.pendingBugCategory || 'other', text, anonymous);
    if (entry) {
      recordSubmission(sender, 'bug');
      notifyAdmins('bug', sender, `[${entry.category}] ${text}`, entry.timestamp, anonymous);
      if (session.pendingRatingId) updateRatingComment(session.pendingRatingId, text);
    }
    if (session.pendingRatingId) {
      return sendFeedbackState(context, 'feedback_rating_done', buildRatingThanks(language), 'feedback_menu');
    }
    return sendFeedbackState(context, 'feedback_bug_done', buildBugThanks(language), 'feedback_menu');
  }

  if (menu === 'feedback_bug_done') {
    return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
  }

  if (menu === 'feedback_suggestion_prompt') {
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    if (!trimmed) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_suggestion_prompt', buildSuggestionPrompt(language), 'feedback_menu');
    }
    return sendFeedbackState(context, 'feedback_suggestion_anon', buildAnonPrompt(language, 'feedback.suggestionTitle'), 'feedback_menu', { pendingSuggestionText: trimmed });
  }

  if (menu === 'feedback_suggestion_anon') {
    const anonymous = trimmed === '1' ? true : trimmed === '2' ? false : null;
    if (trimmed === '0') {
      return sendFeedbackState(context, 'feedback_suggestion_prompt', buildSuggestionPrompt(language), 'feedback_menu');
    }
    if (anonymous === null) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_suggestion_anon', buildAnonPrompt(language, 'feedback.suggestionTitle'), 'feedback_menu', { pendingSuggestionText: session.pendingSuggestionText });
    }
    const cd = checkCooldown(sender, 'suggestion');
    const text = session.pendingSuggestionText || '';
    if (!cd.allowed) {
      await sendCooldownWait(context.sock, sender, language, cd.waitMs);
      return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    }
    const entry = addSuggestion(sender, text, anonymous);
    if (entry) {
      recordSubmission(sender, 'suggestion');
      notifyAdmins('suggestion', sender, text, entry.timestamp, anonymous);
    }
    return sendFeedbackState(context, 'feedback_suggestion_done', buildSuggestionThanks(language), 'feedback_menu');
  }

  if (menu === 'feedback_suggestion_done') {
    return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
  }

  if (menu === 'feedback_history') {
    const page = session.pendingHistoryPage || 0;
    const { combined } = getUserFeedback(sender);
    const totalPages = Math.max(1, Math.ceil(combined.length / HISTORY_PAGE_SIZE));
    const hasNext = (page + 1) * HISTORY_PAGE_SIZE < combined.length;
    const hasPrev = page > 0;
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    if (trimmed === String(HISTORY_PAGE_SIZE + 1) && hasNext) {
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page + 1), 'feedback_to_history', { pendingHistoryPage: page + 1 });
    }
    if (trimmed === String(HISTORY_PAGE_SIZE + 2) && hasPrev) {
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page - 1), 'feedback_to_history', { pendingHistoryPage: page - 1 });
    }
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      const start = page * HISTORY_PAGE_SIZE;
      if (n >= 1 && n <= Math.min(HISTORY_PAGE_SIZE, combined.length - start)) {
        const item = combined[start + n - 1];
        // Editable entries open the Edit/Delete sub-menu; expired ones show a detail line.
        if (isEditable(item.entry)) {
          return sendFeedbackState(context, 'feedback_history_detail', buildHistoryDetail(language, item.kind, item.entry), 'feedback_history_detail', {
            pendingHistoryPage: page,
            pendingHistoryEntryId: item.entry.id
          });
        }
        const detail = item.kind === 'rating'
          ? `⭐ ${item.entry.rating}/5`
          : item.kind === 'bug'
            ? `🐛 (${item.entry.category}) ${item.entry.description}`
            : `💡 ${item.entry.description}`;
        await sendText(context.sock, sender, detail + '\n🕒 ' + item.entry.timestamp);
        return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
      }
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, Math.min(page, totalPages - 1)), 'feedback_to_history', { pendingHistoryPage: Math.min(page, totalPages - 1) });
  }

  if (menu === 'feedback_history_detail') {
    const page = session.pendingHistoryPage || 0;
    const entryId = session.pendingHistoryEntryId;
    const found = entryId ? findUserEntry(sender, entryId) : null;
    if (!found || !isEditable(found.entry)) {
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
    }
    if (trimmed === '0') {
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
    }
    if (trimmed === '1') {
      if (found.kind === 'rating') {
        return sendFeedbackState(context, 'feedback_history_edit_rating', buildRatingScale(language), 'feedback_to_history', { pendingHistoryPage: page, pendingHistoryEntryId: entryId });
      }
      return sendFeedbackState(context, 'feedback_history_edit_desc', buildHistoryEditDesc(language, found.kind), 'feedback_to_history', { pendingHistoryPage: page, pendingHistoryEntryId: entryId });
    }
    if (trimmed === '2') {
      return sendFeedbackState(context, 'feedback_history_delete_confirm', buildHistoryDeleteConfirm(language, found.kind, found.entry), 'feedback_history_detail', { pendingHistoryPage: page, pendingHistoryEntryId: entryId });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_history_detail', buildHistoryDetail(language, found.kind, found.entry), 'feedback_history_detail', { pendingHistoryPage: page, pendingHistoryEntryId: entryId });
  }

  if (menu === 'feedback_history_edit_rating') {
    const page = session.pendingHistoryPage || 0;
    const entryId = session.pendingHistoryEntryId;
    if (trimmed === '0') {
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
    }
    if (/^[1-5]$/.test(trimmed)) {
      const updated = updateFeedback(sender, entryId, { rating: parseInt(trimmed, 10) });
      if (!updated) {
        return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
      }
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_history_edit_rating', buildRatingScale(language), 'feedback_to_history', { pendingHistoryPage: page, pendingHistoryEntryId: entryId });
  }

  if (menu === 'feedback_history_edit_desc') {
    const page = session.pendingHistoryPage || 0;
    const entryId = session.pendingHistoryEntryId;
    const found = entryId ? findUserEntry(sender, entryId) : null;
    if (trimmed === '0' || !found) {
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
    }
    if (!trimmed) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_history_edit_desc', buildHistoryEditDesc(language, found.kind), 'feedback_to_history', { pendingHistoryPage: page, pendingHistoryEntryId: entryId });
    }
    updateFeedback(sender, entryId, { description: trimmed });
    return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
  }

  if (menu === 'feedback_history_delete_confirm') {
    const page = session.pendingHistoryPage || 0;
    const entryId = session.pendingHistoryEntryId;
    if (trimmed === '1') {
      deleteFeedback(entryId, sender);
      await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.deleted')));
      return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
    }
    return sendFeedbackState(context, 'feedback_history', buildHistoryPage(language, sender, page), 'feedback_to_history', { pendingHistoryPage: page });
  }

  if (menu === 'feedback_contact') {
    if (trimmed === '0') return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_contact', buildContactSupport(language), 'feedback_menu');
  }

  return sendFeedbackMenu(context, { language, transitionKey: 'feedback_menu' });
}

// ---------------------------------------------------------------------------
// Admin dispatcher
// ---------------------------------------------------------------------------

export async function handleFeedbackAdminReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = await languageOf(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const menu = session.currentMenu;
  const trimmed = (input || '').trim();

  async function showAdminList(filter, titleKey, page, returnTo) {
    return sendFeedbackState(context, 'feedback_admin_list', buildAdminPage(language, titleKey, filter, page), 'feedback_admin_view', {
      pendingAdminFilter: filter,
      pendingAdminTitle: titleKey,
      pendingAdminPage: page,
      pendingAdminReturn: returnTo || 'feedback_admin'
    });
  }

  if (menu === 'feedback_admin') {
    switch (trimmed) {
      case '0':
        return sendAdminPanel(context);
      case '1':
        return showAdminList({ mode: 'all' }, 'feedback.viewAllTitle', 0, 'feedback_admin');
      case '2':
        return sendFeedbackState(context, 'feedback_admin_type', buildViewTypeMenu(language), 'feedback_admin_type');
      case '3':
        return sendFeedbackState(context, 'feedback_admin_search', buildAdminSearchPrompt(language), 'feedback_admin_search');
      case '4':
        return sendFeedbackState(context, 'feedback_admin_reply_jid', buildReplyJidPrompt(language), 'feedback_admin_reply', { pendingReplyReturn: 'feedback_admin' });
      case '5':
        if (!hasPermission(sender, 'feedback.manage')) {
          await sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
          return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
        }
        return sendFeedbackState(context, 'feedback_admin_delete', buildAdminDeletePrompt(language), 'feedback_admin_delete');
      case '6':
        if (!hasPermission(sender, 'feedback.manage')) {
          await sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
          return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
        }
        return sendFeedbackState(context, 'feedback_admin_delete_all_confirm', buildAdminDeleteAllConfirm(language), 'feedback_admin_delete');
      case '7': {
        const data = JSON.stringify(getAllFeedback(), null, 2);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        try {
          await context.sock.sendMessage(chatId, {
            document: Buffer.from(data, 'utf8'),
            mimetype: 'application/json',
            fileName: `feedback-export-${ts}.json`,
            caption: toSmallCaps(t(language, 'feedback.adminExportCaption'))
          });
        } catch {
          await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        }
        return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
      }
      case '8':
        return sendFeedbackState(context, 'feedback_admin_presets', buildPresetsMenu(language), 'feedback_admin_presets');
      default:
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    }
  }

  if (menu === 'feedback_admin_type') {
    const typeMap = { 1: 'rating', 2: 'bug', 3: 'suggestion' };
    if (trimmed === '0') return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    if (typeMap[trimmed]) {
      const titleKey = trimmed === '1' ? 'feedback.adminRecentRatings' : trimmed === '2' ? 'feedback.adminRecentBugs' : 'feedback.adminRecentSuggestions';
      return showAdminList({ mode: 'type', type: typeMap[trimmed] }, titleKey, 0, 'feedback_admin_type');
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_admin_type', buildViewTypeMenu(language), 'feedback_admin_type');
  }

  if (menu === 'feedback_admin_list') {
    const filter = session.pendingAdminFilter || { mode: 'all' };
    const titleKey = session.pendingAdminTitle || 'feedback.viewAllTitle';
    const returnTo = session.pendingAdminReturn || 'feedback_admin';
    const page = session.pendingAdminPage || 0;
    const items = resolveAdminList(filter);
    const hasNext = (page + 1) * ADMIN_PAGE_SIZE < items.length;
    const hasPrev = page > 0;
    const backTo = async () => {
      if (returnTo === 'feedback_admin_type') {
        return sendFeedbackState(context, 'feedback_admin_type', buildViewTypeMenu(language), 'feedback_admin_type');
      }
      return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    };
    if (trimmed === '0') return backTo();
    if (trimmed === '11' && hasNext) {
      return sendFeedbackState(context, 'feedback_admin_list', buildAdminPage(language, titleKey, filter, page + 1), 'feedback_admin_view', {
        pendingAdminFilter: filter, pendingAdminTitle: titleKey, pendingAdminPage: page + 1, pendingAdminReturn: returnTo
      });
    }
    if (trimmed === '12' && hasPrev) {
      return sendFeedbackState(context, 'feedback_admin_list', buildAdminPage(language, titleKey, filter, page - 1), 'feedback_admin_view', {
        pendingAdminFilter: filter, pendingAdminTitle: titleKey, pendingAdminPage: page - 1, pendingAdminReturn: returnTo
      });
    }
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      const start = page * ADMIN_PAGE_SIZE;
      if (n >= 1 && n <= Math.min(ADMIN_PAGE_SIZE, items.length - start)) {
        const item = items[start + n - 1];
        return sendFeedbackState(context, 'feedback_admin_detail', buildFeedbackDetail(language, item.kind, item.entry), 'feedback_admin_detail', {
          pendingDetailKind: item.kind,
          pendingDetailId: item.entry.id,
          pendingAdminFilter: filter,
          pendingAdminTitle: titleKey,
          pendingAdminPage: page,
          pendingAdminReturn: returnTo
        });
      }
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_admin_list', buildAdminPage(language, titleKey, filter, page), 'feedback_admin_view', {
      pendingAdminFilter: filter, pendingAdminTitle: titleKey, pendingAdminPage: page, pendingAdminReturn: returnTo
    });
  }

  if (menu === 'feedback_admin_detail') {
    const detailId = session.pendingDetailId;
    const found = detailId ? findFeedbackById(detailId) : null;
    const backToList = async () => sendFeedbackState(context, 'feedback_admin_list',
      buildAdminPage(language, session.pendingAdminTitle || 'feedback.viewAllTitle', session.pendingAdminFilter || { mode: 'all' }, session.pendingAdminPage || 0),
      'feedback_admin_view', {
        pendingAdminFilter: session.pendingAdminFilter || { mode: 'all' },
        pendingAdminTitle: session.pendingAdminTitle || 'feedback.viewAllTitle',
        pendingAdminPage: session.pendingAdminPage || 0,
        pendingAdminReturn: session.pendingAdminReturn || 'feedback_admin'
      });
    if (!found) return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    if (trimmed === '0') return backToList();
    if (trimmed === '1') {
      return sendFeedbackState(context, 'feedback_admin_reply_method', buildReplyMethodMenu(language), 'feedback_admin_reply', {
        pendingReplyUser: found.entry.userId,
        pendingReplyEntryId: found.entry.id,
        pendingReplyReturn: 'feedback_admin_detail',
        pendingDetailKind: found.kind,
        pendingDetailId: found.entry.id,
        pendingAdminFilter: session.pendingAdminFilter,
        pendingAdminTitle: session.pendingAdminTitle,
        pendingAdminPage: session.pendingAdminPage,
        pendingAdminReturn: session.pendingAdminReturn
      });
    }
    if (trimmed === '2') {
      if (!hasPermission(sender, 'feedback.manage')) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
        return backToList();
      }
      return sendFeedbackState(context, 'feedback_admin_detail_delete_confirm', buildAdminDeleteAllConfirm(language), 'feedback_admin_delete', {
        pendingDetailKind: found.kind,
        pendingDetailId: found.entry.id,
        pendingAdminFilter: session.pendingAdminFilter,
        pendingAdminTitle: session.pendingAdminTitle,
        pendingAdminPage: session.pendingAdminPage,
        pendingAdminReturn: session.pendingAdminReturn
      });
    }
    if (trimmed === '3') {
      const toggled = toggleResolved(found.entry.id);
      const fresh = toggled || found;
      return sendFeedbackState(context, 'feedback_admin_detail', buildFeedbackDetail(language, fresh.kind, fresh.entry), 'feedback_admin_detail', {
        pendingDetailKind: fresh.kind,
        pendingDetailId: fresh.entry.id,
        pendingAdminFilter: session.pendingAdminFilter,
        pendingAdminTitle: session.pendingAdminTitle,
        pendingAdminPage: session.pendingAdminPage,
        pendingAdminReturn: session.pendingAdminReturn
      });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_admin_detail', buildFeedbackDetail(language, found.kind, found.entry), 'feedback_admin_detail', {
      pendingDetailKind: found.kind,
      pendingDetailId: found.entry.id,
      pendingAdminFilter: session.pendingAdminFilter,
      pendingAdminTitle: session.pendingAdminTitle,
      pendingAdminPage: session.pendingAdminPage,
      pendingAdminReturn: session.pendingAdminReturn
    });
  }

  if (menu === 'feedback_admin_detail_delete_confirm') {
    const detailId = session.pendingDetailId;
    if (!hasPermission(sender, 'feedback.manage')) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
      return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    }
    if (trimmed === '1' && detailId) {
      const removed = deleteFeedback(detailId);
      if (removed) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.adminDeleted', { kind: removed.kind, id: removed.entry.id })));
      }
    }
    return sendFeedbackState(context, 'feedback_admin_list',
      buildAdminPage(language, session.pendingAdminTitle || 'feedback.viewAllTitle', session.pendingAdminFilter || { mode: 'all' }, session.pendingAdminPage || 0),
      'feedback_admin_view', {
        pendingAdminFilter: session.pendingAdminFilter || { mode: 'all' },
        pendingAdminTitle: session.pendingAdminTitle || 'feedback.viewAllTitle',
        pendingAdminPage: session.pendingAdminPage || 0,
        pendingAdminReturn: session.pendingAdminReturn || 'feedback_admin'
      });
  }

  if (menu === 'feedback_admin_search') {
    if (trimmed === '0') return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    if (!trimmed) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_admin_search', buildAdminSearchPrompt(language), 'feedback_admin_search');
    }
    return showAdminList({ mode: 'search', query: trimmed }, 'feedback.adminSearchResults', 0, 'feedback_admin');
  }

  async function showReplyMethod(userJid, entryId, returnState) {
    return sendFeedbackState(context, 'feedback_admin_reply_method', buildReplyMethodMenu(language), 'feedback_admin_reply', {
      pendingReplyUser: userJid,
      pendingReplyEntryId: entryId || null,
      pendingReplyReturn: returnState || 'feedback_admin',
      pendingDetailKind: session.pendingDetailKind,
      pendingDetailId: session.pendingDetailId,
      pendingAdminFilter: session.pendingAdminFilter,
      pendingAdminTitle: session.pendingAdminTitle,
      pendingAdminPage: session.pendingAdminPage,
      pendingAdminReturn: session.pendingAdminReturn
    });
  }

  async function resolveJid(raw) {
    const clean = (raw || '').trim().replace(/^@/, '');
    if (!clean) return null;
    if (getUserFeedback(clean).ratings.length || getUserFeedback(clean).bugReports.length || getUserFeedback(clean).suggestions.length) {
      return clean;
    }
    try {
      const byName = await findUserByUsername(clean);
      if (byName?.jid) return byName.jid;
      const found = await findUser(clean);
      if (found?.jid) return found.jid;
    } catch { /* fall through */ }
    return clean.includes('@') ? clean : null;
  }

  if (menu === 'feedback_admin_reply_jid') {
    if (trimmed === '0') return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    if (!trimmed) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_admin_reply_jid', buildReplyJidPrompt(language), 'feedback_admin_reply', { pendingReplyReturn: 'feedback_admin' });
    }
    const jid = await resolveJid(trimmed);
    if (!jid) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.adminNotFound')));
      return sendFeedbackState(context, 'feedback_admin_reply_jid', buildReplyJidPrompt(language), 'feedback_admin_reply', { pendingReplyReturn: 'feedback_admin' });
    }
    const items = getUserFeedback(jid).combined.slice(0, 5);
    return sendFeedbackState(context, 'feedback_admin_reply_list', buildReplyUserEntries(language, jid, items), 'feedback_admin_reply', {
      pendingReplyUser: jid,
      pendingReplyReturn: 'feedback_admin'
    });
  }

  if (menu === 'feedback_admin_reply_list') {
    const userJid = session.pendingReplyUser;
    if (trimmed === '0') {
      return sendFeedbackState(context, 'feedback_admin_reply_jid', buildReplyJidPrompt(language), 'feedback_admin_reply', { pendingReplyReturn: 'feedback_admin' });
    }
    const items = userJid ? getUserFeedback(userJid).combined.slice(0, 5) : [];
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n >= 1 && n <= items.length) {
        return showReplyMethod(userJid, items[n - 1].entry.id, 'feedback_admin_reply_list');
      }
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_admin_reply_list', buildReplyUserEntries(language, userJid, items), 'feedback_admin_reply', {
      pendingReplyUser: userJid,
      pendingReplyReturn: 'feedback_admin'
    });
  }

  if (menu === 'feedback_admin_reply_method') {
    const backTo = async () => {
      if (session.pendingReplyReturn === 'feedback_admin_detail' && session.pendingDetailId) {
        const found = findFeedbackById(session.pendingDetailId);
        if (found) {
          return sendFeedbackState(context, 'feedback_admin_detail', buildFeedbackDetail(language, found.kind, found.entry), 'feedback_admin_detail', {
            pendingDetailKind: found.kind,
            pendingDetailId: found.entry.id,
            pendingAdminFilter: session.pendingAdminFilter,
            pendingAdminTitle: session.pendingAdminTitle,
            pendingAdminPage: session.pendingAdminPage,
            pendingAdminReturn: session.pendingAdminReturn
          });
        }
      }
      if (session.pendingReplyReturn === 'feedback_admin_reply_list' && session.pendingReplyUser) {
        const items = getUserFeedback(session.pendingReplyUser).combined.slice(0, 5);
        return sendFeedbackState(context, 'feedback_admin_reply_list', buildReplyUserEntries(language, session.pendingReplyUser, items), 'feedback_admin_reply', {
          pendingReplyUser: session.pendingReplyUser,
          pendingReplyReturn: 'feedback_admin'
        });
      }
      return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    };
    if (trimmed === '0') return backTo();
    if (trimmed === '1') {
      const presets = getPresetReplies();
      return sendFeedbackState(context, 'feedback_admin_reply_presets', buildPresetList(language, presets), 'feedback_admin_reply', {
        pendingReplyUser: session.pendingReplyUser,
        pendingReplyEntryId: session.pendingReplyEntryId,
        pendingReplyReturn: session.pendingReplyReturn || 'feedback_admin',
        pendingDetailKind: session.pendingDetailKind,
        pendingDetailId: session.pendingDetailId,
        pendingAdminFilter: session.pendingAdminFilter,
        pendingAdminTitle: session.pendingAdminTitle,
        pendingAdminPage: session.pendingAdminPage,
        pendingAdminReturn: session.pendingAdminReturn
      });
    }
    if (trimmed === '2') {
      return sendFeedbackState(context, 'feedback_admin_reply_custom', buildReplyCustomPrompt(language), 'feedback_admin_reply', {
        pendingReplyUser: session.pendingReplyUser,
        pendingReplyEntryId: session.pendingReplyEntryId,
        pendingReplyReturn: session.pendingReplyReturn || 'feedback_admin',
        pendingDetailKind: session.pendingDetailKind,
        pendingDetailId: session.pendingDetailId,
        pendingAdminFilter: session.pendingAdminFilter,
        pendingAdminTitle: session.pendingAdminTitle,
        pendingAdminPage: session.pendingAdminPage,
        pendingAdminReturn: session.pendingAdminReturn
      });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return showReplyMethod(session.pendingReplyUser, session.pendingReplyEntryId, session.pendingReplyReturn);
  }

  async function confirmReply(text) {
    return sendFeedbackState(context, 'feedback_admin_reply_confirm', buildReplyConfirm(language, session.pendingReplyUser, text), 'feedback_admin_reply', {
      pendingReplyUser: session.pendingReplyUser,
      pendingReplyEntryId: session.pendingReplyEntryId,
      pendingReplyText: text,
      pendingReplyReturn: session.pendingReplyReturn || 'feedback_admin'
    });
  }

  if (menu === 'feedback_admin_reply_presets') {
    const presets = getPresetReplies();
    if (trimmed === '0') return showReplyMethod(session.pendingReplyUser, session.pendingReplyEntryId, session.pendingReplyReturn);
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n >= 1 && n <= presets.length) return confirmReply(presets[n - 1].text);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_admin_reply_presets', buildPresetList(language, presets), 'feedback_admin_reply', {
      pendingReplyUser: session.pendingReplyUser,
      pendingReplyEntryId: session.pendingReplyEntryId,
      pendingReplyReturn: session.pendingReplyReturn || 'feedback_admin'
    });
  }

  if (menu === 'feedback_admin_reply_custom') {
    if (trimmed === '0') return showReplyMethod(session.pendingReplyUser, session.pendingReplyEntryId, session.pendingReplyReturn);
    if (!trimmed) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_admin_reply_custom', buildReplyCustomPrompt(language), 'feedback_admin_reply', {
        pendingReplyUser: session.pendingReplyUser,
        pendingReplyEntryId: session.pendingReplyEntryId,
        pendingReplyReturn: session.pendingReplyReturn || 'feedback_admin'
      });
    }
    return confirmReply(trimmed);
  }

  if (menu === 'feedback_admin_reply_confirm') {
    if (trimmed === '1' && session.pendingReplyUser && session.pendingReplyText) {
      try {
        await sendText(context.sock, session.pendingReplyUser, session.pendingReplyText);
      } catch { /* user unreachable: still record */ }
      if (session.pendingReplyEntryId) addReply(session.pendingReplyEntryId, sender, session.pendingReplyText);
      try {
        logAdminAction(sender, 'feedback_reply', `${session.pendingReplyUser} ← ${session.pendingReplyText.slice(0, 80)}`);
      } catch { /* ignore */ }
      await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.replySent')));
      return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    }
    if (trimmed === '2' || trimmed === '0') {
      return showReplyMethod(session.pendingReplyUser, session.pendingReplyEntryId, session.pendingReplyReturn);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_admin_reply_confirm', buildReplyConfirm(language, session.pendingReplyUser, session.pendingReplyText || ''), 'feedback_admin_reply', {
      pendingReplyUser: session.pendingReplyUser,
      pendingReplyEntryId: session.pendingReplyEntryId,
      pendingReplyText: session.pendingReplyText,
      pendingReplyReturn: session.pendingReplyReturn || 'feedback_admin'
    });
  }

  if (menu === 'feedback_admin_presets') {
    switch (trimmed) {
      case '0':
        return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
      case '1':
        return sendFeedbackState(context, 'feedback_admin_preset_add', buildPresetAddPrompt(language), 'feedback_admin_presets');
      case '2': {
        const presets = getPresetReplies();
        return sendFeedbackState(context, 'feedback_admin_preset_list', buildPresetList(language, presets), 'feedback_admin_presets');
      }
      case '3': {
        const presets = getPresetReplies();
        return sendFeedbackState(context, 'feedback_admin_preset_delete', buildPresetDeletePrompt(language, presets), 'feedback_admin_presets');
      }
      default:
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        return sendFeedbackState(context, 'feedback_admin_presets', buildPresetsMenu(language), 'feedback_admin_presets');
    }
  }

  if (menu === 'feedback_admin_preset_list') {
    return sendFeedbackState(context, 'feedback_admin_presets', buildPresetsMenu(language), 'feedback_admin_presets');
  }

  if (menu === 'feedback_admin_preset_add') {
    if (trimmed === '0') {
      return sendFeedbackState(context, 'feedback_admin_presets', buildPresetsMenu(language), 'feedback_admin_presets');
    }
    if (!trimmed) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return sendFeedbackState(context, 'feedback_admin_preset_add', buildPresetAddPrompt(language), 'feedback_admin_presets');
    }
    return sendFeedbackState(context, 'feedback_admin_preset_confirm', buildReplyConfirm(language, sender, trimmed), 'feedback_admin_presets', { pendingPresetText: trimmed });
  }

  if (menu === 'feedback_admin_preset_confirm') {
    if (trimmed === '1' && session.pendingPresetText) {
      addPresetReply(session.pendingPresetText);
      await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.presetAdded')));
    }
    return sendFeedbackState(context, 'feedback_admin_presets', buildPresetsMenu(language), 'feedback_admin_presets');
  }

  if (menu === 'feedback_admin_preset_delete') {
    const presets = getPresetReplies();
    if (trimmed === '0') {
      return sendFeedbackState(context, 'feedback_admin_presets', buildPresetsMenu(language), 'feedback_admin_presets');
    }
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n >= 1 && n <= presets.length) {
        deletePresetReply(presets[n - 1].id);
        await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.presetDeleted')));
        return sendFeedbackState(context, 'feedback_admin_presets', buildPresetsMenu(language), 'feedback_admin_presets');
      }
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
    return sendFeedbackState(context, 'feedback_admin_preset_delete', buildPresetDeletePrompt(language, getPresetReplies()), 'feedback_admin_presets');
  }

  if (menu === 'feedback_admin_delete') {
    if (trimmed === '0') return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    if (!hasPermission(sender, 'feedback.manage')) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
      return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    }
    const found = deleteFeedback(trimmed);
    if (!found) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.adminNotFound')));
      return sendFeedbackState(context, 'feedback_admin_delete', buildAdminDeletePrompt(language), 'feedback_admin_delete');
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.adminDeleted', { kind: found.kind, id: found.entry.id })));
    return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
  }

  if (menu === 'feedback_admin_delete_all_confirm') {
    if (!hasPermission(sender, 'feedback.manage')) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
      return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    }
    if (trimmed === '1') {
      const count = deleteAllFeedback();
      await sendText(context.sock, sender, toSmallCaps(t(language, 'feedback.adminDeleteAllDone', { count })));
      return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
    }
    return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
  }

  return sendFeedbackAdmin(context, { language, transitionKey: 'feedback_admin' });
}

export const commands = [
  {
    name: 'feedback',
    description: 'Open the feedback menu',
    usage: '/feedback',
    adminOnly: false,
    groupAllowed: true,
    async execute(context) {
      try {
        return openFeedback(context);
      } catch (error) {
        await sendText(context.sock, context.sender, 'Failed to open feedback. Please try again.');
        throw error;
      }
    }
  },
  {
    name: 'feedback-ad',
    description: 'Manage user feedback (admin only)',
    usage: '/feedback-ad',
    aliases: ['feedbackad', 'feedbackadmin'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      try {
        if (!isAdmin(context.sender)) {
          const language = await languageOf(context.sender);
          return sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.notAuthorized')));
        }
        return sendFeedbackAdmin(context);
      } catch (error) {
        await sendText(context.sock, context.sender, 'Failed to open feedback management.');
        throw error;
      }
    }
  }
];
