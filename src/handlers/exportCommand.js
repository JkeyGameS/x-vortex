import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { sendText } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { askConfirmation } from '../utils/confirmationHelper.js';
import { logAdminAction } from '../services/adminLogService.js';
import { getUserByJidSync } from '../services/userService.js';
import * as chatRuleService from '../services/chatRuleService.js';
import * as faqService from '../services/faqService.js';
import {
  listExports, readExport, deleteExport, renameExport, writeExport, setExportHeading,
  buildProgressText, updateProgress
} from '../services/exportService.js';

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

const STAGE_DELAY_MS = config.exportStageDelayMs ?? 320;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isCancelled(sender, chatId) {
  const session = sessionManager.getSession(sender, chatId) || {};
  return session.isProcessing !== true || session.cancelled === true;
}

/**
 * Router hook: while a process is running (admin-lock on), incoming non-zero
 * messages from the admin are blocked with a lock message; `0` cancels.
 * @returns {boolean} true if the message was consumed by the lock
 */
export async function handleProcessingInterrupt(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  if (session.isProcessing !== true) return false;

  const language = resolveLanguage(sender);
  if (String(input || '').trim() === '0') {
    const text = L(language, 'exports.cancelled');
    await updateProgress({ sock: context.sock, sender, chatId, key: session.progressMessageKey || null, text });
    if (session.tempLockMessageKey) {
      try {
        await context.sock.sendMessage(sender, { delete: session.tempLockMessageKey });
      } catch (err) {
        logger.debug({ err }, 'Lock delete failed on cancel');
      }
    }
    sessionManager.setState(sender, chatId, {
      currentMenu: 'processing_cancelled',
      isProcessing: false,
      cancelled: true,
      processType: null,
      progressMessageKey: null,
      tempLockMessageKey: null
    });
    logAdminAction(sender, 'process_cancelled', 'cancelled via interrupt');
    return true;
  }

  // Block with a lock message.
  const lockText = L(language, 'exports.lockMessage');
  let sent = null;
  try {
    sent = await context.sock.sendMessage(sender, { text: lockText });
  } catch (err) {
    logger.warn({ err }, 'Lock message send failed');
  }
  if (sent?.key) {
    sessionManager.setState(sender, chatId, { tempLockMessageKey: sent.key });
    setTimeout(async () => {
      const current = sessionManager.getSession(sender, chatId) || {};
      if (current.tempLockMessageKey !== sent.key) return;
      try {
        await context.sock.sendMessage(sender, { delete: sent.key });
      } catch (err) {
        logger.debug({ err }, 'Lock message delete failed after timeout');
      }
      sessionManager.setState(sender, chatId, { tempLockMessageKey: null });
    }, 10000);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lock management
// ---------------------------------------------------------------------------

/**
 * Kick off a processing session (sets the admin-lock flags) and send the initial
 * progress message. Returns the progress message key.
 */
async function beginLock(context, processType, headingKey) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  sessionManager.setState(sender, chatId, {
    currentMenu: 'processing',
    isProcessing: true,
    processType,
    cancelled: false,
    progressMessageKey: null,
    tempLockMessageKey: null
  });
  const text = buildProgressText(0, L(language, 'exports.stage' + processType + '.0'), { heading: t(language, headingKey), footer: L(language, 'exports.reply0Cancel') });
  const sent = await sendText(context.sock, sender, text);
  const key = sent?.key || null;
  if (key) {
    sessionManager.setState(sender, chatId, { progressMessageKey: key });
  }
  return key;
}

async function updateLockProgress(context, percent, stageKey) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const key = session.progressMessageKey || null;
  const text = buildProgressText(percent, t(language, stageKey), { footer: L(language, 'exports.reply0Cancel') });
  const newKey = await updateProgress({ sock: context.sock, sender, chatId, key, text });
  if (newKey && newKey !== key) {
    sessionManager.setState(sender, chatId, { progressMessageKey: newKey });
  }
}

/** Finalize the progress message (success/failure/cancelled) and clear the lock. */
async function endLock(context, text) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const key = session.progressMessageKey || null;
  await updateProgress({ sock: context.sock, sender, chatId, key, text });
  sessionManager.setState(sender, chatId, {
    currentMenu: 'processing_done',
    isProcessing: false,
    cancelled: false,
    processType: null,
    progressMessageKey: null,
    tempLockMessageKey: null
  });
}

