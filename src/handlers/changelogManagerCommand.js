// Admin Changelog Manager: review drafts, publish versions, edit and delete
// published entries, and export/import the changelog file.
//
// The manager menu itself is a registry menu (system settings option 11 and
// /changelog), so its eight option rows run as custom: actions through the
// cluster. Everything those options lead to is a sub-state rendered here and
// dispatched by handleChangelogManagerReply, so there is one place that decides
// what each number means.
import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenuById } from '../utils/menuSender.js';
import { logAdminAction } from '../services/adminLogService.js';
import { getUserByJid } from '../services/userService.js';
import { getEntries, getCurrentVersion, reload as reloadChangelog } from '../services/changelogService.js';
import {
  getPendingDrafts, getAllDrafts, getDraftById, updateDraft, removeDraft
} from '../services/changelogDraftService.js';
import {
  publishEntry, updateChangelogEntry, deleteChangelogEntry, setCurrentVersion,
  replaceChangelog, validateChangelogShape, readChangelogFile
} from '../services/changelogPublishService.js';
import { suggestVersionBump, isValidVersion } from '../utils/versionBump.js';
import { getTypeMeta, TYPE_META } from '../utils/changelogFormat.js';

export const MANAGER_MENU = 'changelog_manager';

// Every sub-state this module owns. index.js routes input here for any of them.
export const SUB_STATES = new Set([
  'changelog_draft_list',
  'changelog_draft_detail',
  'changelog_draft_input',
  'changelog_published',
  'changelog_add_input',
  'changelog_entry_list',
  'changelog_entry_select',
  'changelog_entry_input',
  'changelog_set_version_input',
  'changelog_import_input',
  'changelog_import_confirm'
]);

const TYPES = ['feature', 'improvement', 'fix', 'breaking', 'security', 'initial'];
const ENTRIES_PER_PAGE = 5;
const today = () => new Date().toISOString().slice(0, 10);

function L(language, key) {
  return toSmallCaps(t(language, key));
}

/** Small-capped label, dynamic value untouched. */
function row(label, value) {
  return { static: L('en', label) + ': *', dynamic: String(value) + '*' };
}

async function langOf(context) {
  const user = await getUserByJid(context.sender).catch(() => null);
  return user?.language || config.defaultLanguage;
}

function ctxOf(context, language) {
  return { sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, language };
}

function setSession(context, patch) {
  sessionManager.setState(context.sender, context.chatId || context.sender, patch);
}

async function backToManager(context) {
  const language = await langOf(context);
  await sendMenuById(MANAGER_MENU, { ...ctxOf(context, language), user: null }, 'changelog_back', { sessionMenu: MANAGER_MENU });
}

/** A screen with a heading, body lines, numbered options and a back row. */
function screen(headingStatic, headingEmoji, lines, options) {
  const body = [];
  for (const line of lines) {
    if (line === '') body.push('');
    else if (typeof line === 'string') body.push({ static: '', dynamic: toSmallCaps(line) });
    else body.push(line);
  }
  if (options?.length) {
    body.push('');
    for (const o of options) body.push({ static: '', dynamic: `${o.number}. ${o.emoji} ${L('en', o.label)}` });
  }
  body.push('');
  body.push({ static: '', dynamic: `0. ${L('en', 'common.back')}` });
  return buildMenu(headingStatic, '', body);
}

const replyPrompt = () => ({ static: '', dynamic: `_${L('en', 'menu.replyPrompt')}_` });

// ---------------------------------------------------------------------------
// Draft review
// ---------------------------------------------------------------------------

async function showDraftList(context) {
  const language = await langOf(context);
  const drafts = getPendingDrafts();
  if (!drafts.length) {
    return sendText(context.sock, context.sender, screen(
      t(language, 'menu.changelog_manager.review_drafts_title'), '📥',
      [{ static: '', dynamic: L(language, 'menu.changelog_manager.no_pending_drafts') }], null
    ));
  }
  const lines = [];
  drafts.forEach((d, i) => {
    const meta = getTypeMeta(d.type);
    lines.push({ static: '', dynamic: `${i + 1}. ${meta.emoji} ${d.version} · ${d.changes?.[0] || '(no summary)'} (${d.changes?.length || 0} changes)` });
  });
  setSession(context, { changelogDraftList: drafts.map((d) => d.id) });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.review_drafts_title'), '📥',
    [...lines, '', replyPrompt()], null
  ));
}

