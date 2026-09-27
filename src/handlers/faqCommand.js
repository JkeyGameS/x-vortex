import config, { isMenuMigrated } from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { sendMenuById } from '../utils/menuSender.js';
import { registerCardResolver, registerBodyResolver } from '../utils/menuResolvers.js';
import { sendText, sendError } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { askConfirmation } from '../utils/confirmationHelper.js';
import { addError } from '../services/errorLogService.js';
import { logAdminAction } from '../services/adminLogService.js';
import { getUserByJidSync } from '../services/userService.js';
import { normalize, splitSemicolons, replacePlaceholders } from '../utils/matchUtils.js';
import * as faqService from '../services/faqService.js';

function isAdmin(sender) {
  return (config.adminJids || []).includes(sender);
}

function resolveLanguage(sender) {
  try {
    const u = getUserByJidSync(sender) || {};
    return u.language || config.defaultLanguage;
  } catch {
    return config.defaultLanguage;
  }
}

function L(language, key, params = {}) {
  return toSmallCaps(t(language, key, params));
}

const LANGS = ['en', 'fr', 'de', 'es', 'ar'];
const LANGUAGE_OPTIONS = [
  ['languageEnglish', '1'],
  ['languageFrench', '2'],
  ['languageGerman', '3'],
  ['languageSpanish', '4'],
  ['languageArabic', '5'],
  ['languageAll', '6']
];

function languageMenu(language) {
  const lines = LANGUAGE_OPTIONS.map(([key, n]) => `${n}. ${t(language, 'faq.' + key)}`);
  lines.push('');
  lines.push('0. ' + t(language, 'faq.back'));
  return lines;
}

export function buildFaqPanel(language, resultLine = '') {
  return buildMenu(
    t(language, 'faq.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ' + t(language, 'faq.optionAdd'),
      '2. ' + t(language, 'faq.optionList'),
      '3. ✏️ ' + t(language, 'faq.optionEdit'),
      '4. 🗑️ ' + t(language, 'faq.optionDelete'),
      '5. 🔀 ' + t(language, 'faq.optionToggle'),
      '6. ' + t(language, 'faq.optionSearch'),
      '7. 🧪 ' + t(language, 'faq.optionTest'),
      '8. 📋 ' + t(language, 'faq.optionDuplicate'),
      '9. ✅ ' + t(language, 'faq.optionEnableAll'),
      '10. ❌ ' + t(language, 'faq.optionDisableAll'),
      '11. 🗂️ ' + t(language, 'faq.optionFilterCategory'),
      '',
      '0. ' + t(language, 'faq.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

const FAQ_LIST_PAGE_SIZE = 10;

async function showFaqList(context, page = 0) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const entries = filteredEntries(session);
  if (entries.length === 0) {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_submenu' });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildFaqPanel(language, L(language, 'faq.noEntries')), transitionKey: 'faq_submenu' });
  }
  const totalPages = Math.max(1, Math.ceil(entries.length / FAQ_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * FAQ_LIST_PAGE_SIZE;
  const visible = entries.slice(start, start + FAQ_LIST_PAGE_SIZE);
  const hits = await faqUsageMap();
  const filter = faqFilterOf(session);
  const head = filter !== 'all' ? [`${L(language, 'faq.filterCategory')}: ${filter}`, ''] : [];
  const lines = visible.map((e, i) => `${start + i + 1}. ${e.question.slice(0, 50)} (${hits[e.id] || 0} ${L(language, 'faq.usageMatches')})${((e.activeFrom || e.activeTo) ? ' 📆' : '') + (e.enabled ? '' : ' [' + L(language, 'common.offFlag') + ']')}`);
  if (start + FAQ_LIST_PAGE_SIZE < entries.length) lines.push('11. ' + t(language, 'faq.next') + ' ▶');
  if (safePage > 0) lines.push('12. ◀ ' + t(language, 'faq.previous'));
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_list', pendingData: { page: safePage } });
  const text = buildMenu(L(language, 'faq.listTitle'), '', [...head, ...lines, '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_list' });
}

export async function handleFaqList(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const page = session.pendingData?.page || 0;
  const entries = filteredEntries(session);
  const hasNext = (page + 1) * FAQ_LIST_PAGE_SIZE < entries.length;
  const hasPrev = page > 0;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqPanel(context);
  if (trimmed === '11' && hasNext) return showFaqList(context, page + 1);
  if (trimmed === '12' && hasPrev) return showFaqList(context, page - 1);
  await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 12 }));
  return showFaqList(context, page);
}

async function showFaqPicker(context, titleKey, targetMenu) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const entries = faqService.getAllEntries();
  if (entries.length === 0) {
    return sendText(context.sock, sender, L(language, 'faq.noEntries'));
  }
  const lines = entries.map((e, i) => `${i + 1}. ${e.question.slice(0, 60)}`);
  sessionManager.setState(sender, chatId, { currentMenu: targetMenu, pendingAction: null, pendingData: null });
  const text = buildMenu(L(language, titleKey), '', [...lines, '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: targetMenu });
}

async function pickFaqByNumber(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return { back: true };
  const entries = faqService.getAllEntries();
  const entry = entries[parseInt(trimmed, 10) - 1];
  if (!entry) {
    await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: entries.length }));
    return { back: true };
  }
  return { entry };
}

export async function handleFaqEditSelect(context, input) {
  const picked = await pickFaqByNumber(context, input);
  if (!picked || picked.back) return sendFaqPanel(context);
  return openEditFaq(context, picked.entry.id);
}

export async function handleFaqDeleteSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const picked = await pickFaqByNumber(context, input);
  if (!picked || picked.back) return sendFaqPanel(context);
  return askConfirmation({ sock: context.sock, sender, chatId }, 'deleteFaqEntry', { id: picked.entry.id, returnTo: 'faqDelete' });
}

export async function handleFaqToggleSelect(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqPanel(context);
  const entries = faqService.getAllEntries();
  const entry = entries[parseInt(trimmed, 10) - 1];
  if (!entry) {
    await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: entries.length }));
    return sendFaqPanel(context);
  }
  const nowEnabled = faqService.toggleEntry(entry.id);
  logAdminAction(sender, 'faq_toggle', (entry.id + ' → ' + (nowEnabled ? 'on' : 'off')));
  return sendFaqPanel(context, { resultLine: L(language, nowEnabled ? 'faq.toggledOn' : 'faq.toggledOff') });
}

function faqFilterOf(session) {
  return session?.faqFilterCategory || 'all';
}

function filteredEntries(session) {
  const filter = faqFilterOf(session);
  const entries = faqService.getAllEntries();
  if (!filter || filter === 'all') return entries;
  return entries.filter((e) => (e.category || '') === filter);
}

function faqCategories() {
  const set = new Set();
  for (const e of faqService.getAllEntries()) {
    if (e.category) set.add(e.category);
  }
  return [...set].sort();
}

async function faqUsageMap() {
  try {
    const { getFaqHits } = await import('../services/chatStatsService.js');
    return getFaqHits();
  } catch {
    return {};
  }
}

export async function sendFaqPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_submenu' });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildFaqPanel(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'faq_submenu'
  });
}

export async function handleFaqReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  switch (selectedNumber) {
    case '0':
      return sendText(context.sock, sender, L(language, 'faq.cancelled'));
    case '1':
      return startAddFaq(context);
    case '2':
      return showFaqList(context, 0);
    case '3':
      return showFaqPicker(context, 'faq.pickEdit', 'faq_edit_select');
    case '4':
      return showFaqPicker(context, 'faq.pickDelete', 'faq_delete_select');
    case '5':
      return showFaqPicker(context, 'faq.pickToggle', 'faq_toggle_select');
    case '6':
      sessionManager.setState(sender, context.chatId || sender, { currentMenu: 'faq_search_input' });
      return sendMenu({ sock: context.sock, sender, chatId: context.chatId || sender, text: toSmallCaps(t(language, 'faq.searchPrompt')), transitionKey: 'faq_search_input' });
    case '7':
      return showFaqTestSelect(context);
    case '8':
      return showFaqDuplicateSelect(context);
    case '9':
      return showFaqBulkConfirm(context, 'enable');
    case '10':
      return showFaqBulkConfirm(context, 'disable');
    case '11':
      return showFaqFilterCategory(context);
    default:
      return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 11 }));
  }
}

async function showFaqTestSelect(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const entries = faqService.getAllEntries();
  if (entries.length === 0) {
    return sendText(context.sock, sender, L(language, 'faq.noEntries'));
  }
  const lines = entries.map((e, i) => `${i + 1}. ${e.question.slice(0, 60)}`);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_test_select' });
  const text = buildMenu(L(language, 'faq.testSelect'), '', [...lines, '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_test_select' });
}

export async function handleFaqTestSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqPanel(context);
  const entries = faqService.getAllEntries();
  const entry = entries[parseInt(trimmed, 10) - 1];
  if (!entry) return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: entries.length }));
  logAdminAction(sender, 'faq_test', entry.id);
  const text = buildMenu('🧪 ' + L(language, 'faq.testResult'), '', [
    { static: toSmallCaps(t(language, 'faq.testInput')) + ': ', dynamic: `"${entry.question}"` },
    { static: toSmallCaps(t(language, 'faq.testMatched')) + ': ', dynamic: `📚 "${entry.question}"` },
    { static: toSmallCaps(t(language, 'faq.testReply')) + ': ', dynamic: `"${entry.answer}"` },
    '',
    '0. ' + L(language, 'faq.back')
  ]);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_test_result' });
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_test_result' });
}

export async function handleFaqTestResult(context, input) {
  if (String(input || '').trim() === '0') return sendFaqPanel(context);
  return showFaqTestSelect(context);
}

async function showFaqBulkConfirm(context, kind) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_bulk_confirm', pendingData: { kind } });
  const text = buildMenu(L(language, kind === 'enable' ? 'faq.bulkEnableAll' : 'faq.bulkDisableAll'), '', [
    '1. ' + L(language, 'admin.yes'),
    '2. ' + L(language, 'admin.no')
  ]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_bulk_confirm' });
}

export async function handleFaqBulkConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const kind = session.pendingData?.kind;
  if (input === '1' && (kind === 'enable' || kind === 'disable')) {
    const enable = kind === 'enable';
    let count = 0;
    for (const e of faqService.getAllEntries()) {
      if (faqService.updateEntry(e.id, { enabled: enable })) count++;
    }
    logAdminAction(sender, enable ? 'faq_enable_all' : 'faq_disable_all', String(count));
    return sendFaqPanel(context, { resultLine: L(language, 'faq.bulkDone') });
  }
  return sendFaqPanel(context);
}

async function showFaqFilterCategory(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const cats = faqCategories();
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_filter_category' });
  const lines = [`1. ${L(language, 'faq.filterAll')}`, ...cats.map((c, i) => `${i + 2}. ${c}`)];
  const text = buildMenu(L(language, 'faq.filterTitle'), '', [...lines, '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_filter_category' });
}

export async function handleFaqFilterCategory(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqPanel(context);
  const cats = faqCategories();
  if (trimmed === '1') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_submenu', faqFilterCategory: 'all' });
    return sendFaqPanel(context);
  }
  const cat = cats[parseInt(trimmed, 10) - 2];
  if (!cat) return showFaqFilterCategory(context);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_submenu', faqFilterCategory: cat });
  return sendFaqPanel(context);
}

async function showFaqDuplicateSelect(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const entries = faqService.getAllEntries();
  if (entries.length === 0) {
    return sendText(context.sock, sender, L(language, 'faq.noEntries'));
  }
  const lines = entries.map((e, i) => `${i + 1}. ${e.question.slice(0, 60)}`);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_duplicate_select' });
  const text = buildMenu(L(language, 'faq.duplicateSelect'), '', [...lines, '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_duplicate_select' });
}

export async function handleFaqDuplicateSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqPanel(context);
  const entries = faqService.getAllEntries();
  const entry = entries[parseInt(trimmed, 10) - 1];
  if (!entry) return showFaqDuplicateSelect(context);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_duplicate_language', pendingData: { entryId: entry.id } });
  const lines = LANGUAGE_OPTIONS.map(([key, n]) => `${n}. ${t(language, 'faq.' + key)}`);
  const text = buildMenu(L(language, 'faq.duplicateLang'), '', [...lines, '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_duplicate_language' });
}

export async function handleFaqDuplicateLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqPanel(context);
  const map = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' };
  if (!map[trimmed] || !session.pendingData?.entryId) return showFaqDuplicateSelect(context);
  const newId = faqService.duplicateFaq(session.pendingData.entryId, map[trimmed]);
  if (!newId) return sendText(context.sock, sender, L(language, 'faq.notFound'));
  logAdminAction(sender, 'faq_duplicate', `${session.pendingData.entryId} → ${newId} (${map[trimmed]})`);
  return sendFaqPanel(context, { resultLine: L(language, 'faq.duplicated') });
}

// ---------------------------------------------------------------------------
// Add-FAQ wizard
// ---------------------------------------------------------------------------

export function faqProgress(language, n) {
  return toSmallCaps(t(language, 'faq.progressStep', { n }));
}

export async function startAddFaq(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_question', faqDraft: { language: 'all', priority: 1, keywords: [], category: '' } });
  const text = buildMenu(faqProgress(language, 1), '', [toSmallCaps(t(language, 'faq.questionPrompt')), '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'faq_add_question' });
}

export async function handleFaqAddQuestion(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const q = String(input || '').trim();
  if (!q) return sendText(context.sock, sender, L(language, 'faq.emptyQuestion'));
  if (q.length > 200) {
    await sendText(context.sock, sender, L(language, 'faq.invalidQuestion'));
    return startAddFaq(context);
  }
  const dupe = faqService.findDuplicateEntry({ question: q, language: draft.language || 'all' });
  if (dupe) {
    await sendText(context.sock, sender, L(language, 'faq.duplicateWarning', { question: dupe.question.slice(0, 50) }));
  }
  draft.question = q;
  if (!draft.keywords || draft.keywords.length === 0) {
    draft.keywords = faqService.suggestKeywords(q);
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_answer', faqDraft: draft });
  const answerText = buildMenu(faqProgress(language, 2), '', [toSmallCaps(t(language, 'faq.answerPrompt')), toSmallCaps(t(language, 'faq.snippetHint')), '', '0. ' + L(language, 'faq.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text: answerText, transitionKey: 'faq_add_answer' });
}

export async function handleFaqAddAnswer(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const a = String(input || '').trim();
  if (!a) return sendText(context.sock, sender, L(language, 'faq.emptyAnswer'));
  if (a.toLowerCase() === 'draft' && draft.question) {
    const id = faqService.addEntry({
      question: draft.question,
      keywords: draft.keywords || [],
      answer: '',
      language: draft.language || 'all',
      category: draft.category || 'misc',
      priority: draft.priority || 1,
      status: 'draft',
      createdBy: sender
    });
    logAdminAction(sender, 'faq_draft_save', id);
    return sendFaqMainPanel(context, { resultLine: t(language, 'faq.draftSaved') });
  }
  if (a.length > 1000) {
    await sendText(context.sock, sender, L(language, 'faq.invalidAnswer'));
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.answerPrompt')), transitionKey: 'faq_add_answer' });
  }
  draft.answer = a;
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_keywords', faqDraft: draft });

  const lines = [
    faqProgress(language, 3),
    L(language, 'faq.keywordsAuto'),
    ...(draft.keywords.length ? draft.keywords.map((k, i) => `${i + 1}. ${k}`) : [L(language, 'faq.keywordsNone')]),
    '',
    '1. ' + t(language, 'faq.keywordsAccept'),
    '2. ' + t(language, 'faq.keywordsEdit'),
    '0. ' + t(language, 'faq.cancelled')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'faq.keywordsTitle'), '', lines), transitionKey: 'faq_add_keywords' });
}

export async function handleFaqAddKeywords(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};

  if (input === '1') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_category', faqDraft: draft });
    const catText = buildMenu(faqProgress(language, 4), '', [toSmallCaps(t(language, 'faq.categoryPrompt')), '', '0. ' + L(language, 'faq.back')]);
    return sendMenu({ sock: context.sock, sender, chatId, text: catText, transitionKey: 'faq_add_category' });
  }
  if (input === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_keywords_input', faqDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.keywordsPrompt')), transitionKey: 'faq_add_keywords' });
  }
  return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 2 }));
}

export async function handleFaqAddKeywordsInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const keywords = splitSemicolons(input).map((k) => normalize(k)).filter(Boolean);
  draft.keywords = keywords;
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_keywords', faqDraft: draft });

  const lines = [
    L(language, 'faq.keywordsAck'),
    ...(draft.keywords.length ? draft.keywords.map((k, i) => `${i + 1}. ${k}`) : [L(language, 'faq.keywordsNone')]),
    '',
    '1. ' + t(language, 'faq.keywordsAccept'),
    '2. ' + t(language, 'faq.keywordsEdit'),
    '0. ' + t(language, 'faq.cancelled')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'faq.keywordsTitle'), '', lines), transitionKey: 'faq_add_keywords' });
}

export async function handleFaqAddCategory(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  if (input !== '0') draft.category = String(input || '').trim();
  else draft.category = '';
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_language', faqDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(faqProgress(language, 5), '', [L(language, 'faq.languageTitle'), '', ...languageMenu(language), '', '0. ' + t(language, 'faq.cancelled')]), transitionKey: 'faq_add_language' });
}

export async function handleFaqAddLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const map = { '1': 'en', '2': 'fr', '3': 'de', '4': 'es', '5': 'ar', '6': 'all' };
  if (!map[input]) return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 6 }));
  draft.language = map[input];
  return showFaqResponsePreview(context, draft);
}

const FAQ_PREVIEW_USER = { username: 'John', name: 'John', jid: '123456789@lid', level: 7 };

async function previewResolvedAnswer(answer) {
  let expanded = String(answer || '');
  try {
    const { expandSnippets } = await import('../utils/snippetExpander.js');
    expanded = expandSnippets(expanded, 'en');
  } catch { /* preview must never break */ }
  return replacePlaceholders(expanded, FAQ_PREVIEW_USER, config);
}

async function buildFaqResponsePreview(language, draft) {
  const resolvedAnswer = await previewResolvedAnswer(draft.answer || '');
  return buildMenu('📖 ' + L(language, 'faq.previewResponseTitle'), '', [
    faqProgress(language, 6),
    { static: toSmallCaps(t(language, 'faq.previewQuestion')) + ': ', dynamic: `"${draft.question || ''}"` },
    { static: toSmallCaps(t(language, 'faq.previewAnswer')) + ': ', dynamic: `"${resolvedAnswer}"` },
    '',
    '1. ✅ ' + t(language, 'faq.previewConfirmSave'),
    '2. ✏️ ' + t(language, 'faq.previewEditAnswer'),
    '3. 🔙 ' + t(language, 'faq.previewBack'),
    '',
    '0. ' + t(language, 'faq.back')
  ]);
}

async function showFaqResponsePreview(context, draft) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_response_preview', faqDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: await buildFaqResponsePreview(language, draft), transitionKey: 'faq_response_preview' });
}

export async function handleFaqResponsePreview(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const trimmed = String(input || '').trim();

  if (trimmed === '1') {
    const id = faqService.addEntry({
      question: draft.question,
      keywords: draft.keywords,
      answer: draft.answer,
      language: draft.language,
      category: draft.category,
      priority: draft.priority || 1,
      enabled: true
    });
    logAdminAction(sender, 'faq_add', (id + ' · ' + draft.question));
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_another_lang', faqDraft: { ...draft, id } });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'faq.saved'), '', ['1. ' + t(language, 'faq.anotherLangYes'), '2. ' + t(language, 'faq.anotherLangNo')]), transitionKey: 'faq_add_another_lang' });
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_answer', faqDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.answerPrompt')), transitionKey: 'faq_add_answer' });
  }
  if (trimmed === '3' || trimmed === '0') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_language', faqDraft: draft });
    const lines = LANGUAGE_OPTIONS.map(([key, n]) => `${n}. ${t(language, 'faq.' + key)}`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'faq.languageTitle'), '', [...lines, '', '0. ' + t(language, 'faq.cancelled')]), transitionKey: 'faq_add_language' });
  }
  return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 3 }));
}

export async function handleFaqAddAnotherLang(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  if (input === '1') {
    const newDraft = { language: 'all', priority: draft.priority || 1, keywords: [], category: '' };
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_add_question', faqDraft: newDraft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.questionPrompt')), transitionKey: 'faq_add_question' });
  }
  return sendFaqPanel(context, { resultLine: L(language, 'faq.saved') });
}

export async function handleFaqSearchInput(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const results = faqService.searchEntries(input);
  if (results.length === 0) return sendText(context.sock, sender, L(language, 'faq.searchNone'));
  const lines = results.map((e) => '• ' + e.id + ' — ' + e.question);
  return sendText(context.sock, sender, buildMenu(L(language, 'faq.searchTitle'), '', lines));
}

export async function handleFaqImportInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  let data;
  try { data = JSON.parse(input); } catch { return sendText(context.sock, sender, L(language, 'faq.importInvalid')); }
  if (!Array.isArray(data)) return sendText(context.sock, sender, L(language, 'faq.importInvalid'));
  return askConfirmation({ sock: context.sock, sender, chatId }, 'importFaqEntries', { json: input, count: data.length, returnTo: 'faqSubmenu' });
}

export async function executeImportFaqEntries(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  let parsed;
  try { parsed = JSON.parse(data.json); } catch { return sendText(context.sock, sender, L(language, 'faq.importInvalid')); }
  faqService.importEntries(parsed);
  logAdminAction(sender, 'faq_import', ('imported ' + (parsed.length || 0) + ' entries'));
  await sendFaqPanel(context, { resultLine: L(language, 'faq.importDone') });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Edit / delete / toggle
// ---------------------------------------------------------------------------

export async function openEditFaq(context, id, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || resolveLanguage(sender);
  const entry = faqService.getEntry(id);
  if (!entry) return sendText(context.sock, sender, L(language, 'faq.notFound'));
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_edit_menu', faqEditId: id });
  const lines = [
    L(language, 'faq.question') + ': ' + entry.question,
    L(language, 'faq.answer') + ': ' + entry.answer,
    L(language, 'faq.keywordsTitle') + ': ' + (entry.keywords.length ? entry.keywords.join(', ') : L(language, 'faq.keywordsNone')),
    L(language, 'faq.category') + ': ' + (entry.category || L(language, 'faq.keywordsNone')),
    '',
    '1. ' + t(language, 'faq.editQuestion'),
    '2. ' + t(language, 'faq.editAnswer'),
    '3. ' + t(language, 'faq.editKeywords'),
    '4. ' + t(language, 'faq.editCategory'),
    '5. ' + t(language, 'faq.editLanguage'),
    '6. ' + t(language, 'faq.editPriority'),
    '7. ' + t(language, 'faq.editToggle'),
    '8. ' + L(language, 'faq.deleteConfirm'),
    '',
    '0. ' + t(language, 'faq.back')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'faq.editMenuTitle'), '', lines), transitionKey: 'faq_edit_menu' });
}

export async function handleFaqEditMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.faqEditId;
  if (!id) return sendFaqPanel(context);
  const entry = faqService.getEntry(id);
  if (!entry) return sendText(context.sock, sender, L(language, 'faq.notFound'));

  if (input === '0') return sendFaqPanel(context);
  if (input === '1') {
    const newId = faqService.addEntry({ ...entry, question: entry.question, keywords: [], id: undefined });
    faqService.deleteEntry(id);
    logAdminAction(sender, 'faq_edit', (newId + ' question'));
    return sendText(context.sock, sender, L(language, 'faq.saved'));
  }
  if (input === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_edit_answer', faqEditId: id });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.answerPrompt')), transitionKey: 'faq_edit_menu' });
  }
  if (input === '3') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_edit_keywords', faqEditId: id });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.keywordsPrompt')), transitionKey: 'faq_edit_menu' });
  }
  if (input === '4') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_edit_category', faqEditId: id });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.categoryPrompt')), transitionKey: 'faq_edit_menu' });
  }
  if (input === '5') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_edit_language', faqEditId: id });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'faq.languageTitle'), '', [...languageMenu(language), '', '0. ' + t(language, 'faq.back')]), transitionKey: 'faq_edit_menu' });
  }
  if (input === '6') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_edit_priority', faqEditId: id });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.priorityPrompt')), transitionKey: 'faq_edit_menu' });
  }
  if (input === '7') {
    const nowEnabled = faqService.toggleEntry(id);
    logAdminAction(sender, 'faq_toggle', (id + ' → ' + (nowEnabled ? 'on' : 'off')));
    return openEditFaq(context, id);
  }
  if (input === '8') {
    return askConfirmation({ sock: context.sock, sender, chatId }, 'deleteFaqEntry', { id, returnTo: 'faqEdit' });
  }
  return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 8 }));
}

export async function handleFaqEditAnswer(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.faqEditId;
  const a = String(input || '').trim();
  if (!a) return sendText(context.sock, sender, L(language, 'faq.emptyAnswer'));
  faqService.updateEntry(id, { answer: a });
  logAdminAction(sender, 'faq_edit', (id + ' answer updated'));
  return openEditFaq(context, id);
}

export async function handleFaqEditKeywords(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.faqEditId;
  const keywords = splitSemicolons(input).map((k) => normalize(k)).filter(Boolean);
  faqService.updateEntry(id, { keywords });
  logAdminAction(sender, 'faq_edit', (id + ' keywords updated'));
  return openEditFaq(context, id);
}

export async function handleFaqEditCategory(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.faqEditId;
  faqService.updateEntry(id, { category: input === '0' ? '' : String(input || '').trim() });
  logAdminAction(sender, 'faq_edit', (id + ' category updated'));
  return openEditFaq(context, id);
}

export async function handleFaqEditLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.faqEditId;
  const map = { '1': 'en', '2': 'fr', '3': 'de', '4': 'es', '5': 'ar', '6': 'all' };
  if (!map[input]) return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 6 }));
  faqService.updateEntry(id, { language: map[input] });
  logAdminAction(sender, 'faq_edit', (id + ' language=' + map[input]));
  return openEditFaq(context, id);
}

export async function handleFaqEditPriority(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.faqEditId;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > 10) return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 1, max: 10 }));
  faqService.updateEntry(id, { priority: n });
  logAdminAction(sender, 'faq_edit', (id + ' priority=' + n));
  return openEditFaq(context, id);
}

export async function executeDeleteFaqEntry(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  faqService.deleteEntry(data.id);
  logAdminAction(sender, 'faq_delete', data.id);
  await sendFaqPanel(context, { resultLine: L(language, 'faq.deleteDone') });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

function notAuthorized(sock, sender, language) {
  return sendText(sock, sender, toSmallCaps(t(language, 'admin.notAuthorized')));
}

export const commands = [
  {
    name: 'addfaq',
    description: 'Add a new FAQ entry (admin)',
    usage: '/add-faq',
    aliases: ['add-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      return startAddFaq(context);
    }
  },
  {
    name: 'listfaq',
    description: 'List all FAQ entries (admin)',
    usage: '/list-faq',
    aliases: ['list-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const entries = faqService.getAllEntries();
      if (entries.length === 0) return sendText(context.sock, sender, L(language, 'faq.noEntries'));
      const lines = entries.map((e) => '• ' + e.id + ' — ' + e.question + (e.enabled ? '' : ' [' + L(language, 'common.offFlag') + ']'));
      return sendText(context.sock, sender, buildMenu(L(language, 'faq.listTitle'), '', lines));
    }
  },
  {
    name: 'editfaq',
    description: 'Edit an FAQ entry (admin)',
    usage: '/edit-faq <id>',
    aliases: ['edit-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const id = context.args?.[0];
      if (!id) return sendText(context.sock, sender, L(language, 'faq.notFound'));
      return openEditFaq(context, id);
    }
  },
  {
    name: 'deletefaq',
    description: 'Delete an FAQ entry (admin)',
    usage: '/delete-faq <id>',
    aliases: ['delete-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const id = context.args?.[0];
      if (!id || !faqService.getEntry(id)) return sendText(context.sock, sender, L(language, 'faq.notFound'));
      return askConfirmation({ sock: context.sock, sender, chatId: context.chatId || sender }, 'deleteFaqEntry', { id, returnTo: 'faqDelete' });
    }
  },
  {
    name: 'togglefaq',
    description: 'Enable/disable an FAQ entry (admin)',
    usage: '/toggle-faq <id>',
    aliases: ['toggle-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const id = context.args?.[0];
      if (!id || !faqService.getEntry(id)) return sendText(context.sock, sender, L(language, 'faq.notFound'));
      const nowEnabled = faqService.toggleEntry(id);
      logAdminAction(sender, 'faq_toggle', (id + ' → ' + (nowEnabled ? 'on' : 'off')));
      return sendText(context.sock, sender, L(language, nowEnabled ? 'faq.toggledOn' : 'faq.toggledOff'));
    }
  },
  {
    name: 'searchfaq',
    description: 'Search FAQ entries (admin)',
    usage: '/search-faq <keyword>',
    aliases: ['search-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const kw = context.args?.join(' ');
      if (!kw) {
        sessionManager.setState(sender, context.chatId || sender, { currentMenu: 'faq_search_input' });
        return sendMenu({ sock: context.sock, sender, chatId: context.chatId || sender, text: toSmallCaps(t(language, 'faq.searchPrompt')), transitionKey: 'faq_search_input' });
      }
      const results = faqService.searchEntries(kw);
      if (results.length === 0) return sendText(context.sock, sender, L(language, 'faq.searchNone'));
      const lines = results.map((e) => '• ' + e.id + ' — ' + e.question);
      return sendText(context.sock, sender, buildMenu(L(language, 'faq.searchTitle'), '', lines));
    }
  },
  {
    name: 'importfaq',
    description: 'Import FAQ JSON (admin)',
    usage: '/import-faq',
    aliases: ['import-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      sessionManager.setState(sender, context.chatId || sender, { currentMenu: 'faq_import_input' });
      return sendMenu({ sock: context.sock, sender, chatId: context.chatId || sender, text: toSmallCaps(t(language, 'faq.importPrompt')), transitionKey: 'faq_import_input' });
    }
  },
  {
    name: 'exportfaq',
    description: 'Export FAQ JSON (admin)',
    usage: '/export-faq',
    aliases: ['export-faq'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const entries = faqService.exportEntries();
      if (entries.length === 0) return sendText(context.sock, sender, L(language, 'faq.exportEmpty'));
      return sendText(context.sock, sender, buildMenu(L(language, 'faq.exportTitle'), '', [JSON.stringify(entries, null, 2)]));
    }
  }
];

// ---------------------------------------------------------------------------
// New FAQ Knowledge Base menu tree (faq_main and submenus)
// ---------------------------------------------------------------------------

function faqPlace(context, opts = {}) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  return {
    returnTo: opts.returnTo || session.pendingData?.returnTo || null,
    view: opts.view || session.pendingData?.view || null,
    viewLang: opts.viewLang || session.pendingData?.viewLang || null,
    viewCategory: opts.viewCategory || session.pendingData?.viewCategory || null
  };
}

