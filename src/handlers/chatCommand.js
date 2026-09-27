import config, { isMenuMigrated } from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { sendMenuById } from '../utils/menuSender.js';
import { sendText, sendError } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { askConfirmation } from '../utils/confirmationHelper.js';
import { addError } from '../services/errorLogService.js';
import { logAdminAction } from '../services/adminLogService.js';
import { getUserByJidSync, getUserByJid } from '../services/userService.js';
import { normalize, splitSemicolons, replacePlaceholders } from '../utils/matchUtils.js';
import * as chatRuleService from '../services/chatRuleService.js';

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
  ['faq', 'languageEnglish', '1'],
  ['faq', 'languageFrench', '2'],
  ['faq', 'languageGerman', '3'],
  ['faq', 'languageSpanish', '4'],
  ['faq', 'languageArabic', '5'],
  ['faq', 'languageAll', '6']
];

function languageMenu(language) {
  const lines = LANGUAGE_OPTIONS.map(([sec, key, n]) => `${n}. ${t(language, sec === 'faq' ? `faq.${key}` : `chatResponses.${key}`)}`);
  lines.push('');
  lines.push('0. ' + t(language, 'chatResponses.cancelled'));
  return lines;
}

export function buildChatPanel(language, resultLine = '') {
  return buildMenu(
    t(language, 'chatResponses.title'),
    '',
    [
      ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
      '1. ➕ ' + t(language, 'chatResponses.groupAddRule'),
      '2. 📋 ' + t(language, 'chatResponses.groupViewRules'),
      '3. ✏️ ' + t(language, 'chatResponses.groupManageRules'),
      '4. 🔍 ' + t(language, 'chatResponses.groupSearch'),
      '5. 📦 ' + t(language, 'chatResponses.groupImportExport'),
      '6. 📊 ' + t(language, 'chatResponses.groupStats'),
      '',
      '0. ' + toSmallCaps(t(language, 'chatResponses.back')),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

const RULE_LIST_PAGE_SIZE = 10;

async function ruleHitsMap() {
  try {
    const { getChatRuleHits } = await import('../services/chatStatsService.js');
    return getChatRuleHits();
  } catch {
    return {};
  }
}

export function buildAddRuleMenu(language) {
  return buildMenu(
    '➕ ' + L(language, 'chatResponses.addRuleTitle'),
    '',
    [
      '1. ⚡ ' + t(language, 'chatResponses.addRuleQuick'),
      '2. 🧩 ' + t(language, 'chatResponses.addRuleAdvanced'),
      '3. 📚 ' + t(language, 'chatResponses.addRuleTemplate'),
      '4. 📦 ' + t(language, 'chatResponses.addRuleBulk'),
      '5. 📥 ' + toSmallCaps(t(language, 'chatResponses.addRuleFromUnmatched')),
      '6. 📋 ' + toSmallCaps(t(language, 'chatResponses.addRuleDuplicate')),
      '7. 📝 ' + toSmallCaps(t(language, 'chatResponses.addRuleResumeDraft')),
      '8. 🎨 ' + toSmallCaps(t(language, 'chatResponses.addRuleFromExample')),
      '9. 🌐 ' + toSmallCaps(t(language, 'chatResponses.addRuleMultiLang')),
      '',
      '0. ' + L(language, 'chatResponses.back'),
      '',
      t(language, 'admin.replyPrompt')
    ]
  );
}

export async function sendAddRuleMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_rule', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildAddRuleMenu(language),
    transitionKey: opts.transitionKey || 'chat_add_rule'
  });
}

function addRuleReturnTo(context, opts = {}) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  return opts.returnTo || session.pendingData?.returnTo || null;
}

async function backFromAddRuleChild(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  if (session.pendingData?.returnTo === 'chat_add_rule') return sendAddRuleMenu(context);
  return sendChatPanel(context);
}

export async function handleAddRuleMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  if (trimmed === '1') {
    const draft = { triggers: [], replies: [], language: 'all', priority: 1, style: 'friendly', emojisEnabled: true, action: 'send_text', cooldownSeconds: 0, activeFrom: null, activeTo: null, createdBy: sender, mode: 'quick' };
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_triggers', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerPrompt')), transitionKey: 'chat_add_triggers' });
  }
  if (trimmed === '2') return showAdvancedStart(context);
  if (trimmed === '3') return showTemplateLibrary(context, { returnTo: 'chat_add_rule' });
  if (trimmed === '4') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_add', chatDraft: null });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('📦 ' + L(language, 'chatResponses.bulkTitle'), '', [L(language, 'chatResponses.bulkFormat'), '', L(language, 'chatResponses.bulkExample'), 'hi = Hello! ; Hi there!', 'thanks = You are welcome!', '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_bulk_add' });
  }
  if (trimmed === '5') return showUnmatchedList(context, { returnTo: 'chat_add_rule' });
  if (trimmed === '6') return showChatDuplicateSelect(context, { returnTo: 'chat_add_rule' });
  if (trimmed === '7') return showDraftsList(context, { returnTo: 'chat_add_rule' });
  if (trimmed === '8') return startExampleAdd(context);
  if (trimmed === '9') return startMultiLanguageAdd(context);
  await sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 9 }));
  return sendAddRuleMenu(context);
}

async function startExampleAdd(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_create_from_example', pendingData: {} });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(toSmallCaps('Create from Example'), '', [toSmallCaps('Send an example user message.'), '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_create_from_example'
  });
}

async function startMultiLanguageAdd(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_multi_language_add', chatDraft: quickDraft(sender), pendingData: { language: 'en' } });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(toSmallCaps('Multi-Language Add'), '', [toSmallCaps('Send the trigger phrase(s) for the first language.'), '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_multi_language_add'
  });
}

export async function handleCreateFromExample(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const value = String(input || '').trim();
  if (value === '0') return sendAddRuleMenu(context);
  if (session.currentMenu === 'chat_create_from_example') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_create_from_example_reply', pendingData: { example: value }, chatDraft: quickDraft(sender) });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(toSmallCaps('Create from Example'), '', [toSmallCaps('Send the reply you want the bot to give.'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_create_from_example_reply' });
  }
  const draft = session.chatDraft || quickDraft(sender);
  draft.triggers = [normalize(session.pendingData?.example || '')].filter(Boolean);
  draft.replies = [value];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_preview', chatDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildQuickPreview(language, draft), transitionKey: 'chat_quick_preview' });
}

export async function handleMultiLanguageAdd(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const value = String(input || '').trim();
  if (value === '0') return sendAddRuleMenu(context);
  if (session.currentMenu === 'chat_multi_language_add') {
    const draft = session.chatDraft || quickDraft(sender);
    draft.triggers = splitSemicolons(value).map(normalize).filter(Boolean);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_multilang_reply_input', chatDraft: draft, pendingData: { language: 'en' } });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(toSmallCaps('Multi-Language Add'), '', [toSmallCaps('Send the reply phrase(s) for this language.'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_multilang_reply_input' });
  }
  const draft = session.chatDraft || quickDraft(sender);
  draft.replies = splitSemicolons(value);
  draft.language = session.pendingData?.language || 'en';
  const id = chatRuleService.addRule({ ...draft, enabled: true, createdBy: sender });
  logAdminAction(sender, 'chat_multilang_add', id);
  return sendAddRuleMenu(context);
}

async function showDraftsList(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const returnTo = addRuleReturnTo(context, opts);
  const drafts = chatRuleService.getAllRules().filter((r) => r.status === 'draft');
  if (!drafts.length) {
    await sendText(context.sock, sender, L(language, 'chatResponses.draftsEmpty'));
    if (returnTo === 'chat_add_rule') return sendAddRuleMenu(context);
    return sendChatPanel(context);
  }
  const lines = drafts.map((r, i) => `${i + 1}. ${(r.triggers[0] || r.id)}`);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_drafts', pendingAction: null, pendingData: { ids: drafts.map((r) => r.id), returnTo } });
  const text = buildMenu('📝 ' + L(language, 'chatResponses.draftsTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_drafts' });
}

export async function handleDraftsList(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return backFromAddRuleChild(context);
  const ids = session.pendingData?.ids || [];
  const rule = chatRuleService.getRule(ids[parseInt(trimmed, 10) - 1]);
  if (!rule) return showDraftsList(context, { returnTo: session.pendingData?.returnTo });
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_draft_detail', pendingAction: null, pendingData: { id: rule.id, returnTo: session.pendingData?.returnTo } });
  const text = buildMenu('📝 ' + L(language, 'chatResponses.draftsTitle'), '', [
    { static: '', dynamic: `"${(rule.triggers[0] || rule.id)}"` },
    '',
    '1. ⬆️ ' + t(language, 'chatResponses.draftPromote'),
    '2. ✏️ ' + t(language, 'chatResponses.draftEdit'),
    '3. 🗑️ ' + t(language, 'chatResponses.draftDelete'),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_draft_detail' });
}

export async function handleDraftDetail(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.pendingData?.id;
  const rule = id ? chatRuleService.getRule(id) : null;
  const trimmed = String(input || '').trim();
  if (trimmed === '0' || !rule) return showDraftsList(context, { returnTo: session.pendingData?.returnTo });
  if (trimmed === '1') {
    chatRuleService.updateRule(id, { status: 'active', enabled: true });
    logAdminAction(sender, 'chat_draft_promote', id);
    return sendChatPanel(context, { resultLine: L(language, 'chatResponses.draftPromoted') });
  }
  if (trimmed === '2') return openEditChat(context, id);
  if (trimmed === '3') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_draft_delete', pendingAction: null, pendingData: { id, returnTo: session.pendingData?.returnTo } });
    const text = buildMenu('🗑️ ' + L(language, 'chatResponses.draftDelete'), '', [
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]);
    return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_draft_delete' });
  }
  return showDraftsList(context);
}

export async function handleDraftDelete(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = session.pendingData?.returnTo;
  if (String(input || '').trim() === '1') {
    if (session.pendingData?.id) {
      chatRuleService.deleteRule(session.pendingData.id);
      logAdminAction(sender, 'chat_draft_delete', session.pendingData.id);
    }
  }
  return showDraftsList(context, { returnTo });
}

function ruleListLine(language, r, i, hits) {
  const draftMark = r.status === 'draft' ? ' 📝' : '';
  const dateMark = (r.activeFrom || r.activeTo) ? ' 📆' : '';
  const offMark = r.enabled ? '' : ' [' + L(language, 'common.offFlag') + ']';
  const hitMark = hits && hits[r.id] ? ` (${hits[r.id]} ${L(language, 'chatResponses.usageMatches')})` : '';
  return `${i + 1}. P${r.priority || 1} ${r.id} — ${r.triggers.join(', ')}${draftMark}${dateMark}${hitMark}${offMark}`;
}

export async function sendChatPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = opts.language || resolveLanguage(sender);
  await sendMenuById('chat_responses', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'chat_submenu', { resultLine: opts.resultLine, sessionMenu: 'chat_responses_main' });
}

function structuredMenu(context, menu, heading, lines, transitionKey = menu, extra = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: menu, ...extra });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(heading, '', [...lines, '', '0. ' + L(language, 'chatResponses.back'), '', L(language, 'admin.replyPrompt')]),
    transitionKey
  });
}

export function showChatViewMenu(context) {
  const language = resolveLanguage(context.sender);
  return structuredMenu(context, 'chat_view_rules', t(language, 'chatResponses.viewTitle'), [
    '1. 📋 ' + L(language, 'chatResponses.viewAll'),
    '2. 🔤 ' + L(language, 'chatResponses.viewByLanguage'),
    '3. 🔛 ' + L(language, 'chatResponses.viewEnabled'),
    '4. ❌ ' + L(language, 'chatResponses.viewDisabled'),
    '5. 📝 ' + L(language, 'chatResponses.viewDrafts'),
    '6. 🕒 ' + L(language, 'chatResponses.viewRecent'),
    '7. ⭐ ' + L(language, 'chatResponses.viewFavorites'),
    '',
    '8. 🗑️ ' + L(language, 'chatResponses.viewBulkDelete'),
    '9. 📦 ' + L(language, 'chatResponses.viewUninstallPack')
  ], 'chat_view_rules');
}

export function showChatManageMenu(context) {
  const language = resolveLanguage(context.sender);
  return structuredMenu(context, 'chat_manage_rules', t(language, 'chatResponses.manageTitle'), [
    '1. ✏️ ' + L(language, 'chatResponses.manageEdit'),
    '2. 🗑️ ' + L(language, 'chatResponses.manageDelete'),
    '3. 🔛 ' + L(language, 'chatResponses.manageToggle'),
    '4. 📋 ' + L(language, 'chatResponses.manageDuplicate'),
    '5. ✅ ' + L(language, 'chatResponses.manageEnableAll'),
    '6. ❌ ' + L(language, 'chatResponses.manageDisableAll'),
    '7. ✅ ' + toSmallCaps(t(language, 'chatResponses.bulkToggleByLanguage')),
    '8. 🔛 ' + toSmallCaps(t(language, 'chatResponses.bulkToggleByCategory')),
    '9. 🔛 ' + toSmallCaps(t(language, 'chatResponses.bulkToggleByPack'))
  ], 'chat_manage_rules');
}

async function bulkToggleTargets(kind) {
  const { getCategories, getPack } = await import('../services/chatTemplateService.js');
  const rules = chatRuleService.getAllRules().filter((r) => r.status !== 'draft');
  if (kind === 'lang') {
    const langs = ['en', 'fr', 'de', 'es', 'ar', 'all'];
    return langs
      .map((code) => ({ code, label: code, count: rules.filter((r) => (r.language || 'all') === code).length }))
      .filter((x) => x.count > 0);
  }
  if (kind === 'category') {
    const cats = getCategories();
    return cats
      .map((c) => ({ code: c.id, label: `${c.emoji} ${c.id}`, count: rules.filter((r) => r.packId && getPack(r.packId)?.category === c.id).length }))
      .filter((x) => x.count > 0);
  }
  const byPack = new Map();
  for (const r of rules) {
    if (!r.packId) continue;
    if (!byPack.has(r.packId)) byPack.set(r.packId, 0);
    byPack.set(r.packId, byPack.get(r.packId) + 1);
  }
  return [...byPack.entries()].map(([code, count]) => {
    const pack = getPack(code);
    return { code, label: `${pack?.emoji || '📦'} ${pack?.name || code}`, count };
  });
}

export async function showBulkToggleMenu(context, kind) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const targets = await bulkToggleTargets(kind);
  const state = kind === 'lang' ? 'chat_bulk_toggle_lang' : kind === 'category' ? 'chat_bulk_toggle_category' : 'chat_bulk_toggle_pack';
  const titleKey = kind === 'lang' ? 'chatResponses.bulkToggleByLanguage' : kind === 'category' ? 'chatResponses.bulkToggleByCategory' : 'chatResponses.bulkToggleByPack';
  sessionManager.setState(sender, chatId, { currentMenu: state, pendingAction: null, pendingData: { kind, step: 'select', targets } });
  const lines = targets.length
    ? targets.map((x, i) => ({ static: `${i + 1}. `, dynamic: `${x.label} (${x.count})` }))
    : [toSmallCaps(t(language, 'chatResponses.bulkToggleNone'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(toSmallCaps(t(language, titleKey)), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: state
  });
}

export async function handleBulkToggleMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  const state = session.currentMenu;
  if (trimmed === '0') {
    if (pd.step === 'confirm') return showBulkToggleMenu(context, pd.kind);
    return sendChatPanel(context);
  }
  if (pd.step === 'select') {
    const picked = (pd.targets || [])[parseInt(trimmed, 10) - 1];
    if (!picked) return showBulkToggleMenu(context, pd.kind);
    sessionManager.setState(sender, chatId, { currentMenu: state, pendingAction: null, pendingData: { ...pd, step: 'confirm', filter: picked } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(toSmallCaps(t(language, 'chatResponses.bulkToggleConfirm', { count: picked.count, filter: picked.label })), '', [
        '1. ✅ ' + t(language, 'chatResponses.manageEnableAll'),
        '2. ❌ ' + t(language, 'chatResponses.manageDisableAll'),
        '',
        '0. ' + L(language, 'chatResponses.back')
      ]),
      transitionKey: state
    });
  }
  if (pd.step === 'confirm') {
    const enable = trimmed === '1';
    if (trimmed !== '1' && trimmed !== '2') return showBulkToggleMenu(context, pd.kind);
    const { getPack } = await import('../services/chatTemplateService.js');
    const rules = chatRuleService.getAllRules();
    const match = (r) => {
      if (r.status === 'draft') return false;
      if (pd.kind === 'lang') return (r.language || 'all') === pd.filter.code;
      if (!r.packId) return false;
      if (pd.kind === 'pack') return r.packId === pd.filter.code;
      return getPack(r.packId)?.category === pd.filter.code;
    };
    try {
      const { saveSnapshot } = await import('../services/snapshotService.js');
      saveSnapshot(`bulk-toggle:${pd.kind}:${pd.filter.code}`);
    } catch { /* snapshots must never break bulk ops */ }
    let count = 0;
    for (const r of rules) {
      if (match(r) && chatRuleService.updateRule(r.id, { enabled: enable })) count++;
    }
    logAdminAction(sender, 'chat_bulk_toggle', `${pd.kind}:${pd.filter.code} ${enable ? 'enable' : 'disable'} → ${count}`);
    return sendChatPanel(context, { resultLine: L(language, 'chatResponses.bulkDone') });
  }
  return showBulkToggleMenu(context, pd.kind || 'lang');
}

export function showChatImportExportMenu(context) {
  const language = resolveLanguage(context.sender);
  return structuredMenu(context, 'chat_import_export', t(language, 'chatResponses.importExportTitle'), [
    '1. 📤 ' + L(language, 'chatResponses.exportRules'),
    '2. 📥 ' + L(language, 'chatResponses.importRules'),
    '3. 📤 ' + L(language, 'chatResponses.exportAll'),
    '4. 📥 ' + L(language, 'chatResponses.importAll')
  ], 'chat_import_export');
}

