// Admin handlers for the Bot Content & Timing editor.
//
// One editor, one file: every editable field goes through the same
// show-current -> capture -> preview -> confirm -> snapshot -> save flow, keyed
// by a dotted content path. There is no per-feature editor.
//
// Emoji shortcut characters are deliberately not exposed as fields -- they are
// input parsing, not copy.
import sessionManager from '../utils/sessionManager.js';
import { logAdminAction } from '../services/adminLogService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import {
  getContent, setContent, getAll, resetSection, resetAll,
  snapshot, listSnapshots, restoreSnapshot, deleteSnapshot, reload, deepMerge
} from '../services/botContentService.js';
import { resolvePlaceholders } from '../utils/placeholderResolver.js';
import {
  EDITABLE_FIELDS, EDITABLE_VARIANTS, RESET_SECTIONS, SAMPLE_CTX
} from '../config/botContentFields.js';

const MENU = 'bot_content';
const subMenu = {
  firstMessage: 'bot_content_onboarding',
  resumeMessage: 'bot_content_onboarding',
  welcomeMessage: 'bot_content_onboarding',
  unsupportedLanguage: 'bot_content_onboarding',
  retry: 'bot_content_onboarding',
  cooldownLock: 'bot_content_onboarding',
  welcomeBack: 'bot_content_welcome_back',
  timing: 'bot_content_timing',
  languageDisplay: 'bot_content_language'
};

const L = (language, key, params) => toSmallCaps(t(language, key, params));

function langOf(context) {
  return context.language || 'en';
}

function resolveMenuId(path) {
  return subMenu[String(path).split('.')[1]] || MENU;
}

/** Compact single-line preview of any field, for the field list. */
function previewOf(path, language) {
  const value = getContent(path);
  if (Array.isArray(value)) return value.length + ' ' + L(language, 'menu.bot_content.variantCount').split(' ').slice(1).join(' ');
  const rendered = resolvePlaceholders(String(value ?? ''), SAMPLE_CTX);
  const flat = rendered.replace(/\n+/g, ' ').trim();
  return flat.length > 46 ? flat.slice(0, 45) + '…' : flat;
}

async function sendPanel(context, text, menuId = MENU) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: menuId, pendingAction: null, pendingData: null });
  await sendText(context.sock, sender, text);
}

/** Group submenu: list every field in that group with its live preview. */
export function showGroupMenu(context, groupKey) {
  const language = langOf(context);
  const paths = (EDITABLE_FIELDS && Object.keys(EDITABLE_FIELDS))
    .filter((p) => p.split('.')[1] === groupKey);
  const body = paths.map((p, i) => {
    const label = L(language, EDITABLE_FIELDS[p].labelKey);
    return `${i + 1}. ${label}\n   ${previewOf(p, language)}`;
  });
  return sendPanel(context, buildMenu(
    L(language, 'menu.bot_content.group.' + groupKey), '',
    [...body, '', '0. ' + L(language, 'common.back'), '', L(language, 'menu.replyPrompt')]
  ), resolveMenuId('onboarding.' + groupKey));
}

/** Field editor: show the current value, then wait for the replacement. */
export async function showFieldEditor(context, path) {
  const language = langOf(context);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const meta = EDITABLE_FIELDS[path];
  if (!meta) {
    await sendText(context.sock, sender, L(language, 'menu.bot_content.invalidJson'));
    return true;
  }
  sessionManager.setState(sender, chatId, {
    currentMenu: 'bot_content',
    pendingAction: 'bot_content_field_input',
    pendingData: { path, menuId: resolveMenuId(path) }
  });
  const current = getContent(path);
  const hints = meta.placeholders?.length
    ? L(language, 'menu.bot_content.placeholders') + ': ' + meta.placeholders.map((x) => '{' + x + '}').join(' ')
    : '';
  const body = [
    '> *' + L(language, meta.labelKey) + '*',
    '',
    L(language, 'menu.bot_content.current') + ': ' + current,
    hints,
    '',
    '_' + resolvePlaceholders(String(current ?? ''), SAMPLE_CTX) + '_',
    '',
    L(language, 'menu.replyPrompt')
  ].join('\n');
  await sendText(context.sock, sender, body);
  return true;
}

/** Preview-then-confirm for a pending field edit. */
export async function confirmFieldEdit(context, session) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = langOf(context);
  const { path } = session.pendingData || {};
  const draft = session.pendingData?.draft;
  const oldValue = getContent(path);
  sessionManager.setState(sender, chatId, {
    pendingAction: 'bot_content_field_confirm',
    pendingData: { path, draft, oldValue, menuId: resolveMenuId(path) }
  });
  await sendText(context.sock, sender, buildMenu(
    L(language, 'menu.bot_content.current'), '',
    [
      '> *' + L(language, EDITABLE_FIELDS[path]?.labelKey || 'menu.bot_content.heading') + '*',
      '',
      '_' + resolvePlaceholders(String(draft ?? ''), SAMPLE_CTX) + '_',
      '',
      '1. ' + '\u2705 ' + L(language, 'menu.bot_content.save'),
      '2. ' + '\u270F\uFE0F ' + L(language, 'menu.bot_content.editAgain'),
      '3. ' + '\u274C ' + L(language, 'menu.bot_content.cancel'),
      '',
      '0. ' + L(language, 'common.back')
    ]
  ));
  return true;
}