registerCardResolver('faqStatsBody', async (user, language) => {
  const entries = faqService.getAllEntries();
  const hits = await faqUsageMap();
  const top = [...entries].sort((a, b) => (hits[b.id] || 0) - (hits[a.id] || 0)).slice(0, 5);
  return [
    { static: `📚 ${toSmallCaps(t(language, 'faq.statsTotal'))}: `, dynamic: String(entries.length) },
    { static: `📊 ${toSmallCaps(t(language, 'faq.statsTotalHits'))}: `, dynamic: String(Object.values(hits).reduce((a, b) => a + (Number(b) || 0), 0)) },
    '',
    '🔝 ' + toSmallCaps(t(language, 'faq.statsTop')) + ':',
    ...top.map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${e.question.slice(0, 45)}" – ${hits[e.id] || 0}` })),
    ''
  ];
});

registerBodyResolver('faqSearchBody', async (user, language) => [
  toSmallCaps(t(language, 'faq.searchPrompt')),
  '',
  '0. ' + L(language, 'faq.back')
]);

async function sendNewFaqPanel(context, menuId, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = getUserByJidSync(sender);
  const language = opts.language || resolveLanguage(sender);
  const sessionMenu = { faq: 'faq_main', faq_add: 'faq_add', faq_view: 'faq_view', faq_manage: 'faq_manage', faq_import_export: 'faq_import_export', faq_stats: 'faq_stats', faq_search: 'faq_search' }[menuId] || menuId;
  sessionManager.setState(sender, chatId, { currentMenu: sessionMenu, pendingAction: null, pendingData: null });
  const transitionKey = opts.transitionKey || menuId;
  await sendMenuById(menuId, { sock: context.sock, sender, chatId, user, language }, transitionKey, { sessionMenu });
}

export async function sendFaqMainPanel(context, opts = {}) {
  return sendNewFaqPanel(context, 'faq', opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_main', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(
      '📚 ' + toSmallCaps(t(language, 'faq.mainTitle')),
      '',
      [
        ...(opts.resultLine ? [toSmallCaps(opts.resultLine), ''] : []),
        '1. ➕ ' + t(language, 'faq.mainAdd'),
        '2. 📋 ' + t(language, 'faq.mainView'),
        '3. ✏️ ' + t(language, 'faq.mainManage'),
        '4. 🔍 ' + t(language, 'faq.mainSearch'),
        '5. 📦 ' + t(language, 'faq.mainImportExport'),
        '6. 📊 ' + t(language, 'faq.mainStats'),
        '',
        '0. ' + t(language, 'faq.back'),
        '',
        t(language, 'admin.replyPrompt')
      ]
    ),
    transitionKey: opts.transitionKey || 'faq_main'
  });
}

export async function handleFaqMain(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  switch (String(selectedNumber)) {
    case '0': {
      const { sendChatFaqMenu } = await import('./adminCommand.js');
      return sendChatFaqMenu(context);
    }
    case '1':
      return showFaqAddMenu(context);
    case '2':
      return showFaqViewMenu(context);
    case '3':
      return showFaqManageMenu(context);
    case '4':
      return showFaqSearchPrompt(context);
    case '5':
      return showFaqImportExportMenu(context);
    case '6':
      return showFaqStatsPanel(context);
    default:
      return sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 6 }));
  }
}

export async function showFaqAddMenu(context, opts = {}) {
  if (isMenuMigrated('faq_add')) return sendNewFaqPanel(context, 'faq_add', opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_add', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(
      '➕ ' + toSmallCaps(t(language, 'faq.addMenuTitle')),
      '',
      [
        '1. ⚡ ' + t(language, 'faq.addQuick'),
        '2. ⚙️ ' + t(language, 'faq.addAdvanced'),
        '3. 📚 ' + t(language, 'faq.addTemplate'),
        '4. 📦 ' + t(language, 'faq.addBulk'),
        '5. 📥 ' + t(language, 'faq.addFromUnmatched'),
        '6. 📋 ' + t(language, 'faq.addDuplicate'),
        '7. 📝 ' + t(language, 'faq.addResumeDraft'),
        '8. 🎨 ' + t(language, 'faq.addFromExample'),
        '9. 🌐 ' + t(language, 'faq.addMultilang'),
        '',
        '0. ' + t(language, 'faq.back'),
        '',
        t(language, 'admin.replyPrompt')
      ]
    ),
    transitionKey: opts.transitionKey || 'faq_add'
  });
}

export async function handleFaqAddMenu(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  switch (trimmed) {
    case '0':
      return sendFaqMainPanel(context);
    case '1':
      return startFaqQuickAdd(context);
    case '2':
      return startAddFaq(context);
    case '3':
      return showFaqTemplateLibrary(context, { returnTo: 'faq_add' });
    case '4':
      return showFaqBulkAdd(context);
    case '5':
      return showFaqFromUnmatched(context);
    case '6':
      return showFaqPicker(context, 'faq.pickDuplicate', 'faq_duplicate_select');
    case '7':
      return showFaqDraftsList(context);
    case '8':
      return showFaqCreateFromExample(context);
    case '9':
      return showFaqMultilangAdd(context);
    default:
      await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 9 }));
      return showFaqAddMenu(context);
  }
}

export async function showFaqViewMenu(context, opts = {}) {
  if (isMenuMigrated('faq_view')) return sendNewFaqPanel(context, 'faq_view', opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_view', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(
      '📋 ' + toSmallCaps(t(language, 'faq.viewMenuTitle')),
      '',
      [
        '1. 📋 ' + t(language, 'faq.viewAll'),
        '2. 🔤 ' + t(language, 'faq.viewByLang'),
        '3. 🗂️ ' + t(language, 'faq.viewByCategory'),
        '4. 🔛 ' + t(language, 'faq.viewEnabled'),
        '5. ❌ ' + t(language, 'faq.viewDisabled'),
        '6. 📝 ' + t(language, 'faq.viewDrafts'),
        '7. 🕒 ' + t(language, 'faq.viewRecent'),
        '8. ⭐ ' + t(language, 'faq.viewFavorites'),
        '',
        '0. ' + t(language, 'faq.back'),
        '',
        t(language, 'admin.replyPrompt')
      ]
    ),
    transitionKey: opts.transitionKey || 'faq_view'
  });
}

export async function handleFaqViewMenu(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  switch (trimmed) {
    case '0':
      return sendFaqMainPanel(context);
    case '1':
      return showFaqViewList(context, { view: 'all', page: 0 });
    case '2':
      return showFaqViewByLang(context);
    case '3':
      return showFaqViewByCategory(context);
    case '4':
      return showFaqViewList(context, { view: 'enabled', page: 0 });
    case '5':
      return showFaqViewList(context, { view: 'disabled', page: 0 });
    case '6':
      return showFaqViewList(context, { view: 'drafts', page: 0 });
    case '7':
      return showFaqViewList(context, { view: 'recent', page: 0 });
    case '8':
      return showFaqViewList(context, { view: 'favorites', page: 0 });
    default:
      await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 8 }));
      return showFaqViewMenu(context);
  }
}

export async function showFaqManageMenu(context, opts = {}) {
  return sendNewFaqPanel(context, 'faq_manage', opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_manage', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(
      '✏️ ' + toSmallCaps(t(language, 'faq.manageMenuTitle')),
      '',
      [
        ...(opts.resultLine ? [toSmallCaps(opts.resultLine), ''] : []),
        '1. ✏️ ' + t(language, 'faq.manageEdit'),
        '2. 🗑️ ' + t(language, 'faq.manageDelete'),
        '3. 🔛 ' + t(language, 'faq.manageToggle'),
        '4. 📋 ' + t(language, 'faq.manageDuplicate'),
        '5. ✅ ' + t(language, 'faq.manageEnableAll'),
        '6. ❌ ' + t(language, 'faq.manageDisableAll'),
        '7. 🔀 ' + t(language, 'faq.manageBulkToggle'),
        '',
        '0. ' + t(language, 'faq.back'),
        '',
        t(language, 'admin.replyPrompt')
      ]
    ),
    transitionKey: opts.transitionKey || 'faq_manage'
  });
}

export async function handleFaqManageMenu(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  switch (trimmed) {
    case '0':
      return sendFaqMainPanel(context);
    case '1':
      return showFaqPicker(context, 'faq.pickEdit', 'faq_edit_select');
    case '2':
      return showFaqPicker(context, 'faq.pickDelete', 'faq_delete_select');
    case '3':
      return showFaqPicker(context, 'faq.pickToggle', 'faq_toggle_select');
    case '4':
      return showFaqPicker(context, 'faq.pickDuplicate', 'faq_duplicate_select');
    case '5':
      return showFaqBulkConfirm(context, 'enable');
    case '6':
      return showFaqBulkConfirm(context, 'disable');
    case '7':
      return showFaqBulkToggleMenu(context, 'lang');
    default:
      await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 7 }));
      return showFaqManageMenu(context);
  }
}

const FAQ_VIEW_PAGE_SIZE = 10;

function faqViewEntries(view, viewLang, viewCategory) {
  let list = faqService.getAllEntries();
  switch (view) {
    case 'enabled':
      return list.filter((e) => e.enabled && e.status !== 'draft');
    case 'disabled':
      return list.filter((e) => !e.enabled || e.status === 'disabled');
    case 'drafts':
      return list.filter((e) => e.status === 'draft');
    case 'favorites':
      return list.filter((e) => e.favorite === true);
    case 'recent':
      return [...list].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    case 'lang':
      return list.filter((e) => (e.language || 'all') === (viewLang || 'all'));
    case 'category':
      return list.filter((e) => (e.category || '') === (viewCategory || ''));
    default:
      return list;
  }
}

function faqEntryMarkers(language, e, hits) {
  const marks = [];
  if (e.status === 'draft') marks.push('📝');
  else if (!e.enabled) marks.push('[' + t(language, 'common.offFlag') + ']');
  if (e.favorite) marks.push('⭐');
  if (hits[e.id] > 0) marks.push(`(${hits[e.id]})`);
  return marks.length ? ' ' + marks.join(' ') : '';
}

export async function showFaqViewList(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const view = opts.view || session.pendingData?.view || 'all';
  const viewLang = opts.viewLang || session.pendingData?.viewLang || null;
  const viewCategory = opts.viewCategory || session.pendingData?.viewCategory || null;
  const entries = faqViewEntries(view, viewLang, viewCategory);
  if (!entries.length) {
    await sendText(context.sock, sender, L(language, 'faq.noEntries'));
    return showFaqViewMenu(context);
  }
  const page = opts.page ?? session.pendingData?.page ?? 0;
  const totalPages = Math.max(1, Math.ceil(entries.length / FAQ_VIEW_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const visible = entries.slice(safePage * FAQ_VIEW_PAGE_SIZE, safePage * FAQ_VIEW_PAGE_SIZE + FAQ_VIEW_PAGE_SIZE);
  const hits = await faqUsageMap();
  const lines = visible.map((e, i) => ({
    static: `${safePage * FAQ_VIEW_PAGE_SIZE + i + 1}. `,
    dynamic: `${e.question.slice(0, 45)} – ${String(e.answer || '').slice(0, 30)}${faqEntryMarkers(language, e, hits)}`
  }));
  if ((safePage + 1) * FAQ_VIEW_PAGE_SIZE < entries.length) lines.push('11. ' + t(language, 'faq.next') + ' ▶');
  if (safePage > 0) lines.push('12. ◀ ' + t(language, 'faq.previous'));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'faq_view_list',
    pendingAction: null,
    pendingData: { view, viewLang, viewCategory, page: safePage, ids: entries.map((e) => e.id) }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📋 ' + toSmallCaps(t(language, 'faq.viewListTitle')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_view_list'
  });
}

export async function handleFaqViewList(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const ids = session.pendingData?.ids || [];
  const page = session.pendingData?.page || 0;
  const hasNext = (page + 1) * FAQ_VIEW_PAGE_SIZE < ids.length;
  const hasPrev = page > 0;
  if (trimmed === '0') return showFaqViewMenu(context);
  if (trimmed === '11' && hasNext) return showFaqViewList(context, { page: page + 1 });
  if (trimmed === '12' && hasPrev) return showFaqViewList(context, { page: page - 1 });
  const id = ids[parseInt(trimmed, 10) - 1];
  if (!id) {
    await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: ids.length }));
    return showFaqViewList(context, {});
  }
  return showFaqDetail(context, { id });
}

export async function showFaqViewByLang(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_view_by_lang', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(L(language, 'faq.languageTitle'), '', [...languageMenu(language), '', '0. ' + t(language, 'faq.back')]),
    transitionKey: 'faq_view_by_lang'
  });
}

export async function handleFaqViewByLang(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqViewMenu(context);
  const map = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' };
  if (!map[trimmed]) {
    await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: 6 }));
    return showFaqViewByLang(context);
  }
  return showFaqViewList(context, { view: 'lang', viewLang: map[trimmed], page: 0 });
}

export async function showFaqViewByCategory(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const cats = faqService.getFaqCategories();
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_view_by_category', pendingAction: null, pendingData: { catIds: cats.map((c) => c.id) } });
  const lines = cats.map((c, i) => `${i + 1}. ${c.emoji} ${toSmallCaps(t(language, c.nameKey))}`);
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🗂️ ' + toSmallCaps(t(language, 'faq.viewByCategory')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_view_by_category'
  });
}