async function showStructuredRuleList(context, filter = 'all', page = 0) {
  const language = resolveLanguage(context.sender);
  let rules = chatRuleService.getAllRules();
  if (filter === 'enabled') rules = rules.filter((rule) => rule.enabled && rule.status !== 'draft');
  if (filter === 'disabled') rules = rules.filter((rule) => !rule.enabled && rule.status !== 'draft');
  if (filter === 'drafts') rules = rules.filter((rule) => rule.status === 'draft');
  if (filter === 'recent') rules = rules.slice().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  if (filter === 'favorites') {
    const { getFavorites } = await import('../services/rulePrefsService.js');
    const favorites = new Set(getFavorites(context.sender));
    rules = rules.filter((rule) => favorites.has(rule.id));
  }
  if (filter.startsWith('lang:')) rules = rules.filter((rule) => rule.language === filter.slice(5) || rule.language === 'all');
  const totalPages = Math.max(1, Math.ceil(rules.length / RULE_LIST_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * RULE_LIST_PAGE_SIZE;
  const visible = rules.slice(start, start + RULE_LIST_PAGE_SIZE);
  const lines = visible.map((rule, index) => `${index + 1}. ${rule.id} - ${(rule.triggers || []).join(', ')}`);
  if (safePage < totalPages - 1) lines.push('11. ' + L(language, 'common.next'));
  if (safePage > 0) lines.push('12. ' + L(language, 'common.previous'));
  return structuredMenu(context, 'chat_view_list', t(language, 'chatResponses.rulesTitle'), lines, 'chat_view_list', { chatListFilter: filter, chatListPage: safePage, chatListIds: visible.map((rule) => rule.id) });
}

async function showStructuredRuleDetail(context, id, returnMenu = 'chat_view_list') {
  const language = resolveLanguage(context.sender);
  const rule = chatRuleService.getRule(id);
  if (!rule) return sendText(context.sock, context.sender, L(language, 'chatResponses.notFound'));
  const hits = await ruleHitsMap();
  let confidenceLines = [];
  try {
    const { getRuleTriggerStats } = await import('../services/triggerStatsService.js');
    const tstats = getRuleTriggerStats(id);
    const entries = Object.entries(tstats).filter(([, v]) => v.attempts > 0);
    if (entries.length) {
      confidenceLines.push('🎯 ' + toSmallCaps(t(language, 'chatResponses.triggerConfidence')) + ':');
      for (const [trigger, v] of entries) {
        const flag = v.confidence !== null && v.confidence < 50 && v.attempts >= 20 ? ' ⚠️' : '';
        confidenceLines.push({
          static: '',
          dynamic: `"${trigger}" → ${v.confidence ?? '–'}% (${v.hits} ${t(language, 'chatResponses.confidenceHits')}, ${v.misses} ${t(language, 'chatResponses.confidenceMisses')})${flag}`
        });
      }
      confidenceLines.push('');
    }
  } catch { /* confidence must never break detail view */ }
  const activeRange = (rule.activeFrom || rule.activeTo)
    ? `${rule.activeFrom || '…'} → ${rule.activeTo || '…'}`
    : t(language, 'chatResponses.detailAlways');
  const { normalizeReplies, replyText } = await import('../services/replySelector.js');
  const detailReplies = normalizeReplies(rule.replies);
  const tagSuffix = (r) => {
    const bits = [];
    if (r.weight !== 1) bits.push(`w: ${r.weight}`);
    if (r.time && r.time !== 'any') bits.push(`t: ${r.time}`);
    if (r.emotion && r.emotion !== 'any') bits.push(`e: ${r.emotion}`);
    return bits.length ? ` (${bits.join(', ')})` : '';
  };
  const styleOf = (r) => (r.style && r.style !== 'friendly' ? `${r.style}: ` : '');
  const followInfo = (r) => (r.followUps && r.followUps.length
    ? ` (fu: ${r.followUps.length} @ ${r.followUpChance != null ? Math.round(r.followUpChance * 100) + '%' : t(language, 'chatResponses.detailDefaultChance')})`
    : '');
  const repliesLine = detailReplies.length
    ? detailReplies.map((r) => `${styleOf(r)}"${replyText(r)}"${tagSuffix(r)}${followInfo(r)}`).join(' | ')
    : '–';
  let snippetPreviewLine = '';
  try {
    const withSnippets = detailReplies.filter((r) => /\{snippet:[A-Za-z0-9_]{1,30}\}/.test(replyText(r)));
    if (withSnippets.length) {
      const { expandSnippets } = await import('../utils/snippetExpander.js');
      const previews = withSnippets.slice(0, 3).map((r) => `"${expandSnippets(replyText(r), rule.language && rule.language !== 'all' ? rule.language : 'en').slice(0, 80)}"`);
      snippetPreviewLine = previews.join(' | ');
    }
  } catch { /* preview must never break detail view */ }
  const styleCounts = {};
  for (const r of detailReplies) {
    const key = r.style || 'friendly';
    styleCounts[key] = (styleCounts[key] || 0) + 1;
  }
  const stylePoolsLine = Object.keys(styleCounts).length
    ? Object.entries(styleCounts).map(([s, n]) => `${s} (${n})`).join(' · ')
    : '–';
  const ruleFollowDefault = rule.followUpChance != null
    ? `${Math.round(rule.followUpChance * 100)}%`
    : t(language, 'chatResponses.detailUsesGlobal');
  const usesGlobal = t(language, 'chatResponses.detailUsesGlobal');
  const toneSensitiveLabel = rule.toneSensitive === true
    ? t(language, 'admin.yes')
    : rule.toneSensitive === false ? t(language, 'admin.no') : usesGlobal;
  const timeSensitiveLabel = rule.timeSensitive === true
    ? t(language, 'admin.yes')
    : rule.timeSensitive === false ? t(language, 'admin.no') : usesGlobal;
  let antiRepNote = '';
  try {
    const { getSettings } = await import('../services/chatSettingsService.js');
    const s = getSettings();
    if (s.antiRepetition !== false) {
      const n = Math.floor(Number(config.chatReplyAntiRepetitionWindow) || 3);
      antiRepNote = `🔁 ` + toSmallCaps(t(language, 'chatResponses.detailAntiRep', { count: n }));
    }
  } catch { /* note must never break detail view */ }
  return structuredMenu(context, 'chat_rule_detail', '📄 ' + t(language, 'chatResponses.detailTitle'), [
    { static: `🆔 ${L(language, 'chatResponses.detailId')}: `, dynamic: rule.id },
    { static: `🔤 ${L(language, 'chatResponses.detailLanguage')}: `, dynamic: rule.language || 'all' },
    { static: `🎯 ${L(language, 'chatResponses.detailTriggers')}: `, dynamic: (rule.triggers || []).join(', ') },
    { static: `💬 ${L(language, 'chatResponses.detailReplies')} (${detailReplies.length}): `, dynamic: repliesLine },
    ...(snippetPreviewLine ? [{ static: `🧩 ${L(language, 'chatResponses.detailSnippetPreview')}: `, dynamic: snippetPreviewLine }] : []),
    ...(antiRepNote ? [antiRepNote] : []),
    { static: `🎭 ${L(language, 'chatResponses.detailToneSensitive')}: `, dynamic: toneSensitiveLabel },
    { static: `🕒 ${L(language, 'chatResponses.detailTimeSensitive')}: `, dynamic: timeSensitiveLabel },
    { static: `🎨 ${L(language, 'chatResponses.detailStylePools')}: `, dynamic: stylePoolsLine },
    { static: `💬 ${L(language, 'chatResponses.detailFollowUps')}: `, dynamic: ruleFollowDefault },
    { static: `⚡ ${L(language, 'chatResponses.detailPriority')}: `, dynamic: String(rule.priority || 1) },
    { static: `🧩 ${L(language, 'chatResponses.detailAction')}: `, dynamic: rule.action || 'send_text' },
    { static: `🚫 ${L(language, 'chatResponses.detailCooldown')}: `, dynamic: `${rule.cooldownSeconds || 0}s` },
    { static: `📆 ${L(language, 'chatResponses.detailActive')}: `, dynamic: activeRange },
    { static: `🧠 ${L(language, 'chatResponses.detailContextIn')}: `, dynamic: rule.context || t(language, 'chatResponses.detailNone') },
    { static: `🧠 ${L(language, 'chatResponses.detailSetsContext')}: `, dynamic: rule.setsContext || t(language, 'chatResponses.detailNone') },
    { static: `⏱️ ${L(language, 'chatResponses.detailContextExpiry')}: `, dynamic: rule.contextExpiryMs ? `${Math.round(rule.contextExpiryMs / 1000)}s` : t(language, 'chatResponses.detailDefault') },
    { static: `🔛 ${L(language, 'chatResponses.detailStatus')}: `, dynamic: rule.status || (rule.enabled ? 'enabled' : 'disabled') },
    { static: `📊 ${L(language, 'chatResponses.detailHits')}: `, dynamic: String(hits[rule.id] || 0) },
    '',
    ...confidenceLines,
    '1. ✏️ ' + L(language, 'chatResponses.detailEdit'),
    '2. 🔛 ' + L(language, 'chatResponses.detailToggle'),
    '3. 📋 ' + L(language, 'chatResponses.detailDuplicate'),
    '4. ⭐ ' + L(language, 'chatResponses.detailFavorite'),
    '5. 🗑️ ' + L(language, 'chatResponses.detailDelete'),
    '6. 🧪 ' + L(language, 'chatResponses.detailTest')
  ], 'chat_rule_detail', { chatDetailId: id, chatDetailReturn: returnMenu });
}

export function showStructuredSearchPrompt(context) {
  const language = resolveLanguage(context.sender);
  return structuredMenu(context, 'chat_search', t(language, 'chatResponses.searchTitle'), [L(language, 'chatResponses.searchPrompt')], 'chat_search');
}

function showChatSearchResults(context) {
  const sender = context.sender;
  const session = sessionManager.getSession(sender, context.chatId || sender) || {};
  const language = resolveLanguage(sender);
  const ids = session.chatSearchIds || [];
  const rules = ids.map((id) => chatRuleService.getRule(id)).filter(Boolean);
  const lines = rules.slice(0, 8).map((rule, index) => `${index + 1}. ${rule.id} - ${(rule.triggers || []).join(', ')}`);
  if (!lines.length) lines.push(L(language, 'chatResponses.searchNone'));
  return structuredMenu(context, 'chat_search_results', t(language, 'chatResponses.searchResultsTitle'), lines, 'chat_search_results');
}

export async function showChatStats(context) {
  const language = resolveLanguage(context.sender);
  const rules = chatRuleService.getAllRules();
  const enabled = rules.filter((rule) => rule.enabled && rule.status !== 'draft').length;
  const drafts = rules.filter((rule) => rule.status === 'draft').length;
  const hits = await ruleHitsMap();
  const top = [...rules].sort((a, b) => (hits[b.id] || 0) - (hits[a.id] || 0)).slice(0, 5);
  return structuredMenu(context, 'chat_stats', t(language, 'chatResponses.statsTitle'), [
    `${L(language, 'chatResponses.totalRules')}: ${rules.length}`,
    `${L(language, 'chatResponses.enabledRules')}: ${enabled}`,
    `${L(language, 'chatResponses.disabledRules')}: ${rules.length - enabled - drafts}`,
    `${L(language, 'chatResponses.draftRules')}: ${drafts}`,
    '',
    '🔝 ' + toSmallCaps(t(language, 'chatResponses.topRules', { count: top.length })),
    ...top.map((r, i) => ({ static: `${i + 1}. `, dynamic: `"${(r.triggers || []).join(', ').slice(0, 40)}" – ${hits[r.id] || 0} ${t(language, 'chatResponses.hitsWord')}` }))
  ], 'chat_stats');
}

export async function handleStructuredChatReply(context, input) {
  const value = String(input || '').trim();
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  const language = resolveLanguage(context.sender);
  if (session.currentMenu === 'chat_responses_main') return handleChatReply(context, value);
  if (session.currentMenu === 'chat_view_rules') {
    if (value === '0') return sendChatPanel(context);
    if (value === '1') return showStructuredRuleList(context);
    if (value === '2') return showChatFilterLanguage(context);
    if (value === '3') return showStructuredRuleList(context, 'enabled');
    if (value === '4') return showStructuredRuleList(context, 'disabled');
    if (value === '5') return showStructuredRuleList(context, 'drafts');
    if (value === '6') return showStructuredRuleList(context, 'recent');
    if (value === '7') return showStructuredRuleList(context, 'favorites');
    if (value === '8') return showBulkDeleteMenu(context);
    if (value === '9') return showPackUninstallMenu(context);
    await sendText(context.sock, context.sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 9 }));
    return showChatViewMenu(context);
  }
  if (session.currentMenu === 'chat_view_list') {
    const page = Number(session.chatListPage || 0);
    if (value === '0') return showChatViewMenu(context);
    if (value === '11') return showStructuredRuleList(context, session.chatListFilter, page + 1);
    if (value === '12') return showStructuredRuleList(context, session.chatListFilter, page - 1);
    const id = session.chatListIds?.[Number(value) - 1];
    if (!id) {
      await sendText(context.sock, context.sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: (session.chatListIds || []).length }));
      return showStructuredRuleList(context, session.chatListFilter, page);
    }
    return showStructuredRuleDetail(context, id);
  }
  if (session.currentMenu === 'chat_manage_rules') {
    if (value === '0') return sendChatPanel(context);
    if (value === '1') return showRulePicker(context, 'chatResponses.pickEdit', 'chat_rule_edit');
    if (value === '2') return showRulePicker(context, 'chatResponses.pickDelete', 'chat_rule_delete');
    if (value === '3') return showRulePicker(context, 'chatResponses.pickToggle', 'chat_rule_toggle');
    if (value === '4') return showChatDuplicateSelect(context);
    if (value === '5') return showChatBulkConfirm(context, 'enable');
    if (value === '6') return showChatBulkConfirm(context, 'disable');
    if (value === '7') return showBulkToggleMenu(context, 'lang');
    if (value === '8') return showBulkToggleMenu(context, 'category');
    if (value === '9') return showBulkToggleMenu(context, 'pack');
    await sendText(context.sock, context.sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 9 }));
    return showChatManageMenu(context);
  }
  if (session.currentMenu === 'chat_search') {
    if (value === '0') return sendChatPanel(context);
    const results = chatRuleService.searchRules(value);
    sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'chat_search_results', chatSearchIds: results.map((rule) => rule.id), chatSearchQuery: value });
    return showChatSearchResults(context);
  }
  if (session.currentMenu === 'chat_search_results') {
    if (value === '0') return showStructuredSearchPrompt(context);
    const id = session.chatSearchIds?.[Number(value) - 1];
    if (!id) {
      await sendText(context.sock, context.sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: (session.chatSearchIds || []).length }));
      return showChatSearchResults(context);
    }
    return showStructuredRuleDetail(context, id, 'chat_search_results');
  }
  if (session.currentMenu === 'chat_import_export') {
    if (value === '0') return sendChatPanel(context);
    if (value === '1') return sendText(context.sock, context.sender, JSON.stringify(chatRuleService.getAllRules(), null, 2));
    if (value === '2' || value === '4') {
      sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'chat_import_input' });
      return sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: toSmallCaps(t(language, 'chatResponses.importPrompt')), transitionKey: 'chat_import_input' });
    }
    if (value === '3') return sendText(context.sock, context.sender, JSON.stringify({ chatRules: chatRuleService.getAllRules() }, null, 2));
    await sendText(context.sock, context.sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
    return showChatImportExportMenu(context);
  }
  if (session.currentMenu === 'chat_rule_detail') {
    const id = session.chatDetailId;
    const detailReturn = session.chatDetailReturn || 'chat_view_list';
    if (value === '0') {
      if (detailReturn === 'chat_search_results') return showStructuredSearchPrompt(context);
      return showStructuredRuleList(context, session.chatListFilter || 'all', session.chatListPage || 0);
    }
    if (value === '1') return openEditChat(context, id);
    if (value === '2') { chatRuleService.toggleRule(id); logAdminAction(context.sender, 'chat_rule_toggle', id); return showStructuredRuleDetail(context, id, detailReturn); }
    if (value === '3') return showChatDuplicateSelect(context);
    if (value === '4') {
      const { addFavorite, removeFavorite, isFavorite } = await import('../services/rulePrefsService.js');
      if (!id || !chatRuleService.getRule(id)) return showStructuredRuleDetail(context, id, detailReturn);
      if (isFavorite(context.sender, id)) removeFavorite(context.sender, id);
      else addFavorite(context.sender, id);
      logAdminAction(context.sender, 'chat_rule_favorite', id);
      return showStructuredRuleDetail(context, id, detailReturn);
    }
    if (value === '5') return askConfirmation({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender }, 'deleteChatRule', { id, returnTo: 'chatSubmenu' });
    if (value === '6') return showChatTestSelect(context);
    await sendText(context.sock, context.sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return showStructuredRuleDetail(context, id, detailReturn);
  }
  if (session.currentMenu === 'chat_stats') {
    if (value === '0') return sendChatPanel(context);
    await sendText(context.sock, context.sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 0 }));
    return showChatStats(context);
  }
  return sendChatPanel(context);
}

export async function handleChatReply(context, selectedNumber) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  switch (selectedNumber) {
    case '0':
      return (await import('./adminCommand.js')).sendChatFaqMenu(context);
    case '1':
      return sendAddRuleMenu(context);
    case '2':
      return showChatViewMenu(context);
    case '3':
      return showChatManageMenu(context);
    case '4':
      return showStructuredSearchPrompt(context);
    case '5':
      return showChatImportExportMenu(context);
    case '6':
      return showChatStats(context);
    default:
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
      return sendChatPanel(context);
  }
}

async function showRulePicker(context, titleKey, targetMenu) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const rules = chatRuleService.getAllRules();
  if (rules.length === 0) {
    return sendText(context.sock, sender, L(language, 'chatResponses.noRules'));
  }
  const hits = await ruleHitsMap();
  const lines = rules.map((r, i) => ruleListLine(language, r, i, hits));
  sessionManager.setState(sender, chatId, { currentMenu: targetMenu, pendingAction: null, pendingData: null });
  const text = buildMenu(L(language, titleKey), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: targetMenu });
}

async function pickRuleByNumber(context, input, backMenu) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  const rules = chatRuleService.getAllRules();
  const rule = rules[parseInt(trimmed, 10) - 1];
  if (!rule) {
    await sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: rules.length }));
    return backMenu ? sendChatPanel(context) : null;
  }
  return rule;
}

export async function handleRuleEditSelect(context, input) {
  const rule = await pickRuleByNumber(context, input, true);
  if (!rule) return;
  return openEditChat(context, rule.id);
}

export async function handleRuleDeleteSelect(context, input) {
  const rule = await pickRuleByNumber(context, input, true);
  if (!rule) return;
  const sender = context.sender;
  const chatId = context.chatId || sender;
  return askConfirmation({ sock: context.sock, sender, chatId }, 'deleteChatRule', { id: rule.id, returnTo: 'chatDelete' });
}

export async function handleRuleToggleSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  const rules = chatRuleService.getAllRules();
  const rule = rules[parseInt(trimmed, 10) - 1];
  if (!rule) {
    await sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: rules.length }));
    return sendChatPanel(context);
  }
  const nowEnabled = chatRuleService.toggleRule(rule.id);
  logAdminAction(sender, 'chat_rule_toggle', (rule.id + ' → ' + (nowEnabled ? 'on' : 'off')));
  return sendChatPanel(context, { resultLine: L(language, nowEnabled ? 'chatResponses.toggledOn' : 'chatResponses.toggledOff') });
}

async function showChatTestSelect(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const rules = chatRuleService.getAllRules();
  if (rules.length === 0) {
    return sendText(context.sock, sender, L(language, 'chatResponses.noRules'));
  }
  const lines = rules.map((r, i) => `${i + 1}. P${r.priority || 1} ${(r.triggers[0] || r.id)}`);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_test_select' });
  const text = buildMenu(L(language, 'chatResponses.testSelect'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_select' });
}

export async function handleChatTestSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  const rules = chatRuleService.getAllRules();
  const rule = rules[parseInt(trimmed, 10) - 1];
  if (!rule) return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: rules.length }));
  const trigger = rule.triggers[0] || '';
  const { replyText: replyTextOf } = await import('../services/replySelector.js');
  const reply = replyTextOf(rule.replies && rule.replies[0]);
  logAdminAction(sender, 'chat_test', rule.id);
  const text = buildMenu('🧪 ' + L(language, 'chatResponses.testResult'), '', [
    { static: toSmallCaps(t(language, 'chatResponses.testInput')) + ': ', dynamic: `"${trigger}"` },
    { static: toSmallCaps(t(language, 'chatResponses.testMatched')) + ': ', dynamic: `💬 "${trigger}" (${toSmallCaps(t(language, 'chatResponses.testPriority'))} ${rule.priority || 1})` },
    { static: toSmallCaps(t(language, 'chatResponses.testReply')) + ': ', dynamic: `"${reply}"` },
    '',
    '0. ' + L(language, 'chatResponses.back')
  ]);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_test_result' });
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_test_result' });
}

export async function handleChatTestResult(context, input) {
  if (String(input || '').trim() === '0') return sendChatPanel(context);
  return showChatTestSelect(context);
}

async function showChatBulkConfirm(context, kind) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_confirm', pendingData: { kind } });
  const text = buildMenu(L(language, kind === 'enable' ? 'chatResponses.bulkEnableAll' : 'chatResponses.bulkDisableAll'), '', [
    '1. ' + L(language, 'admin.yes'),
    '2. ' + L(language, 'admin.no')
  ]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_bulk_confirm' });
}

export async function handleChatBulkConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const kind = session.pendingData?.kind;
  if (input === '1' && (kind === 'enable' || kind === 'disable')) {
    const enable = kind === 'enable';
    try {
      const { saveSnapshot } = await import('../services/snapshotService.js');
      saveSnapshot(enable ? 'bulk-enable-all' : 'bulk-disable-all');
    } catch { /* snapshots must never break bulk ops */ }
    let count = 0;
    for (const r of chatRuleService.getAllRules()) {
      if (r.status === 'draft') continue;
      if (chatRuleService.updateRule(r.id, { enabled: enable })) count++;
    }
    logAdminAction(sender, enable ? 'chat_enable_all' : 'chat_disable_all', String(count));
    return sendChatPanel(context, { resultLine: L(language, 'chatResponses.bulkDone') });
  }
  return sendChatPanel(context);
}

async function showChatFilterLanguage(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_filter_language' });
  const lines = LANGUAGE_OPTIONS.map(([sec, key, n]) => `${n}. ${t(language, `chatResponses.${key}`)}`);
  lines.push(`7. 📝 ${t(language, 'chatResponses.filterDrafts')}`);
  const text = buildMenu(L(language, 'chatResponses.filterTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_filter_language' });
}

export async function handleChatFilterLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showChatViewMenu(context);
  const map = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' };
  if (map[trimmed]) {
    return showStructuredRuleList(context, map[trimmed] === 'all' ? 'all' : 'lang:' + map[trimmed]);
  }
  if (trimmed === '7') {
    return showStructuredRuleList(context, 'drafts');
  }
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 7 }));
  return showChatFilterLanguage(context);
}

async function showChatDuplicateSelect(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const returnTo = addRuleReturnTo(context, opts);
  const rules = chatRuleService.getAllRules();
  if (rules.length === 0) {
    if (returnTo === 'chat_add_rule') return sendAddRuleMenu(context);
    return sendText(context.sock, sender, L(language, 'chatResponses.noRules'));
  }
  const lines = rules.map((r, i) => `${i + 1}. P${r.priority || 1} ${(r.triggers[0] || r.id)}`);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_duplicate_select', pendingData: { returnTo } });
  const text = buildMenu(L(language, 'chatResponses.duplicateSelect'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_duplicate_select' });
}

export async function handleChatDuplicateSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return backFromAddRuleChild(context);
  const rules = chatRuleService.getAllRules();
  const rule = rules[parseInt(trimmed, 10) - 1];
  if (!rule) return showChatDuplicateSelect(context, { returnTo: session.pendingData?.returnTo });
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_duplicate_language', pendingData: { ruleId: rule.id, returnTo: session.pendingData?.returnTo } });
  const lines = LANGUAGE_OPTIONS.map(([sec, key, n]) => `${n}. ${t(language, `chatResponses.${key}`)}`);
  const text = buildMenu(L(language, 'chatResponses.duplicateLang'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_duplicate_language' });
}

export async function handleChatDuplicateLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showChatDuplicateSelect(context, { returnTo: session.pendingData?.returnTo });
  const map = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' };
  if (!map[trimmed] || !session.pendingData?.ruleId) return showChatDuplicateSelect(context, { returnTo: session.pendingData?.returnTo });
  const newId = chatRuleService.duplicateChatRule(session.pendingData.ruleId, map[trimmed]);
  if (!newId) return sendText(context.sock, sender, L(language, 'chatResponses.notFound'));
  logAdminAction(sender, 'chat_duplicate', `${session.pendingData.ruleId} → ${newId} (${map[trimmed]})`);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_duplicate_modify', pendingData: { ruleId: newId } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📋 ' + L(language, 'chatResponses.duplicateModifyTitle'), '', [
      L(language, 'chatResponses.duplicateModifyPrompt'),
      '',
      '1. ' + L(language, 'admin.yes'),
      '2. ' + L(language, 'admin.no')
    ]),
    transitionKey: 'chat_duplicate_modify'
  });
}

export async function handleChatDuplicateModify(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const ruleId = session.pendingData?.ruleId;
  if (trimmed === '1' && ruleId && chatRuleService.getRule(ruleId)) {
    return openEditChat(context, ruleId);
  }
  return sendChatPanel(context, { resultLine: L(language, 'chatResponses.duplicated') });
}

// ---------------------------------------------------------------------------
// Reply snippets (reusable {snippet:name} fragments)
// ---------------------------------------------------------------------------

export async function sendSnippetsMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippets', pendingAction: null, pendingData: null });
  await sendMenuById('snippets', { sock: context.sock, sender, chatId, user, language }, opts.transitionKey || 'chat_snippets', { resultLine: opts.resultLine, sessionMenu: 'chat_snippets' });
}

async function snippetNames() {
  const { getSnippets } = await import('../services/snippetService.js');
  return Object.keys(getSnippets()).sort();
}

export async function handleSnippetsMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  if (trimmed === '1') {
    const names = await snippetNames();
    const lines = names.length ? names.map((n, i) => `${i + 1}. {snippet:${n}}`) : [L(language, 'chatResponses.snippetsEmpty')];
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippets', pendingAction: null, pendingData: null });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🧩 ' + L(language, 'chatResponses.snippetsTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippets' });
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_add', pendingAction: null, pendingData: null });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.snippetsAdd'), '', [L(language, 'chatResponses.snippetNamePrompt'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippet_add' });
  }
  if (trimmed === '3' || trimmed === '4') {
    const names = await snippetNames();
    if (!names.length) {
      return sendText(context.sock, sender, L(language, 'chatResponses.snippetsEmpty'));
    }
    const target = trimmed === '3' ? 'chat_snippet_edit' : 'chat_snippet_delete';
    sessionManager.setState(sender, chatId, { currentMenu: target, pendingAction: null, pendingData: null });
    const lines = names.map((n, i) => `${i + 1}. {snippet:${n}}`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, trimmed === '3' ? 'chatResponses.snippetsEdit' : 'chatResponses.snippetsDelete'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: target });
  }
  if (trimmed === '5') {
    const names = await snippetNames();
    if (!names.length) {
      return sendText(context.sock, sender, L(language, 'chatResponses.snippetsEmpty'));
    }
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_translate', pendingAction: null, pendingData: null });
    const lines = names.map((n, i) => `${i + 1}. {snippet:${n}}`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.snippetsTranslate'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippet_translate' });
  }
  if (trimmed === '6') {
    if (isMenuMigrated('snippet_impex')) {
      const user = await getUserByJid(sender);
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_impex', pendingAction: null, pendingData: null });
      await sendMenuById('snippet_impex', { sock: context.sock, sender, chatId, user, language }, 'chat_snippet_impex', { sessionMenu: 'chat_snippet_impex' });
      return;
    }
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_impex', pendingAction: null, pendingData: null });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(L(language, 'chatResponses.snippetsImportExport'), '', [
        '1. 📤 ' + L(language, 'chatResponses.snippetsExport'),
        '2. 📥 ' + L(language, 'chatResponses.snippetsImport'),
        '',
        '0. ' + L(language, 'chatResponses.back')
      ]),
      transitionKey: 'chat_snippet_impex'
    });
  }
  return sendSnippetsMenu(context);
}

export async function handleSnippetTranslatePick(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const names = await snippetNames();
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendSnippetsMenu(context);
  const name = names[parseInt(trimmed, 10) - 1];
  if (!name) return sendSnippetsMenu(context);
  const { getSupportedSnippetLanguages, getSnippet } = await import('../services/snippetService.js');
  const langs = getSupportedSnippetLanguages();
  const entry = getSnippet(name) || {};
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_translate_lang', pendingAction: null, pendingData: { name } });
  const lines = langs.map((l, i) => `${i + 1}. ${l}${entry[l] ? ' ✓' : ''}`);
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.snippetTranslateLangPrompt', { name }), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippet_translate_lang' });
}

export async function handleSnippetTranslateLang(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const name = session.pendingData?.name;
  const trimmed = String(input || '').trim();
  if (trimmed === '0' || !name) return sendSnippetsMenu(context);
  const { getSupportedSnippetLanguages } = await import('../services/snippetService.js');
  const langs = getSupportedSnippetLanguages();
  const target = langs[parseInt(trimmed, 10) - 1];
  if (!target) return sendSnippetsMenu(context);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_translate_text', pendingAction: null, pendingData: { name, lang: target } });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.snippetsTranslate'), '', [L(language, 'chatResponses.snippetTranslateTextPrompt', { name, lang: target }), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippet_translate_text' });
}

export async function handleSnippetTranslateText(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const { name, lang } = session.pendingData || {};
  const text = String(input || '').trim();
  if (text === '0' || !name || !lang) return sendSnippetsMenu(context);
  if (!text) return sendText(context.sock, sender, L(language, 'chatResponses.snippetTextEmpty'));
  const { setSnippet } = await import('../services/snippetService.js');
  setSnippet(name, text, lang);
  logAdminAction(sender, 'snippet_translate', `${name}:${lang}`);
  return sendSnippetsMenu(context, { resultLine: L(language, 'chatResponses.snippetSaved') });
}

export async function handleSnippetImpex(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendSnippetsMenu(context);
  if (trimmed === '1') {
    const { getSnippets } = await import('../services/snippetService.js');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await context.sock.sendMessage(chatId, {
      document: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), snippets: getSnippets() }, null, 2), 'utf8'),
      mimetype: 'application/json',
      fileName: `snippets-export-${stamp}.json`,
      caption: L(language, 'chatResponses.snippetsExported')
    });
    logAdminAction(sender, 'snippet_export', '');
    return sendSnippetsMenu(context);
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_import', pendingAction: null, pendingData: null });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.snippetsImport'), '', [L(language, 'chatResponses.snippetsImportPrompt'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippet_import' });
  }
  return sendSnippetsMenu(context);
}

export async function handleSnippetImport(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendSnippetsMenu(context);
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    await sendText(context.sock, sender, L(language, 'chatResponses.snippetsImportInvalid'));
    return;
  }
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data.snippets || data) : null;
  const { importSnippets } = await import('../services/snippetService.js');
  const count = obj && typeof obj === 'object' ? importSnippets(obj) : 0;
  if (!count) {
    await sendText(context.sock, sender, L(language, 'chatResponses.snippetsImportInvalid'));
    return;
  }
  logAdminAction(sender, 'snippet_import', `${count} snippets`);
  return sendSnippetsMenu(context, { resultLine: L(language, 'chatResponses.snippetsImported', { count }) });
}