/** Apply a confirmed edit: snapshot, set, log. */
export function applyFieldEdit(context, session) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = langOf(context);
  const { path, draft, oldValue } = session.pendingData || {};
  snapshot();
  setContent(path, draft, sender);
  logAdminAction(sender, 'bot_content_edit', JSON.stringify({ path, oldValue, newValue: draft }));
  const menuId = resolveMenuId(path);
  sessionManager.setState(sender, chatId, { pendingAction: null, pendingData: null });
  return showGroupMenu({ ...context, language }, path.split('.')[1]).then(async () => {
    await sendText(context.sock, sender, L(language, 'menu.bot_content.saved'));
    return true;
  });
}

/** Variant pool editor: list the pool, then edit one index. */
export async function showVariantEditor(context, variant) {
  const language = langOf(context);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const pool = getContent('welcomeBack.' + variant);
  const lines = (Array.isArray(pool) ? pool : []).map((v, i) => `${i + 1}. ${resolvePlaceholders(String(v), SAMPLE_CTX)}`);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'bot_content_welcome_back',
    pendingAction: 'bot_content_variant_pick',
    pendingData: { variant }
  });
  await sendText(context.sock, sender, buildMenu(
    L(language, 'menu.bot_content.variant.' + variant), '',
    [...lines, '', '0. ' + L(language, 'common.back'), '', L(language, 'menu.replyPrompt')]
  ));
  return true;
}

/**
 * Full walkthrough rendered with sample data.
 *
 * Built by joining lines directly rather than through buildMenu: buildMenu
 * small-caps every plain body line, and resolvePlaceholders has already
 * capped the static runs while leaving dynamic values raw. Running it
 * through buildMenu would cap the sample name as well.
 */
export async function botContentPreview(context) {
  const language = langOf(context);
  const sender = context.sender;
  const c = SAMPLE_CTX;
  const R = (p) => resolvePlaceholders(getContent(p), c);
  const A1 = (getContent('welcomeBack.A1') || [])[0];

  const text = [
    '> *\u{1F441}\uFE0F ' + L(language, 'menu.bot_content.preview') + '*',
    '',
    '> *' + R('onboarding.firstMessage.greeting') + '*',
    '',
    R('onboarding.firstMessage.detectedLine'),
    '',
    R('onboarding.firstMessage.languagesPreview'),
    '',
    R('onboarding.firstMessage.question'),
    '',
    '1. ' + R('onboarding.firstMessage.option1'),
    '2. ' + R('onboarding.firstMessage.option2'),
    '',
    '> *' + R('onboarding.resumeMessage.headingShort') + '*',
    '',
    R('onboarding.resumeMessage.bodyShort'),
    '',
    '1. ' + R('onboarding.resumeMessage.optionYes'),
    '2. ' + R('onboarding.resumeMessage.optionNo'),
    '',
    '> *' + L(language, 'menu.bot_content.previewVariant') + '*',
    '',
    resolvePlaceholders(String(A1 ?? ''), c),
    '',
    '> *' + R('onboarding.cooldownLock.heading') + '*',
    '',
    R('onboarding.cooldownLock.body'),
    '',
    '0. ' + L(language, 'common.back')
  ].join('\n');

  await sendText(context.sock, sender, text);
  return true;
}

/** Send the live content as a JSON document. */
export async function botContentExport(context) {
  const sender = context.sender;
  const json = JSON.stringify(getAll(), null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await context.sock.sendMessage(sender, {
      document: Buffer.from(json, 'utf8'),
      mimetype: 'application/json',
      fileName: 'bot-content-' + stamp + '.json',
      caption: toSmallCaps(t(langOf(context), 'menu.bot_content.export')) + ': bot-content-' + stamp + '.json'
    });
  } catch (err) {
    // Fall back to a code block so an admin is never left without the data.
    await sendText(context.sock, sender, '```json\n' + json + '\n```');
  }
  return true;
}