export async function handleFaqViewByCategory(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqViewMenu(context);
  const id = (session.pendingData?.catIds || [])[parseInt(trimmed, 10) - 1];
  if (!id) {
    await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: (session.pendingData?.catIds || []).length }));
    return showFaqViewByCategory(context);
  }
  return showFaqViewList(context, { view: 'category', viewCategory: id, page: 0 });
}

export async function showFaqDetail(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = opts.id || session.pendingData?.detailId;
  const entry = id ? faqService.getEntry(id) : null;
  if (!entry) return sendText(context.sock, sender, L(language, 'faq.notFound'));
  const hits = await faqUsageMap();
  let confidenceLines = [];
  try {
    const { getEntryKeywordStats } = await import('../services/faqKeywordStatsService.js');
    const kstats = getEntryKeywordStats(id);
    const used = Object.entries(kstats).filter(([, v]) => v.attempts > 0);
    if (used.length) {
      confidenceLines.push('🎯 ' + toSmallCaps(t(language, 'faq.keywordConfidence')) + ':');
      for (const [kw, v] of used.slice(0, 5)) {
        const flag = v.confidence !== null && v.confidence < 50 && v.attempts >= 20 ? ' ⚠️' : '';
        confidenceLines.push({ static: '', dynamic: `"${kw}" → ${v.confidence ?? '–'}% (${v.hits}/${v.attempts})${flag}` });
      }
      confidenceLines.push('');
    }
  } catch { /* confidence must never break detail view */ }
  const statusLabel = entry.status === 'draft' ? '📝' : (entry.enabled ? t(language, 'faq.statusEnabled') : t(language, 'faq.statusDisabled'));
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_detail', pendingAction: null, pendingData: { detailId: id } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📄 ' + toSmallCaps(t(language, 'faq.detailTitle')), '', [
      { static: '🆔 ' + toSmallCaps(t(language, 'faq.detailId')) + ': ', dynamic: entry.id },
      { static: '🔤 ' + toSmallCaps(t(language, 'faq.detailLanguage')) + ': ', dynamic: entry.language || 'all' },
      { static: '🗂️ ' + toSmallCaps(t(language, 'faq.detailCategory')) + ': ', dynamic: entry.category || '–' },
      { static: '❓ ' + toSmallCaps(t(language, 'faq.detailQuestion')) + ': ', dynamic: entry.question },
      { static: '💬 ' + toSmallCaps(t(language, 'faq.detailAnswer')) + ': ', dynamic: String(entry.answer || '').slice(0, 300) },
      { static: '🔑 ' + toSmallCaps(t(language, 'faq.detailKeywords')) + ': ', dynamic: (entry.keywords || []).join(', ') || '–' },
      { static: '⚡ ' + toSmallCaps(t(language, 'faq.detailPriority')) + ': ', dynamic: String(entry.priority || 1) },
      { static: '🔛 ' + toSmallCaps(t(language, 'faq.detailStatus')) + ': ', dynamic: statusLabel },
      { static: '📊 ' + toSmallCaps(t(language, 'faq.detailMatches')) + ': ', dynamic: String(hits[id] || 0) },
      '',
      ...confidenceLines,
      '1. ✏️ ' + t(language, 'faq.detailEdit'),
      '2. 🔛 ' + t(language, 'faq.detailToggle'),
      '3. 📋 ' + t(language, 'faq.detailDuplicate'),
      '4. ⭐ ' + t(language, 'faq.detailFavorite'),
      '5. 🗑️ ' + t(language, 'faq.detailDelete'),
      '6. 🧪 ' + t(language, 'faq.detailTest'),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: 'faq_detail'
  });
}

export async function handleFaqDetail(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const id = session.pendingData?.detailId;
  if (trimmed === '0' || !id) return showFaqViewMenu(context);
  const entry = faqService.getEntry(id);
  if (!entry) return sendText(context.sock, sender, L(language, 'faq.notFound'));
  switch (trimmed) {
    case '1':
      return openEditFaq(context, id);
    case '2': {
      const on = faqService.toggleEntry(id);
      logAdminAction(sender, 'faq_toggle', `${id} → ${on ? 'on' : 'off'}`);
      return showFaqDetail(context, { id });
    }
    case '3': {
      const newId = faqService.duplicateFaq(id, entry.language);
      logAdminAction(sender, 'faq_duplicate', `${id} → ${newId}`);
      return showFaqManageMenu(context, { resultLine: t(language, 'faq.duplicated') });
    }
    case '4': {
      faqService.updateEntry(id, { favorite: !entry.favorite });
      logAdminAction(sender, 'faq_favorite', `${id} → ${!entry.favorite ? 'fav' : 'unfav'}`);
      return showFaqDetail(context, { id });
    }
    case '5':
      return askConfirmation({ sock: context.sock, sender, chatId }, 'deleteFaqEntry', { id, returnTo: 'faqDetail' });
    case '6': {
      const { matchFaq } = faqService;
      const res = matchFaq(entry.question, entry.language || 'all');
      const ok = res && !res.multiple && res.entry.id === id;
      await sendText(context.sock, sender, ok
        ? `✅ "${entry.question.slice(0, 60)}" → "${String(entry.answer || '').slice(0, 80)}"`
        : L(language, 'faq.testNoMatch'));
      return showFaqDetail(context, { id });
    }
    default:
      return showFaqDetail(context, { id });
  }
}

async function faqBulkToggleTargets(kind) {
  const rules = faqService.getAllEntries().filter((e) => e.status !== 'draft');
  if (kind === 'lang') {
    return ['en', 'fr', 'de', 'es', 'ar', 'all']
      .map((code) => ({ code, label: code, count: rules.filter((e) => (e.language || 'all') === code).length }))
      .filter((x) => x.count > 0);
  }
  if (kind === 'category') {
    const cats = faqService.getFaqCategories();
    return cats
      .map((c) => ({ code: c.id, label: `${c.emoji} ${c.id}`, count: rules.filter((e) => (e.category || '') === c.id).length }))
      .filter((x) => x.count > 0);
  }
  const byPack = new Map();
  for (const e of rules) {
    if (!e.packId) continue;
    byPack.set(e.packId, (byPack.get(e.packId) || 0) + 1);
  }
  const { getFaqPack } = await import('../services/faqTemplateService.js');
  return [...byPack.entries()].map(([code, count]) => {
    const pack = getFaqPack(code);
    return { code, label: `${pack?.emoji || '📦'} ${pack?.name || code}`, count };
  });
}

export async function showFaqBulkToggleMenu(context, kind) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const targets = await faqBulkToggleTargets(kind || 'lang');
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_bulk_toggle', pendingAction: null, pendingData: { kind: kind || 'lang', step: 'select', targets } });
  const kindLabel = kind === 'category' ? t(language, 'faq.bulkToggleByCategory') : kind === 'pack' ? t(language, 'faq.bulkToggleByPack') : t(language, 'faq.bulkToggleByLanguage');
  const lines = targets.length
    ? targets.map((x, i) => ({ static: `${i + 1}. `, dynamic: `${x.label} (${x.count})` }))
    : [toSmallCaps(t(language, 'faq.bulkToggleNone'))];
  lines.push(
    '',
    '7. ✅ ' + toSmallCaps(t(language, 'faq.bulkToggleByLanguage')),
    '8. 🗂️ ' + toSmallCaps(t(language, 'faq.bulkToggleByCategory')),
    '9. 📦 ' + toSmallCaps(t(language, 'faq.bulkToggleByPack')),
    '',
    '0. ' + L(language, 'faq.back')
  );
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔀 ' + toSmallCaps(t(language, 'faq.manageBulkToggle')), '', [toSmallCaps(kindLabel), '', ...lines]),
    transitionKey: 'faq_bulk_toggle'
  });
}

export async function handleFaqBulkToggleMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0') {
    if (pd.step === 'confirm') return showFaqBulkToggleMenu(context, pd.kind);
    return showFaqManageMenu(context);
  }
  if (pd.step === 'select') {
    if (trimmed === '7') return showFaqBulkToggleMenu(context, 'lang');
    if (trimmed === '8') return showFaqBulkToggleMenu(context, 'category');
    if (trimmed === '9') return showFaqBulkToggleMenu(context, 'pack');
    const picked = (pd.targets || [])[parseInt(trimmed, 10) - 1];
    if (!picked) return showFaqBulkToggleMenu(context, pd.kind);
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_bulk_toggle', pendingAction: null, pendingData: { ...pd, step: 'confirm', filter: picked } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(toSmallCaps(t(language, 'faq.bulkToggleConfirm', { count: picked.count, filter: picked.label })), '', [
        '1. ✅ ' + t(language, 'faq.manageEnableAll'),
        '2. ❌ ' + t(language, 'faq.manageDisableAll'),
        '',
        '0. ' + L(language, 'faq.back')
      ]),
      transitionKey: 'faq_bulk_toggle'
    });
  }
  const enable = trimmed === '1';
  if (trimmed !== '1' && trimmed !== '2') return showFaqBulkToggleMenu(context, pd.kind);
  const { getFaqPack } = await import('../services/faqTemplateService.js');
  const match = (e) => {
    if (e.status === 'draft') return false;
    if (pd.kind === 'lang') return (e.language || 'all') === pd.filter.code;
    if (!e.packId) return false;
    if (pd.kind === 'pack') return e.packId === pd.filter.code;
    return getFaqPack(e.packId)?.category === pd.filter.code;
  };
  try {
    const { saveFaqSnapshot } = await import('../services/snapshotService.js');
    saveFaqSnapshot(`faq-bulk-toggle:${pd.kind}:${pd.filter.code}`);
  } catch { /* snapshots must never break bulk ops */ }
  let count = 0;
  for (const e of faqService.getAllEntries()) {
    if (match(e) && faqService.updateEntry(e.id, { enabled: enable })) count++;
  }
  logAdminAction(sender, 'faq_bulk_toggle', `${pd.kind}:${pd.filter.code} ${enable ? 'enable' : 'disable'} → ${count}`);
  return showFaqManageMenu(context, { resultLine: t(language, 'faq.bulkDone') });
}

export async function showFaqStatsPanel(context, opts = {}) {
  return sendNewFaqPanel(context, 'faq_stats', opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const entries = faqService.getAllEntries();
  const hits = await faqUsageMap();
  const totalHits = Object.values(hits).reduce((a, b) => a + (Number(b) || 0), 0);
  const top = [...entries].sort((a, b) => (hits[b.id] || 0) - (hits[a.id] || 0)).slice(0, 5);
  const byCategory = new Map();
  for (const e of entries) {
    const c = e.category || 'misc';
    byCategory.set(c, (byCategory.get(c) || 0) + 1);
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_stats', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '📊 ' + toSmallCaps(t(language, 'faq.statsTitle')),
      '',
      [
        ...(opts.resultLine ? [toSmallCaps(opts.resultLine), ''] : []),
        { static: '📚 ' + toSmallCaps(t(language, 'faq.statsTotal')) + ': ', dynamic: String(entries.length) },
        { static: '📊 ' + toSmallCaps(t(language, 'faq.statsTotalHits')) + ': ', dynamic: String(totalHits) },
        '',
        '🔝 ' + toSmallCaps(t(language, 'faq.statsTop')) + ':',
        ...top.map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${e.question.slice(0, 45)}" – ${hits[e.id] || 0}` })),
        '',
        '1. 📈 ' + toSmallCaps(t(language, 'faq.statsPerformance')),
        '',
        '0. ' + L(language, 'faq.back')
      ]
    ),
    transitionKey: opts.transitionKey || 'faq_stats'
  });
}

export async function handleFaqStatsPanel(context, input) {
  const trimmed = String(input || '').trim();
  if (trimmed === '1') return showFaqPerformanceDashboard(context);
  return sendFaqMainPanel(context);
}

export async function showFaqPerformanceDashboard(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const entries = faqService.getAllEntries();
  const hits = await faqUsageMap();
  const totalHits = Object.values(hits).reduce((a, b) => a + (Number(b) || 0), 0);
  const top = [...entries].sort((a, b) => (hits[b.id] || 0) - (hits[a.id] || 0)).slice(0, 5);
  const unused = entries.filter((e) => !(hits[e.id] > 0));
  const byCategory = new Map();
  for (const e of entries) {
    const c = e.category || 'misc';
    byCategory.set(c, (byCategory.get(c) || 0) + 1);
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_performance_dashboard', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      '📈 ' + toSmallCaps(t(language, 'faq.perfTitle')),
      '',
      [
        { static: '🔝 ' + toSmallCaps(t(language, 'faq.perfTop')) + ': ', dynamic: '' },
        ...top.map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${e.question.slice(0, 45)}" – ${hits[e.id] || 0}` })),
        '',
        { static: '💤 ' + toSmallCaps(t(language, 'faq.perfUnused')) + ': ', dynamic: String(unused.length) },
        ...unused.slice(0, 5).map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${e.question.slice(0, 45)}"` })),
        '',
        { static: '🗂️ ' + toSmallCaps(t(language, 'faq.perfByCategory')) + ': ', dynamic: '' },
        ...[...byCategory.entries()].map(([c, n]) => ({ static: '', dynamic: `${c}: ${n}` })),
        '',
        { static: '📊 ' + toSmallCaps(t(language, 'faq.statsTotalHits')) + ': ', dynamic: String(totalHits) },
        '',
        '0. ' + L(language, 'faq.back')
      ]
    ),
    transitionKey: opts.transitionKey || 'faq_performance_dashboard'
  });
}

export async function showFaqSearchPrompt(context, opts = {}) {
  if (isMenuMigrated('faq_search')) return sendNewFaqPanel(context, 'faq_search', opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_search', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔍 ' + toSmallCaps(t(language, 'faq.searchMenuTitle')), '', [toSmallCaps(t(language, 'faq.searchPrompt')), '', '0. ' + L(language, 'faq.back')]),
    transitionKey: opts.transitionKey || 'faq_search'
  });
}

export async function handleFaqSearchPrompt(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqMainPanel(context);
  if (!trimmed) return showFaqSearchPrompt(context);
  return showFaqSearchResults(context, { query: trimmed, page: 0 });
}

const FAQ_SEARCH_PAGE_SIZE = 8;

export async function showFaqSearchResults(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const query = opts.query ?? session.pendingData?.query ?? '';
  const results = faqService.searchEntries(query);
  const page = opts.page ?? session.pendingData?.page ?? 0;
  const totalPages = Math.max(1, Math.ceil(results.length / FAQ_SEARCH_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const visible = results.slice(safePage * FAQ_SEARCH_PAGE_SIZE, safePage * FAQ_SEARCH_PAGE_SIZE + FAQ_SEARCH_PAGE_SIZE);
  const lines = visible.map((e, i) => ({
    static: `${safePage * FAQ_SEARCH_PAGE_SIZE + i + 1}. `,
    dynamic: `"${e.question.slice(0, 50)}" (${(e.keywords || []).slice(0, 3).join(', ')})`
  }));
  if (!results.length) lines.push(toSmallCaps(t(language, 'faq.searchNone')));
  if ((safePage + 1) * FAQ_SEARCH_PAGE_SIZE < results.length) lines.push(`${results.length + 1}. ` + t(language, 'faq.next') + ' ▶');
  if (safePage > 0) lines.push(`${results.length + 2}. ◀ ` + t(language, 'faq.previous'));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'faq_search_results',
    pendingAction: null,
    pendingData: { query, page: safePage, ids: results.map((e) => e.id) }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔍 ' + toSmallCaps(t(language, 'faq.searchMenuTitle')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_search_results'
  });
}