export async function handleSnippetAddName(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const name = String(input || '').trim();
  if (name === '0') return sendSnippetsMenu(context);
  if (!/^[A-Za-z0-9_]{1,30}$/.test(name)) {
    return sendText(context.sock, sender, L(language, 'chatResponses.snippetNameInvalid'));
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_text', pendingAction: null, pendingData: { name } });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.snippetsAdd'), '', [L(language, 'chatResponses.snippetTextPrompt'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippet_text' });
}

export async function handleSnippetText(context, input, mode) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const text = String(input || '').trim();
  const name = mode === 'edit' ? session.pendingData?.name : session.pendingData?.name;
  if (text === '0' || !name) return sendSnippetsMenu(context);
  if (!text) return sendText(context.sock, sender, L(language, 'chatResponses.snippetTextEmpty'));
  const { setSnippet } = await import('../services/snippetService.js');
  setSnippet(name, text, language);
  logAdminAction(sender, 'snippet_' + (mode === 'edit' ? 'edit' : 'add'), name);
  return sendSnippetsMenu(context, { resultLine: L(language, 'chatResponses.snippetSaved') });
}

export async function handleSnippetPick(context, input, mode) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const names = await snippetNames();
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendSnippetsMenu(context);
  const name = names[parseInt(trimmed, 10) - 1];
  if (!name) return sendSnippetsMenu(context);
  if (mode === 'delete') {
    const { deleteSnippet } = await import('../services/snippetService.js');
    deleteSnippet(name);
    logAdminAction(sender, 'snippet_delete', name);
    return sendSnippetsMenu(context, { resultLine: L(language, 'chatResponses.snippetDeleted') });
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_snippet_edit_text', pendingAction: null, pendingData: { name } });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.snippetsEdit'), '', [L(language, 'chatResponses.snippetTextPrompt'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_snippet_edit_text' });
}

// ---------------------------------------------------------------------------
// Bulk delete / uninstall by pack / trash
// ---------------------------------------------------------------------------

export async function showBulkDeleteMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_delete', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🗑️ ' + L(language, 'chatResponses.bulkDeleteTitle'), '', [
      // Hybrid: result lines carry snapshot filenames (must stay readable).
      ...(opts.resultLine ? [{ static: '', dynamic: opts.resultLine }, ''] : []),
      '1. ' + t(language, 'chatResponses.bulkDeleteAll'),
      '2. ' + t(language, 'chatResponses.bulkDeleteByLanguage'),
      '3. ' + t(language, 'chatResponses.bulkDeleteByCategory'),
      '4. ' + t(language, 'chatResponses.bulkDeleteDisabled'),
      '5. ' + t(language, 'chatResponses.bulkDeleteDrafts'),
      '6. ' + t(language, 'chatResponses.bulkMoveToTrash'),
      '7. ' + t(language, 'chatResponses.bulkTrash'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: opts.transitionKey || 'chat_bulk_delete'
  });
}

async function bulkFilterRules(kind, code = null) {
  const rules = chatRuleService.getAllRules();
  if (kind === 'all') return rules;
  if (kind === 'lang') return rules.filter((r) => (r.language || 'all') === code);
  if (kind === 'disabled') return rules.filter((r) => r.status !== 'draft' && (r.enabled === false || r.status === 'disabled'));
  if (kind === 'drafts') return rules.filter((r) => r.status === 'draft');
  if (kind === 'pack') return rules.filter((r) => r.packId === code);
  if (kind === 'category') {
    const { getPack } = await import('../services/chatTemplateService.js');
    return rules.filter((r) => r.packId && getPack(r.packId)?.category === code);
  }
  return [];
}

function bulkFilterLabel(language, kind, code, count) {
  const base = t(language, 'chatResponses.bulkDeleteTitle');
  if (kind === 'all') return `${base}: ${count}`;
  if (kind === 'lang') return `${base}: ${code} (${count})`;
  if (kind === 'category') return `${base}: ${code} (${count})`;
  if (kind === 'disabled') return `${t(language, 'chatResponses.bulkDeleteDisabled')}: ${count}`;
  if (kind === 'drafts') return `${t(language, 'chatResponses.bulkDeleteDrafts')}: ${count}`;
  if (kind === 'pack') return `${base}: ${code} (${count})`;
  return `${base}: ${count}`;
}

async function askBulkDeleteConfirm(context, op, kind, code = null) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const targets = await bulkFilterRules(kind, code);
  if (!targets.length) {
    await sendText(context.sock, sender, L(language, 'chatResponses.bulkDeleteEmpty'));
    return showBulkDeleteMenu(context);
  }
  const label = bulkFilterLabel(language, kind, code, targets.length);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_bulk_delete_confirm',
    pendingAction: null,
    pendingData: { op, kind, code, label, ids: targets.map((r) => r.id), count: targets.length }
  });
  const titleKey = op === 'trash' ? 'chatResponses.trashMoveTitle' : 'chatResponses.bulkDeleteConfirmTitle';
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🗑️ ' + L(language, titleKey), '', [
      toSmallCaps(t(language, op === 'trash' ? 'chatResponses.trashMovePrompt' : 'chatResponses.bulkDeletePrompt', { count: targets.length })),
      toSmallCaps(t(language, 'chatResponses.bulkDeleteNoUndo')),
      toSmallCaps(t(language, 'chatResponses.bulkDeleteTypeConfirm')),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_bulk_delete_confirm'
  });
}

export async function handleBulkDeleteMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showChatViewMenu(context);
  if (trimmed === '1') return askBulkDeleteConfirm(context, 'delete', 'all');
  if (trimmed === '4') return askBulkDeleteConfirm(context, 'delete', 'disabled');
  if (trimmed === '5') return askBulkDeleteConfirm(context, 'delete', 'drafts');
  if (trimmed === '2') {
    const targets = await bulkToggleTargets('lang');
    if (!targets.length) {
      await sendText(context.sock, sender, L(language, 'chatResponses.bulkDeleteEmpty'));
      return showBulkDeleteMenu(context);
    }
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_delete_lang', pendingAction: null, pendingData: { targets } });
    const lines = targets.map((x, i) => `${i + 1}. ${x.label} (${x.count})`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🔤 ' + L(language, 'chatResponses.bulkDeleteByLanguage'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_bulk_delete_lang' });
  }
  if (trimmed === '3') {
    const targets = await bulkToggleTargets('category');
    if (!targets.length) {
      await sendText(context.sock, sender, L(language, 'chatResponses.bulkDeleteEmpty'));
      return showBulkDeleteMenu(context);
    }
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_delete_category', pendingAction: null, pendingData: { targets } });
    const lines = targets.map((x, i) => `${i + 1}. ${x.label} (${x.count})`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🔀 ' + L(language, 'chatResponses.bulkDeleteByCategory'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_bulk_delete_category' });
  }
  if (trimmed === '6') return showTrashMoveMenu(context);
  if (trimmed === '7') return showTrashMenu(context);
  return showBulkDeleteMenu(context);
}

export async function handleBulkDeleteFilterPick(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showBulkDeleteMenu(context);
  const kind = session.currentMenu === 'chat_bulk_delete_category' ? 'category' : 'lang';
  const picked = (session.pendingData?.targets || [])[parseInt(trimmed, 10) - 1];
  if (!picked) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: (session.pendingData?.targets || []).length }));
    return showBulkDeleteMenu(context);
  }
  return askBulkDeleteConfirm(context, 'delete', kind, picked.code);
}

export async function handleBulkDeleteConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const pd = session.pendingData || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showBulkDeleteMenu(context);
  if (trimmed !== 'DELETE') {
    await sendText(context.sock, sender, L(language, 'chatResponses.bulkDeleteNeedConfirm'));
    return;
  }
  if (!pd.ids || !pd.ids.length) return showBulkDeleteMenu(context);
  const { saveSnapshot } = await import('../services/snapshotService.js');
  const snap = saveSnapshot(`bulk-${pd.op}:${pd.kind}${pd.code ? ':' + pd.code : ''}`);
  let done = 0;
  if (pd.op === 'trash') {
    const { moveToTrash } = await import('../services/trashService.js');
    const victims = pd.ids.map((id) => chatRuleService.getRule(id)).filter(Boolean);
    moveToTrash(victims);
    for (const id of pd.ids) if (chatRuleService.deleteRule(id)) done++;
    logAdminAction(sender, 'chat_bulk_trash', `${pd.label}: ${done} rules (snapshot ${snap})`);
  } else if (pd.op === 'pack') {
    const { uninstallPack } = await import('../services/chatTemplateService.js');
    done = uninstallPack(pd.code);
    logAdminAction(sender, 'chat_pack_uninstall', `${pd.code}: ${done} rules (snapshot ${snap})`);
  } else {
    for (const id of pd.ids) if (chatRuleService.deleteRule(id)) done++;
    logAdminAction(sender, 'chat_bulk_delete', `${pd.label}: ${done} rules (snapshot ${snap})`);
  }
  return showBulkDeleteMenu(context, {
    resultLine: t(language, pd.op === 'trash' ? 'chatResponses.trashMoveDone' : 'chatResponses.bulkDeleteDone', { count: done }) + ` 💾 ${snap || ''}`
  });
}

export async function showTrashMoveMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_trash_move', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🗃️ ' + L(language, 'chatResponses.trashMoveTitle'), '', [
      toSmallCaps(t(language, 'chatResponses.trashMoveIntro')),
      '',
      '1. ' + t(language, 'chatResponses.bulkDeleteAll'),
      '2. ' + t(language, 'chatResponses.bulkDeleteByLanguage'),
      '3. ' + t(language, 'chatResponses.bulkDeleteByCategory'),
      '4. ' + t(language, 'chatResponses.bulkDeleteDisabled'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: opts.transitionKey || 'chat_trash_move'
  });
}

export async function handleTrashMoveMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showBulkDeleteMenu(context);
  if (trimmed === '1') return askBulkDeleteConfirm(context, 'trash', 'all');
  if (trimmed === '4') return askBulkDeleteConfirm(context, 'trash', 'disabled');
  if (trimmed === '2' || trimmed === '3') {
    const kind = trimmed === '2' ? 'lang' : 'category';
    const targets = await bulkToggleTargets(kind);
    if (!targets.length) {
      await sendText(context.sock, sender, L(language, 'chatResponses.bulkDeleteEmpty'));
      return showTrashMoveMenu(context);
    }
    const state = trimmed === '2' ? 'chat_trash_move_lang' : 'chat_trash_move_category';
    sessionManager.setState(sender, chatId, { currentMenu: state, pendingAction: null, pendingData: { targets } });
    const lines = targets.map((x, i) => `${i + 1}. ${x.label} (${x.count})`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🗃️ ' + L(language, 'chatResponses.trashMoveTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: state });
  }
  return showTrashMoveMenu(context);
}

export async function handleTrashMoveFilterPick(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showTrashMoveMenu(context);
  const kind = session.currentMenu === 'chat_trash_move_category' ? 'category' : 'lang';
  const picked = (session.pendingData?.targets || [])[parseInt(trimmed, 10) - 1];
  if (!picked) return showTrashMoveMenu(context);
  return askBulkDeleteConfirm(context, 'trash', kind, picked.code);
}

export async function showTrashMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { listTrash, purgeExpiredTrash } = await import('../services/trashService.js');
  const purged = purgeExpiredTrash();
  const entries = listTrash();
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_trash',
    pendingAction: null,
    pendingData: { ids: entries.map((e) => e.id) }
  });
  const retention = (() => {
    try {
      return Math.max(1, Math.floor(Number(config.chatTrashRetentionDays) || 30));
    } catch {
      return 30;
    }
  })();
  const lines = entries.length
    ? entries.map((e, i) => ({ static: `${i + 1}. `, dynamic: `"${((e.triggers || []).join(', ') || e.id).slice(0, 40)}" (${String(e.deletedAt || '').slice(0, 10)})` }))
    : [toSmallCaps(t(language, 'chatResponses.trashEmpty'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🗃️ ' + L(language, 'chatResponses.trashTitle'), '', [
      ...(opts.resultLine ? [{ static: '', dynamic: opts.resultLine }, ''] : []),
      toSmallCaps(t(language, 'chatResponses.trashRetention', { days: retention })),
      ...(purged ? [toSmallCaps(t(language, 'chatResponses.trashPurged', { count: purged }))] : []),
      '',
      ...lines,
      ...(entries.length ? ['', `${entries.length + 1}. ♻️ ` + toSmallCaps(t(language, 'chatResponses.trashRestoreAll'))] : []),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: opts.transitionKey || 'chat_trash'
  });
}

export async function handleTrashMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const ids = session.pendingData?.ids || [];
  if (trimmed === '0') return showBulkDeleteMenu(context);
  const { takeFromTrash } = await import('../services/trashService.js');
  if (trimmed === String(ids.length + 1) && ids.length) {
    const taken = takeFromTrash(ids);
    let n = 0;
    for (const rule of taken) {
      try {
        chatRuleService.addRule({ ...rule, enabled: rule.enabled !== false });
        n++;
      } catch { /* restore must never break menu */ }
    }
    logAdminAction(sender, 'chat_trash_restore', `all: ${n} rules`);
    return showTrashMenu(context, { resultLine: t(language, 'chatResponses.trashRestored', { count: n }) });
  }
  const id = ids[parseInt(trimmed, 10) - 1];
  if (!id) return showTrashMenu(context);
  const taken = takeFromTrash([id]);
  let n = 0;
  for (const rule of taken) {
    try {
      chatRuleService.addRule({ ...rule, enabled: rule.enabled !== false });
      n++;
    } catch { /* restore must never break menu */ }
  }
  logAdminAction(sender, 'chat_trash_restore', `${id}`);
  return showTrashMenu(context, { resultLine: t(language, 'chatResponses.trashRestored', { count: n }) });
}

export async function showPackUninstallMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const targets = await bulkToggleTargets('pack');
  if (!targets.length) {
    await sendText(context.sock, sender, L(language, 'chatResponses.bulkDeleteEmpty'));
    return showChatViewMenu(context);
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_uninstall_pack', pendingAction: null, pendingData: { targets } });
  const lines = targets.map((x, i) => `${i + 1}. ${x.label} (${x.count})`);
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📦 ' + L(language, 'chatResponses.packUninstallTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: opts.transitionKey || 'chat_bulk_uninstall_pack'
  });
}

export async function handlePackUninstallMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showChatViewMenu(context);
  const picked = (session.pendingData?.targets || [])[parseInt(trimmed, 10) - 1];
  if (!picked) return showPackUninstallMenu(context);
  return askBulkDeleteConfirm(context, 'pack', 'pack', picked.code);
}

// ---------------------------------------------------------------------------
// Recent / favorites
// ---------------------------------------------------------------------------

async function ruleLineItems(rules) {
  const { replyText } = await import('../services/replySelector.js');
  return rules.map((r, i) => ({ static: `${i + 1}. `, dynamic: `${(r.triggers[0] || r.id)} — ${replyText(r.replies && r.replies[0]).slice(0, 40)}` }));
}

export async function sendRecentMenu(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_recent', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(recentTitleHeading(language), '', [
      ...(opts.resultLine ? [toSmallCaps(opts.resultLine), ''] : []),
      '1. ' + t(language, 'chatResponses.recentRules'),
      '2. ' + t(language, 'chatResponses.favoriteRules'),
      '3. ' + t(language, 'chatResponses.favAdd'),
      '4. ' + t(language, 'chatResponses.favRemove'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: opts.transitionKey || 'chat_recent'
  });
}

async function showRuleIdList(context, ids, emptyKey) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const rules = ids.map((id) => chatRuleService.getRule(id)).filter(Boolean);
  if (!rules.length) {
    return sendText(context.sock, sender, L(language, emptyKey));
  }
  const lines = await ruleLineItems(rules);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_recent_open', pendingAction: null, pendingData: { ids: rules.map((r) => r.id) } });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(recentTitleHeading(language), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_recent_open' });
}

export async function handleRecentMenu(context, input) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  const { getRecent, getFavorites } = await import('../services/rulePrefsService.js');
  if (trimmed === '0') return sendChatPanel(context);
  if (trimmed === '1') return showRuleIdList(context, getRecent(sender), 'chatResponses.recentEmpty');
  if (trimmed === '2') return showRuleIdList(context, getFavorites(sender), 'chatResponses.favEmpty');
  if (trimmed === '3' || trimmed === '4') {
    const rules = chatRuleService.getAllRules();
    if (!rules.length) return sendText(context.sock, sender, L(language, 'chatResponses.noRules'));
    const menu = trimmed === '3' ? 'chat_recent_add' : 'chat_recent_remove';
    const lines = await ruleLineItems(rules);
    sessionManager.setState(sender, chatId, { currentMenu: menu, pendingAction: null, pendingData: { ids: rules.map((r) => r.id) } });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, trimmed === '3' ? 'chatResponses.favAddTitle' : 'chatResponses.favRemoveTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: menu });
  }
  return sendRecentMenu(context);
}

export async function handleRecentOpen(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendRecentMenu(context);
  const ids = session.pendingData?.ids || [];
  const rule = chatRuleService.getRule(ids[parseInt(trimmed, 10) - 1]);
  if (!rule) return sendRecentMenu(context);
  return openEditChat(context, rule.id);
}

export async function handleRecentFavToggle(context, input, add) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendRecentMenu(context);
  const ids = session.pendingData?.ids || [];
  const id = ids[parseInt(trimmed, 10) - 1];
  const { addFavorite, removeFavorite } = await import('../services/rulePrefsService.js');
  if (!id || !chatRuleService.getRule(id)) return sendRecentMenu(context);
  if (add) addFavorite(sender, id);
  else removeFavorite(sender, id);
  logAdminAction(sender, add ? 'rule_favorite_add' : 'rule_favorite_remove', id);
  return sendRecentMenu(context, { resultLine: L(language, add ? 'chatResponses.favAdded' : 'chatResponses.favRemoved') });
}

// ---------------------------------------------------------------------------
// Add-chat wizard
// ---------------------------------------------------------------------------

const MAX_REPLIES = 10;

function wizardStep(language, step, total, label) {
  return toSmallCaps(`Step ${step}/${total} · ${label}`);
}

async function snippetHint(language) {
  try {
    const { getSnippets } = await import('../services/snippetService.js');
    const names = Object.keys(getSnippets()).slice(0, 3);
    return names.length ? toSmallCaps('Tip: use snippets like ') + names.map((name) => `{snippet:${name}}`).join(', ') : '';
  } catch {
    return '';
  }
}

function validTrigger(value) {
  const text = String(value || '');
  return text.trim() === text && text.length > 0 && text.length <= 60 && /[\p{L}\p{N}]/u.test(text);
}

function validReply(value) {
  return String(value || '').trim().length > 0 && String(value || '').length <= 500;
}

export async function saveWizardDraft(context, step = 'unknown') {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  if (!draft.triggers?.length && !draft.replies?.length) return sendAddRuleMenu(context);
  const id = chatRuleService.addRule({ ...draft, status: 'draft', enabled: false, resumeStep: step, createdBy: sender });
  logAdminAction(sender, 'chat_draft_save', `${id} · ${step}`);
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.draftSaved'), '', [L(language, 'chatResponses.draftSavedHint'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_draft_save' });
}

async function duplicateWarning(context, trigger, language) {
  const existing = chatRuleService.getAllRules().find((rule) => rule.enabled && rule.triggers?.some((item) => normalize(item) === normalize(trigger)));
  if (!existing) return false;
  const { replyText: dupReplyText } = await import('../services/replySelector.js');
  const dupFirstReply = dupReplyText(existing.replies && existing.replies[0]);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_duplicate_confirm', pendingData: { trigger, existingId: existing.id } });
  await sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(toSmallCaps('Duplicate Trigger Warning'), '', [toSmallCaps('A rule with this trigger already exists:'), { static: '', dynamic: `"${trigger}" → "${dupFirstReply}"` }, '', '1. ' + toSmallCaps('Keep Both'), '2. ' + toSmallCaps('Overwrite Existing'), '3. ' + toSmallCaps('Cancel This Trigger'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_duplicate_confirm' });
  return true;
}

export async function handleExitConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '1') {
    const draft = session.chatDraft || {};
    if (draft.triggers?.length || draft.replies?.length) {
      const id = chatRuleService.addRule({ ...draft, status: 'draft', enabled: false, createdBy: sender });
      logAdminAction(sender, 'chat_draft_save', `${id} · exit-confirm`);
      return sendChatPanel(context, { resultLine: L(language, 'chatResponses.draftSaved') });
    }
    return sendChatPanel(context);
  }
  if (trimmed === '2' || trimmed === '0') return sendChatPanel(context);
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
  return sendChatPanel(context);
}

export async function handleWizardExit(context, input) {
  const value = String(input || '').trim().toLowerCase();
  if (!['0', 'cancel'].includes(value)) return false;
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  if (!session.chatDraft || (!session.chatDraft.triggers?.length && !session.chatDraft.replies?.length)) return true;
  const language = resolveLanguage(context.sender);
  await sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: buildMenu(toSmallCaps('Exit Without Saving?'), '', ['1. ' + toSmallCaps('Save as Draft'), '2. ' + toSmallCaps('Exit Without Saving'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_exit_confirm' });
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'chat_exit_confirm' });
  return true;
}

async function showAdvancedStart(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_start', chatDraft: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(L(language, 'chatResponses.title'), '', [
      L(language, 'chatResponses.addStart'),
      '',
      '1. ' + t(language, 'chatResponses.addStartYes'),
      '2. ' + t(language, 'chatResponses.addStartNo'),
      '',
      '0. ' + t(language, 'chatResponses.cancelled')
    ]),
    transitionKey: 'chat_add_start'
  });
}

// ---------------------------------------------------------------------------
// Quick Add mode: trigger -> AI question -> reply -> preview -> save
// ---------------------------------------------------------------------------

function quickDraft(sender) {
  return { triggers: [], replies: [], language: 'en', priority: 1, style: 'friendly', emojisEnabled: true, action: 'send_text', cooldownSeconds: 0, activeFrom: null, activeTo: null, createdBy: sender };
}

export async function handleQuickTriggers(context, input, prefilled = null) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = prefilled !== null ? prefilled : String(input || '').trim();
  if (prefilled === null && trimmed === '0') return sendChatPanel(context);
  if (!validTrigger(trimmed)) return sendText(context.sock, sender, L(language, 'chatResponses.triggerInvalid'));
  if (await duplicateWarning(context, trimmed, language)) return;
  const triggers = splitSemicolons(trimmed).map((x) => normalize(x)).filter(Boolean);
  if (triggers.length === 0) {
    return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
  }
  const draft = session.chatDraft || quickDraft(sender);
  draft.triggers = triggers;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_ai', chatDraft: draft });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🤖 ' + L(language, 'chatResponses.quickAiTitle'), '', [
      L(language, 'chatResponses.quickAiPrompt'),
      '',
      '1. ' + t(language, 'chatResponses.quickAiYes'),
      '2. ' + t(language, 'chatResponses.quickAiNo')
    ]),
    transitionKey: 'chat_quick_ai'
  });
}

export async function handleQuickAi(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '1') {
    await sendText(context.sock, sender, L(language, 'chatResponses.quickAiSoon'));
  } else if (trimmed !== '2') {
    return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 1, max: 2 }));
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_replies', chatDraft: session.chatDraft });
  const hint = await snippetHint(language);
  return sendMenu({ sock: context.sock, sender, chatId, text: [wizardStep(language, 3, 6, 'Reply Input'), toSmallCaps(t(language, 'chatResponses.quickReplyPrompt')), hint].filter(Boolean).join('\n\n'), transitionKey: 'chat_quick_replies' });
}

export async function handleQuickReplies(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  if (!validReply(trimmed)) return sendText(context.sock, sender, L(language, 'chatResponses.replyInvalid'));
  const replies = splitSemicolons(trimmed);
  if (replies.length === 0) {
    return sendText(context.sock, sender, L(language, 'chatResponses.emptyReplies'));
  }
  const draft = session.chatDraft || quickDraft(sender);
  draft.replies = replies;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_preview', chatDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildQuickPreview(language, draft), transitionKey: 'chat_quick_preview' });
}

function buildQuickPreview(language, draft) {
  const lines = [
    { static: toSmallCaps(t(language, 'chatResponses.previewUserSays')) + ': ', dynamic: `"${(draft.triggers[0] || '')}"` },
    ...((draft.replies || []).map((r) => ({
      static: toSmallCaps(t(language, 'chatResponses.previewBotReplies')) + ': ',
      dynamic: `"${replacePlaceholders(r, { username: 'John', name: 'John', jid: '123456789@lid', level: 7 }, config)}"`
    }))),
    '',
    '1. ✅ ' + t(language, 'chatResponses.previewConfirmSave'),
    '2. ' + t(language, 'chatResponses.quickLanguage'),
    '',
    '0. ' + t(language, 'chatResponses.back')
  ];
  return buildMenu('⚡ ' + L(language, 'chatResponses.quickPreviewTitle'), '', lines);
}

export async function handleQuickPreview(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  if (trimmed === '1') {
    const id = chatRuleService.addRule({
      triggers: draft.triggers, replies: draft.replies, language: draft.language || 'en',
      priority: 1, style: 'friendly', emojisEnabled: true, action: 'send_text',
      cooldownSeconds: 0, activeFrom: null, activeTo: null, createdBy: sender, enabled: true
    });
    logAdminAction(sender, 'chat_quick_add', (id + ' · ' + (draft.triggers || []).join(', ')));
    if (session.pendingData?.unmatchedId) {
      try {
        const { resolveUnmatched } = await import('../services/unmatchedService.js');
        resolveUnmatched(session.pendingData.unmatchedId);
      } catch { /* ignore */ }
    }
    return sendChatPanel(context, { resultLine: L(language, 'chatResponses.saved') });
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_language', chatDraft: draft });
    const lines = LANGUAGE_OPTIONS.map(([sec, key, n]) => `${n}. ${t(language, `chatResponses.${key}`)}`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.languageTitle'), '', [...lines, '', '0. ' + t(language, 'chatResponses.back')]), transitionKey: 'chat_quick_language' });
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 2 }));
}

export async function handleQuickLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  const map = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' };
  if (!map[trimmed]) {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_language', chatDraft: draft });
    const lines = LANGUAGE_OPTIONS.map(([sec, key, n]) => `${n}. ${t(language, `chatResponses.${key}`)}`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.languageTitle'), '', [...lines, '', '0. ' + t(language, 'chatResponses.back')]), transitionKey: 'chat_quick_language' });
  }
  draft.language = map[trimmed];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_preview', chatDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildQuickPreview(language, draft), transitionKey: 'chat_quick_preview' });
}

// ---------------------------------------------------------------------------
// Template library (chat rule packs)
// ---------------------------------------------------------------------------

const TEMPLATE_LANG_MAP = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' };
const TEMPLATE_LANG_NAME_KEY = { en: 'languageEnglish', fr: 'languageFrench', de: 'languageGerman', es: 'languageSpanish', ar: 'languageArabic', all: 'languageAll' };
const TEMPLATE_LANG_FLAG = { en: '🇬🇧', fr: '🇫🇷', de: '🇩🇪', es: '🇪🇸', ar: '🇸🇦', all: '🌍' };

function packLabel(language, pack) {
  const name = pack.name || t(language, pack.nameKey);
  return `${pack.emoji} ${toSmallCaps(name)}`;
}

function recentTitleHeading(language) {
  const parts = t(language, 'chatResponses.recentTitle').split(' / ');
  if (parts.length === 2) return '🕒 ' + toSmallCaps(parts[0]) + ' / ⭐ ' + toSmallCaps(parts[1]);
  return '🕒 ' + toSmallCaps(t(language, 'chatResponses.recentTitle'));
}

function categoryLabel(language, cat) {
  return `${cat.emoji} ${toSmallCaps(t(language, cat.nameKey))}`;
}

function templateLangName(language, code) {
  return t(language, `chatResponses.${TEMPLATE_LANG_NAME_KEY[code] || 'languageEnglish'}`);
}

function backFromTemplateLibrary(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  if (session.pendingData?.returnTo === 'chat_add_rule') return sendAddRuleMenu(context);
  return sendChatPanel(context);
}