async function cancelLock(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const text = L(language, 'exports.cancelled');
  const session = sessionManager.getSession(sender, chatId) || {};
  const key = session.progressMessageKey || null;
  await updateProgress({ sock: context.sock, sender, chatId, key: key || null, text });
  // Delete any temp lock message.
  if (session.tempLockMessageKey) {
    try {
      await context.sock.sendMessage(sender, { delete: session.tempLockMessageKey });
    } catch (err) {
      logger.debug({ err }, 'Cancel lock delete failed');
    }
  }
  sessionManager.setState(sender, chatId, {
    currentMenu: 'processing_cancelled',
    isProcessing: false,
    cancelled: true,
    processType: null,
    progressMessageKey: null,
    tempLockMessageKey: null
  });
  logAdminAction(sender, 'process_cancelled', (session.processType || 'process') + ' cancelled');
}

/**
 * Run a staged process. Between each stage we wait a short delay and check for
 * cancellation; if the admin sent 0 (cancelled), abort early.
 *
 * `stages` is an array of [percent, stageKey].
 * After the last stage, waits up to `holdMs` for a 0-cancel before returning.
 * @returns {boolean} true if completed, false if cancelled
 */
async function runProcess(context, opts) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const { stages, headingKey, body, holdMs = 0, doneKey } = opts;

  await beginLock(context, opts.processType, headingKey);

  for (let i = 0; i < stages.length; i++) {
    await sleep(STAGE_DELAY_MS);
    if (isCancelled(sender, chatId)) {
      // The interrupt handler already displayed the cancelled state.
      return false;
    }
    await updateLockProgress(context, stages[i][0], stages[i][1]);
  }

  // If we should hold to allow a cancel before applying final result.
  if (holdMs > 0) {
    await sleep(holdMs);
    if (isCancelled(sender, chatId)) {
      return false;
    }
  }

  const result = await body();
  if (isCancelled(sender, chatId)) {
    return false;
  }
  // Emit the 100% completion stage before the final summary.
  if (doneKey) {
    await updateLockProgress(context, 100, doneKey);
  }
  await endLock(context, result);
  return true;
}

// ---------------------------------------------------------------------------
// Export process
// ---------------------------------------------------------------------------

export async function executeExport(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const heading = opts.heading || L(language, 'exports.exportDefaultHeading');

  const stages = [
    [10, 'exports.stageexport.1'],
    [40, 'exports.stageexport.2'],
    [70, 'exports.stageexport.3'],
    [90, 'exports.stageexport.4']
  ];

  const completed = await runProcess(context, {
    processType: 'export',
    headingKey: 'exports.exportHeading',
    stages,
    doneKey: 'exports.exportDone',
    body: async () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        adminJid: sender,
        heading,
        data: {
          chatRules: chatRuleService.exportRules(),
          faqEntries: faqService.exportEntries()
        }
      };
      const filename = writeExport(payload);
      if (!filename) {
        logAdminAction(sender, 'export_failed', 'failed to write export file');
        return L(language, 'exports.exportFailed');
      }
      logAdminAction(sender, 'export', ('exported ' + payload.data.chatRules.length + ' rules, ' + payload.data.faqEntries.length + ' faq entries -> ' + filename));
      return L(language, 'exports.exportComplete', { file: filename });
    }
  });

  await returnToExports(context);
  return completed;
}

// ---------------------------------------------------------------------------
// Import process
// ---------------------------------------------------------------------------

export async function startImport(context, filename) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);

  const parsed = readExport(filename);
  let chatData = [];
  let faqData = [];
  if (parsed) {
    chatData = Array.isArray(parsed.data?.chatRules) ? parsed.data.chatRules : [];
    faqData = Array.isArray(parsed.data?.faqEntries) ? parsed.data.faqEntries : [];
  }
  if (!parsed || (chatData.length === 0 && faqData.length === 0)) {
    await sendText(context.sock, sender, L(language, 'exports.importEmpty'));
    return;
  }

  sessionManager.setState(sender, chatId, {
    currentMenu: 'exports_import_policy',
    importDraft: { filename, chatData, faqData }
  });

  const lines = [
    L(language, 'exports.importPrompt', { file: filename }),
    '',
    '1. ' + L(language, 'exports.policySkip'),
    '2. ' + L(language, 'exports.policyOverwrite'),
    '3. ' + L(language, 'exports.policyKeepBoth'),
    '',
    '0. ' + L(language, 'exports.cancel')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(t(language, 'exports.importTitle'), '', lines), transitionKey: 'exports_import_policy' });
}