/** Accept pasted JSON or a .json document, validate, snapshot, merge. */
export async function botContentImport(context, session, rawText, documentBuffer) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = langOf(context);
  let parsed = null;
  try {
    const raw = documentBuffer ? documentBuffer.toString('utf8') : rawText;
    // Tolerate a fenced code block around pasted JSON.
    const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').trim();
    if (cleaned) parsed = JSON.parse(cleaned);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sessionManager.setState(sender, chatId, {
      pendingAction: 'bot_content_import',
      pendingData: { stage: 'await' }
    });
    await sendText(context.sock, sender, L(language, 'menu.bot_content.invalidJson'));
    return true;
  }
  snapshot();
  setContent('__import__', undefined, sender); // no-op write guard for clarity
  reload();
  // Merge the parsed document over the defaults and persist it wholesale.
  const merged = deepMerge(getAll(), parsed);
  setContent('version', merged.version, sender);
  for (const section of Object.keys(merged)) {
    if (section === 'updatedAt' || section === 'updatedBy') continue;
    setContent(section, merged[section], sender);
  }
  logAdminAction(sender, 'bot_content_import', JSON.stringify({ sections: Object.keys(parsed) }));
  sessionManager.setState(sender, chatId, { pendingAction: null, pendingData: null });
  await sendText(context.sock, sender, L(language, 'menu.bot_content.imported'));
  return true;
}

/** List snapshots and offer restore / delete. */
export async function botContentSnapshots(context) {
  const language = langOf(context);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const files = listSnapshots();
  if (!files.length) {
    await sendText(context.sock, sender, L(language, 'menu.bot_content.noSnapshots'));
    return true;
  }
  const lines = files.slice(0, 10).map((f, i) => `${i + 1}. ${f.replace('botContent-', '').replace('.json', '')}`);
  sessionManager.setState(sender, chatId, {
    currentMenu: MENU,
    pendingAction: 'bot_content_snapshot_pick',
    pendingData: { files }
  });
  await sendText(context.sock, sender, buildMenu(
    '\u{1F4F8} ' + L(language, 'menu.bot_content.snapshots'), '',
    [...lines, '', '0. ' + L(language, 'common.back')]
  ));
  return true;
}

export async function botContentSnapshotAction(context, session, index, wantsDelete) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = langOf(context);
  const file = session.pendingData?.files?.[index];
  if (!file) {
    await sendText(context.sock, sender, L(language, 'menu.bot_content.noSnapshots'));
    return true;
  }
  if (wantsDelete) {
    deleteSnapshot(file);
    sessionManager.setState(sender, chatId, { pendingAction: null, pendingData: null });
    return botContentSnapshots(context);
  }
  snapshot();
  restoreSnapshot(file);
  logAdminAction(sender, 'bot_content_restore', file);
  sessionManager.setState(sender, chatId, { pendingAction: null, pendingData: null });
  await sendText(context.sock, sender, L(language, 'menu.bot_content.restore') + ': ' + file);
  return true;
}

/** Reset submenu -> confirm -> snapshot -> apply. */
export async function botContentResetMenu(context) {
  const language = langOf(context);
  const lines = RESET_SECTIONS.map((s, i) => `${i + 1}. \u267B\uFE0F ${L(language, s.labelKey)}`);
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    currentMenu: MENU,
    pendingAction: 'bot_content_reset_pick',
    pendingData: { sections: RESET_SECTIONS }
  });
  await sendText(context.sock, context.sender, buildMenu(
    '\u267B\uFE0F ' + L(language, 'menu.bot_content.reset'), '',
    [...lines, '', '0. ' + L(language, 'common.back')]
  ));
  return true;
}

export async function botContentResetConfirm(context, session, index) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = langOf(context);
  const section = session.pendingData?.sections?.[index];
  if (!section) return botContentResetMenu(context);
  sessionManager.setState(sender, chatId, {
    pendingAction: 'bot_content_reset_confirm',
    pendingData: { key: section.key }
  });
  await sendText(context.sock, sender, buildMenu(
    '\u267B\uFE0F ' + L(language, 'menu.bot_content.reset'), '',
    [
      L(language, section.labelKey),
      '',
      L(language, 'menu.bot_content.confirmReset'),
      '',
      '1. ' + '\u2705 ' + L(language, 'admin.yes'),
      '2. ' + '\u274C ' + L(language, 'admin.no')
    ]
  ));
  return true;
}

export function botContentResetApply(context, session) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = langOf(context);
  const key = session.pendingData?.key || 'all';
  snapshot();
  if (key === 'all') resetAll(sender);
  else resetSection(key, sender);
  logAdminAction(sender, 'bot_content_reset', key);
  sessionManager.setState(sender, chatId, { pendingAction: null, pendingData: null, currentMenu: MENU });
  return sendPanel(context, L(language, 'menu.bot_content.resetDone'), MENU);
}