export async function handleFaqSearchResults(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const ids = session.pendingData?.ids || [];
  const page = session.pendingData?.page || 0;
  if (trimmed === '0') return showFaqSearchPrompt(context);
  if (trimmed === String(ids.length + 1) && (page + 1) * FAQ_SEARCH_PAGE_SIZE < ids.length) {
    return showFaqSearchResults(context, { page: page + 1 });
  }
  if (trimmed === String(ids.length + 2) && page > 0) {
    return showFaqSearchResults(context, { page: page - 1 });
  }
  const id = ids[parseInt(trimmed, 10) - 1];
  if (!id) {
    await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 0, max: ids.length }));
    return showFaqSearchResults(context, {});
  }
  return showFaqDetail(context, { id });
}

export async function showFaqTestQuestion(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_test_question', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧪 ' + toSmallCaps(t(language, 'faq.testQuestionTitle')), '', [toSmallCaps(t(language, 'faq.testQuestionPrompt')), '', '0. ' + L(language, 'faq.back')]),
    transitionKey: opts.transitionKey || 'faq_test_question'
  });
}

export async function handleFaqTestQuestion(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqMainPanel(context);
  if (!trimmed) return showFaqTestQuestion(context);
  const res = faqService.matchFaq(trimmed, resolveLanguage(sender));
  const entry = res && !res.multiple ? res.entry : res?.candidates?.[0] || null;
  logAdminAction(sender, 'faq_test_question', trimmed.slice(0, 60));
  if (!entry) {
    await sendText(context.sock, sender, L(language, 'faq.testNoMatch'));
    return showFaqTestQuestion(context);
  }
  const lines = [
    { static: toSmallCaps(t(language, 'faq.testInput')) + ': ', dynamic: `"${trimmed}"` },
    { static: toSmallCaps(t(language, 'faq.testMatched')) + ': ', dynamic: `📚 "${entry.question}"` },
    { static: '🔑 ', dynamic: (res.matchedKeywords || entry.keywords || []).join(', ') || '–' },
    { static: toSmallCaps(t(language, 'faq.testReply')) + ': ', dynamic: `"${String(entry.answer || '').slice(0, 200)}"` },
    '',
    '0. ' + L(language, 'faq.back')
  ];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧪 ' + toSmallCaps(t(language, 'faq.testQuestionTitle')), '', lines),
    transitionKey: 'faq_test_question'
  });
}

export async function showFaqImportExportMenu(context, opts = {}) {
  if (isMenuMigrated('faq_import_export')) return sendNewFaqPanel(context, 'faq_import_export', opts);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_import_export', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(
      '📦 ' + toSmallCaps(t(language, 'faq.ieMenuTitle')),
      '',
      [
        ...(opts.resultLine ? [toSmallCaps(opts.resultLine), ''] : []),
        '1. 📤 ' + t(language, 'faq.ieExportJson'),
        '2. 📥 ' + t(language, 'faq.ieImportJson'),
        '3. 📥 ' + t(language, 'faq.ieImportCsv'),
        '4. 💾 ' + t(language, 'faq.ieSnapshots'),
        '',
        '0. ' + t(language, 'faq.back'),
        '',
        t(language, 'admin.replyPrompt')
      ]
    ),
    transitionKey: opts.transitionKey || 'faq_import_export'
  });
}

export async function handleFaqImportExportMenu(context, input, documentContent = null) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const awaiting = session.pendingData?.awaiting;
  if (awaiting === 'json' || awaiting === 'csv') {
    const content = documentContent || String(input || '').trim();
    if (content === '0' && !documentContent) return showFaqImportExportMenu(context);
    return handleFaqImportContent(context, content, awaiting);
  }
  const trimmed = String(input || '').trim();
  switch (trimmed) {
    case '0':
      return sendFaqMainPanel(context);
    case '1': {
      const entries = faqService.exportEntries();
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
      await context.sock.sendMessage(chatId, {
        document: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2), 'utf8'),
        mimetype: 'application/json',
        fileName: `faq-export-${stamp}.json`,
        caption: toSmallCaps(t(language, 'faq.ieExported'))
      });
      logAdminAction(sender, 'faq_export', `${entries.length} entries`);
      return showFaqImportExportMenu(context);
    }
    case '2':
    case '3': {
      const kind = trimmed === '2' ? 'json' : 'csv';
      sessionManager.setState(sender, chatId, { currentMenu: 'faq_import_export', pendingAction: null, pendingData: { awaiting: kind } });
      return sendMenu({
        sock: context.sock, sender, chatId,
        text: buildMenu('📥 ' + toSmallCaps(t(language, kind === 'json' ? 'faq.ieImportJson' : 'faq.ieImportCsv')), '', [toSmallCaps(t(language, 'faq.ieImportPrompt')), '', '0. ' + L(language, 'faq.back')]),
        transitionKey: 'faq_import_export'
      });
    }
    case '4':
      return showFaqSnapshots(context);
    default:
      return showFaqImportExportMenu(context);
  }
}

function parseFaqCsv(text) {
  const rows = [];
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    if (cols.length < 2 || !cols[0] || !cols[1]) continue;
    rows.push({
      question: cols[0].slice(0, 200),
      answer: cols[1].slice(0, 1000),
      keywords: (cols[2] || '').split(/[;|]/).map((k) => k.trim().toLowerCase()).filter(Boolean),
      category: (cols[3] || '').trim(),
      language: ['en', 'fr', 'de', 'es', 'ar', 'all'].includes((cols[4] || '').trim()) ? cols[4].trim() : 'en'
    });
  }
  return rows;
}

export async function handleFaqImportContent(context, content, kind) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  let rows = [];
  if (kind === 'csv') {
    rows = parseFaqCsv(content);
  } else {
    try {
      const parsed = JSON.parse(String(content || ''));
      const arr = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(arr)) throw new Error('bad shape');
      rows = arr;
    } catch {
      await sendText(context.sock, sender, L(language, 'faq.importInvalid'));
      return showFaqImportExportMenu(context);
    }
  }
  if (!rows.length) {
    await sendText(context.sock, sender, L(language, 'faq.importInvalid'));
    return showFaqImportExportMenu(context);
  }
  try {
    const { saveFaqSnapshot } = await import('../services/snapshotService.js');
    saveFaqSnapshot('faq-import');
  } catch { /* snapshots must never break imports */ }
  let added = 0;
  for (const raw of rows) {
    if (!raw.question || !raw.answer) continue;
    const dupe = faqService.findDuplicateEntry({ question: raw.question, language: raw.language || 'en' });
    if (dupe) continue;
    faqService.addEntry({
      question: String(raw.question).slice(0, 200),
      answer: String(raw.answer).slice(0, 1000),
      keywords: raw.keywords || faqService.suggestKeywords(raw.question),
      category: raw.category || '',
      language: raw.language || 'en',
      priority: raw.priority || 1,
      enabled: true,
      createdBy: sender
    });
    added++;
  }
  logAdminAction(sender, 'faq_import', `${kind} → ${added}/${rows.length}`);
  return showFaqImportExportMenu(context, { resultLine: t(language, 'faq.importDoneCount', { count: added }) });
}

export async function showFaqSnapshots(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const confirmFile = opts.confirmFile || session.pendingData?.confirmFile || null;
  const { listFaqSnapshots } = await import('../services/snapshotService.js');
  if (confirmFile) {
    const snap = listFaqSnapshots().find((s) => s.file === confirmFile);
    if (!snap) return showFaqSnapshots(context, {});
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_snapshot_restore', pendingAction: null, pendingData: { confirmFile } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('💾 ' + toSmallCaps(t(language, 'faq.snapshotsTitle')), '', [
        { static: '', dynamic: `${snap.file} (${snap.count ?? '?'} ${t(language, 'faq.snapshotEntries')})` },
        toSmallCaps(t(language, 'faq.snapshotRestoreConfirm')),
        '',
        '1. ✅ ' + L(language, 'admin.yes'),
        '2. ❌ ' + L(language, 'admin.no'),
        '',
        '0. ' + L(language, 'faq.back')
      ]),
      transitionKey: 'faq_snapshot_restore'
    });
  }
  const snaps = listFaqSnapshots();
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_snapshots', pendingAction: null, pendingData: { files: snaps.map((s) => s.file) } });
  const lines = snaps.length
    ? snaps.map((s, i) => ({ static: `${i + 1}. `, dynamic: `${s.file} (${s.count ?? '?'} ${t(language, 'faq.snapshotEntries')})` }))
    : [toSmallCaps(t(language, 'faq.noSnapshots'))];
  lines.push('', '0. ' + L(language, 'faq.back'));
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('💾 ' + toSmallCaps(t(language, 'faq.snapshotsTitle')), '', lines),
    transitionKey: 'faq_snapshots'
  });
}

export async function handleFaqSnapshots(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const confirmFile = session.pendingData?.confirmFile || null;
  if (trimmed === '0') {
    if (confirmFile) return showFaqSnapshots(context, {});
    return showFaqImportExportMenu(context);
  }
  const { restoreFaqSnapshot } = await import('../services/snapshotService.js');
  if (confirmFile) {
    if (trimmed === '1') {
      const res = await restoreFaqSnapshot(confirmFile);
      logAdminAction(sender, 'faq_snapshot_restore', `${confirmFile} → ok=${res.ok} count=${res.count}`);
      return showFaqImportExportMenu(context, {
        resultLine: res.ok ? t(language, 'faq.snapshotRestored', { count: res.count }) : t(language, 'faq.snapshotRestoreFailed')
      });
    }
    return showFaqSnapshots(context, {});
  }
  const files = session.pendingData?.files || [];
  const file = files[parseInt(trimmed, 10) - 1];
  if (!file) return showFaqSnapshots(context, {});
  return showFaqSnapshots(context, { confirmFile: file });
}

export async function showFaqCleanupSuggestions(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { generateFaqCleanupSuggestions } = await import('../services/faqCleanupService.js');
  const { groups } = await generateFaqCleanupSuggestions();
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_cleanup_suggestions', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧹 ' + toSmallCaps(t(language, 'faq.cleanupTitle')), '', [
      '1. 💤 ' + toSmallCaps(t(language, 'faq.cleanupUnused', { count: groups.unused.length })),
      '2. 📋 ' + toSmallCaps(t(language, 'faq.cleanupDuplicates', { count: groups.duplicates.length })),
      '3. 🗂️ ' + toSmallCaps(t(language, 'faq.cleanupOrphaned', { count: groups.orphaned.length })),
      '4. 🔗 ' + toSmallCaps(t(language, 'faq.cleanupSimilar', { count: groups.similar.length })),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: 'faq_cleanup_suggestions'
  });
}

function faqCleanupItems(groups, group) {
  if (group === 'duplicates' || group === 'similar') {
    return groups[group].map((ids, i) => ({ key: `${group}:${i}`, ids, label: ids.join(', ').slice(0, 60) }));
  }
  return (groups[group] || []).map((id) => ({ key: `entry:${id}`, ids: [id], label: id }));
}

export async function showFaqCleanupGroup(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const group = opts.group || session.pendingData?.group;
  const selected = opts.selected !== undefined ? opts.selected : session.pendingData?.selected || null;
  const { getFaqCleanupSuggestions } = await import('../services/faqCleanupService.js');
  const stored = getFaqCleanupSuggestions();
  if (!stored || !group) return showFaqCleanupSuggestions(context);
  const items = faqCleanupItems(stored.groups, group);
  if (selected) {
    const item = items.find((x) => x.key === selected);
    if (!item) return showFaqCleanupGroup(context, { group });
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_cleanup_group', pendingAction: null, pendingData: { group, selected, ids: item.ids } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🧹 ' + toSmallCaps(t(language, 'faq.cleanupTitle')), '', [
        { static: '', dynamic: item.label },
        '',
        '1. 🔛 ' + toSmallCaps(t(language, 'faq.cleanupDisable')),
        '2. 🗑️ ' + toSmallCaps(t(language, 'faq.cleanupDelete')),
        ...(group === 'similar' ? ['3. 🔗 ' + toSmallCaps(t(language, 'faq.cleanupMerge'))] : []),
        '',
        '0. ' + L(language, 'faq.back')
      ]),
      transitionKey: 'faq_cleanup_group'
    });
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_cleanup_group', pendingAction: null, pendingData: { group, selected: null, items } });
  const lines = items.length
    ? items.map((x, i) => ({ static: `${i + 1}. `, dynamic: x.label }))
    : [toSmallCaps(t(language, 'faq.cleanupGroupEmpty'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧹 ' + toSmallCaps(t(language, 'faq.cleanupTitle')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_cleanup_group'
  });
}

export async function handleFaqCleanupSuggestions(context, input) {
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqMainPanel(context);
  const map = { 1: 'unused', 2: 'duplicates', 3: 'orphaned', 4: 'similar' };
  if (!map[trimmed]) return showFaqCleanupSuggestions(context);
  return showFaqCleanupGroup(context, { group: map[trimmed] });
}

export async function handleFaqCleanupGroup(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0') {
    if (pd.selected) return showFaqCleanupGroup(context, { group: pd.group });
    return showFaqCleanupSuggestions(context);
  }
  if (pd.selected) {
    const ids = pd.ids || [];
    if (trimmed === '1') {
      for (const id of ids) faqService.updateEntry(id, { enabled: false });
      logAdminAction(sender, 'faq_cleanup_disable', `${pd.group}: ${ids.length}`);
    } else if (trimmed === '2') {
      try {
        const { saveFaqSnapshot } = await import('../services/snapshotService.js');
        saveFaqSnapshot('faq-cleanup-delete');
      } catch { /* snapshots must never break cleanup */ }
      for (const id of ids) faqService.deleteEntry(id);
      logAdminAction(sender, 'faq_cleanup_delete', `${pd.group}: ${ids.length}`);
    } else if (trimmed === '3' && pd.group === 'similar') {
      try {
        const { saveFaqSnapshot } = await import('../services/snapshotService.js');
        saveFaqSnapshot('faq-cleanup-merge');
      } catch { /* snapshots must never break cleanup */ }
      const [keep, ...rest] = ids;
      for (const id of rest) faqService.deleteEntry(id);
      logAdminAction(sender, 'faq_cleanup_merge', `keep=${keep} removed=${rest.length}`);
    } else {
      return showFaqCleanupGroup(context, { group: pd.group, selected: pd.selected });
    }
    return showFaqCleanupSuggestions(context);
  }
  const items = pd.items || [];
  const item = items[parseInt(trimmed, 10) - 1];
  if (!item) return showFaqCleanupGroup(context, { group: pd.group });
  return showFaqCleanupGroup(context, { group: pd.group, selected: item.key });
}