export async function handleImportPolicy(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const draft = session.importDraft;
  if (!draft) return returnToExports(context);

  if (input === '0') {
    await returnToExports(context);
    sessionManager.setState(sender, chatId, { importDraft: null });
    return;
  }
  const policyMap = { '1': 'skip', '2': 'overwrite', '3': 'keep_both' };
  const policy = policyMap[input];
  if (!policy) return sendText(context.sock, sender, L(language, 'exports.invalidPolicy'));

  const stages = [
    [20, 'exports.stageimport.1'],
    [40, 'exports.stageimport.2'],
    [70, 'exports.stageimport.3'],
    [90, 'exports.stageimport.4']
  ];

  const completed = await runProcess(context, {
    processType: 'import',
    headingKey: 'exports.importHeading',
    stages,
    doneKey: 'exports.importDone',
    body: async () => {
      const chatResult = chatRuleService.mergeRules(draft.chatData, policy);
      const faqResult = faqService.mergeEntries(draft.faqData, policy);
      logAdminAction(sender, 'import', ('policy=' + policy + ' chat:' + JSON.stringify(chatResult) + ' faq:' + JSON.stringify(faqResult)));
      return L(language, 'exports.importComplete', {
        rules: chatResult.added,
        faqs: faqResult.added,
        skipped: chatResult.skipped + faqResult.skipped,
        dup: chatResult.duplicated + faqResult.duplicated
      });
    }
  });

  sessionManager.setState(sender, chatId, { importDraft: null });
  await returnToExports(context);
  return completed;
}

// ---------------------------------------------------------------------------
// Activation process (with self-test)
// ---------------------------------------------------------------------------

async function runSelfTest(sender) {
  // Pick the first enabled chat rule (if any) that would match something, to
  // prove the matching engine still works. Otherwise fall back to validating
  // that the services are loadable.
  const enabledRule = chatRuleService.getEnabledRules()[0];
  if (enabledRule) {
    const trigger = enabledRule.triggers[0];
    if (trigger) {
      const match = chatRuleService.matchRule(trigger, enabledRule.language === 'all' ? 'en' : enabledRule.language);
      if (match) return true;
    }
  }
  // Data-structure self check: all stored rules/entries have required fields.
  const rulesAll = chatRuleService.getAllRules();
  const faqsAll = faqService.getAllEntries();
  const ruleOk = rulesAll.every((r) => r && typeof r.id === 'string' && Array.isArray(r.triggers));
  const faqOk = faqsAll.every((e) => e && typeof e.id === 'string' && typeof e.question === 'string');
  return ruleOk && faqOk;
}

export async function executeActivateExport(context, data = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const filename = data.filename;
  if (!filename) return returnToExports(context);

  const parsed = readExport(filename);
  const chatData = Array.isArray(parsed?.data?.chatRules) ? parsed.data.chatRules : [];
  const faqData = Array.isArray(parsed?.data?.faqEntries) ? parsed.data.faqEntries : [];
  if (!parsed || (chatData.length === 0 && faqData.length === 0)) {
    return sendText(context.sock, sender, L(language, 'exports.importEmpty'));
  }

  const stages = [
    [20, 'exports.stageactivation.1'],
    [40, 'exports.stageactivation.2'],
    [70, 'exports.stageactivation.3'],
    [90, 'exports.stageactivation.4']
  ];

  const completed = await runProcess(context, {
    processType: 'activation',
    headingKey: 'exports.activationHeading',
    stages,
    doneKey: 'exports.activationDone',
    body: async () => {
      const chatResult = chatRuleService.mergeRules(chatData, 'skip');
      const faqResult = faqService.mergeEntries(faqData, 'skip');
      logAdminAction(sender, 'export_activate', (filename + ' merged chat:' + chatResult.added + ' faq:' + faqResult.added));

      let testText;
      try {
        const ok = await runSelfTest(sender);
        testText = ok ? L(language, 'exports.selftestPass') : L(language, 'exports.selftestFail');
      } catch (err) {
        logger.warn({ err }, 'Self-test error');
        testText = L(language, 'exports.selftestFail');
      }
      return L(language, 'exports.activationComplete') + '\n\n' + testText;
    }
  });

  await returnToExports(context);
  return completed;
}

// ---------------------------------------------------------------------------
// Details submenu actions
// ---------------------------------------------------------------------------

export function openExportDetails(context, filename) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const data = readExport(filename);
  if (!data) {
    return sendText(context.sock, sender, L(language, 'exports.notFound'));
  }
  const rules = Array.isArray(data.data?.chatRules) ? data.data.chatRules : [];
  const faqs = Array.isArray(data.data?.faqEntries) ? data.data.faqEntries : [];
  sessionManager.setState(sender, chatId, { currentMenu: 'exports_detail', exportFilename: filename });
  const lines = [
    '📄 ' + filename,
    '',
    L(language, 'exports.fieldHeading') + ': ' + toSmallCaps(data.heading || ''),
    L(language, 'exports.fieldDate') + ': ' + toSmallCaps(data.exportedAt || ''),
    L(language, 'exports.fieldRules') + ': ' + rules.length,
    L(language, 'exports.fieldFaqs') + ': ' + faqs.length,
    '',
    '1. ' + L(language, 'exports.optionActivate'),
    '2. ' + L(language, 'exports.optionRename'),
    '3. ' + L(language, 'exports.optionDelete'),
    '',
    '0. ' + L(language, 'exports.back')
  ];
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(t(language, 'exports.detailTitle'), '', lines), transitionKey: 'exports_detail' });
}