function backFromTemplateChild(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  const pd = session.pendingData || {};
  if (pd.returnTo === 'chat_template_category' && pd.category) {
    return showTemplateCategory(context, { category: pd.category });
  }
  if (pd.returnTo === 'template_featured') return showTemplateFeatured(context);
  if (pd.returnTo === 'template_search') return showTemplateSearch(context);
  if (pd.returnTo === 'template_tag_filter') return showTemplateTagFilter(context, {});
  return showTemplateLibrary(context);
}

function templateKeepReturnTo(context, extra = {}) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  return { returnTo: session.pendingData?.returnTo || null, ...extra };
}

function templatePlace(context, opts = {}) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  return {
    returnTo: opts.returnTo || session.pendingData?.returnTo || null,
    category: opts.category || session.pendingData?.category || null
  };
}

export async function showTemplateLibrary(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getCategories, getPackUpdates } = await import('../services/chatTemplateService.js');
  const categories = getCategories();
  const updates = getPackUpdates();
  const returnTo = addRuleReturnTo(context, opts);
  const lines = categories.map((c, i) => `${i + 1}. ${categoryLabel(language, c)}`);
  lines.push('');
  let n = categories.length;
  const optNums = {};
  lines.push(`${++n}. ⭐ ` + toSmallCaps(t(language, 'templates.featuredPacks'))); optNums.featured = n;
  lines.push(`${++n}. 🔍 ` + toSmallCaps(t(language, 'templates.searchTemplates'))); optNums.search = n;
  lines.push(`${++n}. 🏷️ ` + toSmallCaps(t(language, 'templates.filterByTag'))); optNums.tags = n;
  lines.push(`${++n}. ➕ ` + toSmallCaps(t(language, 'templates.createPack'))); optNums.create = n;
  lines.push(`${++n}. 📦 ` + toSmallCaps(t(language, 'templates.ieTitle'))); optNums.ie = n;
  lines.push(`${++n}. 🗑️ ` + toSmallCaps(t(language, 'chatResponses.templateUninstallOption'))); optNums.uninstall = n;
  if (updates.length) {
    lines.push(`${++n}. 🔄 ` + toSmallCaps(t(language, 'templates.packUpdates', { count: updates.length }))); optNums.updates = n;
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_template_library', pendingAction: null, pendingData: { returnTo, optNums, hasUpdates: updates.length > 0 } });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu('📚 ' + toSmallCaps(t(language, 'chatResponses.templateTitle')), opts.resultLine || '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_template_library'
  });
}

export async function handleTemplateLibrary(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return backFromTemplateLibrary(context);
  const { getCategories } = await import('../services/chatTemplateService.js');
  const categories = getCategories();
  const n = parseInt(trimmed, 10);
  const optNums = session.pendingData?.optNums || { featured: 11, search: 12, tags: 13, create: 14, ie: 15, uninstall: 16, updates: 17 };
  if (n >= 1 && n <= categories.length) return showTemplateCategory(context, { category: categories[n - 1].id });
  if (n === optNums.featured) return showTemplateFeatured(context);
  if (n === optNums.search) return showTemplateSearch(context);
  if (n === optNums.tags) return showTemplateTagFilter(context);
  if (n === optNums.create) return showTemplateCreatePack(context, { step: 'name' });
  if (n === optNums.ie) return showTemplateImportExport(context);
  if (n === optNums.uninstall) return showTemplateUninstall(context);
  if (n === optNums.updates && session.pendingData?.hasUpdates) return showPackUpdates(context);
  await sendText(context.sock, sender, L(resolveLanguage(sender), 'chatResponses.invalidNumber', { min: 0, max: optNums.updates || optNums.uninstall }));
  return showTemplateLibrary(context);
}

export async function showTemplateCategory(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const category = opts.category || session.pendingData?.category;
  const { getCategory, getPacksByCategory } = await import('../services/chatTemplateService.js');
  const cat = category ? getCategory(category) : null;
  if (!cat) return showTemplateLibrary(context);
  const returnTo = addRuleReturnTo(context, opts);
  const packs = getPacksByCategory(cat.id);
  const lines = packs.map((p, i) => `${i + 1}. ${packLabel(language, p)} (${p.rules.length})`);
  if (!packs.length) lines.push(toSmallCaps(t(language, 'chatResponses.templateEmpty')));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_template_category',
    pendingAction: null,
    pendingData: { returnTo, category: cat.id, packIds: packs.map((p) => p.id) }
  });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(categoryLabel(language, cat), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_template_category'
  });
}

export async function handleTemplateCategory(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showTemplateLibrary(context);
  const ids = session.pendingData?.ids || session.pendingData?.packIds || [];
  const { getPack } = await import('../services/chatTemplateService.js');
  const pack = getPack(ids[parseInt(trimmed, 10) - 1]);
  if (!pack) return showTemplateCategory(context);
  const returnTo = 'chat_template_category';
  sessionManager.setState(sender, chatId, { pendingData: { ...(session.pendingData || {}), returnTo } });
  if (pack.multi) {
    return showTemplateLanguageSelect(context, { packId: pack.id, forMulti: true, returnTo });
  }
  return showTemplatePackPreview(context, { packId: pack.id, returnTo });
}

export async function showTemplateFeatured(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const returnTo = addRuleReturnTo(context, opts);
  const { getFeaturedPacks } = await import('../services/templateSearchService.js');
  const packs = getFeaturedPacks();
  const lines = packs.map((p, i) => `${i + 1}. ${packLabel(language, p)} (${p.rules.length})`);
  if (!packs.length) lines.push(toSmallCaps(t(language, 'chatResponses.templateEmpty')));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'template_featured',
    pendingAction: null,
    pendingData: { returnTo, packIds: packs.map((p) => p.id) }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('⭐ ' + toSmallCaps(t(language, 'templates.featuredPacks')), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'template_featured'
  });
}

export async function handleTemplateFeatured(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showTemplateLibrary(context);
  const ids = session.pendingData?.packIds || [];
  const { getPack } = await import('../services/chatTemplateService.js');
  const pack = getPack(ids[parseInt(trimmed, 10) - 1]);
  if (!pack) return showTemplateFeatured(context);
  return showTemplatePackPreview(context, { packId: pack.id, returnTo: 'template_featured' });
}

export async function showTemplateSearch(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const returnTo = addRuleReturnTo(context, opts);
  sessionManager.setState(sender, chatId, { currentMenu: 'template_search', pendingAction: null, pendingData: { returnTo, step: 'input' } });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔍 ' + toSmallCaps(t(language, 'templates.searchTemplates')), '', [toSmallCaps(t(language, 'templates.searchPrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'template_search'
  });
}

export async function handleTemplateSearch(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (pd.step === 'input') {
    if (trimmed === '0') return showTemplateLibrary(context);
    if (!trimmed) return showTemplateSearch(context);
    return showTemplateSearchResults(context, { query: trimmed, page: 0 });
  }
  const results = pd.results || [];
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(Math.max(0, pd.page || 0), totalPages - 1);
  if (trimmed === '0') return showTemplateLibrary(context);
  if (trimmed === '11' && page + 1 < totalPages) return showTemplateSearchResults(context, { query: pd.query, page: page + 1 });
  if (trimmed === '12' && page > 0) return showTemplateSearchResults(context, { query: pd.query, page: page - 1 });
  const hit = results[(page * pageSize) + parseInt(trimmed, 10) - 1];
  if (!hit) return showTemplateSearchResults(context, { query: pd.query, page });
  return showTemplatePackPreview(context, { packId: hit.packId, returnTo: 'template_search' });
}

async function templateNameMatches(query, language) {
  const { getPacks } = await import('../services/chatTemplateService.js');
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  for (const pack of getPacks()) {
    const label = pack.name || t(language, pack.nameKey);
    if (label.toLowerCase().includes(q)) out.push(pack.id);
  }
  return out;
}

export async function showTemplateSearchResults(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = addRuleReturnTo(context, opts);
  const query = opts.query ?? session.pendingData?.query ?? '';
  const { searchTemplates } = await import('../services/templateSearchService.js');
  const nameMatches = await templateNameMatches(query, language);
  const results = searchTemplates(query, { nameMatches });
  const pageSize = 8;
  const page = opts.page || 0;
  const { getPack } = await import('../services/chatTemplateService.js');
  const lines = [];
  if (!results.length) lines.push(toSmallCaps(t(language, 'templates.searchNoResults')));
  const visible = results.slice(page * pageSize, page * pageSize + pageSize);
  visible.forEach((r, i) => {
    const pack = getPack(r.packId);
    const first = r.hits[0] || {};
    lines.push({ static: `${page * pageSize + i + 1}. `, dynamic: `"${String(first.context || '').slice(0, 40)}" ${t(language, 'templates.searchMatchIn')} ${pack ? (pack.emoji + ' ' + (pack.name || t(language, pack.nameKey))) : r.packId}` });
  });
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
if (page + 1 < totalPages) lines.push('11. ' + t(language, 'chatResponses.next') + ' ▶');
if (page > 0) lines.push('12. ◀ ' + t(language, 'chatResponses.previous'));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'template_search',
    pendingAction: null,
    pendingData: { returnTo, step: 'results', query, page, results }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔍 ' + toSmallCaps(t(language, 'templates.searchTemplates')), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'template_search'
  });
}

export async function showTemplateTagFilter(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = addRuleReturnTo(context, opts);
  const tag = opts.tag || session.pendingData?.tag || null;
  const { collectTags, packsWithTag } = await import('../services/templateSearchService.js');
  if (!tag) {
    const tags = collectTags();
    const lines = tags.map((x, i) => `${i + 1}. 🏷️ ${x.tag} (${x.count})`);
    if (!tags.length) lines.push(toSmallCaps(t(language, 'chatResponses.templateEmpty')));
    sessionManager.setState(sender, chatId, {
      currentMenu: 'template_tag_filter',
      pendingAction: null,
      pendingData: { returnTo, step: 'tags', tagList: tags.map((x) => x.tag) }
    });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🏷️ ' + toSmallCaps(t(language, 'templates.filterByTag')), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'template_tag_filter'
    });
  }
  const packs = packsWithTag(tag);
  const lines = packs.map((p, i) => `${i + 1}. ${packLabel(language, p)} (${p.rules.length})`);
  if (!packs.length) lines.push(toSmallCaps(t(language, 'chatResponses.templateEmpty')));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'template_tag_filter',
    pendingAction: null,
    pendingData: { returnTo, step: 'packs', tag, packIds: packs.map((p) => p.id) }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🏷️ ' + toSmallCaps(String(tag)), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'template_tag_filter'
  });
}

export async function handleTemplateTagFilter(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0') {
    if (pd.step === 'packs') return showTemplateTagFilter(context, {});
    return showTemplateLibrary(context);
  }
  if (pd.step === 'packs') {
    const { getPack } = await import('../services/chatTemplateService.js');
    const pack = getPack((pd.packIds || [])[parseInt(trimmed, 10) - 1]);
    if (!pack) return showTemplateTagFilter(context, { tag: pd.tag });
    return showTemplatePackPreview(context, { packId: pack.id, returnTo: 'template_tag_filter' });
  }
  const tag = (pd.tagList || [])[parseInt(trimmed, 10) - 1];
  if (!tag) return showTemplateTagFilter(context, {});
  return showTemplateTagFilter(context, { tag });
}

export async function showPackUpdates(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const returnTo = addRuleReturnTo(context, opts);
  const { getPackUpdates, getPack } = await import('../services/chatTemplateService.js');
  const pending = getPackUpdates();
  sessionManager.setState(sender, chatId, {
    currentMenu: 'pack_updates_list',
    pendingAction: null,
    pendingData: { returnTo, updates: pending }
  });
  if (!pending.length) return showTemplateLibrary(context);
  const lines = pending.map((u, i) => {
    const pack = getPack(u.packId);
    const label = pack ? (pack.name || t(language, pack.nameKey)) : u.packId;
    return { static: `${i + 2}. `, dynamic: `${pack?.emoji || '📦'} ${label} (v${u.installedVersion} → v${u.availableVersion})` };
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔄 ' + toSmallCaps(t(language, 'templates.packUpdatesTitle')), '', [
      ...lines, '',
      '1. ✅ ' + toSmallCaps(t(language, 'templates.updateAll')),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'pack_updates_list'
  });
}

export async function handlePackUpdates(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pending = session.pendingData?.updates || [];
  if (trimmed === '0') return showTemplateLibrary(context);
  const { applyPackUpdate } = await import('../services/chatTemplateService.js');
  if (trimmed === '1') {
    let total = 0;
    for (const u of pending) {
      try {
        const { saveSnapshot } = await import('../services/snapshotService.js');
        saveSnapshot(`pack-update:${u.packId}`);
      } catch { /* snapshots must never break updates */ }
      const res = applyPackUpdate(u.packId, sender);
      total += res.updated;
      logAdminAction(sender, 'chat_template_update', `${u.packId} → ${res.updated} rule(s)`);
    }
    try {
      const { checkForPackUpdates } = await import('../services/chatTemplateService.js');
      checkForPackUpdates();
    } catch { /* noop */ }
    return showTemplateLibrary(context, {
      resultLine: `🔄 ` + toSmallCaps(t(resolveLanguage(sender), 'templates.updatesApplied', { count: total }))
    });
  }
  const u = pending[parseInt(trimmed, 10) - 2];
  if (!u) return showPackUpdates(context);
  try {
    const { saveSnapshot } = await import('../services/snapshotService.js');
    saveSnapshot(`pack-update:${u.packId}`);
  } catch { /* snapshots must never break updates */ }
  const res = applyPackUpdate(u.packId, sender);
  logAdminAction(sender, 'chat_template_update', `${u.packId} → ${res.updated} rule(s)`);
  return showPackUpdates(context);
}

function defaultPreviewLang(language) {
  return ['en', 'fr', 'de', 'es', 'ar'].includes(language) ? language : 'en';
}

async function resolvedPreview(pack, useLang) {
  const { resolvePackRules } = await import('../services/chatTemplateService.js');
  return resolvePackRules(pack, useLang);
}

export async function showTemplatePackPreview(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const packId = opts.packId || session.pendingData?.packId;
  const lockedLanguage = opts.language || session.pendingData?.language || null;
  const { getPack } = await import('../services/chatTemplateService.js');
  const pack = packId ? getPack(packId) : null;
  if (!pack) return backFromTemplateChild(context);
  const place = templatePlace(context, opts);
  const useLang = lockedLanguage || defaultPreviewLang(language);
  const entries = await resolvedPreview(pack, useLang);
  const { resolvePackRules } = await import('../services/chatTemplateService.js');
  const totalAllLangs = resolvePackRules(pack, 'all').length;
  const shown = entries.slice(0, 5);
  let statsLine = null;
  try {
    const { getPackStats, relativeTime } = await import('../services/packStatsService.js');
    const st = getPackStats(pack.id);
    if (st && st.installs > 0) {
      const rel = relativeTime(st.lastInstalled);
      const ago = rel ? t(language, `templates.timeAgo${rel.unit[0].toUpperCase()}${rel.unit.slice(1)}`, { count: rel.value }) : '';
      statsLine = `📊 ` + toSmallCaps(t(language, 'templates.packInstalledStats', { count: st.installs }))
        + (ago ? ` · ` + toSmallCaps(t(language, 'templates.lastSeenAt', { ago })) : '');
    }
  } catch { /* stats must never break previews */ }
  const lines = [
    toSmallCaps(t(language, 'chatResponses.templateContains', { count: entries.length })),
    toSmallCaps(t(language, 'templates.previewWillAdd', { count: lockedLanguage ? entries.length : totalAllLangs })),
    ...((pack.tags || []).length ? [`🏷️ ` + (pack.tags || []).join(', ')] : []),
    ...(statsLine ? [statsLine] : []),
    '',
    ...shown.map((e) => ({ static: '', dynamic: `"${e.triggers.join(' / ')}" → "${e.replies[0] || ''}"` })),
    ...(entries.length > 5 ? [`... +${entries.length - 5} ` + toSmallCaps(t(language, 'chatResponses.templateMore'))] : []),
    '',
    '1. ✅ ' + t(language, 'chatResponses.templateInstall'),
    '2. 🔤 ' + toSmallCaps(t(language, 'chatResponses.templateChooseLanguage')),
    '3. ✏️ ' + toSmallCaps(t(language, 'chatResponses.templatePreviewEdit')),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_template_pack_preview',
    pendingAction: null,
    pendingData: { packId: pack.id, ...place, language: lockedLanguage || null, previewLang: useLang }
  });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu(packLabel(language, pack), '', lines),
    transitionKey: 'chat_template_pack_preview'
  });
}

export async function handleTemplatePackPreview(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const packId = session.pendingData?.packId;
  if (trimmed === '0' || !packId) return backFromTemplateChild(context);
  if (trimmed === '1') return templateBeginInstall(context, packId, session.pendingData?.language || session.pendingData?.previewLang || null);
  if (trimmed === '2') return showTemplateLanguageSelect(context, { packId });
  if (trimmed === '3') return showTemplatePreviewEdit(context, { packId, language: session.pendingData?.language || session.pendingData?.previewLang || null, index: 0, accepted: [] });
  return showTemplatePackPreview(context);
}

export async function showTemplateLanguageSelect(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const packId = opts.packId || session.pendingData?.packId;
  if (!packId) return backFromTemplateChild(context);
  const place = templatePlace(context, opts);
  const forMulti = opts.forMulti === true || session.pendingData?.forMulti === true;
  const lines = [1, 2, 3, 4, 5].map((n) => {
    const code = TEMPLATE_LANG_MAP[n];
    return `${n}. ${TEMPLATE_LANG_FLAG[code]} ${templateLangName(language, code)}`;
  });
  lines.push(`6. ✅ ` + toSmallCaps(t(language, 'chatResponses.templateAllLanguages')));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_template_language_select',
    pendingAction: null,
    pendingData: { packId, ...place, forMulti }
  });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildMenu('🔤 ' + toSmallCaps(t(language, 'chatResponses.templateChooseLanguage')), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_template_language_select'
  });
}

export async function handleTemplateLanguageSelect(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const packId = session.pendingData?.packId;
  if (trimmed === '0' || !packId) return backFromTemplateChild(context);
  const code = TEMPLATE_LANG_MAP[parseInt(trimmed, 10)];
  if (!code) return showTemplateLanguageSelect(context);
  if (session.pendingData?.forMulti) {
    return showTemplatePackPreview(context, { packId, language: code === 'all' ? null : code });
  }
  return templateBeginInstall(context, packId, code);
}

async function templateBeginInstall(context, packId, languageOrAll) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, context.chatId || sender) || {};
  const place = { returnTo: session.pendingData?.returnTo || null, category: session.pendingData?.category || null };
  const { getPack, resolvePackRules, installedPackRules } = await import('../services/chatTemplateService.js');
  const pack = getPack(packId);
  if (!pack) return backFromTemplateChild(context);
  const lang = languageOrAll || (['en', 'fr', 'de', 'es', 'ar'].includes(language) ? language : 'en');
  const entries = resolvePackRules(pack, lang);
  if (!entries.length) {
    await sendText(context.sock, sender, L(language, 'templates.templateNoLangRules', { language: lang }));
    return showTemplatePackPreview(context);
  }
  const dups = installedPackRules(packId, lang);
  if (!dups.length && lang !== 'all') {
    return templateDoInstall(context, pack, lang, entries, 'fresh', null);
  }
  sessionManager.setState(sender, context.chatId || sender, {
    currentMenu: 'chat_template_duplicate_confirm',
    pendingAction: null,
    pendingData: { packId, ...place, language: lang, editedRules: null }
  });
  const lines = [];
  if (dups.length) {
    lines.push(toSmallCaps(t(language, 'chatResponses.templateAlreadyInstalled', { language: lang === 'all' ? templateLangName(language, 'all') : templateLangName(language, lang) })));
    lines.push('');
  }
  lines.push(toSmallCaps(t(language, 'chatResponses.templateConfirmInstall', { count: entries.length })));
  lines.push('');
  lines.push(dups.length ? '1. 🔁 ' + toSmallCaps(t(language, 'chatResponses.templateReinstall')) : '1. ✅ ' + t(language, 'chatResponses.templateInstall'));
  if (dups.length) lines.push('2. ➕ ' + toSmallCaps(t(language, 'chatResponses.templateAddNew')));
  lines.push('');
  lines.push('0. ' + L(language, 'chatResponses.back'));
  return sendMenu({
    sock: context.sock, sender, chatId: context.chatId || sender,
    text: buildMenu('⚠️ ' + toSmallCaps(t(language, 'chatResponses.templateTitle')), '', lines),
    transitionKey: 'chat_template_duplicate_confirm'
  });
}

async function templateDoInstall(context, pack, language, entries, mode, editedRules) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const adminLang = resolveLanguage(sender);
  try {
    const { saveSnapshot } = await import('../services/snapshotService.js');
    saveSnapshot(`pack-install:${pack.id}`);
  } catch { /* snapshots must never break installs */ }
  const { installPackRules, clearPackLanguage } = await import('../services/chatTemplateService.js');
  if (mode === 'reinstall') {
    clearPackLanguage(pack.id, language);
  }
  const payload = editedRules || entries;
  const { added } = installPackRules(pack.id, payload, { mode: mode === 'add-new' ? 'add-new' : 'fresh', createdBy: sender });
  logAdminAction(sender, 'chat_template_install', `${pack.id} (${language}, ${mode}) → ${added} rule(s)`);
  try {
    const { recordPackInstall } = await import('../services/packStatsService.js');
    recordPackInstall(pack.id, added);
  } catch { /* stats must never break installs */ }
  const session = sessionManager.getSession(sender, chatId) || {};
  const place = { returnTo: session.pendingData?.returnTo || null, category: session.pendingData?.category || null };
  return showTemplateLibrary(context, {
    ...place,
    resultLine: `✅ ` + toSmallCaps(t(adminLang, 'chatResponses.templateInstalledOk', { count: added }))
  });
}

export async function handleTemplateDuplicateConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const { packId, language: lang, editedRules } = session.pendingData || {};
  if (trimmed === '0' || !packId) return showTemplatePackPreview(context);
  const { getPack, resolvePackRules, installedPackRules } = await import('../services/chatTemplateService.js');
  const pack = getPack(packId);
  if (!pack) return backFromTemplateChild(context);
  const entries = editedRules || resolvePackRules(pack, lang || 'en');
  const dups = editedRules ? [] : installedPackRules(packId, lang);
  if (trimmed === '1') {
    return templateDoInstall(context, pack, lang || 'en', entries, dups.length ? 'reinstall' : 'fresh', editedRules);
  }
  if (trimmed === '2' && dups.length) {
    return templateDoInstall(context, pack, lang || 'en', entries, 'add-new', null);
  }
  return showTemplatePackPreview(context);
}

export async function showTemplatePreviewEdit(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const packId = opts.packId || session.pendingData?.packId;
  if (!packId) return backFromTemplateChild(context);
  const place = templatePlace(context, opts);
  const lang = opts.language || session.pendingData?.previewLang || (['en', 'fr', 'de', 'es', 'ar'].includes(language) ? language : 'en');
  const { getPack, resolvePackRules } = await import('../services/chatTemplateService.js');
  const pack = getPack(packId);
  if (!pack) return backFromTemplateChild(context);
  const entries = resolvePackRules(pack, lang);
  const index = opts.index ?? session.pendingData?.index ?? 0;
  const accepted = opts.accepted || session.pendingData?.accepted || [];
  if (index >= entries.length) {
    if (!accepted.length) {
      return backFromTemplateChild(context);
    }
    sessionManager.setState(sender, chatId, {
      currentMenu: 'chat_template_duplicate_confirm',
      pendingAction: null,
      pendingData: { packId, ...place, language: lang, editedRules: accepted }
    });
    const lines = [
      toSmallCaps(t(language, 'chatResponses.templateReviewDone', { count: accepted.length })),
      '',
      toSmallCaps(t(language, 'chatResponses.templateConfirmInstall', { count: accepted.length })),
      '',
      '1. ✅ ' + t(language, 'chatResponses.templateInstall'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ];
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('⚠️ ' + toSmallCaps(t(language, 'chatResponses.templateTitle')), '', lines),
      transitionKey: 'chat_template_duplicate_confirm'
    });
  }
  const entry = entries[index];
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_template_preview_edit',
    pendingAction: null,
    pendingData: { packId, ...place, language: lang, index, accepted, current: { triggers: entry.triggers, replies: entry.replies } }
  });
  const lines = [
    { static: '', dynamic: `"${entry.triggers.join(' / ')}" → "${entry.replies[0] || ''}"` },
    '',
    '1. ✅ ' + toSmallCaps(t(language, 'chatResponses.templateKeepAsIs')),
    '2. ✏️ ' + toSmallCaps(t(language, 'chatResponses.templateEditRule')),
    '3. ⏭️ ' + toSmallCaps(t(language, 'chatResponses.templateSkipRule')),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(packLabel(language, pack), '', lines),
    transitionKey: 'chat_template_preview_edit'
  });
}