export async function startFaqQuickAdd(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || resolveLanguage(sender);
  const preset = opts.preset || {};
  const draft = { question: preset.question || '', keywords: [], answer: '', language: 'en', priority: 1, category: 'misc', history: [] };
  if (draft.question) {
    draft.keywords = faqService.suggestKeywords(draft.question);
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add_keywords', faqDraft: draft });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(L(language, 'faq.keywordsTitle'), '', [
        { static: '', dynamic: `"${draft.question}"` },
        toSmallCaps(t(language, 'faq.keywordsAuto')),
        ...(draft.keywords.length ? draft.keywords.map((k, i) => `${i + 1}. ${k}`) : [L(language, 'faq.keywordsNone')]),
        '',
        '1. ✅ ' + t(language, 'faq.keywordsAccept'),
        '2. ✏️ ' + t(language, 'faq.keywordsEdit'),
        '',
        '0. ' + L(language, 'faq.back')
      ]),
      transitionKey: 'faq_quick_add_keywords'
    });
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add', faqDraft: draft });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('⚡ ' + toSmallCaps(t(language, 'faq.quickTitle')), '', [toSmallCaps(t(language, 'faq.questionPrompt')), '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_quick_add'
  });
}

export async function startFaqFromUnmatched(context, text) {
  return startFaqQuickAdd(context, { preset: { question: String(text || '').slice(0, 200) } });
}

export async function handleFaqQuickAdd(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') {
    if (draft.question) return showFaqExitConfirm(context);
    return showFaqAddMenu(context);
  }
  if (trimmed.toLowerCase() === 'back' && draft.history?.length) {
    return showFaqAddMenu(context);
  }
  if (!trimmed || trimmed.length > 200) {
    await sendText(context.sock, sender, L(language, 'faq.invalidQuestion'));
    return startFaqQuickAdd(context);
  }
  const dupe = faqService.findDuplicateEntry({ question: trimmed, language: 'en' });
  draft.history = [...(draft.history || []), 'question'];
  draft.question = trimmed;
  draft.keywords = faqService.suggestKeywords(trimmed);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add_keywords', faqDraft: draft });
  const lines = [
    ...(dupe ? [toSmallCaps(t(language, 'faq.duplicateWarning', { question: dupe.question.slice(0, 50) })), ''] : []),
    toSmallCaps(t(language, 'faq.keywordsAuto')),
    ...(draft.keywords.length ? draft.keywords.map((k, i) => `${i + 1}. ${k}`) : [L(language, 'faq.keywordsNone')]),
    '',
    '1. ✅ ' + t(language, 'faq.keywordsAccept'),
    '2. ✏️ ' + t(language, 'faq.keywordsEdit'),
    '',
    '0. ' + L(language, 'faq.back')
  ];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(L(language, 'faq.keywordsTitle'), '', lines),
    transitionKey: 'faq_quick_add_keywords'
  });
}

export async function handleFaqQuickAddKeywords(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqExitConfirm(context);
  if (trimmed === '1') {
    draft.history = [...(draft.history || []), 'keywords'];
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add_answer', faqDraft: draft });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(toSmallCaps(t(language, 'faq.answerPrompt')), '', [toSmallCaps(t(language, 'faq.snippetHint')), '', '0. ' + L(language, 'faq.back')]),
      transitionKey: 'faq_quick_add_answer'
    });
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add_keywords_input', faqDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.keywordsPrompt')), transitionKey: 'faq_quick_add_keywords_input' });
  }
  return handleFaqQuickAdd(context, input);
}

export async function handleFaqQuickAddKeywordsInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const keywords = splitSemicolons(input).map((k) => normalize(k)).filter(Boolean);
  if (!keywords.length) return handleFaqQuickAddKeywords(context, '2');
  draft.keywords = keywords;
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add_keywords', faqDraft: draft });
  return handleFaqQuickAddKeywords(context, '1');
}

export async function handleFaqQuickAddAnswer(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.faqDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqExitConfirm(context);
  if (trimmed.toLowerCase() === 'draft' && draft.question) {
    const id = faqService.addEntry({
      question: draft.question,
      keywords: draft.keywords || [],
      answer: trimmed.length > 5 ? trimmed : '',
      language: 'en',
      category: 'misc',
      priority: 1,
      status: 'draft',
      createdBy: sender
    });
    logAdminAction(sender, 'faq_draft_save', id);
    return showFaqAddMenu(context, {});
  }
  if (!trimmed || trimmed.length > 1000) {
    await sendText(context.sock, sender, L(language, 'faq.invalidAnswer'));
    return handleFaqQuickAddKeywords(context, '1');
  }
  draft.answer = trimmed;
  const id = faqService.addEntry({
    question: draft.question,
    keywords: draft.keywords || [],
    answer: draft.answer,
    language: 'en',
    category: 'misc',
    priority: 1,
    enabled: true,
    createdBy: sender
  });
  logAdminAction(sender, 'faq_add', `${id} · ${draft.question}`);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add_done', pendingAction: null, pendingData: { id } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('✅ ' + toSmallCaps(t(language, 'faq.savedMessage')), '', [
      '1. ➕ ' + toSmallCaps(t(language, 'faq.postAddAnother')),
      '2. 🧪 ' + toSmallCaps(t(language, 'faq.postTest')),
      '3. 📄 ' + toSmallCaps(t(language, 'faq.postView')),
      '4. ⭐ ' + toSmallCaps(t(language, 'faq.postFavorite')),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: 'faq_quick_add_done'
  });
}

export async function handleFaqQuickAddDone(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const id = session.pendingData?.id;
  switch (trimmed) {
    case '0':
      return showFaqAddMenu(context);
    case '1':
      return startFaqQuickAdd(context);
    case '2':
      if (id) {
        const entry = faqService.getEntry(id);
        if (entry) {
          const res = faqService.matchFaq(entry.question, entry.language || 'all');
          await sendText(context.sock, sender, res && !res.multiple && res.entry.id === id
            ? `✅ "${entry.question.slice(0, 60)}"`
            : L(language, 'faq.testNoMatch'));
        }
      }
      return showFaqAddMenu(context);
    case '3':
      if (id) return showFaqDetail(context, { id });
      return showFaqAddMenu(context);
    case '4':
      if (id) {
        faqService.updateEntry(id, { favorite: true });
        logAdminAction(sender, 'faq_favorite', `${id} → fav`);
      }
      return showFaqAddMenu(context);
    default:
      return showFaqAddMenu(context);
  }
}

export async function showFaqExitConfirm(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_exit_confirm', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(toSmallCaps(t(language, 'faq.exitTitle')), '', [
      '1. 💾 ' + toSmallCaps(t(language, 'faq.exitSaveDraft')),
      '2. 🗑️ ' + toSmallCaps(t(language, 'faq.exitDiscard')),
      '3. ↩️ ' + toSmallCaps(t(language, 'faq.exitBack')),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: opts.transitionKey || 'faq_exit_confirm'
  });
}

export async function handleFaqExitConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const draft = session.faqDraft || {};
  if (trimmed === '1' && draft.question) {
    const id = faqService.addEntry({
      question: draft.question,
      keywords: draft.keywords || [],
      answer: draft.answer || '',
      language: draft.language || 'en',
      category: draft.category || 'misc',
      priority: draft.priority || 1,
      status: 'draft',
      createdBy: sender
    });
    logAdminAction(sender, 'faq_draft_save', id);
    return showFaqAddMenu(context);
  }
  if (trimmed === '3' && draft.question) {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_quick_add_answer', faqDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(resolveLanguage(sender), 'faq.answerPrompt')), transitionKey: 'faq_quick_add_answer' });
  }
  return showFaqAddMenu(context);
}

export async function showFaqBulkAdd(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_bulk_add', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📦 ' + toSmallCaps(t(language, 'faq.bulkTitle')), '', [
      toSmallCaps(t(language, 'faq.bulkFormat')),
      '',
      { static: '', dynamic: 'How do I start? = Just say hi! ; start ; begin ; misc' },
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: opts.transitionKey || 'faq_bulk_add'
  });
}

export async function handleFaqBulkAdd(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqAddMenu(context);
  const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
  let added = 0;
  let skipped = 0;
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq < 0) {
      skipped++;
      continue;
    }
    const question = line.slice(0, eq).trim().slice(0, 200);
    const parts = line.slice(eq + 1).split(';').map((s) => s.trim()).filter(Boolean);
    if (!question || !parts.length) {
      skipped++;
      continue;
    }
    const answer = parts[0].slice(0, 1000);
    const rest = parts.slice(1);
    const category = rest.length && !rest[rest.length - 1].includes(' ') ? rest.pop() : '';
    const keywords = rest.length ? rest : faqService.suggestKeywords(question);
    if (faqService.findDuplicateEntry({ question, language: 'en' })) {
      skipped++;
      continue;
    }
    faqService.addEntry({ question, answer, keywords, category: category || 'misc', language: 'en', priority: 1, enabled: true, createdBy: sender });
    added++;
  }
  try {
    const { saveFaqSnapshot } = await import('../services/snapshotService.js');
    saveFaqSnapshot('faq-bulk-add');
  } catch { /* snapshots must never break bulk ops */ }
  logAdminAction(sender, 'faq_bulk_add', `added=${added} skipped=${skipped}`);
  return showFaqAddMenu(context, {});
}

export async function showFaqFromUnmatched(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getUnmatched } = await import('../services/unmatchedService.js');
  const entries = getUnmatched().slice(0, 15);
  if (!entries.length) {
    await sendText(context.sock, sender, L(language, 'chatResponses.unmatchedEmpty'));
    return showFaqAddMenu(context);
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_from_unmatched', pendingAction: null, pendingData: { ids: entries.map((e) => e.id) } });
  const lines = entries.map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${e.text.slice(0, 50)}"` }));
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📥 ' + toSmallCaps(t(language, 'faq.fromUnmatchedTitle')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: opts.transitionKey || 'faq_from_unmatched'
  });
}

export async function handleFaqFromUnmatched(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqAddMenu(context);
  const { getUnmatched } = await import('../services/unmatchedService.js');
  const entries = getUnmatched();
  const ids = session.pendingData?.ids || [];
  const entry = entries.find((e) => e.id === ids[parseInt(trimmed, 10) - 1]);
  if (!entry) return showFaqFromUnmatched(context);
  return startFaqFromUnmatched(context, entry.text);
}

export async function showFaqDraftsList(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const drafts = faqService.getAllEntries().filter((e) => e.status === 'draft');
  if (!drafts.length) {
    await sendText(context.sock, sender, L(language, 'faq.noDrafts'));
    return showFaqAddMenu(context);
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_resume_draft', pendingAction: null, pendingData: { ids: drafts.map((e) => e.id) } });
  const lines = drafts.map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${e.question.slice(0, 50)}"` }));
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📝 ' + toSmallCaps(t(language, 'faq.draftsTitle')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: opts.transitionKey || 'faq_resume_draft'
  });
}

export async function handleFaqDraftsList(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqAddMenu(context);
  const ids = session.pendingData?.ids || [];
  const id = ids[parseInt(trimmed, 10) - 1];
  if (!id || !faqService.getEntry(id)) return showFaqDraftsList(context);
  faqService.updateEntry(id, { status: 'active', enabled: true });
  return openEditFaq(context, id);
}

export async function showFaqCreateFromExample(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_create_from_example', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🎨 ' + toSmallCaps(t(language, 'faq.exampleTitle')), '', [toSmallCaps(t(language, 'faq.examplePrompt')), '', '0. ' + L(language, 'faq.back')]),
    transitionKey: opts.transitionKey || 'faq_create_from_example'
  });
}

export async function handleFaqCreateFromExample(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqAddMenu(context);
  if (!trimmed) return showFaqCreateFromExample(context);
  const draft = { question: trimmed.slice(0, 200), keywords: faqService.suggestKeywords(trimmed), answer: '', language: 'en', priority: 1, category: 'misc' };
  sessionManager.setState(sender, context.chatId || sender, { currentMenu: 'faq_quick_add_answer', faqDraft: draft });
  return sendMenu({
    sock: context.sock, sender, chatId: context.chatId || sender,
    text: buildMenu(toSmallCaps(t(language, 'faq.answerPrompt')), '', [
      { static: '', dynamic: `"${draft.question}"` },
      toSmallCaps(t(language, 'faq.keywordsAuto') + ': ' + draft.keywords.join(', ')),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: 'faq_quick_add_answer'
  });
}

export async function showFaqMultilangAdd(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_multilang_add', pendingAction: null, pendingData: { step: 'qa' } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🌐 ' + toSmallCaps(t(language, 'faq.multilangTitle')), '', [toSmallCaps(t(language, 'faq.multilangQaPrompt')), '', '0. ' + L(language, 'faq.back')]),
    transitionKey: opts.transitionKey || 'faq_multilang_add'
  });
}

export async function handleFaqMultilangAdd(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0') return showFaqAddMenu(context);
  if (pd.step === 'qa') {
    const eq = trimmed.indexOf('=');
    const question = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).trim().slice(0, 200);
    const answer = (eq >= 0 ? trimmed.slice(eq + 1) : '').trim().slice(0, 1000);
    if (!question) return showFaqMultilangAdd(context);
    sessionManager.setState(sender, chatId, {
      currentMenu: 'faq_multilang_add',
      pendingAction: null,
      pendingData: { step: 'langs', question, answer: answer || null, keywords: faqService.suggestKeywords(question) }
    });
    const lines = LANGUAGE_OPTIONS.map(([key, n]) => `${n}. ${t(language, 'faq.' + key)}`);
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🌐 ' + toSmallCaps(t(language, 'faq.multilangLangsPrompt')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
      transitionKey: 'faq_multilang_add'
    });
  }
  if (pd.step === 'answer') {
    if (!trimmed) return showFaqMultilangAdd(context);
    const answer = trimmed.slice(0, 1000);
    let added = 0;
    for (const code of pd.codes || []) {
      if (faqService.findDuplicateEntry({ question: pd.question, language: code })) continue;
      faqService.addEntry({ question: pd.question, answer, keywords: pd.keywords || [], language: code, category: 'misc', priority: 1, enabled: true, createdBy: sender });
      added++;
    }
    logAdminAction(sender, 'faq_multilang_add', `${pd.question.slice(0, 40)} → ${added} lang(s)`);
    return showFaqAddMenu(context, {});
  }
  const codes = [...new Set(trimmed.split(',').map((s) => s.trim()))]
    .map((n) => ({ 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar' })[n])
    .filter(Boolean);
  if (!codes.length) {
    await sendText(context.sock, sender, L(language, 'faq.invalidNumber', { min: 1, max: 5 }));
    const lines = LANGUAGE_OPTIONS.map(([key, n]) => `${n}. ${t(language, 'faq.' + key)}`);
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_multilang_add', pendingAction: null, pendingData: { ...pd, step: 'langs' } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🌐 ' + toSmallCaps(t(language, 'faq.multilangLangsPrompt')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
      transitionKey: 'faq_multilang_add'
    });
  }
  if (!pd.answer) {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_multilang_add', pendingAction: null, pendingData: { ...pd, step: 'answer', codes } });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'faq.answerPrompt')), transitionKey: 'faq_multilang_add' });
  }
  let added = 0;
  for (const code of codes) {
    if (faqService.findDuplicateEntry({ question: pd.question, language: code })) continue;
    faqService.addEntry({ question: pd.question, answer: pd.answer, keywords: pd.keywords || [], language: code, category: 'misc', priority: 1, enabled: true, createdBy: sender });
    added++;
  }
  logAdminAction(sender, 'faq_multilang_add', `${pd.question.slice(0, 40)} → ${added} lang(s)`);
  return showFaqAddMenu(context, {});
}

function faqPackLabel(language, pack) {
  const name = pack.name || t(language, pack.nameKey);
  return `${pack.emoji} ${toSmallCaps(name)}`;
}

function faqCategoryLabel(language, cat) {
  return `${cat.emoji} ${toSmallCaps(t(language, cat.nameKey))}`;
}

function faqTemplatePlace(context, opts = {}) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  return {
    returnTo: opts.returnTo || session.pendingData?.returnTo || null,
    category: opts.category || session.pendingData?.category || null
  };
}