async function showDraftDetail(context, draftId) {
  const language = await langOf(context);
  const draft = getDraftById(draftId);
  if (!draft) {
    await sendText(context.sock, context.sender, L(language, 'menu.changelog_manager.nothing_to_edit'));
    return backToManager(context);
  }
  const meta = getTypeMeta(draft.type);
  const lines = [
    row('menu.changelog_manager.version', draft.version),
    { static: L('en', 'menu.changelog_manager.type') + ': ', dynamic: `${meta.emoji} ${meta.label}` },
    { static: L('en', 'menu.changelog_manager.date') + ': ', dynamic: draft.date },
    '',
    { static: L('en', 'menu.changelog_manager.changes') + ':' },
    ...(draft.changes || []).map((c) => ({ static: '', dynamic: '• ' + toSmallCaps(c) }))
  ];
  setSession(context, { currentMenu: 'changelog_draft_detail', changelogDraftId: draftId });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.draft_detail_title'), '📝', lines,
    [
      { number: '1', emoji: '✅', label: 'menu.changelog_manager.approve_publish' },
      { number: '2', emoji: '✏️', label: 'menu.changelog_manager.edit_version' },
      { number: '3', emoji: '✏️', label: 'menu.changelog_manager.edit_type' },
      { number: '4', emoji: '✏️', label: 'menu.changelog_manager.edit_changes' },
      { number: '5', emoji: '🗑️', label: 'menu.changelog_manager.discard' }
    ]
  ));
}

function showTypeMenu(context, draftId) {
  const lines = TYPES.map((type, i) => {
    const meta = getTypeMeta(type);
    return { static: '', dynamic: `${i + 1}. ${meta.emoji} ${meta.label}` };
  });
  setSession(context, { currentMenu: 'changelog_draft_input', changelogDraftId: draftId, changelogField: 'type' });
  return sendText(context.sock, context.sender, screen(
    t('en', 'menu.changelog_manager.edit_type'), '🏷️', lines, null
  ));
}

async function showFieldPrompt(context, draftId, field) {
  const language = await langOf(context);
  const key = field === 'version'
    ? 'menu.changelog_manager.version'
    : field === 'changes' ? 'menu.changelog_manager.changes' : 'menu.changelog_manager.edit_changes';
  setSession(context, { currentMenu: 'changelog_draft_input', changelogDraftId: draftId, changelogField: field });
  if (field === 'discard') {
    return sendText(context.sock, context.sender, screen(
      t(language, 'menu.changelog_manager.discard_confirm'), '🗑️', [], [
        { number: '1', emoji: '✅', label: 'menu.changelog_manager.yes' },
        { number: '2', emoji: '❌', label: 'menu.changelog_manager.no' }
      ]
    ));
  }
  return sendText(context.sock, context.sender, screen(
    t(language, key), '✏️',
    [{ static: '', dynamic: L(language, 'menu.changelog_manager.send_' + field + '_prompt') }, '', replyPrompt()], null
  ));
}

async function approveAndPublish(context, draft) {
  const language = await langOf(context);
  const entry = publishEntry({
    version: draft.version,
    date: draft.date,
    type: draft.type,
    changes: draft.changes || []
  });
  removeDraft(draft.id);
  logAdminAction(context.sender, 'changelog_publish', `version=${entry.version}; from=${draft.sourceChangeId || 'manual'}`);
  setSession(context, { currentMenu: 'changelog_published', changelogDraftId: null, changelogField: null });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.published'), '✅',
    [{ static: '', dynamic: '✅ ' + L(language, 'menu.changelog_manager.published_ok') + ' ' + toSmallCaps(entry.version) }],
    [
      { number: '1', emoji: '📢', label: 'menu.changelog_manager.notify_users' },
      { number: '2', emoji: '📝', label: 'menu.changelog_manager.review_more' }
    ]
  ));
}