async function handleDetailActivate(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const filename = session.exportFilename;
  if (!filename) return returnToExports(context);
  return askConfirmation({ sock: context.sock, sender, chatId }, 'activateExport', { filename, returnTo: 'exportsDetail' });
}

async function handleDetailRename(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  if (!session.exportFilename) return returnToExports(context);
  sessionManager.setState(sender, chatId, { currentMenu: 'exports_rename_input' });
  return sendMenu({ sock: context.sock, sender, chatId, text: toSmallCaps(t(language, 'exports.renamePrompt')), transitionKey: 'exports_rename_input' });
}

async function handleDetailDelete(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const filename = session.exportFilename;
  if (!filename) return returnToExports(context);
  return askConfirmation({ sock: context.sock, sender, chatId }, 'deleteExport', { filename, returnTo: 'exportsDetail' });
}

export function handleExportsDetailReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  switch (input) {
    case '0':
      return returnToExports(context);
    case '1':
      return handleDetailActivate(context);
    case '2':
      return handleDetailRename(context);
    case '3':
      return handleDetailDelete(context);
    default:
      return sendText(context.sock, sender, L(resolveLanguage(sender), 'exports.invalidDetail'));
  }
}

export async function handleExportsRenameInput(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const filename = session.exportFilename;
  if (!filename) return returnToExports(context);
  const newHeading = (input || '').trim();
  if (!newHeading) {
    return sendText(context.sock, sender, L(language, 'exports.renameInvalid'));
  }
  const ok = setExportHeading(filename, newHeading);
  if (!ok) {
    return sendText(context.sock, sender, L(language, 'exports.renameInvalid'));
  }
  logAdminAction(sender, 'export_rename', (filename + ' heading -> ' + newHeading));
  sessionManager.setState(sender, chatId, { currentMenu: 'exports_menu' });
  return sendExportsPanel(context);
}

export async function executeDeleteExport(context, data = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const filename = data.filename;
  if (!filename) return returnToExports(context);
  deleteExport(filename);
  logAdminAction(sender, 'export_delete', ('deleted ' + filename));
  return sendExportsPanel(context);
}

// ---------------------------------------------------------------------------
// Exports submenu (view list)
// ---------------------------------------------------------------------------

export function buildExportsPanel(language, resultLine = '') {
  const exportsList = listExports();
  const lines = [
    ...(resultLine ? [toSmallCaps(resultLine), ''] : []),
    L(language, 'exports.listPrompt')
  ];
  if (exportsList.length === 0) {
    lines.push('', L(language, 'exports.noExports'));
  } else {
    exportsList.slice(0, 10).forEach((e, i) => {
      lines.push(`${i + 1}. 📄 ${toSmallCaps(e.heading || e.filename)} · ${toSmallCaps(e.exportedAt || '')}`);
    });
  }
  lines.push('', L(language, 'exports.listHint'), '', t(language, 'admin.replyPrompt'));
  return buildMenu(t(language, 'exports.title'), '', lines);
}

export async function sendExportsPanel(context, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = opts.language || resolveLanguage(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'exports_menu', exportFilename: null });
  return sendMenu({
    sock: context.sock,
    sender,
    chatId,
    text: buildExportsPanel(language, opts.resultLine),
    transitionKey: opts.transitionKey || 'exports_menu'
  });
}

export async function handleExportsListReply(context, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = resolveLanguage(sender);
  const exportsList = listExports();
  const num = Number(input);
  if (!/^\d+$/.test(input) || num < 1 || num > exportsList.length) {
    return sendText(context.sock, sender, L(language, 'exports.invalidList'));
  }
  const chosen = exportsList[num - 1];
  return openExportDetails(context, chosen.filename);
}

async function returnToExports(context) {
  return sendExportsPanel(context);
}

// ---------------------------------------------------------------------------
// Standalone commands (export / import)
// ---------------------------------------------------------------------------

function notAuthorized(sock, sender, language) {
  return sendText(sock, sender, toSmallCaps(t(language, 'admin.notAuthorized')));
}

export async function cmdExport(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
  return executeExport(context);
}

export async function cmdImport(context) {
  const sender = context.sender;
  const language = resolveLanguage(sender);
  if (!isAdmin(sender)) return notAuthorized(context.sock, sender, language);
  return sendExportsPanel(context);
}

export const commands = [
  {
    name: 'exportchat',
    description: 'Export chat + FAQ data to a JSON file (admin)',
    usage: '/export-chat',
    aliases: ['export-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      return cmdExport(context);
    }
  },
  {
    name: 'importchat',
    description: 'Import chat + FAQ data from an export (admin)',
    usage: '/import-chat',
    aliases: ['import-chat'],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      return cmdImport(context);
    }
  }
];