export async function handleTemplatePreviewEdit(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0' || pd.packId == null) return showTemplatePackPreview(context);
  const accepted = pd.accepted || [];
  if (trimmed === '1' && pd.current) {
    accepted.push({ triggers: pd.current.triggers, replies: pd.current.replies, language: pd.language });
    return showTemplatePreviewEdit(context, { packId: pd.packId, language: pd.language, index: (pd.index || 0) + 1, accepted });
  }
  if (trimmed === '2' && pd.current) {
    const language = resolveLanguage(sender);
    sessionManager.setState(sender, chatId, {
      currentMenu: 'chat_template_preview_edit_input',
      pendingAction: null,
      pendingData: { ...pd, accepted }
    });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(packLabel(language, { emoji: '✏️', nameKey: 'chatResponses.templateEditRule' }), '', [toSmallCaps(t(language, 'chatResponses.templateEditReplyPrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_template_preview_edit_input'
    });
  }
  if (trimmed === '3') {
    return showTemplatePreviewEdit(context, { packId: pd.packId, language: pd.language, index: (pd.index || 0) + 1, accepted });
  }
  return showTemplatePreviewEdit(context);
}

export async function handleTemplatePreviewEditInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0' || pd.packId == null) return showTemplatePackPreview(context);
  if (!trimmed) {
    await sendText(context.sock, sender, L(language, 'chatResponses.replyInvalid'));
    return showTemplatePreviewEdit(context);
  }
  const accepted = pd.accepted || [];
  if (pd.current) {
    accepted.push({ triggers: pd.current.triggers, replies: [trimmed], language: pd.language });
  }
  return showTemplatePreviewEdit(context, { packId: pd.packId, language: pd.language, index: (pd.index || 0) + 1, accepted });
}

export async function showTemplateUninstall(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = addRuleReturnTo(context, opts);
  const confirmPackId = opts.confirmPackId || session.pendingData?.confirmPackId || null;
  const { getPacks, getPack, installedPackRules } = await import('../services/chatTemplateService.js');
  if (confirmPackId) {
    const pack = getPack(confirmPackId);
    if (!pack) return showTemplateUninstall(context, { returnTo });
    const count = installedPackRules(confirmPackId).length;
    sessionManager.setState(sender, chatId, {
      currentMenu: 'chat_template_uninstall',
      pendingAction: null,
      pendingData: { returnTo, confirmPackId }
    });
    const lines = [
      toSmallCaps(t(language, 'chatResponses.templateUninstallConfirm', { pack: pack.name || t(language, pack.nameKey) })),
      toSmallCaps(t(language, 'chatResponses.templateUninstallWarn', { count })),
      '',
      '1. ✅ ' + L(language, 'admin.yes'),
      '2. ❌ ' + L(language, 'admin.no'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ];
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🗑️ ' + toSmallCaps(t(language, 'chatResponses.templateUninstallTitle')), '', lines),
      transitionKey: 'chat_template_uninstall'
    });
  }
  const packs = getPacks().map((p) => ({ pack: p, count: installedPackRules(p.id).length })).filter((x) => x.count > 0);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_template_uninstall', pendingAction: null, pendingData: { returnTo, confirmPackId: null } });
  if (!packs.length) {
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🗑️ ' + toSmallCaps(t(language, 'chatResponses.templateUninstallTitle')), toSmallCaps(t(language, 'chatResponses.templateNothingInstalled')), ['0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_template_uninstall'
    });
  }
  const lines = packs.map((x, i) => `${i + 1}. ${packLabel(language, x.pack)} (${toSmallCaps(t(language, 'chatResponses.templateInstalledCount', { count: x.count }))})`);
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🗑️ ' + toSmallCaps(t(language, 'chatResponses.templateUninstallTitle')), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_template_uninstall'
  });
}

export async function handleTemplateUninstall(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const returnTo = session.pendingData?.returnTo || null;
  const confirmPackId = session.pendingData?.confirmPackId || null;
  if (trimmed === '0') {
    if (confirmPackId) return showTemplateUninstall(context, { returnTo });
    return showTemplateLibrary(context, { returnTo });
  }
  const { getPacks, installedPackRules, uninstallPack } = await import('../services/chatTemplateService.js');
  if (confirmPackId) {
    if (trimmed === '1') {
      try {
        const { saveSnapshot } = await import('../services/snapshotService.js');
        saveSnapshot(`pack-uninstall:${confirmPackId}`);
      } catch { /* snapshots must never break uninstalls */ }
      const count = uninstallPack(confirmPackId);
      logAdminAction(sender, 'chat_template_uninstall', `${confirmPackId} → ${count} rule(s)`);
      return showTemplateLibrary(context, {
        returnTo,
        resultLine: `🗑️ ` + toSmallCaps(t(language, 'chatResponses.templateUninstalled', { count }))
      });
    }
    return showTemplateUninstall(context, { returnTo });
  }
  const packs = getPacks().map((p) => ({ pack: p, count: installedPackRules(p.id).length })).filter((x) => x.count > 0);
  const picked = packs[parseInt(trimmed, 10) - 1];
  if (!picked) return showTemplateUninstall(context, { returnTo });
  return showTemplateUninstall(context, { returnTo, confirmPackId: picked.pack.id });
}

// ---------------------------------------------------------------------------
// Create custom pack
// ---------------------------------------------------------------------------

function parsePackRuleLines(text, language) {
  const out = [];
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const triggers = line.slice(0, eq).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const replies = line.slice(eq + 1).split(';').map((s) => s.trim()).filter(Boolean);
    if (!triggers.length || !replies.length) continue;
    out.push({ triggers, replies: { [language]: replies } });
  }
  return out;
}

export async function showTemplateCreatePack(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const step = opts.step || session.pendingData?.step || 'name';
  const pd = { ...(session.pendingData || {}), ...(opts.preset || {}), step };
  if (!Array.isArray(pd.rules)) pd.rules = [];
  if (!pd.returnTo) pd.returnTo = addRuleReturnTo(context, opts);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_template_create_pack', pendingAction: null, pendingData: pd });
  const { getCategories } = await import('../services/chatTemplateService.js');
  let lines = [];
  let title = '➕ ' + toSmallCaps(t(language, 'templates.createPack'));
  if (step === 'name') {
    lines = [toSmallCaps(t(language, 'templates.createName')), '', '0. ' + L(language, 'chatResponses.back')];
  } else if (step === 'emoji') {
    lines = [toSmallCaps(t(language, 'templates.createEmoji')), '', '0. ' + L(language, 'chatResponses.back')];
  } else if (step === 'category') {
    const categories = getCategories();
    lines = categories.map((c, i) => `${i + 1}. ${categoryLabel(language, c)}`);
    lines.push('', '0. ' + L(language, 'chatResponses.back'));
    pd.categoryIds = categories.map((c) => c.id);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_template_create_pack', pendingAction: null, pendingData: pd });
  } else if (step === 'method') {
    lines = [
      '1. ➕ ' + toSmallCaps(t(language, 'templates.createManual')),
      '2. 📋 ' + toSmallCaps(t(language, 'templates.createFromExisting')),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ];
  } else if (step === 'manual') {
    lines = [toSmallCaps(t(language, 'templates.createManualPrompt')), '', '0. ' + L(language, 'chatResponses.back')];
  } else if (step === 'pick') {
    const { getAllRules } = await import('../services/chatRuleService.js');
    const rules = getAllRules().slice(0, 30);
    if (!rules.length) {
      await sendText(context.sock, sender, L(language, 'templates.createNoExisting'));
      return showTemplateCreatePack(context, { step: 'method' });
    }
    lines = rules.map((r, i) => `${i + 1}. ${(r.triggers || []).join(' / ').slice(0, 50)}`);
    lines.push('', toSmallCaps(t(language, 'templates.createPickPrompt')), '', '0. ' + L(language, 'chatResponses.back'));
    pd.pickIds = rules.map((r) => r.id);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_template_create_pack', pendingAction: null, pendingData: pd });
  } else if (step === 'review') {
    const { getCategory } = await import('../services/chatTemplateService.js');
    const cat = pd.category ? getCategory(pd.category) : null;
    lines = [
      { static: '', dynamic: `${pd.emoji || '📦'} "${pd.name || ''}" (${(pd.rules || []).length})` },
      { static: '', dynamic: cat ? `${cat.emoji} ${t(language, cat.nameKey)}` : '' },
      '',
      '1. ✅ ' + toSmallCaps(t(language, 'templates.createSave')),
      '2. ➕ ' + toSmallCaps(t(language, 'templates.createAddMore')),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ];
  }
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(title, '', lines), transitionKey: 'chat_template_create_pack' });
}

export async function handleTemplateCreatePack(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  const step = pd.step || 'name';
  const go = (nextStep, patch = {}) => showTemplateCreatePack(context, { step: nextStep, preset: patch });
  if (step === 'name') {
    if (trimmed === '0') return showTemplateLibrary(context);
    if (!trimmed) return go('name');
    return go('emoji', { name: trimmed.slice(0, 40) });
  }
  if (step === 'emoji') {
    if (trimmed === '0') return go('name');
    const found = (trimmed.match(/\p{Extended_Pictographic}/u) || [])[0];
    if (!found) {
      await sendText(context.sock, sender, L(language, 'templates.createInvalidEmoji'));
      return go('emoji');
    }
    return go('category', { emoji: found });
  }
  if (step === 'category') {
    if (trimmed === '0') return go('emoji');
    const ids = pd.categoryIds || [];
    const category = ids[parseInt(trimmed, 10) - 1];
    if (!category) return go('category');
    return go('method', { category });
  }
  if (step === 'method') {
    if (trimmed === '0') return go('category');
    if (trimmed === '1') return go('manual', { pickMethod: 'manual' });
    if (trimmed === '2') return go('pick', { pickMethod: 'pick' });
    return go('method');
  }
  if (step === 'manual') {
    if (trimmed === '0') return go((pd.rules || []).length ? 'review' : 'method');
    const adminLang = ['en', 'fr', 'de', 'es', 'ar'].includes(language) ? language : 'en';
    const parsed = parsePackRuleLines(trimmed, adminLang);
    return go('review', { rules: [...(pd.rules || []), ...parsed] });
  }
  if (step === 'pick') {
    if (trimmed === '0') return go('method');
    const { getRule } = await import('../services/chatRuleService.js');
    const ids = pd.pickIds || [];
    const picked = [...new Set(trimmed.split(',').map((s) => parseInt(s.trim(), 10) - 1))]
      .filter((i) => i >= 0 && ids[i])
      .map((i) => getRule(ids[i]))
      .filter(Boolean);
    if (!picked.length) return go('pick');
    const bundled = picked.map((r) => ({
      triggers: [...(r.triggers || [])],
      replies: { [['en', 'fr', 'de', 'es', 'ar'].includes(r.language) ? r.language : 'en']: [...(r.replies || ['…'])] }
    }));
    return go('review', { rules: [...(pd.rules || []), ...bundled] });
  }
  if (step === 'review') {
    if (trimmed === '0') return showTemplateLibrary(context);
    if (trimmed === '2') return go(pd.pickMethod === 'pick' ? 'pick' : 'manual');
    if (trimmed !== '1') return go('review');
    if (!(pd.rules || []).length) {
      await sendText(context.sock, sender, L(language, 'templates.createNeedRules'));
      return go('review');
    }
    const { saveCustomPack } = await import('../services/chatTemplateService.js');
    const id = saveCustomPack({ name: pd.name, emoji: pd.emoji, category: pd.category, rules: pd.rules });
    if (!id) return go('review');
    logAdminAction(sender, 'chat_template_create', `${id} → ${(pd.rules || []).length} rule(s)`);
    return showTemplateLibrary(context, {
      resultLine: `✅ ` + toSmallCaps(t(language, 'templates.createSaved', { count: (pd.rules || []).length }))
    });
  }
  return showTemplateLibrary(context);
}

// ---------------------------------------------------------------------------
// Template import / export
// ---------------------------------------------------------------------------

export async function showTemplateImportExport(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const returnTo = addRuleReturnTo(context, opts);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_template_import_export', pendingAction: null, pendingData: { returnTo, awaitingImport: false } });
  const lines = [
    '1. 📤 ' + toSmallCaps(t(language, 'templates.ieExportAll')),
    '2. 📤 ' + toSmallCaps(t(language, 'templates.ieExportCustom')),
    '3. 📥 ' + toSmallCaps(t(language, 'templates.ieImport')),
    '4. 📊 ' + toSmallCaps(t(language, 'templates.resetPackStats')),
    '5. 💾 ' + toSmallCaps(t(language, 'templates.snapshotsTitle')),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📦 ' + toSmallCaps(t(language, 'templates.ieTitle')), '', lines),
    transitionKey: 'chat_template_import_export'
  });
}

export async function handleTemplateImportExport(context, input, documentContent = null) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = session.pendingData?.returnTo || null;
  if (session.pendingData?.awaitingImport) {
    const content = documentContent || String(input || '').trim();
    if (content === '0' && !documentContent) return showTemplateImportExport(context, { returnTo });
    return handleTemplateImportInput(context, content);
  }
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showTemplateLibrary(context, { returnTo });
  if (trimmed === '1' || trimmed === '2') {
    const { exportTemplatePacks } = await import('../services/chatTemplateService.js');
    const scope = trimmed === '1' ? 'all' : 'custom';
    const packs = exportTemplatePacks(scope);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
    await context.sock.sendMessage(chatId, {
      document: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), packs }, null, 2), 'utf8'),
      mimetype: 'application/json',
      fileName: `templates-${stamp}.json`,
      caption: toSmallCaps(t(language, 'templates.ieExported'))
    });
    logAdminAction(sender, 'chat_template_export', `${scope} → ${Object.keys(packs).length} pack(s)`);
    return showTemplateImportExport(context, { returnTo });
  }
  if (trimmed === '3') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_template_import_export', pendingAction: null, pendingData: { returnTo, awaitingImport: true } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('📥 ' + toSmallCaps(t(language, 'templates.ieImport')), '', [toSmallCaps(t(language, 'templates.ieImportPrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_template_import_export'
    });
  }
  if (trimmed === '4') {
    const { resetPackStats } = await import('../services/packStatsService.js');
    resetPackStats();
    logAdminAction(sender, 'chat_template_stats_reset', 'pack stats cleared');
    return showTemplateLibrary(context, {
      returnTo,
      resultLine: `📊 ` + toSmallCaps(t(language, 'templates.packStatsReset'))
    });
  }
  if (trimmed === '5') return showTemplateSnapshots(context, { returnTo });
  return showTemplateImportExport(context, { returnTo });
}

export async function showTemplateSnapshots(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = addRuleReturnTo(context, opts);
  const confirmFile = opts.confirmFile || session.pendingData?.confirmFile || null;
  const { listSnapshots } = await import('../services/snapshotService.js');
  if (confirmFile) {
    const snap = listSnapshots().find((s) => s.file === confirmFile);
    if (!snap) return showTemplateSnapshots(context, { returnTo });
    sessionManager.setState(sender, chatId, {
      currentMenu: 'chat_snapshot_restore',
      pendingAction: null,
      pendingData: { returnTo, confirmFile }
    });
    const lines = [
      { static: '', dynamic: `${snap.file} (${snap.count ?? '?'} ${t(language, 'templates.snapshotRules')})` },
      toSmallCaps(t(language, 'templates.snapshotRestoreConfirm')),
      '',
      '1. ✅ ' + L(language, 'admin.yes'),
      '2. ❌ ' + L(language, 'admin.no'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ];
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('💾 ' + toSmallCaps(t(language, 'templates.snapshotsTitle')), '', lines),
      transitionKey: 'chat_snapshots'
    });
  }
  const snaps = listSnapshots();
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_snapshots', pendingAction: null, pendingData: { returnTo, confirmFile: null, files: snaps.map((s) => s.file) } });
  const lines = snaps.length
    ? snaps.map((s, i) => ({ static: `${i + 1}. `, dynamic: `${s.file} (${s.count ?? '?'} ${t(language, 'templates.snapshotRules')})` }))
    : [toSmallCaps(t(language, 'templates.noSnapshots'))];
  lines.push('', '0. ' + L(language, 'chatResponses.back'));
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('💾 ' + toSmallCaps(t(language, 'templates.snapshotsTitle')), '', lines),
    transitionKey: 'chat_snapshots'
  });
}

export async function handleTemplateSnapshots(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const returnTo = session.pendingData?.returnTo || null;
  const confirmFile = session.pendingData?.confirmFile || null;
  if (trimmed === '0') {
    if (confirmFile) return showTemplateSnapshots(context, { returnTo });
    return showTemplateImportExport(context, { returnTo });
  }
  if (confirmFile) {
    if (trimmed === '1') {
      const { restoreSnapshot } = await import('../services/snapshotService.js');
      const res = await restoreSnapshot(confirmFile);
      logAdminAction(sender, 'chat_snapshot_restore', `${confirmFile} → ok=${res.ok} count=${res.count}`);
      return showTemplateLibrary(context, {
        returnTo,
        resultLine: res.ok
          ? `💾 ` + toSmallCaps(t(language, 'templates.snapshotRestored', { count: res.count }))
          : `💾 ` + toSmallCaps(t(language, 'templates.snapshotRestoreFailed'))
      });
    }
    return showTemplateSnapshots(context, { returnTo });
  }
  const files = session.pendingData?.files || [];
  const file = files[parseInt(trimmed, 10) - 1];
  if (!file) return showTemplateSnapshots(context, { returnTo });
  return showTemplateSnapshots(context, { returnTo, confirmFile: file });
}

export async function handleTemplateImportInput(context, content) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = session.pendingData?.returnTo || null;
  let doc = null;
  try {
    doc = JSON.parse(String(content || ''));
  } catch {
    await sendText(context.sock, sender, L(language, 'chatResponses.importInvalid'));
    return showTemplateImportExport(context, { returnTo });
  }
  const { validateTemplateImport, getPack, isBuiltinPack } = await import('../services/chatTemplateService.js');
  const { packs, errors } = validateTemplateImport(doc);
  if (!packs.length) {
    await sendText(context.sock, sender, L(language, 'templates.ieNoPacks'));
    return showTemplateImportExport(context, { returnTo });
  }
  const fresh = [];
  const conflicts = [];
  for (const pack of packs) {
    const existing = getPack(pack.id);
    if (!existing) {
      fresh.push(pack);
      continue;
    }
    conflicts.push({
      pack,
      builtin: isBuiltinPack(pack.id),
      installedVersion: existing.version || 1,
      importedVersion: pack.version || 1
    });
  }
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_template_import_confirm',
    pendingAction: null,
    pendingData: { returnTo, fresh, conflicts, errors: errors.slice(0, 5) }
  });
  const mark = (c) => (c.importedVersion > c.installedVersion ? '↑' : c.importedVersion < c.installedVersion ? '↓' : '=');
  const lines = [
    toSmallCaps(t(language, 'templates.ieImport')),
    '',
    ...fresh.map((p) => ({ static: '', dynamic: `+ ${p.emoji} ${p.name || p.id} (${p.rules.length})` })),
    ...conflicts.map((c) => ({ static: '', dynamic: `≠ ${c.pack.emoji} ${c.pack.name || c.pack.id} (v${c.installedVersion} → v${c.importedVersion} ${mark(c)})${c.builtin ? ' [built-in]' : ''}` })),
    ...(errors.length ? [`⚠️ ${errors.length} ` + toSmallCaps(t(language, 'templates.ieNoPacks'))] : []),
    '',
    '1. ✅ ' + toSmallCaps(t(language, 'templates.ieOptionNewOnly')),
    ...(conflicts.some((c) => !c.builtin) ? ['2. 🔁 ' + toSmallCaps(t(language, 'templates.ieOptionOverwrite'))] : []),
    ...(conflicts.length ? ['3. ➕ ' + toSmallCaps(t(language, 'templates.ieOptionKeepBoth'))] : []),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('📥 ' + toSmallCaps(t(language, 'templates.ieTitle')), '', lines),
    transitionKey: 'chat_template_import_confirm'
  });
}

export async function handleTemplateImportConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0') return showTemplateImportExport(context, { returnTo: pd.returnTo });
  const { importTemplatePacks } = await import('../services/chatTemplateService.js');
  let mode = null;
  if (trimmed === '1') mode = 'skip';
  else if (trimmed === '2' && (pd.conflicts || []).some((c) => !c.builtin)) mode = 'overwrite';
  else if (trimmed === '3' && (pd.conflicts || []).length) mode = 'keep-both';
  if (!mode) return showTemplateImportExport(context, { returnTo: pd.returnTo });
  const all = [...(pd.fresh || []), ...(pd.conflicts || []).map((c) => c.pack)];
  try {
    const { saveSnapshot } = await import('../services/snapshotService.js');
    saveSnapshot('template-import');
  } catch { /* snapshots must never break imports */ }
  const res = importTemplatePacks(all, { conflict: mode });
  logAdminAction(sender, 'chat_template_import', `${mode} → imported=${res.imported} skipped=${res.skipped} renamed=${res.renamed} overwritten=${res.overwritten}`);
  return showTemplateLibrary(context, {
    returnTo: pd.returnTo,
    resultLine: `📥 ` + toSmallCaps(t(language, 'templates.ieImportDone', res))
  });
}

// ---------------------------------------------------------------------------
// Cleanup suggestions
// ---------------------------------------------------------------------------

export async function showCleanupSuggestions(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { generateCleanupSuggestions } = await import('../services/cleanupService.js');
  const { groups } = await generateCleanupSuggestions();
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_cleanup_suggestions', pendingAction: null, pendingData: null });
  const row = (n, key, count) => `${n}. ${toSmallCaps(t(language, key))} (${count})`;
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧹 ' + toSmallCaps(t(language, 'templates.cleanupTitle')), '', [
      '1. 💤 ' + toSmallCaps(t(language, 'templates.cleanupNoHits', { count: groups.noHits.length })),
      '2. 📋 ' + toSmallCaps(t(language, 'templates.cleanupDuplicates', { count: groups.duplicates.length })),
      '3. ⚠️ ' + toSmallCaps(t(language, 'templates.cleanupBroken', { count: groups.broken.length })),
      '4. 🗂️ ' + toSmallCaps(t(language, 'templates.cleanupOrphaned', { count: groups.orphaned.length })),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_cleanup_suggestions'
  });
}

function cleanupGroupItems(groups, group) {
  if (group === 'duplicates') return groups.duplicates.map((ids, i) => ({ key: `dup:${i}`, ids, label: ids.join(', ').slice(0, 60) }));
  if (group === 'broken') return groups.broken.map((b) => ({ key: `broken:${b.id}`, ids: [b.id], label: `${b.id} (${(b.placeholders || []).join(', ')})` }));
  const ids = groups[group] || [];
  return ids.map((id) => ({ key: `rule:${id}`, ids: [id], label: id }));
}

export async function showCleanupGroup(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const group = opts.group || session.pendingData?.group;
  const selected = opts.selected !== undefined ? opts.selected : session.pendingData?.selected || null;
  const { getCleanupSuggestions } = await import('../services/cleanupService.js');
  const stored = getCleanupSuggestions();
  if (!stored || !group) return showCleanupSuggestions(context);
  const items = cleanupGroupItems(stored.groups, group);
  if (selected) {
    const item = items.find((x) => x.key === selected);
    if (!item) return showCleanupGroup(context, { group });
    const isBroken = group === 'broken';
    sessionManager.setState(sender, chatId, {
      currentMenu: 'chat_cleanup_group',
      pendingAction: null,
      pendingData: { group, selected, ids: item.ids }
    });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🧹 ' + toSmallCaps(t(language, 'templates.cleanupTitle')), '', [
        { static: '', dynamic: item.label },
        '',
        '1. 🔛 ' + toSmallCaps(t(language, 'templates.cleanupDisable')),
        '2. 🗑️ ' + toSmallCaps(t(language, 'templates.cleanupDelete')),
        ...(isBroken ? ['3. 🔧 ' + toSmallCaps(t(language, 'templates.cleanupFix'))] : []),
        '',
        '0. ' + L(language, 'chatResponses.back')
      ]),
      transitionKey: 'chat_cleanup_group'
    });
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_cleanup_group', pendingAction: null, pendingData: { group, selected: null, items } });
  const lines = items.length
    ? items.map((x, i) => ({ static: `${i + 1}. `, dynamic: x.label }))
    : [toSmallCaps(t(language, 'templates.cleanupGroupEmpty'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧹 ' + toSmallCaps(t(language, 'templates.cleanupTitle')), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_cleanup_group'
  });
}

export async function handleCleanupSuggestions(context, input) {
  const trimmed = String(input || '').trim();
  if (trimmed === '0') {
    const { sendChatFaqMenu } = await import('./adminCommand.js');
    return sendChatFaqMenu(context);
  }
  const map = { 1: 'noHits', 2: 'duplicates', 3: 'broken', 4: 'orphaned' };
  if (!map[trimmed]) return showCleanupSuggestions(context);
  return showCleanupGroup(context, { group: map[trimmed] });
}

export async function handleCleanupGroup(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  if (trimmed === '0') {
    if (pd.selected) return showCleanupGroup(context, { group: pd.group });
    const { sendChatFaqMenu } = await import('./adminCommand.js');
    return sendChatFaqMenu(context);
  }
  if (pd.selected) {
    const ids = pd.ids || [];
    if (trimmed === '1') {
      for (const id of ids) chatRuleService.updateRule(id, { enabled: false });
      logAdminAction(sender, 'chat_cleanup_disable', `${pd.group}: ${ids.length} rule(s)`);
    } else if (trimmed === '2') {
      try {
        const { saveSnapshot } = await import('../services/snapshotService.js');
        saveSnapshot('cleanup-delete');
      } catch { /* snapshots must never break cleanup */ }
      for (const id of ids) chatRuleService.deleteRule(id);
      logAdminAction(sender, 'chat_cleanup_delete', `${pd.group}: ${ids.length} rule(s)`);
    } else if (trimmed === '3' && pd.group === 'broken') {
      for (const id of ids) {
        const rule = chatRuleService.getRule(id);
        if (!rule) continue;
        const fixed = (rule.replies || []).map((r) => String(r).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, name) =>
          ['username', 'firstname', 'time', 'date', 'botname', 'user_id', 'level'].includes(name) ? m : ''));
        chatRuleService.updateRule(id, { replies: fixed });
      }
      logAdminAction(sender, 'chat_cleanup_fix', `${ids.length} rule(s)`);
    } else {
      return showCleanupGroup(context, { group: pd.group, selected: pd.selected });
    }
    return showCleanupSuggestions(context);
  }
  const items = pd.items || [];
  const item = items[parseInt(trimmed, 10) - 1];
  if (!item) return showCleanupGroup(context, { group: pd.group });
  return showCleanupGroup(context, { group: pd.group, selected: item.key });
}

// ---------------------------------------------------------------------------
// Bulk add: `trigger = reply1 ; reply2` one per line
// ---------------------------------------------------------------------------

function parseBulkRules(text) {
  const out = [];
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const triggers = line.slice(0, eq).split(';').map((x) => normalize(x)).filter(Boolean);
    const replies = line.slice(eq + 1).split(';').map((x) => x.trim()).filter(Boolean);
    if (triggers.length && replies.length) out.push({ triggers, replies });
  }
  return out;
}