/** Per-language flag editor + small-caps toggle. */
export async function botContentLanguageEditor(context, code) {
  const language = langOf(context);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const lang = getContent('languageDisplay.languages.' + code, {});
  sessionManager.setState(sender, chatId, {
    currentMenu: 'bot_content_language',
    pendingAction: 'bot_content_language_pick',
    pendingData: { code }
  });
  await sendText(context.sock, sender, buildMenu(
    '\u{1F310} ' + L(language, 'menu.bot_content.language.' + code), '',
    [
      L(language, 'menu.bot_content.field_detectedLine') + ': ' + (lang.name ?? ''),
      '⚑' + ': ' + (lang.flag ?? ''),
      '',
      '1. ' + L(language, 'menu.bot_content.editAgain'),
      '',
      '0. ' + L(language, 'common.back')
    ]
  ));
  return true;
}

export function botContentToggleSmallCaps(context) {
  const sender = context.sender;
  const next = getContent('languageDisplay.smallCapsEnabled', true) === false;
  setContent('languageDisplay.smallCapsEnabled', next, sender);
  logAdminAction(sender, 'bot_content_edit', JSON.stringify({ path: 'languageDisplay.smallCapsEnabled', newValue: next }));
  return showPanel(context, L(langOf(context), 'menu.bot_content.saved'), 'bot_content_language');
}

export async function botContentTimingValue(context, key) {
  const language = langOf(context);
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const map = {
    typingIndicatorEnabled: 'timing.typingIndicatorEnabled',
    typingMode: 'timing.typingMode',
    typingDelayMs: 'timing.typingDelayMs',
    typingTargeting: 'timing.typingTargeting',
    welcomeBackThresholds: 'timing.welcomeBackThresholds.minGapMs',
    cooldownLockMs: 'timing.cooldownLockMs',
    onboardingRetryMaxAttempts: 'timing.onboardingRetryMaxAttempts'
  };
  const path = map[key];
  sessionManager.setState(sender, chatId, {
    currentMenu: 'bot_content_timing',
    pendingAction: 'bot_content_timing_input',
    pendingData: { key, path }
  });
  const value = getContent(path);
  await sendText(context.sock, sender, buildMenu(
    L(language, 'menu.bot_content.field.' + key), '',
    [
      L(language, 'menu.bot_content.current') + ': '
        + (typeof value === 'object' ? JSON.stringify(value) : String(value)),
      '',
      L(language, 'menu.replyPrompt')
    ]
  ));
  return true;
}

export { EDITABLE_FIELDS, EDITABLE_VARIANTS, SAMPLE_CTX };
/** Import: ask for the JSON, then wait for a paste or a document. */
export async function botContentImportStart(context) {
  const sender = context.sender;
  sessionManager.setState(sender, context.chatId || sender, {
    currentMenu: MENU,
    pendingAction: 'bot_content_import',
    pendingData: { stage: 'await' }
  });
  await sendText(context.sock, sender, L(langOf(context), 'menu.bot_content.sendFile'));
  return true;
}

/** Prompt for the new text of one welcome-back variant. */
export async function showVariantInput(context, variant, index) {
  const language = langOf(context);
  const pool = getContent('welcomeBack.' + variant) || [];
  await sendText(context.sock, context.sender, buildMenu(
    L(language, 'menu.bot_content.variant.' + variant), '',
    [
      L(language, 'menu.bot_content.current') + ': ' + String(pool[index] ?? ''),
      '',
      '_' + resolvePlaceholders(String(pool[index] ?? ''), SAMPLE_CTX) + '_',
      '',
      L(language, 'menu.replyPrompt')
    ]
  ));
  return true;
}

/** Preview-then-confirm for a welcome-back variant edit. */
export async function confirmVariantEdit(context, pendingData) {
  const language = langOf(context);
  const { variant, index, draft } = pendingData || {};
  await sendText(context.sock, context.sender, buildMenu(
    L(language, 'menu.bot_content.variant.' + variant), '',
    [
      '> *' + L(language, 'menu.bot_content.variant.' + variant) + ' #' + (Number(index) + 1) + '*',
      '',
      '_' + resolvePlaceholders(String(draft ?? ''), SAMPLE_CTX) + '_',
      '',
      '1. ' + '\u2705 ' + L(language, 'menu.bot_content.save'),
      '2. ' + '\u270F\uFE0F ' + L(language, 'menu.bot_content.editAgain'),
      '3. ' + '\u274C ' + L(language, 'menu.bot_content.cancel')
    ]
  ));
  return true;
}

/** Prompt for one half of a language row (name or flag). */
export async function showLanguageField(context, code, which) {
  const language = langOf(context);
  const path = 'languageDisplay.languages.' + code + '.' + which;
  await sendText(context.sock, context.sender, buildMenu(
    L(language, 'menu.bot_content.language.' + code), '',
    [
      L(language, 'menu.bot_content.current') + ': ' + String(getContent(path) ?? ''),
      '',
      L(language, 'menu.replyPrompt')
    ]
  ));
  return true;
}