// ---------------------------------------------------------------------------
// Published entry list / edit / delete
// ---------------------------------------------------------------------------

async function showEntryList(context, page = 1) {
  const language = await langOf(context);
  const entries = getEntries();
  if (!entries.length) {
    await sendText(context.sock, context.sender, L(language, 'menu.changelog_manager.nothing_to_edit'));
    return backToManager(context);
  }
  const maxPage = Math.max(1, Math.ceil(entries.length / ENTRIES_PER_PAGE));
  const current = Math.min(Math.max(1, page), maxPage);
  const slice = entries.slice((current - 1) * ENTRIES_PER_PAGE, current * ENTRIES_PER_PAGE);
  const lines = slice.map((e, i) => {
    const meta = getTypeMeta(e.type);
    return { static: '', dynamic: `${(current - 1) * ENTRIES_PER_PAGE + i + 1}. ${meta.emoji} ${e.version} · ${e.date}` };
  });
  setSession(context, { currentMenu: 'changelog_entry_list', changelogEntryPage: current });
  const options = [];
  if (current > 1) options.push({ number: '1', emoji: '⬅️', label: 'menu.changelog_manager.previous' });
  if (current < maxPage) options.push({ number: '2', emoji: '📜', label: 'menu.changelog_manager.see_more' });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.entry_list_title'), '📜',
    [...lines, '', replyPrompt()], options
  ));
}

async function showEntrySelect(context, mode) {
  const language = await langOf(context);
  const entries = getEntries();
  if (!entries.length) {
    await sendText(context.sock, context.sender, L(language, mode === 'delete' ? 'menu.changelog_manager.nothing_to_delete' : 'menu.changelog_manager.nothing_to_edit'));
    return backToManager(context);
  }
  const currentVersion = getCurrentVersion();
  const lines = entries.map((e, i) => {
    const meta = getTypeMeta(e.type);
    const marker = e.version === currentVersion ? ' ⭐' : '';
    return { static: '', dynamic: `${i + 1}. ${meta.emoji} ${e.version}${marker} · ${e.date}` };
  });
  setSession(context, { currentMenu: 'changelog_entry_select', changelogEntryMode: mode });
  return sendText(context.sock, context.sender, screen(
    t(language, mode === 'delete' ? 'menu.changelog_manager.delete_confirm' : 'menu.changelog_manager.select_entry'),
    mode === 'delete' ? '🗑️' : '✏️',
    [...lines, '', replyPrompt()], null
  ));
}

async function showEntryEditChoose(context, version) {
  const language = await langOf(context);
  setSession(context, { currentMenu: 'changelog_entry_input', changelogEntryMode: 'edit', changelogEntryVersion: version, changelogField: 'choose' });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.edit_choose'), '✏️', [], [
      { number: '1', emoji: '🔢', label: 'menu.changelog_manager.version' },
      { number: '2', emoji: '📅', label: 'menu.changelog_manager.date' },
      { number: '3', emoji: '✨', label: 'menu.changelog_manager.changes' }
    ]
  ));
}

async function showEntryFieldPrompt(context, version, field) {
  const language = await langOf(context);
  setSession(context, {
    currentMenu: 'changelog_entry_input',
    changelogEntryMode: 'edit',
    changelogEntryVersion: version,
    changelogField: field
  });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.' + field), '✏️',
    [{ static: '', dynamic: L(language, 'menu.changelog_manager.send_' + field + '_prompt') }, '', replyPrompt()], null
  ));
}

// ---------------------------------------------------------------------------
// Add entry wizard
// ---------------------------------------------------------------------------