export async function handleBulkAddInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  const parsed = parseBulkRules(trimmed);
  if (!parsed.length) {
    return sendText(context.sock, sender, L(language, 'chatResponses.bulkInvalid'));
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_preview', pendingData: { rules: parsed } });
  const lines = [
    ...parsed.map((r, i) => `${i + 1}. ${r.triggers.join(', ')} → ${r.replies.join(' ; ')}`),
    '',
    '1. ' + t(language, 'chatResponses.bulkContinue')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('📦 ' + L(language, 'chatResponses.bulkPreviewTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_bulk_preview' });
}

export async function handleBulkPreview(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  if (trimmed !== '1' || !session.pendingData?.rules?.length) {
    return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 1 }));
  }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_bulk_language', pendingData: session.pendingData });
  const lines = LANGUAGE_OPTIONS.map(([sec, key, n]) => `${n}. ${t(language, `chatResponses.${key}`)}`);
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.bulkLanguageTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_bulk_language' });
}

export async function handleBulkLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  const map = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar', 6: 'all' };
  if (!map[trimmed] || !session.pendingData?.rules) return sendChatPanel(context);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_bulk_policy',
    pendingData: { rules: session.pendingData.rules, language: map[trimmed] }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(L(language, 'chatResponses.bulkPolicyTitle'), '', [
      '1. ' + t(language, 'chatResponses.policySkip'),
      '2. ' + t(language, 'chatResponses.policyOverwrite'),
      '3. ' + t(language, 'chatResponses.policyKeepBoth'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_bulk_policy'
  });
}

export async function handleBulkPolicy(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const pending = session.pendingData || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendChatPanel(context);
  const policy = { 1: 'skip', 2: 'overwrite', 3: 'keepBoth' }[trimmed];
  if (!policy || !Array.isArray(pending.rules)) {
    return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 3 }));
  }
  let added = 0;
  let skipped = 0;
  let overwritten = 0;
  for (const raw of pending.rules) {
    const dupe = chatRuleService.getAllRules().find((e) =>
      chatRuleService.isDuplicateRule({ ...raw, language: pending.language || 'en' }, e));
    if (dupe) {
      if (policy === 'skip') { skipped++; continue; }
      if (policy === 'overwrite') { chatRuleService.deleteRule(dupe.id); overwritten++; }
      if (policy === 'keepBoth') { delete raw.id; }
    }
    chatRuleService.addRule({ ...raw, language: pending.language || 'en', createdBy: sender, enabled: true });
    added++;
  }
  logAdminAction(sender, 'chat_bulk_add', `${policy} added=${added} skipped=${skipped} overwritten=${overwritten}`);
  return sendChatPanel(context, { resultLine: toSmallCaps(t(language, 'chatResponses.bulkAddDone', { added, skipped, overwritten })) });
}

// ---------------------------------------------------------------------------
// Unmatched messages inbox
// ---------------------------------------------------------------------------

export async function showUnmatchedList(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const { getUnmatched } = await import('../services/unmatchedService.js');
  const entries = getUnmatched().slice(0, 20);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_unmatched',
    pendingData: { ids: entries.map((e) => e.id), returnTo: opts.returnTo || 'chat_submenu' }
  });
  const lines = entries.length
    ? entries.map((e, i) => `${i + 1}. "${e.text.slice(0, 50)}"`)
    : [L(language, 'chatResponses.unmatchedEmpty')];
  lines.push('', 's. 💡 ' + toSmallCaps(t(language, 'templates.suggestionsTitle')));
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('❓ ' + L(language, 'chatResponses.unmatchedTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_unmatched'
  });
}

export async function showSmartSuggestions(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const returnTo = opts.returnTo || session.pendingData?.returnTo || null;
  const selected = opts.selected !== undefined ? opts.selected : (session.pendingData?.selected || null);
  const { topSuggestions } = await import('../services/suggestionService.js');
  if (selected) {
    const top = topSuggestions(5);
    const item = top.find((x) => x.key === selected);
    if (!item) return showSmartSuggestions(context, { returnTo, selected: null });
    sessionManager.setState(sender, chatId, {
      currentMenu: 'chat_smart_suggestions',
      pendingAction: null,
      pendingData: { returnTo, selected, detail: true }
    });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('💡 ' + toSmallCaps(t(language, 'templates.suggestionsTitle')), '', [
        { static: '', dynamic: `"${item.message}" (${item.count})` },
        '',
        '1. ➕ ' + toSmallCaps(t(language, 'templates.suggestionCreateRule')),
        '2. ❌ ' + toSmallCaps(t(language, 'templates.suggestionIgnore')),
        '',
        '0. ' + L(language, 'chatResponses.back')
      ]),
      transitionKey: 'chat_smart_suggestions'
    });
  }
  const top = topSuggestions(5);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_smart_suggestions',
    pendingAction: null,
    pendingData: { returnTo, selected: null, detail: false, keys: top.map((x) => x.key) }
  });
  const lines = top.length
    ? top.map((x, i) => ({ static: `${i + 1}. `, dynamic: `"${x.message.slice(0, 45)}" (${x.count})` }))
    : [toSmallCaps(t(language, 'templates.noSuggestions'))];
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('💡 ' + toSmallCaps(t(language, 'templates.suggestionsTitle')), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_smart_suggestions'
  });
}

export async function handleSmartSuggestions(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const pd = session.pendingData || {};
  const { topSuggestions, ignoreSuggestion, removeSuggestion } = await import('../services/suggestionService.js');
  if (pd.detail) {
    if (trimmed === '0') return showSmartSuggestions(context, { returnTo: pd.returnTo });
    const item = topSuggestions(5).find((x) => x.key === pd.selected);
    if (!item) return showSmartSuggestions(context, { returnTo: pd.returnTo });
    if (trimmed === '1') {
      const looksQuestion = /[?؟]$/.test(item.message.trim())
        || /^(who|what|when|where|why|how|is|are|can|do|does|comment|wie|was|cómo|qué|cómo|كيف|ما|هل)\b/i.test(item.message.trim());
      removeSuggestion(pd.selected);
      if (looksQuestion) {
        const { startFaqFromUnmatched } = await import('./faqCommand.js');
        logAdminAction(sender, 'unmatched_suggest_create_faq', item.message.slice(0, 60));
        return startFaqFromUnmatched(context, item.message);
      }
      const draft = quickDraft(sender);
      draft.triggers = [item.message.toLowerCase()].filter(Boolean);
      logAdminAction(sender, 'unmatched_suggest_create', item.message.slice(0, 60));
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_replies', chatDraft: draft, pendingData: { unmatchedText: item.message } });
      const language = resolveLanguage(sender);
      return sendMenu({
        sock: context.sock, sender, chatId,
        text: buildMenu('⚡ ' + L(language, 'chatResponses.quickReplyTitle'), '', [
          { static: toSmallCaps(t(language, 'chatResponses.unmatchedPrefill')) + ': ', dynamic: `"${item.message}"` },
          '',
          toSmallCaps(t(language, 'chatResponses.quickReplyPrompt'))
        ]),
        transitionKey: 'chat_quick_replies'
      });
    }
    if (trimmed === '2') {
      ignoreSuggestion(pd.selected);
      logAdminAction(sender, 'unmatched_suggest_ignore', item.message.slice(0, 60));
      return showSmartSuggestions(context, { returnTo: pd.returnTo });
    }
    return showSmartSuggestions(context, { returnTo: pd.returnTo, selected: pd.selected });
  }
  if (trimmed === '0') return showUnmatchedList(context, { returnTo: pd.returnTo });
  const key = (pd.keys || [])[parseInt(trimmed, 10) - 1];
  if (!key) return showSmartSuggestions(context, { returnTo: pd.returnTo });
  return showSmartSuggestions(context, { returnTo: pd.returnTo, selected: key });
}

async function backFromUnmatched(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  if (session.pendingData?.returnTo === 'chat_faq_menu') {
    const { sendChatFaqMenu } = await import('./adminCommand.js');
    return sendChatFaqMenu(context);
  }
  if (session.pendingData?.returnTo === 'chat_add_rule') return sendAddRuleMenu(context);
  return sendChatPanel(context);
}

export async function handleUnmatchedList(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return backFromUnmatched(context);
  if (trimmed.toLowerCase() === 's') return showSmartSuggestions(context, { returnTo: session.pendingData?.returnTo });
  const ids = session.pendingData?.ids || [];
  const { getUnmatched } = await import('../services/unmatchedService.js');
  const entries = getUnmatched();
  const entry = entries[parseInt(trimmed, 10) - 1];
  if (!entry || !ids.includes(entry.id)) return showUnmatchedList(context, { returnTo: session.pendingData?.returnTo });
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_unmatched_detail', pendingData: { id: entry.id, returnTo: session.pendingData?.returnTo } });
  const text = buildMenu('❓ ' + L(language, 'chatResponses.unmatchedDetail'), '', [
    { static: '', dynamic: `"${entry.text}" (${entry.count || 1})` },
    '',
    '1. ' + t(language, 'chatResponses.unmatchedCreate'),
    '2. ' + t(language, 'chatResponses.unmatchedDelete'),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ]);
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'chat_unmatched_detail' });
}

export async function handleUnmatchedDetail(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const id = session.pendingData?.id;
  const { getUnmatched, deleteUnmatched } = await import('../services/unmatchedService.js');
  const entry = getUnmatched(true).find((e) => e.id === id);
  if (trimmed === '0' || !entry) return showUnmatchedList(context, { returnTo: session.pendingData?.returnTo });
  if (trimmed === '2') {
    deleteUnmatched(id);
    logAdminAction(sender, 'unmatched_delete', id);
    return showUnmatchedList(context, { returnTo: session.pendingData?.returnTo });
  }
  if (trimmed !== '1') return showUnmatchedList(context, { returnTo: session.pendingData?.returnTo });
  const draft = quickDraft(sender);
  draft.triggers = [normalize(entry.text)].filter(Boolean);
  if (!draft.triggers.length) return showUnmatchedList(context);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_replies', chatDraft: draft, pendingData: { unmatchedId: entry.id } });
  const lines = [
    { static: toSmallCaps(t(language, 'chatResponses.unmatchedPrefill')) + ': ', dynamic: `"${entry.text}"` },
    '',
    toSmallCaps(t(language, 'chatResponses.quickReplyPrompt'))
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('⚡ ' + L(language, 'chatResponses.quickReplyTitle'), '', lines), transitionKey: 'chat_quick_replies' });
}

const TRIGGER_OPTIONS = [
  ['triggerAddMore', '1'],
  ['triggerDeleteLast', '2'],
  ['triggerDeleteAll', '3'],
  ['triggerCustomize', '4'],
  ['triggerContinue', '5'],
  ['triggerSaveDraft', '6']
];

async function saveDraftRule(context, draft) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  if (!draft.triggers || draft.triggers.length === 0) {
    return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
  }
  const id = chatRuleService.addRule({
    triggers: draft.triggers,
    triggerExact: false,
    replies: draft.replies || [],
    language: draft.language || 'all',
    priority: draft.priority || 1,
    style: draft.style || 'friendly',
    emojisEnabled: draft.emojisEnabled !== false,
    action: draft.action || 'send_text',
    cooldownSeconds: draft.cooldownSeconds || 0,
    activeFrom: draft.activeFrom || null,
    activeTo: draft.activeTo || null,
    createdBy: draft.createdBy || sender,
    status: 'draft',
    enabled: false
  });
  logAdminAction(sender, 'chat_draft_save', (id + ' · ' + (draft.triggers || []).join(', ')));
  return sendChatPanel(context, { resultLine: L(language, 'chatResponses.draftSaved') });
}

function triggerEditMenu(language, draft) {
  const lines = [
    L(language, 'chatResponses.triggerEditTitle') + ':',
    ''
  ];
  draft.triggers.forEach((tr, i) => lines.push(`${i + 1}. ${t(language, 'chatResponses.previewTrigger')}: ` + tr));
  lines.push('');
  TRIGGER_OPTIONS.forEach(([key, n]) => lines.push(`${n}. ${t(language, 'chatResponses.' + key)}`));
  lines.push('');
  lines.push('0. ' + t(language, 'chatResponses.cancelled'));
  return buildMenu(L(language, 'chatResponses.previewTitle'), '', lines);
}

function setState(sender, chatId, patch) {
  const s = sessionManager.getSession(sender, chatId) || {};
  sessionManager.setState(sender, chatId, Object.assign({
    currentMenu: 'chat_add_triggers',
    chatDraft: s.chatDraft
  }, patch));
}

export async function handleChatAddStart(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  if (input === '1') {
    const draft = { triggers: [], replies: [], language: 'all', priority: 1, style: 'friendly', emojisEnabled: true, createdBy: sender };
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_triggers', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerPrompt')), transitionKey: 'chat_add_triggers' });
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.cancelled'));
}

const VARIATION_SYNONYMS = {
  hello: ['hi', 'hey'],
  hi: ['hello', 'hey'],
  hey: ['hello', 'hi'],
  thanks: ['thank you'],
  'thank you': ['thanks'],
  bye: ['goodbye'],
  goodbye: ['bye'],
  help: ['help me'],
  'help me': ['help']
};

/**
 * Generate display variations for a trigger: original, case, punctuation,
 * edit-distance-1 typos and synonyms. Capped at 6, exact duplicates removed.
 */
export function generateTriggerVariations(trigger) {
  const base = String(trigger || '').trim();
  if (!base) return [];
  const out = [base];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && !out.includes(s) && out.length < 6) out.push(s);
  };
  push(base.charAt(0).toUpperCase() + base.slice(1));
  if (!/[!?.]$/.test(base)) push(base + '!');
  for (const syn of VARIATION_SYNONYMS[base.toLowerCase()] || []) push(syn);
  if (base.length > 3) {
    push(base.slice(0, -2) + base.slice(-1));
    push(base[1] + base[0] + base.slice(2));
    push(base.slice(0, -1));
  }
  return out;
}

function buildVariationsMenu(language, variations, selected) {
  const lines = [
    L(language, 'chatResponses.varHint'),
    '',
    ...variations.map((v, i) => `${i + 1}. ${(selected.includes(i) ? '✅ ' : '⬜ ') + v}`),
    '',
    `1-${variations.length}. ` + t(language, 'chatResponses.varToggle'),
    `7. ➕ ` + L(language, 'chatResponses.varAddMore'),
    `8. ✅ ` + L(language, 'chatResponses.varDone'),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return buildMenu('🔀 ' + L(language, 'chatResponses.varTitle'), '', lines);
}

async function showTriggerVariations(context, baseTrigger, extra = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const variations = generateTriggerVariations(baseTrigger);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_trigger_variations',
    chatDraft: session.chatDraft,
    pendingData: { variations, selected: [0], baseTrigger, ...extra }
  });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildVariationsMenu(language, variations, [0]), transitionKey: 'chat_trigger_variations' });
}

export async function handleTriggerVariations(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  const variations = pending.variations || [];
  const selected = [...(pending.selected || [0])];
  const trimmed = String(input || '').trim();

  if (trimmed === '0') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_triggers', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerPrompt')), transitionKey: 'chat_add_triggers' });
  }
  const n = parseInt(trimmed, 10);
  if (!isNaN(n) && n >= 1 && n <= variations.length) {
    const idx = selected.indexOf(n - 1);
    if (idx >= 0) selected.splice(idx, 1);
    else selected.push(n - 1);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_trigger_variations', chatDraft: draft, pendingData: { ...pending, selected } });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildVariationsMenu(language, variations, selected), transitionKey: 'chat_trigger_variations' });
  }
  if (trimmed === '7') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_trigger_variations_add', chatDraft: draft, pendingData: pending });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerPrompt')), transitionKey: 'chat_trigger_variations_add' });
  }
  if (trimmed === '8') {
    const picked = selected.map((i) => variations[i]).filter(Boolean);
    const finalized = [...new Set(picked.map((v) => normalize(v)).filter(Boolean))];
    if (pending.mode === 'edit' && pending.editId) {
      if (finalized.length) {
        chatRuleService.updateRule(pending.editId, { triggers: finalized });
        logAdminAction(sender, 'chat_rule_edit', (pending.editId + ' triggers updated (variations)'));
      }
      return openEditChat(context, pending.editId);
    }
    draft.triggers = [...(draft.triggers || []), ...finalized];
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_trigger_edit', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: triggerEditMenu(language, draft), transitionKey: 'chat_add_trigger_edit' });
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 8 }));
}

export async function handleTriggerVariationsAdd(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  const custom = String(input || '').trim();
  if (!custom) return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
  const variations = [...(pending.variations || []), custom].slice(0, 12);
  const selected = [...(pending.selected || []), variations.length - 1];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_trigger_variations', chatDraft: draft, pendingData: { ...pending, variations, selected } });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildVariationsMenu(language, variations, selected), transitionKey: 'chat_trigger_variations' });
}

export async function handleChatAddTriggerInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const triggers = splitSemicolons(input).map((x) => normalize(x)).filter(Boolean);
  if (triggers.length === 0) {
    return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
  }
  return showTriggerVariations(context, triggers[0], {});
}

export async function handleChatAddTriggerEdit(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};

  if (input === '0') {
    return sendText(context.sock, sender, L(language, 'chatResponses.cancelled'));
  }
  if (input === '1') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_triggers', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerPrompt')), transitionKey: 'chat_add_triggers' });
  }
  if (input === '2') {
    draft.triggers = draft.triggers.slice(0, -1);
    if (draft.triggers.length === 0) return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_trigger_edit', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: triggerEditMenu(language, draft), transitionKey: 'chat_add_trigger_edit' });
  }
  if (input === '3') {
    draft.triggers = [];
    return sendText(context.sock, sender, L(language, 'chatResponses.triggerCleared') + ' ' + L(language, 'chatResponses.emptyTriggers'));
  }
  if (input === '4') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_custom_trigger', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerCustomPrompt')), transitionKey: 'chat_add_trigger_edit' });
  }
  if (input === '5') {
    if (!draft.triggers || draft.triggers.length === 0) {
      return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
    }
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_replies', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.replyPrompt')), transitionKey: 'chat_add_replies' });
  }
  if (input === '6') {
    return saveDraftRule(context, draft);
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 6 }));
}

export async function handleChatAddCustomTrigger(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const norm = normalize(input);
  if (!norm) return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
  draft.triggers = [...draft.triggers, norm];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_trigger_edit', chatDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: triggerEditMenu(language, draft), transitionKey: 'chat_add_trigger_edit' });
}

export async function handleChatAddReplies(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const replies = splitSemicolons(input);
  if (replies.length === 0) {
    return sendText(context.sock, sender, L(language, 'chatResponses.emptyReplies'));
  }
  if ((draft.replies?.length || 0) + replies.length > MAX_REPLIES) {
    return sendText(context.sock, sender, L(language, 'chatResponses.repliesTooMany'));
  }
  draft.replies = [...(draft.replies || []), ...replies];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_preview', chatDraft: draft });
  return showAddReplySnippetPrompt(context);
}

export async function showAddReplySnippetPrompt(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_reply_snippet', pendingAction: null, pendingData: null });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧩 ' + L(language, 'chatResponses.insertSnippetTitle'), '', [
      '1. ' + t(language, 'chatResponses.insertSnippetNo'),
      '2. ' + t(language, 'chatResponses.insertSnippetShow'),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_add_reply_snippet'
  });
}

async function resumeAddWalkAfterSnippet(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const replies = Array.isArray(draft.replies) ? draft.replies : [];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_preview', chatDraft: draft });
  if (await styleWalkEnabled()) {
    return showReplyStyleWalk(context, { flow: 'add', replies, index: 0, styled: [] });
  }
  return showReplyTagWalk(context, { flow: 'add', replies, index: 0, tagged: [] });
}

export async function handleAddReplySnippet(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const trimmed = String(input || '').trim();
  if (trimmed === '0' || trimmed === '1') return resumeAddWalkAfterSnippet(context);
  if (trimmed === '2') {
    const names = await snippetNames();
    if (!names.length) {
      await sendText(context.sock, sender, L(language, 'chatResponses.snippetsEmpty'));
      return resumeAddWalkAfterSnippet(context);
    }
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_reply_snippet_pick', pendingAction: null, pendingData: null });
    const lines = names.map((n, i) => `${i + 1}. {snippet:${n}}`);
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🧩 ' + L(language, 'chatResponses.insertSnippetTitle'), '', [...lines, '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_add_reply_snippet_pick' });
  }
  return showAddReplySnippetPrompt(context);
}

export async function handleAddReplySnippetPick(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showAddReplySnippetPrompt(context);
  const names = await snippetNames();
  const name = names[parseInt(trimmed, 10) - 1];
  if (!name) return showAddReplySnippetPrompt(context);
  const draft = session.chatDraft || {};
  const replies = Array.isArray(draft.replies) ? [...draft.replies] : [];
  if (!replies.length) return resumeAddWalkAfterSnippet(context);
  const last = replies[replies.length - 1];
  const tag = ` {snippet:${name}}`;
  if (typeof last === 'string') replies[replies.length - 1] = last + tag;
  else if (last && typeof last === 'object') replies[replies.length - 1] = { ...last, text: String(last.text || '') + tag };
  draft.replies = replies;
  sessionManager.setState(sender, chatId, { chatDraft: draft });
  logAdminAction(sender, 'chat_add_insert_snippet', name);
  await sendText(context.sock, sender, L(language, 'chatResponses.insertSnippetDone', { name }));
  return showAddReplySnippetPrompt(context);
}

function previewReplyLine(r) {
  const text = typeof r === 'string' ? r : String(r?.text ?? '');
  const bits = [];
  if (r && typeof r === 'object') {
    if (Number(r.weight) !== 1) bits.push(`w: ${r.weight}`);
    if (r.time && r.time !== 'any') bits.push(`t: ${r.time}`);
    if (r.emotion && r.emotion !== 'any') bits.push(`e: ${r.emotion}`);
  }
  return '• ' + text + (bits.length ? ` (${bits.join(', ')})` : '');
}

function previewMenu(language, draft) {
  const lines = [
    L(language, 'chatResponses.previewTrigger') + ': ' + draft.triggers.map((s) => '`' + s + '`').join(', '),
    L(language, 'chatResponses.previewReplies') + ':',
    ...(draft.replies || []).map(previewReplyLine),
    '',
    '1. ' + t(language, 'chatResponses.confirmYes'),
    '2. ' + t(language, 'chatResponses.addMoreReplies'),
    '3. ' + t(language, 'chatResponses.deleteAllReplies'),
    '',
    'b. ' + t(language, 'chatResponses.backToTriggers'),
    '',
    '0. ' + t(language, 'chatResponses.cancelled')
  ];
  return buildMenu(L(language, 'chatResponses.previewTitle'), '', lines);
}

const SAMPLE_PREVIEW_USER = { username: 'John', name: 'John', jid: '123456789@lid', level: 7 };

async function previewResolvedReply(reply) {
  let expanded = String(typeof reply === 'string' ? reply : (reply?.text ?? ''));
  try {
    const { expandSnippets } = await import('../utils/snippetExpander.js');
    expanded = expandSnippets(expanded, 'en');
  } catch { /* preview must never break */ }
  return replacePlaceholders(expanded, SAMPLE_PREVIEW_USER, config);
}

async function buildResponsePreview(language, draft) {
  const trigger = (draft.triggers && draft.triggers[0]) || '';
  const resolvedReplies = [];
  for (const r of draft.replies || []) {
    resolvedReplies.push(await previewResolvedReply(r));
  }
  const lines = [
    { static: toSmallCaps(t(language, 'chatResponses.previewUserSays')) + ': ', dynamic: `"${trigger}"` },
    ...(resolvedReplies.map((text) => ({
      static: toSmallCaps(t(language, 'chatResponses.previewBotReplies')) + ': ',
      dynamic: `"${text}"`
    })))
  ];
  return buildMenu('📖 ' + L(language, 'chatResponses.previewResponseTitle'), '', [
    ...lines,
    '',
    '1. ✅ ' + t(language, 'chatResponses.previewConfirmSave'),
    '2. ✏️ ' + t(language, 'chatResponses.previewEditReply'),
    '3. 🔙 ' + t(language, 'chatResponses.previewBack'),
    '',
    '0. ' + t(language, 'chatResponses.back')
  ]);
}

async function showResponsePreview(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_response_preview', chatDraft: session.chatDraft });
  return sendMenu({ sock: context.sock, sender, chatId, text: await buildResponsePreview(language, session.chatDraft || {}), transitionKey: 'chat_response_preview' });
}

export async function handleResponsePreview(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();

  if (trimmed === '1') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_language', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.languageTitle'), '', [...languageMenu(language), '', '0. ' + t(language, 'chatResponses.cancelled')]), transitionKey: 'chat_add_language' });
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_replies', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.replyPrompt')), transitionKey: 'chat_add_replies' });
  }
  if (trimmed === '3' || trimmed === '0') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_preview', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: previewMenu(language, draft), transitionKey: 'chat_add_preview' });
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 3 }));
}

export async function handleChatAddPreview(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};

  if (input === '1') {
    return showResponsePreview(context);
  }
  if (input === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_replies', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.replyPrompt')), transitionKey: 'chat_add_replies' });
  }
  if (input === '3') {
    draft.replies = [];
    return sendText(context.sock, sender, L(language, 'chatResponses.repliesCleared'));
  }
  if (input.toLowerCase() === 'b') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_trigger_edit', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: triggerEditMenu(language, draft), transitionKey: 'chat_add_trigger_edit' });
  }
  if (input === '0') {
    return sendText(context.sock, sender, L(language, 'chatResponses.cancelled'));
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 3 }));
}

const STYLE_OPTIONS = [
  ['styleFriendly', '1'],
  ['styleCasual', '2'],
  ['styleFormal', '3'],
  ['styleMinimal', '4']
];

export async function handleChatAddLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const map = { '1': 'en', '2': 'fr', '3': 'de', '4': 'es', '5': 'ar', '6': 'all' };
  if (!map[input]) return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 6 }));
  draft.language = map[input];
  return showPriorityReorder(context, draft, { mode: 'create' });
}

function reorderOrderFor(lang, draftOrId) {
  const sameLang = chatRuleService.getAllRules()
    .filter((r) => (r.language || 'all') === (lang || 'all'))
    .sort((a, b) => (b.priority || 1) - (a.priority || 1));
  return sameLang.map((r) => ({ id: r.id, label: r.triggers[0] || r.id, priority: r.priority || 1, isDraft: false }));
}