function backFromFaqTemplateChild(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  const pd = session.pendingData || {};
  if (pd.returnTo === 'faq_template_category' && pd.category) {
    return showFaqTemplateCategory(context, { category: pd.category });
  }
  if (pd.returnTo === 'faq_add') return showFaqAddMenu(context);
  return showFaqTemplateLibrary(context);
}

export async function showFaqTemplateLibrary(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const cats = faqService.getFaqCategories();
  const { getFaqPackUpdates } = await import('../services/faqTemplateService.js');
  const updates = getFaqPackUpdates();
  const returnTo = opts.returnTo || null;
  const lines = cats.map((c, i) => `${i + 1}. ${faqCategoryLabel(language, c)}`);
  lines.push('');
  let n = cats.length;
  const optNums = {};
  lines.push(`${++n}. ➕ ` + toSmallCaps(t(language, 'faqtemplates.createPack'))); optNums.create = n;
  lines.push(`${++n}. 📦 ` + toSmallCaps(t(language, 'faqtemplates.ieTitle'))); optNums.ie = n;
  lines.push(`${++n}. 🗑️ ` + toSmallCaps(t(language, 'faqtemplates.uninstallOption'))); optNums.uninstall = n;
  if (updates.length) {
    lines.push(`${++n}. 🔄 ` + toSmallCaps(t(language, 'faqtemplates.packUpdates', { count: updates.length }))); optNums.updates = n;
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_template_library', pendingAction: null, pendingData: { returnTo, optNums, hasUpdates: updates.length > 0 } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📚 ' + toSmallCaps(t(language, 'faqtemplates.libraryTitle')), opts.resultLine || '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_template_library'
  });
}

export async function handleFaqTemplateLibrary(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') {
    if (session.pendingData?.returnTo === 'faq_add') return showFaqAddMenu(context);
    return sendFaqMainPanel(context);
  }
  const cats = faqService.getFaqCategories();
  const n = parseInt(trimmed, 10);
  const optNums = session.pendingData?.optNums || { create: 9, ie: 10, uninstall: 11, updates: 12 };
  if (n >= 1 && n <= cats.length) return showFaqTemplateCategory(context, { category: cats[n - 1].id });
  if (n === optNums.create) {
    await sendText(context.sock, sender, L(language, 'faqtemplates.createViaImport'));
    return showFaqTemplateLibrary(context);
  }
  if (n === optNums.ie) return showFaqTemplateImportExport(context);
  if (n === optNums.uninstall) return showFaqTemplateUninstall(context);
  if (n === optNums.updates && session.pendingData?.hasUpdates) return showFaqPackUpdates(context);
  return showFaqTemplateLibrary(context);
}

export async function showFaqTemplateCategory(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const category = opts.category || session.pendingData?.category;
  const cat = category ? faqService.getFaqCategory(category) : null;
  if (!cat) return showFaqTemplateLibrary(context);
  const { getFaqPacksByCategory } = await import('../services/faqTemplateService.js');
  const packs = getFaqPacksByCategory(cat.id);
  const place = faqTemplatePlace(context, opts);
  const lines = packs.map((p, i) => `${i + 1}. ${faqPackLabel(language, p)} (${p.entries.length})`);
  if (!packs.length) lines.push(toSmallCaps(t(language, 'faqtemplates.emptyCategory')));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'faq_template_category',
    pendingAction: null,
    pendingData: { ...place, category: cat.id, packIds: packs.map((p) => p.id) }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(faqCategoryLabel(language, cat), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_template_category'
  });
}

export async function handleFaqTemplateCategory(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqTemplateLibrary(context);
  const ids = session.pendingData?.packIds || [];
  const { getFaqPack } = await import('../services/faqTemplateService.js');
  const pack = getFaqPack(ids[parseInt(trimmed, 10) - 1]);
  if (!pack) return showFaqTemplateCategory(context);
  return showFaqTemplatePackPreview(context, { packId: pack.id, returnTo: 'faq_template_category' });
}

function faqDefaultLang(language) {
  return ['en', 'fr', 'de', 'es', 'ar'].includes(language) ? language : 'en';
}

export async function showFaqTemplatePackPreview(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const packId = opts.packId || session.pendingData?.packId;
  const lockedLanguage = opts.language || session.pendingData?.language || null;
  const { getFaqPack, resolveFaqPackEntries } = await import('../services/faqTemplateService.js');
  const pack = packId ? getFaqPack(packId) : null;
  if (!pack) return backFromFaqTemplateChild(context);
  const place = faqTemplatePlace(context, opts);
  const useLang = lockedLanguage || faqDefaultLang(language);
  const entries = resolveFaqPackEntries(pack, useLang);
  const totalAll = resolveFaqPackEntries(pack, 'all').length;
  const shown = entries.slice(0, 5);
  let statsLine = null;
  try {
    const { getFaqPackStats, relativeTime } = await import('../services/faqPackStatsService.js').catch(() => ({}));
    void relativeTime;
    const st = getFaqPackStats ? getFaqPackStats(pack.id) : null;
    if (st && st.installs > 0) {
      statsLine = `📊 ` + toSmallCaps(t(language, 'faqtemplates.packInstalledStats', { count: st.installs }));
    }
  } catch { /* stats must never break previews */ }
  const lines = [
    toSmallCaps(t(language, 'faqtemplates.packContains', { count: entries.length })),
    toSmallCaps(t(language, 'faqtemplates.previewWillAdd', { count: lockedLanguage ? entries.length : totalAll })),
    ...((pack.tags || []).length ? [`🏷️ ` + (pack.tags || []).join(', ')] : []),
    ...(statsLine ? [statsLine] : []),
    '',
    ...shown.map((e) => ({ static: '', dynamic: `"${e.question.slice(0, 50)}" → "${String(e.answer || '').slice(0, 50)}"` })),
    ...(entries.length > 5 ? [`... +${entries.length - 5} ` + toSmallCaps(t(language, 'faqtemplates.more'))] : []),
    '',
    '1. ✅ ' + t(language, 'faqtemplates.installPack'),
    '2. 🔤 ' + toSmallCaps(t(language, 'faqtemplates.chooseLanguage')),
    '3. ✏️ ' + toSmallCaps(t(language, 'faqtemplates.previewEdit')),
    '',
    '0. ' + L(language, 'faq.back')
  ];
  sessionManager.setState(sender, chatId, {
    currentMenu: 'faq_template_pack_preview',
    pendingAction: null,
    pendingData: { packId: pack.id, ...place, language: lockedLanguage || null, previewLang: useLang }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(faqPackLabel(language, pack), '', lines),
    transitionKey: 'faq_template_pack_preview'
  });
}

export async function handleFaqTemplatePackPreview(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const packId = session.pendingData?.packId;
  if (trimmed === '0' || !packId) return backFromFaqTemplateChild(context);
  if (trimmed === '1') return faqTemplateBeginInstall(context, packId, session.pendingData?.language || session.pendingData?.previewLang || null);
  if (trimmed === '2') return showFaqTemplateLanguageSelect(context, { packId });
  if (trimmed === '3') return showFaqTemplatePreviewEdit(context, { packId, language: session.pendingData?.language || session.pendingData?.previewLang || null, index: 0, accepted: [] });
  return showFaqTemplatePackPreview(context);
}

export async function showFaqTemplateLanguageSelect(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const packId = opts.packId || session.pendingData?.packId;
  if (!packId) return backFromFaqTemplateChild(context);
  const place = faqTemplatePlace(context, opts);
  const forMulti = opts.forMulti === true || session.pendingData?.forMulti === true;
  const flags = { en: '🇬🇧', fr: '🇫🇷', de: '🇩🇪', es: '🇪🇸', ar: '🇸🇦' };
  const names = { en: 'languageEnglish', fr: 'languageFrench', de: 'languageGerman', es: 'languageSpanish', ar: 'languageArabic' };
  const lines = [1, 2, 3, 4, 5].map((n) => {
    const code = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar' }[n];
    return `${n}. ${flags[code]} ${t(language, 'faq.' + names[code])}`;
  });
  lines.push('6. ✅ ' + toSmallCaps(t(language, 'faqtemplates.allLanguages')));
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_template_language_select', pendingAction: null, pendingData: { packId, ...place, forMulti } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔤 ' + toSmallCaps(t(language, 'faqtemplates.chooseLanguage')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_template_language_select'
  });
}

export async function handleFaqTemplateLanguageSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const packId = session.pendingData?.packId;
  if (trimmed === '0' || !packId) return backFromFaqTemplateChild(context);
  const code = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' }[parseInt(trimmed, 10)];
  if (!code) return showFaqTemplateLanguageSelect(context);
  if (session.pendingData?.forMulti) {
    return showFaqTemplatePackPreview(context, { packId, language: code === 'all' ? null : code });
  }
  return faqTemplateBeginInstall(context, packId, code);
}

async function faqTemplateBeginInstall(context, packId, languageOrAll) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, context.chatId || sender) || {};
  const place = { returnTo: session.pendingData?.returnTo || null, category: session.pendingData?.category || null };
  const { getFaqPack, resolveFaqPackEntries, installedFaqPackEntries } = await import('../services/faqTemplateService.js');
  const pack = getFaqPack(packId);
  if (!pack) return backFromFaqTemplateChild(context);
  const lang = languageOrAll || faqDefaultLang(language);
  const entries = resolveFaqPackEntries(pack, lang);
  if (!entries.length) {
    await sendText(context.sock, sender, L(language, 'faqtemplates.noLangEntries', { language: lang }));
    return showFaqTemplatePackPreview(context);
  }
  const dups = installedFaqPackEntries(packId, lang);
  if (!dups.length && lang !== 'all') {
    return faqTemplateDoInstall(context, pack, lang, entries, 'fresh', null);
  }
  sessionManager.setState(sender, context.chatId || sender, {
    currentMenu: 'faq_template_duplicate_confirm',
    pendingAction: null,
    pendingData: { packId, ...place, language: lang, editedEntries: null }
  });
  const lines = [];
  if (dups.length) {
    lines.push(toSmallCaps(t(language, 'faqtemplates.alreadyInstalled', { language: lang })));
    lines.push('');
  }
  lines.push(toSmallCaps(t(language, 'faqtemplates.confirmInstall', { count: entries.length })));
  lines.push('');
  lines.push(dups.length ? '1. 🔁 ' + toSmallCaps(t(language, 'faqtemplates.reinstall')) : '1. ✅ ' + t(language, 'faqtemplates.installPack'));
  if (dups.length) lines.push('2. ➕ ' + toSmallCaps(t(language, 'faqtemplates.addNewOnly')));
  lines.push('');
  lines.push('0. ' + L(language, 'faq.back'));
  return sendMenu({
    sock: context.sock, sender, chatId: context.chatId || sender,
    text: buildMenu('⚠️ ' + toSmallCaps(t(language, 'faqtemplates.libraryTitle')), '', lines),
    transitionKey: 'faq_template_duplicate_confirm'
  });
}

async function faqTemplateDoInstall(context, pack, language, entries, mode, editedEntries) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const adminLang = resolveLanguage(sender);
  try {
    const { saveFaqSnapshot } = await import('../services/snapshotService.js');
    saveFaqSnapshot(`faq-pack-install:${pack.id}`);
  } catch { /* snapshots must never break installs */ }
  const { installFaqPackEntries, clearFaqPackLanguage } = await import('../services/faqTemplateService.js');
  if (mode === 'reinstall') clearFaqPackLanguage(pack.id, language);
  const payload = editedEntries || entries;
  const { added } = installFaqPackEntries(pack.id, payload, { mode: mode === 'add-new' ? 'add-new' : 'fresh', createdBy: sender });
  logAdminAction(sender, 'faq_template_install', `${pack.id} (${language}, ${mode}) → ${added}`);
  try {
    const { recordFaqPackInstall } = await import('../services/faqPackStatsService.js');
    recordFaqPackInstall(pack.id, added);
  } catch { /* stats must never break installs */ }
  const session = sessionManager.getSession(sender, chatId) || {};
  return showFaqTemplateLibrary(context, {
    returnTo: session.pendingData?.returnTo || null,
    resultLine: `✅ ` + toSmallCaps(t(adminLang, 'faqtemplates.installedOk', { count: added }))
  });
}

export async function handleFaqTemplateDuplicateConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const { packId, language: lang, editedEntries } = session.pendingData || {};
  if (trimmed === '0' || !packId) return showFaqTemplatePackPreview(context);
  const { getFaqPack, resolveFaqPackEntries, installedFaqPackEntries } = await import('../services/faqTemplateService.js');
  const pack = getFaqPack(packId);
  if (!pack) return backFromFaqTemplateChild(context);
  const entries = editedEntries || resolveFaqPackEntries(pack, lang || 'en');
  const dups = editedEntries ? [] : installedFaqPackEntries(packId, lang);
  if (trimmed === '1') {
    return faqTemplateDoInstall(context, pack, lang || 'en', entries, dups.length ? 'reinstall' : 'fresh', editedEntries);
  }
  if (trimmed === '2' && dups.length) {
    return faqTemplateDoInstall(context, pack, lang || 'en', entries, 'add-new', null);
  }
  return showFaqTemplatePackPreview(context);
}