async function startAddWizard(context) {
  const language = await langOf(context);
  const suggested = suggestVersionBump(getCurrentVersion(), 'improvement');
  setSession(context, {
    currentMenu: 'changelog_add_input',
    changelogWizard: { step: 'version', data: { version: suggested, date: today() } }
  });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.add_entry'), '➕',
    [
      { static: L('en', 'menu.changelog_manager.version') + ': ', dynamic: suggested },
      '',
      { static: '', dynamic: L(language, 'menu.changelog_manager.send_version_prompt') },
      '',
      replyPrompt()
    ], null
  ));
}

function wizardLines(language, wiz) {
  const meta = getTypeMeta(wiz.data.type);
  const lines = [
    row('menu.changelog_manager.version', wiz.data.version),
    { static: L('en', 'menu.changelog_manager.type') + ': ', dynamic: wiz.data.type ? `${meta.emoji} ${meta.label}` : '-' },
    { static: L('en', 'menu.changelog_manager.date') + ': ', dynamic: wiz.data.date || '-' }
  ];
  if (wiz.data.changes?.length) {
    lines.push('', { static: L('en', 'menu.changelog_manager.changes') + ':' });
    for (const c of wiz.data.changes) lines.push({ static: '', dynamic: '• ' + toSmallCaps(c) });
  }
  return lines;
}

function saveWizard(context, language) {
  const wiz = sessionManager.getSession(context.sender, context.chatId || context.sender)?.changelogWizard || {};
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.add_entry'), '➕',
    wizardLines(language, wiz), [
      { number: '1', emoji: '✅', label: 'menu.changelog_manager.approve_publish' },
      { number: '2', emoji: '✏️', label: 'menu.changelog_manager.edit_entry' }
    ]
  ));
}

// ---------------------------------------------------------------------------
// Set version / export / import
// ---------------------------------------------------------------------------

async function startSetVersion(context) {
  const language = await langOf(context);
  setSession(context, { currentMenu: 'changelog_set_version_input' });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.set_version'), '🔢',
    [
      { static: L('en', 'menu.changelog_manager.current_version') + ': *', dynamic: getCurrentVersion() + '*' },
      '',
      { static: '', dynamic: L(language, 'menu.changelog_manager.send_version_prompt') },
      '',
      replyPrompt()
    ], null
  ));
}

async function doExport(context) {
  const language = await langOf(context);
  let payload;
  try {
    payload = JSON.stringify(readChangelogFile(), null, 2);
  } catch (err) {
    logger.error({ err }, '[CHANGELOG] export failed');
    await sendText(context.sock, context.sender, L(language, 'menu.changelog_manager.export_empty'));
    return backToManager(context);
  }
  await context.sock.sendMessage(context.sender, {
    document: Buffer.from(payload, 'utf8'),
    mimetype: 'application/json',
    fileName: `changelog-${today()}.json`
  });
  logAdminAction(context.sender, 'changelog_export', `changelog-${today()}.json`);
  await sendText(context.sock, context.sender, L(language, 'menu.changelog_manager.export_sent'));
  return backToManager(context);
}

async function startImport(context) {
  const language = await langOf(context);
  setSession(context, { currentMenu: 'changelog_import_input' });
  return sendText(context.sock, context.sender, screen(
    t(language, 'menu.changelog_manager.import'), '📥',
    [{ static: '', dynamic: L(language, 'menu.changelog_manager.import_prompt') }, '', replyPrompt()], null
  ));
}

// ---------------------------------------------------------------------------
// The eight menu actions
// ---------------------------------------------------------------------------

export const changelogManagerHandlers = {
  changelog_review_drafts: (context) => showDraftList(context),
  changelog_list_versions: (context) => showEntryList(context, 1),
  changelog_add_entry: (context) => startAddWizard(context),
  changelog_edit_entry: (context) => showEntrySelect(context, 'edit'),
  changelog_delete_entry: (context) => showEntrySelect(context, 'delete'),
  changelog_set_version: (context) => startSetVersion(context),
  changelog_export: (context) => doExport(context),
  changelog_import: (context) => startImport(context)
};

// ---------------------------------------------------------------------------
// Sub-state reply dispatcher
// ---------------------------------------------------------------------------