function buildReorderMenu(language, order, selectedId) {
  const lines = [
    L(language, 'chatResponses.reorderCurrent'),
    '',
    ...order.map((item, i) => `${i + 1}. "${item.label}" (ᴘ${item.priority})${item.id === selectedId ? ' ①' : ''}`),
    '',
    `${order.length + 1}. ⬆️ ` + L(language, 'chatResponses.reorderUp'),
    `${order.length + 2}. ⬇️ ` + L(language, 'chatResponses.reorderDown'),
    `${order.length + 3}. ✅ ` + L(language, 'chatResponses.reorderDone'),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return buildMenu('🕹️ ' + L(language, 'chatResponses.reorderTitle'), '', lines);
}

async function showPriorityReorder(context, draftOrId, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const mode = opts.mode || 'create';
  let order;
  let selectedId = null;
  if (mode === 'edit') {
    const rule = chatRuleService.getRule(draftOrId);
    if (!rule) return sendText(context.sock, sender, L(language, 'chatResponses.notFound'));
    order = reorderOrderFor(rule.language);
    selectedId = rule.id;
  } else {
    const draft = draftOrId || {};
    order = reorderOrderFor(draft.language);
    order.push({ id: '__draft__', label: (draft.triggers && draft.triggers[0]) || 'new', priority: 1, isDraft: true });
    selectedId = '__draft__';
  }
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_priority_reorder',
    chatDraft: mode === 'create' ? (draftOrId || {}) : undefined,
    pendingData: { mode, editId: mode === 'edit' ? draftOrId : null, order, selectedId }
  });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildReorderMenu(language, order, selectedId), transitionKey: 'chat_priority_reorder' });
}

function moveSelected(order, selectedId, dir) {
  const idx = order.findIndex((item) => item.id === selectedId);
  if (idx < 0) return order;
  const swapWith = idx + dir;
  if (swapWith < 0 || swapWith >= order.length) return order;
  const next = [...order];
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  return next;
}

function renumberPriorities(order) {
  const top = Math.min(order.length, 10);
  order.forEach((item, i) => {
    item.priority = Math.max(1, top - i);
  });
  return order;
}

export async function handlePriorityReorder(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  let order = pending.order || [];
  let selectedId = pending.selectedId || null;
  const mode = pending.mode || 'create';
  const trimmed = String(input || '').trim();

  if (trimmed === '0') {
    if (mode === 'edit') return openEditChat(context, pending.editId);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_language', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.languageTitle'), '', [...languageMenu(language), '', '0. ' + t(language, 'chatResponses.cancelled')]), transitionKey: 'chat_add_language' });
  }
  const n = parseInt(trimmed, 10);
  if (!isNaN(n) && n >= 1 && n <= order.length) {
    selectedId = order[n - 1].id;
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_priority_reorder', chatDraft: mode === 'create' ? draft : undefined, pendingData: { ...pending, selectedId } });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildReorderMenu(language, order, selectedId), transitionKey: 'chat_priority_reorder' });
  }
  if (n === order.length + 1 || n === order.length + 2) {
    order = moveSelected(order, selectedId, n === order.length + 1 ? -1 : 1);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_priority_reorder', chatDraft: mode === 'create' ? draft : undefined, pendingData: { ...pending, order, selectedId } });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildReorderMenu(language, order, selectedId), transitionKey: 'chat_priority_reorder' });
  }
  if (n === order.length + 3) {
    renumberPriorities(order);
    for (const item of order) {
      if (!item.isDraft) chatRuleService.updateRule(item.id, { priority: item.priority });
    }
    logAdminAction(sender, 'chat_priority_reorder', `${order.length} rule(s)`);
    if (mode === 'edit') return openEditChat(context, pending.editId);
    const draftItem = order.find((item) => item.isDraft);
    draft.priority = draftItem ? draftItem.priority : 1;
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_style', chatDraft: draft });
    const lines = [L(language, 'chatResponses.styleSelect'), ''];
    STYLE_OPTIONS.forEach(([key, num]) => lines.push(`${num}. ${t(language, 'chatResponses.' + key)}`));
    lines.push('', '0. ' + t(language, 'chatResponses.cancelled'));
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.styleTitle'), '', lines), transitionKey: 'chat_add_style' });
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: order.length + 3 }));
}

export async function handleChatAddStyle(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const map = { '1': 'friendly', '2': 'casual', '3': 'formal', '4': 'minimal' };
  if (!map[input]) return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 4 }));
  draft.style = map[input];
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_emoji', chatDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.emojiPrompt'), '', ['1. ' + t(language, 'chatResponses.emojiYes'), '2. ' + t(language, 'chatResponses.emojiNo'), '', '0. ' + t(language, 'chatResponses.cancelled')]), transitionKey: 'chat_add_emoji' });
}

const RESPONSE_ACTIONS = [
  ['send_text', 'chatResponses.actionSendText', '💬'],
  ['open_menu:main', 'chatResponses.actionMain', '🏠'],
  ['open_menu:profile', 'chatResponses.actionProfile', '👤'],
  ['open_menu:help', 'chatResponses.actionHelp', '📚'],
  ['open_menu:settings', 'chatResponses.actionSettings', '⚙️'],
  ['open_feedback', 'chatResponses.actionFeedback', '📮'],
  ['send_notify', 'chatResponses.actionNotify', '🔔']
];

const COOLDOWN_OPTIONS = [
  ['none', 'chatResponses.cooldownNone', 0],
  ['30s', 'chatResponses.cooldown30s', 30],
  ['1m', 'chatResponses.cooldown1m', 60],
  ['5m', 'chatResponses.cooldown5m', 300],
  ['30m', 'chatResponses.cooldown30m', 1800],
  ['custom', 'chatResponses.cooldownCustom', null]
];

export async function handleChatAddEmoji(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  if (input === '1') draft.emojisEnabled = true;
  else if (input === '2') draft.emojisEnabled = false;
  else return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 2 }));
  return showResponseActionMenu(context, draft, {});
}

async function showResponseActionMenu(context, draft, extra) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_response_action', chatDraft: draft, pendingData: extra });
  const lines = [
    L(language, 'chatResponses.actionPrompt'),
    '',
    ...RESPONSE_ACTIONS.map(([id, key, emoji], i) => `${i + 1}. ${emoji} ${t(language, key)}`),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🧩 ' + L(language, 'chatResponses.actionTitle'), '', lines), transitionKey: 'chat_response_action' });
}

export async function handleResponseAction(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  const trimmed = String(input || '').trim();

  if (trimmed === '0') {
    if (pending.mode === 'edit' && pending.editId) return openEditChat(context, pending.editId);
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_emoji', chatDraft: draft });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.emojiPrompt'), '', ['1. ' + t(language, 'chatResponses.emojiYes'), '2. ' + t(language, 'chatResponses.emojiNo'), '', '0. ' + t(language, 'chatResponses.cancelled')]), transitionKey: 'chat_add_emoji' });
  }
  const n = parseInt(trimmed, 10);
  if (isNaN(n) || n < 1 || n > RESPONSE_ACTIONS.length) {
    return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: RESPONSE_ACTIONS.length }));
  }
  const action = RESPONSE_ACTIONS[n - 1][0];
  if (pending.mode === 'edit' && pending.editId) {
    chatRuleService.updateRule(pending.editId, { action });
    logAdminAction(sender, 'chat_rule_edit', (pending.editId + ' action=' + action));
    return openEditChat(context, pending.editId);
  }
  draft.action = action;
  return showContextMenu(context, draft);
}

async function showContextMenu(context, draft) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_context', chatDraft: draft });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧠 ' + L(language, 'chatResponses.contextTitle'), '', [
      toSmallCaps(t(language, 'chatResponses.contextPrompt')),
      '',
      '1. ✅ ' + toSmallCaps(t(language, 'chatResponses.contextNo')),
      '2. 🎯 ' + toSmallCaps(t(language, 'chatResponses.contextYes')),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_add_context'
  });
}

export async function handleContextMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showResponseActionMenu(context, draft, {});
  if (trimmed === '1') {
    draft.context = null;
    return showSetsContextMenu(context, draft);
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_context_input', chatDraft: draft });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🧠 ' + L(language, 'chatResponses.contextTitle'), '', [toSmallCaps(t(language, 'chatResponses.contextNamePrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_add_context_input'
    });
  }
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
  return showContextMenu(context, draft);
}

export async function handleContextInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showContextMenu(context, draft);
  const { isValidContextName, hasContext, registerContext } = await import('../services/contextRegistry.js');
  if (!isValidContextName(trimmed)) {
    await sendText(context.sock, sender, L(language, 'chatResponses.contextInvalidName'));
    return showContextMenu(context, draft);
  }
  draft.context = trimmed;
  if (!hasContext(trimmed)) {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_context_confirm', chatDraft: draft });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('⚠️ ' + L(language, 'chatResponses.contextTitle'), '', [
        toSmallCaps(t(language, 'chatResponses.contextCreatePrompt', { name: trimmed })),
        '',
        '1. ✅ ' + toSmallCaps(t(language, 'admin.yes')),
        '2. ❌ ' + toSmallCaps(t(language, 'admin.no')),
        '',
        '0. ' + L(language, 'chatResponses.back')
      ]),
      transitionKey: 'chat_add_context_confirm'
    });
  }
  return showSetsContextMenu(context, draft);
}

export async function handleContextConfirm(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '1' && draft.context) {
    const { registerContext } = await import('../services/contextRegistry.js');
    registerContext(draft.context, { createdBy: sender });
    logAdminAction(sender, 'chat_context_register', draft.context);
    return showSetsContextMenu(context, draft);
  }
  if (trimmed === '0') return showContextMenu(context, draft);
  draft.context = null;
  return showSetsContextMenu(context, draft);
}

async function showSetsContextMenu(context, draft) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_context_sets', chatDraft: draft });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧠 ' + L(language, 'chatResponses.contextTitle'), '', [
      toSmallCaps(t(language, 'chatResponses.setsContextPrompt')),
      '',
      '1. ✅ ' + toSmallCaps(t(language, 'chatResponses.contextNo')),
      '2. 🧠 ' + toSmallCaps(t(language, 'chatResponses.contextYesSet')),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_add_context_sets'
  });
}

export async function handleSetsContextMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showContextMenu(context, draft);
  if (trimmed === '1') {
    draft.setsContext = null;
    draft.contextExpiryMs = null;
    return showCooldownMenu(context, draft, {});
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_context_sets_input', chatDraft: draft });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🧠 ' + L(language, 'chatResponses.contextTitle'), '', [toSmallCaps(t(language, 'chatResponses.setsContextNamePrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_add_context_sets_input'
    });
  }
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
  return showSetsContextMenu(context, draft);
}

export async function handleSetsContextInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showSetsContextMenu(context, draft);
  const { isValidContextName, hasContext, registerContext } = await import('../services/contextRegistry.js');
  if (!isValidContextName(trimmed)) {
    await sendText(context.sock, sender, L(language, 'chatResponses.contextInvalidName'));
    return showSetsContextMenu(context, draft);
  }
  draft.setsContext = trimmed;
  if (!hasContext(trimmed)) registerContext(trimmed, { createdBy: sender });
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_context_expiry', chatDraft: draft });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧠 ' + L(language, 'chatResponses.contextTitle'), '', [toSmallCaps(t(language, 'chatResponses.contextExpiryPrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
    transitionKey: 'chat_add_context_expiry'
  });
}

export async function handleContextExpiry(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showSetsContextMenu(context, draft);
  if (trimmed === '') {
    draft.contextExpiryMs = 120000;
    return showCooldownMenu(context, draft, {});
  }
  const secs = Math.floor(Number(trimmed) || 0);
  if (Number.isNaN(Number(trimmed)) || secs <= 0) {
    await sendText(context.sock, sender, L(language, 'chatResponses.contextExpiryInvalid'));
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_context_expiry', chatDraft: draft });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🧠 ' + L(language, 'chatResponses.contextTitle'), '', [toSmallCaps(t(language, 'chatResponses.contextExpiryPrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_add_context_expiry'
    });
  }
  draft.contextExpiryMs = Math.min(3600000, secs * 1000);
  return showCooldownMenu(context, draft, {});
}

async function showCooldownMenu(context, draft, extra) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_cooldown', chatDraft: draft, pendingData: extra });
  const lines = [
    L(language, 'chatResponses.cooldownPrompt'),
    '',
    ...COOLDOWN_OPTIONS.map(([id, key], i) => `${i + 1}. ${t(language, key)}`),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🚫 ' + L(language, 'chatResponses.cooldownTitle'), '', lines), transitionKey: 'chat_cooldown' });
}

export async function handleCooldownMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  const trimmed = String(input || '').trim();

  if (trimmed === '0') {
    if (pending.mode === 'edit' && pending.editId) return openEditChat(context, pending.editId);
    return showResponseActionMenu(context, draft, {});
  }
  const n = parseInt(trimmed, 10);
  if (isNaN(n) || n < 1 || n > COOLDOWN_OPTIONS.length) {
    return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: COOLDOWN_OPTIONS.length }));
  }
  const [, , seconds] = COOLDOWN_OPTIONS[n - 1];
  if (seconds === null) {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_cooldown_custom', chatDraft: draft, pendingData: pending });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('🚫 ' + L(language, 'chatResponses.cooldownTitle'), '', [L(language, 'chatResponses.cooldownSecondsPrompt'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_cooldown_custom' });
  }
  return applyCooldownChoice(context, draft, pending, seconds);
}

export async function handleCooldownCustom(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return showCooldownMenu(context, draft, pending);
  const seconds = parseInt(trimmed, 10);
  if (isNaN(seconds) || seconds < 0 || seconds > 86400) {
    return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 86400 }));
  }
  return applyCooldownChoice(context, draft, pending, seconds);
}

async function applyCooldownChoice(context, draft, pending, seconds) {
  const sender = context.sender;
  if (pending.mode === 'edit' && pending.editId) {
    chatRuleService.updateRule(pending.editId, { cooldownSeconds: seconds });
    logAdminAction(sender, 'chat_rule_edit', (pending.editId + ' cooldownSeconds=' + seconds));
    return openEditChat(context, pending.editId);
  }
  draft.cooldownSeconds = seconds;
  return showActiveDatesMenu(context, draft, {});
}

async function showActiveDatesMenu(context, draft, extra) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_active_dates', chatDraft: draft, pendingData: extra });
  const lines = [
    L(language, 'chatResponses.datesPrompt'),
    '',
    '1. ✅ ' + L(language, 'chatResponses.datesAlways'),
    '2. 📅 ' + L(language, 'chatResponses.datesRange'),
    '',
    '0. ' + L(language, 'chatResponses.back')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('📆 ' + L(language, 'chatResponses.datesTitle'), '', lines), transitionKey: 'chat_active_dates' });
}

export async function handleActiveDatesMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  const trimmed = String(input || '').trim();

  if (trimmed === '0') {
    if (pending.mode === 'edit' && pending.editId) return openEditChat(context, pending.editId);
    return showCooldownMenu(context, draft, {});
  }
  if (trimmed === '1') {
    if (pending.mode === 'edit' && pending.editId) {
      chatRuleService.updateRule(pending.editId, { activeFrom: null, activeTo: null });
      logAdminAction(sender, 'chat_rule_edit', (pending.editId + ' dates cleared'));
      return openEditChat(context, pending.editId);
    }
    draft.activeFrom = null;
    draft.activeTo = null;
    return saveChatDraft(context, draft);
  }
  if (trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_active_start', chatDraft: draft, pendingData: pending });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('📆 ' + L(language, 'chatResponses.datesTitle'), '', [L(language, 'chatResponses.datesStartPrompt'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_active_start' });
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 2 }));
}

async function parseActiveDate(input) {
  const { parseScheduleTime, parseRelativeTime } = await import('./adminCommand.js');
  const trimmed = String(input || '').trim();
  const manual = parseScheduleTime(trimmed);
  if (manual) return manual.getTime();
  return parseRelativeTime(trimmed);
}

export async function handleActiveDateInput(context, input, stage) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  const pending = session.pendingData || {};
  const trimmed = String(input || '').trim();

  if (trimmed === '0') return showActiveDatesMenu(context, draft, pending);
  const ms = await parseActiveDate(trimmed);
  if (ms === null || ms <= 0) {
    await sendText(context.sock, sender, L(language, 'chatResponses.datesInvalid'));
    return showActiveDatesMenu(context, draft, pending);
  }
  if (stage === 'start') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_active_end', chatDraft: draft, pendingData: { ...pending, startAt: ms } });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu('📆 ' + L(language, 'chatResponses.datesTitle'), '', [L(language, 'chatResponses.datesEndPrompt'), '', '0. ' + L(language, 'chatResponses.back')]), transitionKey: 'chat_active_end' });
  }
  const startAt = pending.startAt;
  if (typeof startAt !== 'number' || ms <= startAt) {
    await sendText(context.sock, sender, L(language, 'chatResponses.datesInvalid'));
    return showActiveDatesMenu(context, draft, pending);
  }
  if (pending.mode === 'edit' && pending.editId) {
    chatRuleService.updateRule(pending.editId, { activeFrom: new Date(startAt).toISOString(), activeTo: new Date(ms).toISOString() });
    logAdminAction(sender, 'chat_rule_edit', (pending.editId + ' dates set'));
    return openEditChat(context, pending.editId);
  }
  draft.activeFrom = new Date(startAt).toISOString();
  draft.activeTo = new Date(ms).toISOString();
  return saveChatDraft(context, draft);
}

async function saveChatDraft(context, draft) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const id = chatRuleService.addRule({
    triggers: draft.triggers,
    triggerExact: false,
    replies: draft.replies,
    language: draft.language,
    priority: draft.priority,
    style: draft.style,
    emojisEnabled: draft.emojisEnabled,
    action: draft.action || 'send_text',
    cooldownSeconds: draft.cooldownSeconds || 0,
    activeFrom: draft.activeFrom || null,
    activeTo: draft.activeTo || null,
    createdBy: draft.createdBy,
    enabled: true
  });
  logAdminAction(sender, 'chat_rule_add', (id + ' · ' + (draft.triggers || []).join(', ')));
  // Multi-language: offer to add the same rule in another language.
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_another_lang', chatDraft: { ...draft, id } });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.saved'), '', ['1. ' + t(language, 'chatResponses.anotherLangYes'), '2. ' + t(language, 'chatResponses.anotherLangNo')]), transitionKey: 'chat_add_another_lang' });
}

export async function handleChatAddAnotherLang(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.chatDraft || {};
  if (input === '1') {
    // Re-run the wizard for a fresh rule based on the previous one.
    const newDraft = { triggers: [], replies: [], language: 'all', priority: draft.priority, style: draft.style, emojisEnabled: draft.emojisEnabled, createdBy: sender };
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_triggers', chatDraft: newDraft });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerPrompt')), transitionKey: 'chat_add_triggers' });
  }
  return sendChatPanel(context, { resultLine: L(language, 'chatResponses.saved') });
}

export async function handleChatSearchInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const results = chatRuleService.searchRules(input);
  if (results.length === 0) return sendText(context.sock, sender, L(language, 'chatResponses.searchNone'));
  const lines = results.map((r) => '• ' + r.id + ' — ' + r.triggers.join(', '));
  return sendText(context.sock, sender, buildMenu(L(language, 'chatResponses.searchTitle'), '', lines));
}

export async function handleChatImportInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return sendText(context.sock, sender, L(language, 'chatResponses.importInvalid'));
  }
  if (!Array.isArray(data)) return sendText(context.sock, sender, L(language, 'chatResponses.importInvalid'));
  return askConfirmation({ sock: context.sock, sender, chatId }, 'importChatRules', { json: input, count: data.length, returnTo: 'chatSubmenu' });
}

export async function executeImportChatRules(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  let parsed;
  try { parsed = JSON.parse(data.json); } catch { return sendText(context.sock, sender, L(language, 'chatResponses.importInvalid')); }
  chatRuleService.importRules(parsed);
  logAdminAction(sender, 'chat_rules_import', ('imported ' + (parsed.length || 0) + ' rules'));
  await sendChatPanel(context, { resultLine: L(language, 'chatResponses.importDone') });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Edit / delete / toggle commands
// ---------------------------------------------------------------------------

export async function openEditChat(context, id, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || resolveLanguage(sender);
  const rule = chatRuleService.getRule(id);
  if (!rule) return sendText(context.sock, sender, L(language, 'chatResponses.notFound'));
  try {
    const { touchRecent } = await import('../services/rulePrefsService.js');
    touchRecent(sender, id);
  } catch { /* ignore */ }
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_menu', chatEditId: id });
  const { normalizeReplies } = await import('../services/replySelector.js');
  const editReplies = normalizeReplies(rule.replies);
  const editSuffix = (r) => {
    const bits = [];
    if (r.weight !== 1) bits.push(`w: ${r.weight}`);
    if (r.time && r.time !== 'any') bits.push(`t: ${r.time}`);
    if (r.emotion && r.emotion !== 'any') bits.push(`e: ${r.emotion}`);
    return bits.length ? ` (${bits.join(', ')})` : '';
  };
  const lines = [
    L(language, 'chatResponses.previewTrigger') + ': ' + rule.triggers.map((s) => '`' + s + '`').join(', '),
    L(language, 'chatResponses.previewReplies') + ':',
    ...editReplies.map((r) => '• ' + r.text + editSuffix(r)),
    '',
    '1. ' + t(language, 'chatResponses.editTriggers'),
    '2. ' + t(language, 'chatResponses.editReplies'),
    '3. ' + t(language, 'chatResponses.editLanguage'),
    '4. ' + t(language, 'chatResponses.editPriority'),
    '5. ' + t(language, 'chatResponses.editStyle'),
    '6. ' + t(language, 'chatResponses.editEmoji'),
    '7. ' + t(language, 'chatResponses.editToggle'),
    '8. ' + L(language, 'chatResponses.deleteConfirm'),
    '9. ' + t(language, 'chatResponses.editAction'),
    '10. ' + t(language, 'chatResponses.editCooldown'),
    '11. ' + t(language, 'chatResponses.editDates'),
    '12. 🧠 ' + toSmallCaps(t(language, 'chatResponses.editContext')),
    '',
    '0. ' + t(language, 'chatResponses.back')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.editMenuTitle'), '', lines), transitionKey: 'chat_edit_menu' });
}

export async function showEditContextMenu(context, id) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const rule = chatRuleService.getRule(id);
  if (!rule) return sendText(context.sock, sender, L(language, 'chatResponses.notFound'));
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_context', chatEditId: id });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🧠 ' + L(language, 'chatResponses.editContextTitle'), '', [
      { static: `🧠 ${L(language, 'chatResponses.detailContextIn')}: `, dynamic: rule.context || t(language, 'chatResponses.detailNone') },
      { static: `🧠 ${L(language, 'chatResponses.detailSetsContext')}: `, dynamic: rule.setsContext || t(language, 'chatResponses.detailNone') },
      { static: `⏱️ ${L(language, 'chatResponses.detailContextExpiry')}: `, dynamic: rule.contextExpiryMs ? `${Math.round(rule.contextExpiryMs / 1000)}s` : t(language, 'chatResponses.detailDefault') },
      '',
      '1. 🎯 ' + toSmallCaps(t(language, 'chatResponses.editContextIn')),
      '2. 🧠 ' + toSmallCaps(t(language, 'chatResponses.editSetsContext')),
      '3. ⏱️ ' + toSmallCaps(t(language, 'chatResponses.editContextExpiryMenu')),
      '4. 🗑️ ' + toSmallCaps(t(language, 'chatResponses.editContextClear')),
      '',
      '0. ' + L(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_edit_context'
  });
}

export async function handleEditContextMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const trimmed = String(input || '').trim();
  if (trimmed === '0' || !id) return openEditChat(context, id);
  if (trimmed === '1' || trimmed === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_context_input', chatEditId: id, pendingData: { field: trimmed === '1' ? 'context' : 'setsContext' } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🧠 ' + L(language, 'chatResponses.editContextTitle'), '', [toSmallCaps(t(language, 'chatResponses.contextNamePrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_edit_context_input'
    });
  }
  if (trimmed === '3') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_context_expiry', chatEditId: id });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu('🧠 ' + L(language, 'chatResponses.editContextTitle'), '', [toSmallCaps(t(language, 'chatResponses.contextExpiryPrompt')), '', '0. ' + L(language, 'chatResponses.back')]),
      transitionKey: 'chat_edit_context_expiry'
    });
  }
  if (trimmed === '4') {
    chatRuleService.updateRule(id, { context: null, setsContext: null, contextExpiryMs: null });
    logAdminAction(sender, 'chat_rule_edit', (id + ' context cleared'));
    return showEditContextMenu(context, id);
  }
  await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
  return showEditContextMenu(context, id);
}

export async function handleEditContextInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const field = session.pendingData?.field || 'context';
  const trimmed = String(input || '').trim();
  if (trimmed === '0' || !id) return showEditContextMenu(context, id);
  const { isValidContextName } = await import('../services/contextRegistry.js');
  if (!isValidContextName(trimmed)) {
    await sendText(context.sock, sender, L(language, 'chatResponses.contextInvalidName'));
    return showEditContextMenu(context, id);
  }
  chatRuleService.updateRule(id, { [field]: trimmed });
  logAdminAction(sender, 'chat_rule_edit', (id + ` ${field}=${trimmed}`));
  return showEditContextMenu(context, id);
}

export async function handleEditContextExpiry(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const trimmed = String(input || '').trim();
  if (trimmed === '0' || !id) return showEditContextMenu(context, id);
  const secs = Math.floor(Number(trimmed) || 0);
  if (Number.isNaN(Number(trimmed)) || secs <= 0) {
    await sendText(context.sock, sender, L(language, 'chatResponses.contextExpiryInvalid'));
    return showEditContextMenu(context, id);
  }
  chatRuleService.updateRule(id, { contextExpiryMs: Math.min(3600000, secs * 1000) });
  logAdminAction(sender, 'chat_rule_edit', (id + ` contextExpiryMs=${secs * 1000}`));
  return showEditContextMenu(context, id);
}