export async function showFaqTemplatePreviewEdit(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const packId = opts.packId || session.pendingData?.packId;
  if (!packId) return backFromFaqTemplateChild(context);
  const place = faqTemplatePlace(context, opts);
  const lang = opts.language || session.pendingData?.previewLang || faqDefaultLang(language);
  const { getFaqPack, resolveFaqPackEntries } = await import('../services/faqTemplateService.js');
  const pack = getFaqPack(packId);
  if (!pack) return backFromFaqTemplateChild(context);
  const entries = resolveFaqPackEntries(pack, lang);
  const index = opts.index ?? session.pendingData?.index ?? 0;
  const accepted = opts.accepted || session.pendingData?.accepted || [];
  if (index >= entries.length) {
    if (!accepted.length) return backFromFaqTemplateChild(context);
    sessionManager.setState(sender, chatId, {
      currentMenu: 'faq_template_duplicate_confirm',
      pendingAction: null,
      pendingData: { packId, ...place, language: lang, editedEntries: accepted }
    });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('⚠️ ' + toSmallCaps(t(language, 'faqtemplates.libraryTitle')), '', [
        toSmallCaps(t(language, 'faqtemplates.reviewDone', { count: accepted.length })),
        '',
        toSmallCaps(t(language, 'faqtemplates.confirmInstall', { count: accepted.length })),
        '',
        '1. ✅ ' + t(language, 'faqtemplates.installPack'),
        '',
        '0. ' + L(language, 'faq.back')
      ]),
      transitionKey: 'faq_template_duplicate_confirm'
    });
  }
  const entry = entries[index];
  sessionManager.setState(sender, chatId, {
    currentMenu: 'faq_template_preview_edit',
    pendingAction: null,
    pendingData: { packId, ...place, language: lang, index, accepted, current: { question: entry.question, answer: entry.answer, keywords: entry.keywords, category: entry.category } }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(faqPackLabel(language, pack), '', [
      { static: '', dynamic: `"${entry.question.slice(0, 60)}" → "${String(entry.answer || '').slice(0, 60)}"` },
      '',
      '1. ✅ ' + toSmallCaps(t(language, 'faqtemplates.keepAsIs')),
      '2. ✏️ ' + toSmallCaps(t(language, 'faqtemplates.editEntry')),
      '3. ⏭️ ' + toSmallCaps(t(language, 'faqtemplates.skipEntry')),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: 'faq_template_preview_edit'
  });
}

export async function handleFaqTemplatePreviewEdit(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0' || pd.packId == null) return showFaqTemplatePackPreview(context);
  const accepted = pd.accepted || [];
  if (trimmed === '1' && pd.current) {
    accepted.push({ ...pd.current, language: pd.language });
    return showFaqTemplatePreviewEdit(context, { packId: pd.packId, language: pd.language, index: (pd.index || 0) + 1, accepted });
  }
  if (trimmed === '2' && pd.current) {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_template_preview_edit_input', pendingAction: null, pendingData: { ...pd, accepted } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('✏️ ' + toSmallCaps(t(language, 'faqtemplates.editEntry')), '', [toSmallCaps(t(language, 'faqtemplates.editAnswerPrompt')), '', '0. ' + L(language, 'faq.back')]),
      transitionKey: 'faq_template_preview_edit_input'
    });
  }
  if (trimmed === '3') {
    return showFaqTemplatePreviewEdit(context, { packId: pd.packId, language: pd.language, index: (pd.index || 0) + 1, accepted });
  }
  return showFaqTemplatePreviewEdit(context);
}

export async function handleFaqTemplatePreviewEditInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0' || pd.packId == null) return showFaqTemplatePackPreview(context);
  if (!trimmed) {
    await sendText(context.sock, sender, L(language, 'faq.emptyAnswer'));
    return showFaqTemplatePreviewEdit(context);
  }
  const accepted = pd.accepted || [];
  if (pd.current) {
    accepted.push({ ...pd.current, answer: trimmed.slice(0, 1000), language: pd.language });
  }
  return showFaqTemplatePreviewEdit(context, { packId: pd.packId, language: pd.language, index: (pd.index || 0) + 1, accepted });
}

export async function showFaqTemplateUninstall(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const place = faqTemplatePlace(context, opts);
  const confirmPackId = opts.confirmPackId || session.pendingData?.confirmPackId || null;
  const { getFaqPacks, getFaqPack, installedFaqPackEntries } = await import('../services/faqTemplateService.js');
  if (confirmPackId) {
    const pack = getFaqPack(confirmPackId);
    if (!pack) return showFaqTemplateUninstall(context, place);
    const count = installedFaqPackEntries(confirmPackId).length;
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_template_uninstall', pendingAction: null, pendingData: { ...place, confirmPackId } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🗑️ ' + toSmallCaps(t(language, 'faqtemplates.uninstallTitle')), '', [
        toSmallCaps(t(language, 'faqtemplates.uninstallConfirm', { pack: pack.name || t(language, pack.nameKey) })),
        toSmallCaps(t(language, 'faqtemplates.uninstallWarn', { count })),
        '',
        '1. ✅ ' + L(language, 'admin.yes'),
        '2. ❌ ' + L(language, 'admin.no'),
        '',
        '0. ' + L(language, 'faq.back')
      ]),
      transitionKey: 'faq_template_uninstall'
    });
  }
  const packs = getFaqPacks().map((p) => ({ pack: p, count: installedFaqPackEntries(p.id).length })).filter((x) => x.count > 0);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_template_uninstall', pendingAction: null, pendingData: { ...place, confirmPackId: null } });
  if (!packs.length) {
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🗑️ ' + toSmallCaps(t(language, 'faqtemplates.uninstallTitle')), toSmallCaps(t(language, 'faqtemplates.nothingInstalled')), ['0. ' + L(language, 'faq.back')]),
      transitionKey: 'faq_template_uninstall'
    });
  }
  const lines = packs.map((x, i) => `${i + 1}. ${faqPackLabel(language, x.pack)} (${toSmallCaps(t(language, 'faqtemplates.installedCount', { count: x.count }))})`);
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🗑️ ' + toSmallCaps(t(language, 'faqtemplates.uninstallTitle')), '', [...lines, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_template_uninstall'
  });
}

export async function handleFaqTemplateUninstall(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const place = { returnTo: session.pendingData?.returnTo || null, category: session.pendingData?.category || null };
  const confirmPackId = session.pendingData?.confirmPackId || null;
  if (trimmed === '0') {
    if (confirmPackId) return showFaqTemplateUninstall(context, place);
    return showFaqTemplateLibrary(context, place);
  }
  const { getFaqPacks, installedFaqPackEntries, uninstallFaqPack } = await import('../services/faqTemplateService.js');
  if (confirmPackId) {
    if (trimmed === '1') {
      try {
        const { saveFaqSnapshot } = await import('../services/snapshotService.js');
        saveFaqSnapshot(`faq-pack-uninstall:${confirmPackId}`);
      } catch { /* snapshots must never break uninstalls */ }
      const count = uninstallFaqPack(confirmPackId);
      logAdminAction(sender, 'faq_template_uninstall', `${confirmPackId} → ${count}`);
      return showFaqTemplateLibrary(context, {
        ...place,
        resultLine: `🗑️ ` + toSmallCaps(t(language, 'faqtemplates.uninstalled', { count }))
      });
    }
    return showFaqTemplateUninstall(context, place);
  }
  const packs = getFaqPacks().map((p) => ({ pack: p, count: installedFaqPackEntries(p.id).length })).filter((x) => x.count > 0);
  const picked = packs[parseInt(trimmed, 10) - 1];
  if (!picked) return showFaqTemplateUninstall(context, place);
  return showFaqTemplateUninstall(context, { ...place, confirmPackId: picked.pack.id });
}

export async function showFaqTemplateImportExport(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const place = faqTemplatePlace(context, opts);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_template_import_export', pendingAction: null, pendingData: { ...place, awaiting: false } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📦 ' + toSmallCaps(t(language, 'faqtemplates.ieTitle')), '', [
      '1. 📤 ' + toSmallCaps(t(language, 'faqtemplates.ieExportAll')),
      '2. 📤 ' + toSmallCaps(t(language, 'faqtemplates.ieExportCustom')),
      '3. 📥 ' + toSmallCaps(t(language, 'faqtemplates.ieImport')),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: 'faq_template_import_export'
  });
}

export async function handleFaqTemplateImportExport(context, input, documentContent = null) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const place = { returnTo: session.pendingData?.returnTo || null, category: session.pendingData?.category || null };
  if (session.pendingData?.awaiting) {
    const content = documentContent || String(input || '').trim();
    if (content === '0' && !documentContent) return showFaqTemplateImportExport(context, place);
    return handleFaqTemplateImportInput(context, content);
  }
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showFaqTemplateLibrary(context, place);
  if (trimmed === '1' || trimmed === '2') {
    const { exportFaqTemplatePacks } = await import('../services/faqTemplateService.js');
    const packs = exportFaqTemplatePacks(trimmed === '1' ? 'all' : 'custom');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
    await context.sock.sendMessage(chatId, {
      document: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), packs }, null, 2), 'utf8'),
      mimetype: 'application/json',
      fileName: `faq-templates-${stamp}.json`,
      caption: toSmallCaps(t(language, 'faqtemplates.ieExported'))
    });
    logAdminAction(sender, 'faq_template_export', `${Object.keys(packs).length} pack(s)`);
    return showFaqTemplateImportExport(context, place);
  }
  if (trimmed === '3') {
    sessionManager.setState(sender, chatId, { currentMenu: 'faq_template_import_export', pendingAction: null, pendingData: { ...place, awaiting: true } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('📥 ' + toSmallCaps(t(language, 'faqtemplates.ieImport')), '', [toSmallCaps(t(language, 'faqtemplates.ieImportPrompt')), '', '0. ' + L(language, 'faq.back')]),
      transitionKey: 'faq_template_import_export'
    });
  }
  return showFaqTemplateImportExport(context, place);
}

export async function handleFaqTemplateImportInput(context, content) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, context.chatId || sender) || {};
  const place = { returnTo: session.pendingData?.returnTo || null, category: session.pendingData?.category || null };
  let packs = [];
  try {
    const parsed = JSON.parse(String(content || ''));
    const src = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed.packs || parsed) : null;
    if (!src || typeof src !== 'object') throw new Error('bad shape');
    const { sanitizeFaqImport } = await import('../services/faqTemplateService.js');
    packs = sanitizeFaqImport(src);
  } catch {
    await sendText(context.sock, sender, L(language, 'faq.importInvalid'));
    return showFaqTemplateImportExport(context, place);
  }
  if (!packs.length) {
    await sendText(context.sock, sender, L(language, 'faqtemplates.ieNoPacks'));
    return showFaqTemplateImportExport(context, place);
  }
  try {
    const { saveFaqSnapshot } = await import('../services/snapshotService.js');
    saveFaqSnapshot('faq-template-import');
  } catch { /* snapshots must never break imports */ }
  const { importFaqTemplatePacks } = await import('../services/faqTemplateService.js');
  const res = importFaqTemplatePacks(packs, { conflict: 'keep-both' });
  logAdminAction(sender, 'faq_template_import', `imported=${res.imported} skipped=${res.skipped} renamed=${res.renamed}`);
  return showFaqTemplateLibrary(context, {
    ...place,
    resultLine: `📥 ` + toSmallCaps(t(language, 'faqtemplates.ieImportDone', res))
  });
}

export async function showFaqPackUpdates(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const place = faqTemplatePlace(context, opts);
  const { getFaqPackUpdates, getFaqPack } = await import('../services/faqTemplateService.js');
  const pending = getFaqPackUpdates();
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_pack_updates_list', pendingAction: null, pendingData: { ...place, updates: pending } });
  if (!pending.length) return showFaqTemplateLibrary(context, place);
  const lines = pending.map((u, i) => {
    const pack = getFaqPack(u.packId);
    const label = pack ? (pack.name || t(language, pack.nameKey)) : u.packId;
    return { static: `${i + 2}. `, dynamic: `${pack?.emoji || '📦'} ${label} (v${u.installedVersion} → v${u.availableVersion})` };
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔄 ' + toSmallCaps(t(language, 'faqtemplates.packUpdatesTitle')), '', [
      ...lines, '',
      '1. ✅ ' + toSmallCaps(t(language, 'faqtemplates.updateAll')),
      '',
      '0. ' + L(language, 'faq.back')
    ]),
    transitionKey: 'faq_pack_updates_list'
  });
}

export async function handleFaqPackUpdates(context, input) {
  const sender = context.sender;
  const session = sessionManager.getSession(sender, context.chatId || sender) || {};
  const trimmed = String(input || '').trim();
  const pending = session.pendingData?.updates || [];
  if (trimmed === '0') return showFaqTemplateLibrary(context);
  const { applyFaqPackUpdate, checkForFaqPackUpdates } = await import('../services/faqTemplateService.js');
  const runOne = async (u) => {
    try {
      const { saveFaqSnapshot } = await import('../services/snapshotService.js');
      saveFaqSnapshot(`faq-pack-update:${u.packId}`);
    } catch { /* snapshots must never break updates */ }
    const res = applyFaqPackUpdate(u.packId, sender);
    logAdminAction(sender, 'faq_template_update', `${u.packId} → ${res.updated}`);
    return res.updated;
  };
  if (trimmed === '1') {
    let total = 0;
    for (const u of pending) total += await runOne(u);
    try { checkForFaqPackUpdates(); } catch { /* noop */ }
    return showFaqTemplateLibrary(context, {
      resultLine: `🔄 ` + toSmallCaps(t(resolveLanguage(sender), 'faqtemplates.updatesApplied', { count: total }))
    });
  }
  const u = pending[parseInt(trimmed, 10) - 2];
  if (!u) return showFaqPackUpdates(context);
  await runOne(u);
  return showFaqPackUpdates(context);
}

export async function showFaqBatchTest(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'faq_batch_test', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧪 ' + toSmallCaps(t(language, 'faq.batchTitle')), '', [toSmallCaps(t(language, 'faq.batchPrompt')), '', '0. ' + L(language, 'faq.back')]),
    transitionKey: opts.transitionKey || 'faq_batch_test'
  });
}

export async function handleFaqBatchTest(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendFaqMainPanel(context);
  const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!lines.length) return showFaqBatchTest(context);
  const rows = lines.map((line) => {
    const res = faqService.matchFaq(line, language);
    const entry = res && !res.multiple ? res.entry : res?.candidates?.[0] || null;
    if (!entry) return { static: '', dynamic: `"${line.slice(0, 40)}" → ❌ ` + toSmallCaps(t(language, 'faq.testNoMatch')) };
    return { static: '', dynamic: `"${line.slice(0, 40)}" → 📚 "${entry.question.slice(0, 40)}" → "${String(entry.answer || '').slice(0, 50)}"` };
  });
  logAdminAction(sender, 'faq_batch_test', `${rows.length} question(s)`);
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧪 ' + toSmallCaps(t(language, 'faq.batchTitle')), '', [...rows, '', '0. ' + L(language, 'faq.back')]),
    transitionKey: 'faq_batch_test'
  });
}