/** Split a pasted change list on newlines or semicolons. */
export function parseChangeLines(input) {
  return String(input ?? '')
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function handleChangelogManagerReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const menu = session.currentMenu;
  const text = String(input ?? '').trim();
  const language = await langOf(context);

  if (menu === 'changelog_draft_list') {
    if (text === '0') return backToManager(context);
    const ids = session.changelogDraftList || [];
    const draft = getDraftById(ids[Number(text) - 1]);
    if (!draft) {
      await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
      return showDraftList(context);
    }
    return showDraftDetail(context, draft.id);
  }

  if (menu === 'changelog_draft_detail') {
    const draft = getDraftById(session.changelogDraftId);
    if (!draft) return backToManager(context);
    if (text === '0') return showDraftList(context);
    if (text === '1') return approveAndPublish(context, draft);
    if (text === '2') return showFieldPrompt(context, draft.id, 'version');
    if (text === '3') return showTypeMenu(context, draft.id);
    if (text === '4') return showFieldPrompt(context, draft.id, 'changes');
    if (text === '5') return showFieldPrompt(context, draft.id, 'discard');
    await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
    return showDraftDetail(context, draft.id);
  }

  if (menu === 'changelog_draft_input') {
    const draft = getDraftById(session.changelogDraftId);
    if (!draft) return backToManager(context);
    const field = session.changelogField;

    if (field === 'type') {
      if (text === '0') return showDraftDetail(context, draft.id);
      const type = TYPES[Number(text) - 1];
      if (!type) {
        await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
        return showTypeMenu(context, draft.id);
      }
      updateDraft(draft.id, { type });
      return showDraftDetail(context, draft.id);
    }

    if (field === 'discard') {
      if (text === '0') return showDraftDetail(context, draft.id);
      if (text === '1') {
        updateDraft(draft.id, { status: 'discarded' });
        logAdminAction(sender, 'changelog_draft_discard', draft.id);
        setSession(context, { currentMenu: 'changelog_draft_list', changelogDraftId: null, changelogField: null });
        return showDraftList(context);
      }
      if (text === '2') return showDraftDetail(context, draft.id);
      await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
      return showFieldPrompt(context, draft.id, 'discard');
    }

    if (field === 'version') {
      if (text === '0') return showDraftDetail(context, draft.id);
      if (!isValidVersion(text)) {
        await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_version'));
        return showFieldPrompt(context, draft.id, 'version');
      }
      updateDraft(draft.id, { version: text.trim() });
      return showDraftDetail(context, draft.id);
    }

    if (field === 'changes') {
      if (text === '0') return showDraftDetail(context, draft.id);
      const changes = parseChangeLines(text);
      if (!changes.length) {
        await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
        return showFieldPrompt(context, draft.id, 'changes');
      }
      updateDraft(draft.id, { changes });
      return showDraftDetail(context, draft.id);
    }
    return showDraftDetail(context, draft.id);
  }

  if (menu === 'changelog_published') {
    if (text === '0') return backToManager(context);
    // Subscription/broadcast is deferred to a later prompt, per the spec.
    if (text === '1') {
      await sendText(sock(context), sender, screen(
        t(language, 'menu.changelog_manager.notify_users'), '🚧',
        [{ static: '', dynamic: toSmallCaps('🚧 ') + L(language, 'menu.info.version_history.comingSoon') }], null
      ));
      return;
    }
    if (text === '2') return showDraftList(context);
    return backToManager(context);
  }

  if (menu === 'changelog_add_input') {
    const wiz = { ...(session.changelogWizard || { data: {} }) };
    wiz.data = { ...(wiz.data || {}) };
    // Every branch below must advance wiz.step; leaving it unchanged made the
    // wizard re-prompt the same question forever.
    if (wiz.step === 'version') {
      if (text === '0') return backToManager(context);
      if (!isValidVersion(text)) {
        await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_version'));
        return startAddWizard(context);
      }
      wiz.data.version = text.trim();
      wiz.step = 'type';
      setSession(context, { currentMenu: 'changelog_add_input', changelogWizard: wiz });
      const lines = TYPES.map((type, i) => {
        const meta = getTypeMeta(type);
        return { static: '', dynamic: `${i + 1}. ${meta.emoji} ${meta.label}` };
      });
      return sendText(sock(context), sender, screen(
        t(language, 'menu.changelog_manager.type'), '🏷️', lines, null
      ));
    }
    if (wiz.step === 'type') {
      if (text === '0') return backToManager(context);
      const type = TYPES[Number(text) - 1];
      if (!type) {
        await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
        return saveWizard(context, language);
      }
      wiz.data.type = type;
      wiz.step = 'date';
      setSession(context, { currentMenu: 'changelog_add_input', changelogWizard: wiz });
      return sendText(sock(context), sender, screen(
        t(language, 'menu.changelog_manager.date'), '📅',
        [
          { static: L('en', 'menu.changelog_manager.date') + ': ', dynamic: wiz.data.date },
          '',
          { static: '', dynamic: L(language, 'menu.changelog_manager.send_date_prompt') },
          '',
          replyPrompt()
        ], null
      ));
    }
    if (wiz.step === 'date') {
      if (text === '0') return backToManager(context);
      wiz.data.date = text === '-' ? today() : text.trim();
      wiz.step = 'changes';
      setSession(context, { currentMenu: 'changelog_add_input', changelogWizard: wiz });
      return sendText(sock(context), sender, screen(
        t(language, 'menu.changelog_manager.changes'), '✨',
        [{ static: '', dynamic: L(language, 'menu.changelog_manager.send_changes_prompt') }, '', replyPrompt()], null
      ));
    }
    if (wiz.step === 'changes') {
      if (text === '0') return backToManager(context);
      const changes = parseChangeLines(text);
      if (!changes.length) {
        await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
        return saveWizard(context, language);
      }
      wiz.data.changes = changes;
      wiz.step = 'confirm';
      setSession(context, { currentMenu: 'changelog_add_input', changelogWizard: wiz });
      return saveWizard(context, language);
    }
    if (wiz.step === 'confirm') {
      if (text === '0') return backToManager(context);
      if (text === '2') return saveWizard(context, language);
      if (text === '1') {
        const entry = publishEntry({
          version: wiz.data.version,
          date: wiz.data.date,
          type: wiz.data.type,
          changes: wiz.data.changes || []
        });
        logAdminAction(sender, 'changelog_publish', `version=${entry.version}; from=manual`);
        setSession(context, { currentMenu: 'changelog_published', changelogWizard: null });
        return sendText(sock(context), sender, screen(
          t(language, 'menu.changelog_manager.published'), '✅',
          [{ static: '', dynamic: '✅ ' + L(language, 'menu.changelog_manager.published_ok') + ' ' + toSmallCaps(entry.version) }],
          [
            { number: '1', emoji: '📢', label: 'menu.changelog_manager.notify_users' },
            { number: '2', emoji: '📝', label: 'menu.changelog_manager.review_more' }
          ]
        ));
      }
    }
    return saveWizard(context, language);
  }

  if (menu === 'changelog_entry_list') {
    if (text === '0') return backToManager(context);
    if (text === '1' && (session.changelogEntryPage || 1) > 1) {
      return showEntryList(context, (session.changelogEntryPage || 1) - 1);
    }
    if (text === '2') return showEntryList(context, (session.changelogEntryPage || 1) + 1);
    return backToManager(context);
  }

  if (menu === 'changelog_entry_select') {
    if (text === '0') return backToManager(context);
    const entry = getEntries()[Number(text) - 1];
    if (!entry) {
      await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
      return showEntrySelect(context, session.changelogEntryMode);
    }
    if (session.changelogEntryMode === 'delete') {
      if (entry.version === getCurrentVersion()) {
        setSession(context, { currentMenu: 'changelog_entry_input', changelogEntryMode: 'delete', changelogEntryVersion: entry.version, changelogField: 'confirmDelete' });
        return sendText(sock(context), sender, screen(
          t(language, 'menu.changelog_manager.current_version_warning'), '⚠️', [], [
            { number: '1', emoji: '✅', label: 'menu.changelog_manager.yes' },
            { number: '2', emoji: '❌', label: 'menu.changelog_manager.no' }
          ]
        ));
      }
      deleteChangelogEntry(entry.version);
      logAdminAction(sender, 'changelog_delete', entry.version);
      return showEntryList(context, 1);
    }
    return showEntryEditChoose(context, entry.version);
  }

  if (menu === 'changelog_entry_input') {
    const version = session.changelogEntryVersion;
    const field = session.changelogField;
    if (session.changelogEntryMode === 'delete' && field === 'confirmDelete') {
      if (text === '0') return showEntrySelect(context, 'delete');
      if (text === '2') return showEntrySelect(context, 'delete');
      if (text === '1') {
        deleteChangelogEntry(version);
        logAdminAction(sender, 'changelog_delete', version);
        return showEntryList(context, 1);
      }
      return showEntrySelect(context, 'delete');
    }
    if (session.changelogEntryMode === 'edit') {
      if (field === 'choose') {
        if (text === '0') return showEntrySelect(context, 'edit');
        if (text === '1') return showEntryFieldPrompt(context, version, 'version');
        if (text === '2') return showEntryFieldPrompt(context, version, 'date');
        if (text === '3') return showEntryFieldPrompt(context, version, 'changes');
        return showEntryEditChoose(context, version);
      }
      if (text === '0') return showEntryEditChoose(context, version);
      const patch = {};
      if (field === 'version') {
        if (!isValidVersion(text)) {
          await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_version'));
          return showEntryFieldPrompt(context, version, 'version');
        }
        patch.version = text.trim();
      } else if (field === 'date') {
        patch.date = text === '-' ? today() : text.trim();
      } else if (field === 'changes') {
        const changes = parseChangeLines(text);
        if (!changes.length) {
          await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_number'));
          return showEntryFieldPrompt(context, version, 'changes');
        }
        patch.changes = changes;
      }
      if (Object.keys(patch).length) {
        updateChangelogEntry(version, patch);
        logAdminAction(sender, 'changelog_edit', `${version} -> ${JSON.stringify(patch).slice(0, 80)}`);
      }
      return showEntryList(context, 1);
    }
    return backToManager(context);
  }

  if (menu === 'changelog_set_version_input') {
    if (text === '0') return backToManager(context);
    if (!isValidVersion(text)) {
      await sendText(sock(context), sender, L(language, 'menu.changelog_manager.invalid_version'));
      return startSetVersion(context);
    }
    setCurrentVersion(text.trim());
    logAdminAction(sender, 'changelog_set_version', text.trim());
    return backToManager(context);
  }

  if (menu === 'changelog_import_input') {
    if (text === '0' || text === '-') return backToManager(context);
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const problems = parsed ? validateChangelogShape(parsed) : ['not valid JSON'];
    if (problems.length) {
      await sendText(sock(context), sender, L(language, 'menu.changelog_manager.import_invalid'));
      return startImport(context);
    }
    setSession(context, { currentMenu: 'changelog_import_confirm', changelogImportPayload: parsed });
    return sendText(sock(context), sender, screen(
      t(language, 'menu.changelog_manager.import_confirm'), '📥', [], [
        { number: '1', emoji: '✅', label: 'menu.changelog_manager.yes' },
        { number: '2', emoji: '❌', label: 'menu.changelog_manager.no' }
      ]
    ));
  }

  if (menu === 'changelog_import_confirm') {
    if (text === '0' || text === '2') return backToManager(context);
    if (text === '1') {
      replaceChangelog(session.changelogImportPayload);
      logAdminAction(sender, 'changelog_import', 'replaced');
      await sendText(sock(context), sender, L(language, 'menu.changelog_manager.import_done'));
      return backToManager(context);
    }
    return backToManager(context);
  }

  return backToManager(context);
}

function sock(context) {
  return context.sock;
}

export const __testing = { screen, parseChangeLines, TYPES, ENTRIES_PER_PAGE, getAllDrafts, reloadChangelog };