export async function handleChatEditMenu(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  if (!id) return sendChatPanel(context);
  const rule = chatRuleService.getRule(id);
  if (!rule) return sendText(context.sock, sender, L(language, 'chatResponses.notFound'));

  if (input === '0') return sendChatPanel(context);
  if (input === '1') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_triggers', chatEditId: id, chatDraft: { ...rule } });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.triggerPrompt')), transitionKey: 'chat_edit_triggers' });
  }
  if (input === '2') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_replies', chatEditId: id, chatDraft: { ...rule } });
    return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'chatResponses.replyPrompt')), transitionKey: 'chat_edit_replies' });
  }
  if (input === '3') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_language', chatEditId: id });
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.languageTitle'), '', [...languageMenu(language), '', '0. ' + t(language, 'chatResponses.back')]), transitionKey: 'chat_edit_menu' });
  }
  if (input === '4') {
    return showPriorityReorder(context, id, { mode: 'edit' });
  }
  if (input === '5') {
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_style', chatEditId: id });
    const lines = [L(language, 'chatResponses.styleSelect'), ''];
    STYLE_OPTIONS.forEach(([key, num]) => lines.push(`${num}. ${t(language, 'chatResponses.' + key)}`));
    lines.push('', '0. ' + t(language, 'chatResponses.back'));
    return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'chatResponses.styleTitle'), '', lines), transitionKey: 'chat_edit_menu' });
  }
  if (input === '6') {
    chatRuleService.updateRule(id, { emojisEnabled: !rule.emojisEnabled });
    logAdminAction(sender, 'chat_rule_edit', (id + ' emojisEnabled=' + (!rule.emojisEnabled)));
    return openEditChat(context, id);
  }
  if (input === '7') {
    const nowEnabled = chatRuleService.toggleRule(id);
    logAdminAction(sender, 'chat_rule_toggle', (id + ' → ' + (nowEnabled ? 'on' : 'off')));
    return openEditChat(context, id);
  }
  if (input === '8') {
    return askConfirmation({ sock: context.sock, sender, chatId }, 'deleteChatRule', { id, returnTo: 'chatEdit' });
  }
  if (input === '9') {
    return showResponseActionMenu(context, {}, { mode: 'edit', editId: id });
  }
  if (input === '10') {
    return showCooldownMenu(context, {}, { mode: 'edit', editId: id });
  }
  if (input === '11') {
    return showActiveDatesMenu(context, {}, { mode: 'edit', editId: id });
  }
  if (input === '12') {
    return showEditContextMenu(context, id);
  }
  return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 12 }));
}

export async function handleChatEditTriggers(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const triggers = splitSemicolons(input).map((x) => normalize(x)).filter(Boolean);
  if (triggers.length === 0) return sendText(context.sock, sender, L(language, 'chatResponses.emptyTriggers'));
  const variations = generateTriggerVariations(triggers[0]);
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_trigger_variations', chatDraft: session.chatDraft, pendingData: { mode: 'edit', editId: id, variations, selected: [0], baseTrigger: triggers[0] } });
  return sendMenu({ sock: context.sock, sender, chatId, text: buildVariationsMenu(language, variations, [0]), transitionKey: 'chat_trigger_variations' });
}

export async function handleChatEditReplies(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const replies = splitSemicolons(input);
  if (replies.length === 0) return sendText(context.sock, sender, L(language, 'chatResponses.emptyReplies'));
  sessionManager.setState(sender, chatId, {
    currentMenu: 'chat_edit_weights',
    chatEditId: id,
    pendingAction: null,
    pendingData: { replies, index: 0, weighted: [] }
  });
  return sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(L(language, 'chatResponses.weightPromptTitle'), '', [
      { static: '', dynamic: `"${replies[0].slice(0, 80)}"` },
      toSmallCaps(t(language, 'chatResponses.weightPrompt')),
      '',
      '0. ' + t(language, 'chatResponses.back')
    ]),
    transitionKey: 'chat_edit_weights'
  });
}

export async function handleChatEditWeights(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const pd = session.pendingData || {};
  const replies = Array.isArray(pd.replies) ? pd.replies : [];
  const index = Number(pd.index) || 0;
  const weighted = Array.isArray(pd.weighted) ? pd.weighted : [];
  if (String(input || '').trim() === '0') return openEditChat(context, id);
  const current = replies[index];
  if (current === undefined) return openEditChat(context, id);
  const raw = String(input || '').trim();
  let weight = 1.0;
  if (raw !== '') {
    weight = Number(raw);
    if (!Number.isFinite(weight) || weight < 0.1 || weight > 1.0) {
      await sendText(context.sock, sender, L(language, 'chatResponses.weightInvalid', { min: 0.1, max: 1.0 }));
      sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_weights', chatEditId: id, pendingAction: null, pendingData: { replies, index, weighted } });
      return sendMenu({
        sock: context.sock, sender, chatId,
        text: buildMenu(L(language, 'chatResponses.weightPromptTitle'), '', [
          { static: '', dynamic: `"${current.slice(0, 80)}"` },
          toSmallCaps(t(language, 'chatResponses.weightPrompt')),
          '',
          '0. ' + t(language, 'chatResponses.back')
        ]),
        transitionKey: 'chat_edit_weights'
      });
    }
  }
  const next = [...weighted, { text: current, weight }];
  if (index + 1 < replies.length) {
    const following = replies[index + 1];
    sessionManager.setState(sender, chatId, { currentMenu: 'chat_edit_weights', chatEditId: id, pendingAction: null, pendingData: { replies, index: index + 1, weighted: next } });
    return sendMenu({
      sock: context.sock, sender, chatId,
      text: buildMenu(L(language, 'chatResponses.weightPromptTitle'), '', [
        { static: '', dynamic: `"${following.slice(0, 80)}"` },
        toSmallCaps(t(language, 'chatResponses.weightPrompt')),
        '',
        '0. ' + t(language, 'chatResponses.back')
      ]),
      transitionKey: 'chat_edit_weights'
    });
  }
  if (await styleWalkEnabled()) {
    return showReplyStyleWalk(context, { flow: 'edit', replies: next, index: 0, styled: [] });
  }
  return showReplyTagWalk(context, { flow: 'edit', replies: next, index: 0, tagged: [] });
}

const TAG_TONES = ['positive', 'negative', 'neutral'];
const TAG_TIMES = ['morning', 'afternoon', 'evening', 'night'];

function tagMenuText(language, replyText, step) {
  if (step === 'tone') {
    return buildMenu('🧩 ' + L(language, 'chatResponses.tagTitle'), '', [
      { static: '', dynamic: `"${replyText.slice(0, 80)}"` },
      toSmallCaps(t(language, 'chatResponses.tagTonePrompt')),
      '',
      ...TAG_TONES.map((emo, i) => `${i + 1}. ${toSmallCaps(t(language, 'chatResponses.tagTone_' + emo))}`),
      '',
      '0. ' + t(language, 'chatResponses.back')
    ]);
  }
  if (step === 'time') {
    return buildMenu('🧩 ' + L(language, 'chatResponses.tagTitle'), '', [
      { static: '', dynamic: `"${replyText.slice(0, 80)}"` },
      toSmallCaps(t(language, 'chatResponses.tagTimePrompt')),
      '',
      ...TAG_TIMES.map((bucket, i) => `${i + 1}. ${toSmallCaps(t(language, 'chatResponses.tagTime_' + bucket))}`),
      '',
      '0. ' + t(language, 'chatResponses.back')
    ]);
  }
  return buildMenu('🧩 ' + L(language, 'chatResponses.tagTitle'), '', [
    { static: '', dynamic: `"${replyText.slice(0, 80)}"` },
    toSmallCaps(t(language, 'chatResponses.tagPrompt')),
    '',
    '1. ✅ ' + toSmallCaps(t(language, 'chatResponses.tagNo')),
    '2. 🎭 ' + toSmallCaps(t(language, 'chatResponses.tagByTone')),
    '3. 🕒 ' + toSmallCaps(t(language, 'chatResponses.tagByTime')),
    '4. 🎭🕒 ' + toSmallCaps(t(language, 'chatResponses.tagBoth')),
    '',
    '0. ' + t(language, 'chatResponses.back')
  ]);
}

async function showReplyTagWalk(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const flow = opts.flow || session.pendingData?.flow || 'add';
  const replies = opts.replies || session.pendingData?.replies || [];
  const index = opts.index ?? session.pendingData?.index ?? 0;
  const tagged = opts.tagged || session.pendingData?.tagged || [];
  const state = flow === 'edit' ? 'chat_edit_reply_tags' : 'chat_add_reply_tags';
  const current = replies[index];
  if (current === undefined) return finishReplyTagWalk(context, { flow, tagged });
  const { replyText: rt } = await import('../services/replySelector.js');
  sessionManager.setState(sender, chatId, {
    currentMenu: state,
    ...(flow === 'edit' ? { chatEditId: session.chatEditId } : {}),
    pendingAction: null,
    pendingData: { ...(session.pendingData || {}), flow, replies, index, tagged, step: 'menu', pendingBoth: false, pendingEmotion: null }
  });
  return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(current), 'menu'), transitionKey: state });
}

async function finishReplyTagWalk(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const flow = opts.flow || 'add';
  const tagged = opts.tagged || [];
  if (flow === 'edit') {
    const id = session.chatEditId;
    if (!id) return sendChatPanel(context);
    chatRuleService.updateRule(id, { replies: tagged });
    logAdminAction(sender, 'chat_rule_edit', (id + ' replies updated (tagged)'));
    return openEditChat(context, id);
  }
  const draft = session.chatDraft || {};
  draft.replies = tagged;
  sessionManager.setState(sender, chatId, { currentMenu: 'chat_add_preview', chatDraft: draft });
  return sendMenu({ sock: context.sock, sender, chatId, text: previewMenu(language, draft), transitionKey: 'chat_add_preview' });
}

async function handleReplyTagWalk(context, input, flow) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const pd = session.pendingData || {};
  const replies = Array.isArray(pd.replies) ? pd.replies : [];
  const index = Number(pd.index) || 0;
  const tagged = Array.isArray(pd.tagged) ? pd.tagged : [];
  const step = pd.step || 'menu';
  const trimmed = String(input || '').trim();
  const { replyText: rt } = await import('../services/replySelector.js');
  const state = flow === 'edit' ? 'chat_edit_reply_tags' : 'chat_add_reply_tags';
  const rest = (extra = {}) => ({ ...(session.pendingData || {}), ...extra });
  const current = replies[index];
  if (current === undefined) return finishReplyTagWalk(context, { flow, tagged });
  const base = typeof current === 'string' ? { text: current, weight: 1 } : { ...current };
  const accept = (entry) => {
    const next = [...tagged, entry];
    if (index + 1 < replies.length) {
      sessionManager.setState(sender, chatId, { currentMenu: state, ...(flow === 'edit' ? { chatEditId: session.chatEditId } : {}), pendingAction: null, pendingData: { ...rest({ step: 'menu', index: index + 1, tagged: next, pendingBoth: false, pendingEmotion: null }) } });
      const following = replies[index + 1];
      return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(following), 'menu'), transitionKey: state });
    }
    return finishReplyTagWalk(context, { flow, tagged: next });
  };
  if (trimmed === '0') {
    const remaining = replies.slice(index).map((r) => (typeof r === 'string' ? { text: r, weight: 1 } : { ...r }));
    return finishReplyTagWalk(context, { flow, tagged: [...tagged, ...remaining] });
  }
  if (step === 'menu') {
    if (trimmed === '1') return accept({ ...base, time: base.time || 'any', emotion: base.emotion || 'any' });
    if (trimmed === '2' || trimmed === '4') {
      sessionManager.setState(sender, chatId, { currentMenu: state, ...(flow === 'edit' ? { chatEditId: session.chatEditId } : {}), pendingAction: null, pendingData: { ...rest({ step: 'tone', pendingBoth: trimmed === '4', pendingBase: base }) } });
      return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(current), 'tone'), transitionKey: state });
    }
    if (trimmed === '3') {
      sessionManager.setState(sender, chatId, { currentMenu: state, ...(flow === 'edit' ? { chatEditId: session.chatEditId } : {}), pendingAction: null, pendingData: { ...rest({ step: 'time', pendingBoth: false, pendingBase: base }) } });
      return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(current), 'time'), transitionKey: state });
    }
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
    return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(current), 'menu'), transitionKey: state });
  }
  if (step === 'tone') {
    const emo = TAG_TONES[Number(trimmed) - 1];
    if (!emo) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
      return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(current), 'tone'), transitionKey: state });
    }
    const withEmo = { ...pd.pendingBase, emotion: emo };
    if (pd.pendingBoth) {
      sessionManager.setState(sender, chatId, { currentMenu: state, ...(flow === 'edit' ? { chatEditId: session.chatEditId } : {}), pendingAction: null, pendingData: { ...rest({ step: 'time', pendingBoth: false, pendingBase: withEmo }) } });
      return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(current), 'time'), transitionKey: state });
    }
    return accept({ ...withEmo, time: withEmo.time || 'any' });
  }
  if (step === 'time') {
    const bucket = TAG_TIMES[Number(trimmed) - 1];
    if (!bucket) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
      return sendMenu({ sock: context.sock, sender, chatId, text: tagMenuText(language, rt(current), 'time'), transitionKey: state });
    }
    const base2 = pd.pendingBase || base;
    return accept({ ...base2, time: bucket, emotion: base2.emotion || 'any' });
  }
  return showReplyTagWalk(context, { flow, replies, index, tagged });
}

export async function handleAddReplyTags(context, input) {
  return handleReplyTagWalk(context, input, 'add');
}

export async function handleEditReplyTags(context, input) {
  return handleReplyTagWalk(context, input, 'edit');
}

const STYLE_WALK_OPTIONS = ['friendly', 'casual', 'formal', 'minimal', 'detailed'];
const STYLE_WALK_KEYS = ['styleDefault', 'styleCasual', 'styleFormal', 'styleMinimal', 'styleDetailed', 'styleAll'];

async function styleWalkEnabled() {
  try {
    const { getSettings } = await import('../services/chatSettingsService.js');
    const s = getSettings();
    if (s && typeof s.replyStylePersonalization === 'boolean') return s.replyStylePersonalization;
  } catch { /* default below */ }
  return true;
}

function styleMenuText(language, text) {
  return buildMenu('🎨 ' + L(language, 'chatResponses.styleReplyTitle'), '', [
    { static: '', dynamic: `"${text.slice(0, 80)}"` },
    toSmallCaps(t(language, 'chatResponses.styleReplyPrompt')),
    '',
    ...STYLE_WALK_KEYS.map((key, i) => `${i + 1}. ` + toSmallCaps(t(language, 'chatResponses.' + key))),
    '',
    '0. ' + t(language, 'chatResponses.back')
  ]);
}

async function showReplyStyleWalk(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const flow = opts.flow || session.pendingData?.flow || 'add';
  const replies = opts.replies || session.pendingData?.replies || [];
  const index = opts.index ?? session.pendingData?.index ?? 0;
  const styled = opts.styled || session.pendingData?.styled || [];
  const state = flow === 'edit' ? 'chat_edit_reply_styles' : 'chat_add_reply_styles';
  const current = replies[index];
  if (current === undefined) return finishReplyStyleWalk(context, { flow, styled });
  const { replyText: rt } = await import('../services/replySelector.js');
  sessionManager.setState(sender, chatId, {
    currentMenu: state,
    ...(flow === 'edit' ? { chatEditId: session.chatEditId } : {}),
    pendingAction: null,
    pendingData: { ...(session.pendingData || {}), flow, replies, index, styled }
  });
  return sendMenu({ sock: context.sock, sender, chatId, text: styleMenuText(language, rt(current)), transitionKey: state });
}

async function finishReplyStyleWalk(context, opts = {}) {
  const flow = opts.flow || 'add';
  const styled = opts.styled || [];
  return showReplyTagWalk(context, { flow, replies: styled, index: 0, tagged: [] });
}

async function handleReplyStyleWalk(context, input, flow) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const pd = session.pendingData || {};
  const replies = Array.isArray(pd.replies) ? pd.replies : [];
  const index = Number(pd.index) || 0;
  const styled = Array.isArray(pd.styled) ? pd.styled : [];
  const state = flow === 'edit' ? 'chat_edit_reply_styles' : 'chat_add_reply_styles';
  const trimmed = String(input || '').trim();
  const { replyText: rt } = await import('../services/replySelector.js');
  const current = replies[index];
  if (current === undefined) return finishReplyStyleWalk(context, { flow, styled });
  const base = typeof current === 'string' ? { text: current, weight: 1 } : { ...current };
  const accept = (entries) => {
    const next = [...styled, ...entries];
    if (index + 1 < replies.length) {
      sessionManager.setState(sender, chatId, { currentMenu: state, ...(flow === 'edit' ? { chatEditId: session.chatEditId } : {}), pendingAction: null, pendingData: { ...(session.pendingData || {}), index: index + 1, styled: next } });
      return sendMenu({ sock: context.sock, sender, chatId, text: styleMenuText(language, rt(replies[index + 1])), transitionKey: state });
    }
    return finishReplyStyleWalk(context, { flow, styled: next });
  };
  if (trimmed === '0') {
    const remaining = replies.slice(index).map((r) => (typeof r === 'string' ? { text: r, weight: 1 } : { ...r }));
    return finishReplyStyleWalk(context, { flow, styled: [...styled, ...remaining] });
  }
  const n = Number(trimmed);
  if (![1, 2, 3, 4, 5, 6].includes(n)) {
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return sendMenu({ sock: context.sock, sender, chatId, text: styleMenuText(language, rt(current)), transitionKey: state });
  }
  if (n === 6) {
    return accept(STYLE_WALK_OPTIONS.map((style) => ({ ...base, style })));
  }
  return accept([{ ...base, style: STYLE_WALK_OPTIONS[n - 1] }]);
}

export async function handleAddReplyStyles(context, input) {
  return handleReplyStyleWalk(context, input, 'add');
}

export async function handleEditReplyStyles(context, input) {
  return handleReplyStyleWalk(context, input, 'edit');
}

export async function handleChatEditLanguage(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const map = { '1': 'en', '2': 'fr', '3': 'de', '4': 'es', '5': 'ar', '6': 'all' };
  if (!map[input]) return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 6 }));
  chatRuleService.updateRule(id, { language: map[input] });
  logAdminAction(sender, 'chat_rule_edit', (id + ' language=' + map[input]));
  return openEditChat(context, id);
}

export async function handleChatEditPriority(context, input) {
  // Numeric entry replaced by the visual reorder UI; kept as a fallback that
  // opens the reorder screen for the rule being edited.
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  if (!id || !chatRuleService.getRule(id)) {
    return sendChatPanel(context);
  }
  return showPriorityReorder(context, id, { mode: 'edit' });
}

export async function handleChatEditStyle(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const id = session.chatEditId;
  const map = { '1': 'friendly', '2': 'casual', '3': 'formal', '4': 'minimal' };
  if (!map[input]) return sendText(context.sock, sender, L(language, 'chatResponses.invalidNumber', { min: 0, max: 4 }));
  chatRuleService.updateRule(id, { style: map[input] });
  logAdminAction(sender, 'chat_rule_edit', (id + ' style=' + map[input]));
  return openEditChat(context, id);
}

export async function executeDeleteChatRule(context, data) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  chatRuleService.deleteRule(data.id);
  logAdminAction(sender, 'chat_rule_delete', data.id);
  await sendChatPanel(context, { resultLine: L(language, 'chatResponses.deleteDone') });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

function notAuthorized(sock, sender, language) {
  return sendText(sock, sender, toSmallCaps(t(language, 'admin.notAuthorized')));
}

function parseAddRuleArgs(raw) {
  // `trigger = reply1 ; reply2 [lang=en] [priority=5] [cooldown=30]`, `|` separates rules.
  const out = [];
  for (const chunk of String(raw || '').split('|')) {
    const text = chunk.trim();
    if (!text) continue;
    const eq = text.indexOf('=');
    if (eq < 0) continue;
    const trigger = text.slice(0, eq).trim();
    let rest = text.slice(eq + 1).trim();
    const opts = {};
    const optRe = /\b(lang|priority|cooldown)=([^\s;]+)\s*$/;
    let m;
    while ((m = optRe.exec(rest)) !== null) {
      opts[m[1]] = m[2];
      rest = rest.slice(0, m.index).trim();
    }
    const replies = rest.split(';').map((s) => s.trim()).filter(Boolean);
    if (!trigger || !replies.length) continue;
    out.push({ trigger, replies, opts });
  }
  return out;
}

export const commands = [
  {
    name: 'addchat',
    description: 'Add a new chat response (admin)',
    usage: '/add-chat',
    aliases: ['add-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      return sendAddRuleMenu(context);
    }
  },
  {
    name: 'addrule',
    description: 'Quick-add chat rule(s): /addrule trigger = reply [lang=en] [priority=5] [cooldown=30] (admin)',
    usage: '/addrule trigger = reply1 ; reply2 [lang=en] [priority=5] [cooldown=30]',
    aliases: [],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const raw = (context.args || []).join(' ');
      const parsed = parseAddRuleArgs(raw);
      if (!parsed.length) {
        return sendText(context.sock, sender, L(language, 'chatResponses.addruleUsage'));
      }
      const created = [];
      for (const p of parsed) {
        const lang = ['en', 'fr', 'de', 'es', 'ar', 'all'].includes(p.opts.lang) ? p.opts.lang : 'en';
        const priority = Math.min(10, Math.max(1, parseInt(p.opts.priority, 10) || 1));
        const cooldownSeconds = Math.min(86400, Math.max(0, parseInt(p.opts.cooldown, 10) || 0));
        const id = chatRuleService.addRule({
          triggers: [p.trigger],
          replies: p.replies,
          language: lang,
          priority,
          cooldownSeconds,
          createdBy: sender,
          enabled: true
        });
        created.push(id);
      }
      logAdminAction(sender, 'chat_addrule', created.join(','));
      return sendText(context.sock, sender, toSmallCaps(t(language, 'chatResponses.addruleDone', { count: created.length })));
    }
  },
  {
    name: 'listchat',
    description: 'List all chat responses (admin)',
    usage: '/list-chat',
    aliases: ['list-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const rules = chatRuleService.getAllRules();
      if (rules.length === 0) return sendText(context.sock, sender, L(language, 'chatResponses.noRules'));
      const lines = rules.map((r) => '• ' + r.id + ' — ' + r.triggers.join(', ') + (r.enabled ? '' : ' [' + L(language, 'common.offFlag') + ']'));
      return sendText(context.sock, sender, buildMenu(L(language, 'chatResponses.listTitle'), '', lines));
    }
  },
  {
    name: 'editchat',
    description: 'Edit a chat response (admin)',
    usage: '/edit-chat <id>',
    aliases: ['edit-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const id = context.args?.[0];
      if (!id) return sendText(context.sock, sender, toSmallCaps(t(language, 'chatResponses.invalidNumber', { min: 0, max: 1 })));
      return openEditChat(context, id);
    }
  },
  {
    name: 'deletechat',
    description: 'Delete a chat response (admin)',
    usage: '/delete-chat <id>',
    aliases: ['delete-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const id = context.args?.[0];
      if (!id) return sendText(context.sock, sender, toSmallCaps(t(language, 'chatResponses.notFound')));
      if (!chatRuleService.getRule(id)) return sendText(context.sock, sender, L(language, 'chatResponses.notFound'));
      return askConfirmation({ sock: context.sock, sender, chatId: context.chatId || sender }, 'deleteChatRule', { id, returnTo: 'chatDelete' });
    }
  },
  {
    name: 'togglechat',
    description: 'Enable/disable a chat response (admin)',
    usage: '/toggle-chat <id>',
    aliases: ['toggle-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const id = context.args?.[0];
      if (!id || !chatRuleService.getRule(id)) return sendText(context.sock, sender, L(language, 'chatResponses.notFound'));
      const nowEnabled = chatRuleService.toggleRule(id);
      logAdminAction(sender, 'chat_rule_toggle', (id + ' → ' + (nowEnabled ? 'on' : 'off')));
      return sendText(context.sock, sender, L(language, nowEnabled ? 'chatResponses.toggledOn' : 'chatResponses.toggledOff'));
    }
  },
  {
    name: 'searchchat',
    description: 'Search chat responses (admin)',
    usage: '/search-chat <keyword>',
    aliases: ['search-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const kw = context.args?.join(' ');
      if (!kw) {
        sessionManager.setState(sender, context.chatId || sender, { currentMenu: 'chat_search_input' });
        return sendMenu({ sock: context.sock, sender, chatId: context.chatId || sender, text: toSmallCaps(t(language, 'chatResponses.searchPrompt')), transitionKey: 'chat_search_input' });
      }
      const results = chatRuleService.searchRules(kw);
      if (results.length === 0) return sendText(context.sock, sender, L(language, 'chatResponses.searchNone'));
      const lines = results.map((r) => '• ' + r.id + ' — ' + r.triggers.join(', '));
      return sendText(context.sock, sender, buildMenu(L(language, 'chatResponses.searchTitle'), '', lines));
    }
  },
  {
    name: 'importchat',
    description: 'Import chat responses JSON (admin)',
    usage: '/import-chat',
    aliases: ['import-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      sessionManager.setState(sender, context.chatId || sender, { currentMenu: 'chat_import_input' });
      return sendMenu({ sock: context.sock, sender, chatId: context.chatId || sender, text: toSmallCaps(t(language, 'chatResponses.importPrompt')), transitionKey: 'chat_import_input' });
    }
  },
  {
    name: 'exportchat',
    description: 'Export chat responses JSON (admin)',
    usage: '/export-chat',
    aliases: ['export-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      const sender = context.sender;
      const language = resolveLanguage(sender);
      if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
      const rules = chatRuleService.exportRules();
      if (rules.length === 0) return sendText(context.sock, sender, L(language, 'chatResponses.exportEmpty'));
      return sendText(context.sock, sender, buildMenu(L(language, 'chatResponses.exportTitle'), '', [JSON.stringify(rules, null, 2)]));
    }
  }
];
