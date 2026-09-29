import sessionManager from './sessionManager.js';
import { sendText } from '../services/messageService.js';
import { sendMenu } from './messageHelper.js';
import { toSmallCaps } from './smallCaps.js';
import { t } from '../services/localeService.js';
import logger from './logger.js';

/**
 * Custom Commands admin wizard.
 *
 * State lives in session.pendingData.cc (the in-progress draft). Input is
 * captured by the dispatcher branch in index.js, which routes the
 * 'custom_command_*' session states to handleCustomCommandWizard().
 */

const L = (language, key, params) => toSmallCaps(t(language || 'en', key, params));

export const CC_WIZARD_STATES = [
  'custom_command_name',
  'custom_command_aliases',
  'custom_command_description',
  'custom_command_action',
  'custom_command_config',
  'custom_command_permissions',
  'custom_command_pick',
  'custom_command_editpick',
  'custom_command_confirm_delete',
  'custom_command_impex',
  'custom_command_import_input'
];

export function isCustomCommandWizardState(menu) {
  return CC_WIZARD_STATES.includes(menu);
}

const PAGE_SIZE = 10;

function ctxInfo(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  return { sender, chatId, language: context.language || 'en' };
}

async function prompt(context, text, menu, pendingData = {}) {
  const { sender, chatId } = ctxInfo(context);
  sessionManager.setState(sender, chatId, {
    currentMenu: menu,
    pendingAction: menu,
    pendingData
  });
  await sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'custom_commands' });
}

const backPrompt = (language, heading, key) =>
  '> *' + heading + '*\n\n' + L(language, key) + '\n\n0. ' + L(language, 'common.back');

async function reserved() {
  const { reservedCommandNames } = await import('../handlers/commandHandler.js');
  return reservedCommandNames();
}

async function openMain(context, resultLine) {
  const { sendMenuById } = await import('./menuSender.js');
  const { sender, chatId, language } = ctxInfo(context);
  return sendMenuById('custom_commands', { ...context, sender, chatId, language }, 'system_custom_commands', { resultLine, sessionMenu: 'custom_commands' });
}

// ---------------------------------------------------------------------------
// Wizard prompts
// ---------------------------------------------------------------------------

async function promptName(context, draft, extra = {}) {
  const { language } = ctxInfo(context);
  const body = backPrompt(language, L(language, 'menu.custom_commands.addTitle'), 'menu.custom_commands.stepName')
    .replace('> *' + L(language, 'menu.custom_commands.addTitle') + '*\n\n', '')
    .replace(/0\. .*$/s, '');
  return prompt(
    context,
    '> *' + L(language, 'menu.custom_commands.addTitle') + '*\n\n' +
    L(language, 'menu.custom_commands.stepName') + '\n\n' +
    (extra.notice ? extra.notice + '\n\n' : '') +
    L(language, 'menu.custom_commands.nameHint') + '\n\n0. ' + L(language, 'common.back'),
    'custom_command_name',
    draft
  );
}

async function promptAliases(context, draft, notice) {
  const { language } = ctxInfo(context);
  return prompt(
    context,
    '> *' + L(language, 'menu.custom_commands.stepAliases') + '*\n\n' +
    (notice ? notice + '\n\n' : '') +
    L(language, 'menu.custom_commands.aliasesHint') + '\n\n0. ' + L(language, 'common.back'),
    'custom_command_aliases',
    draft
  );
}

async function promptDescription(context, draft) {
  const { language } = ctxInfo(context);
  return prompt(
    context,
    '> *' + L(language, 'menu.custom_commands.stepDescription') + '*\n\n' +
    L(language, 'menu.custom_commands.descriptionHint') + '\n\n0. ' + L(language, 'common.back'),
    'custom_command_description',
    draft
  );
}

function actionMenuText(language) {
  return '> *' + L(language, 'menu.custom_commands.stepAction') + '*\n\n' +
    '1. 💬 ' + L(language, 'menu.custom_commands.action_send_text') + '\n' +
    '2. 📂 ' + L(language, 'menu.custom_commands.action_open_menu') + '\n' +
    '3. 🧩 ' + L(language, 'menu.custom_commands.action_invoke_rule') + '\n' +
    '4. 📨 ' + L(language, 'menu.custom_commands.action_forward') + '\n\n' +
    '0. ' + L(language, 'common.back');
}

async function promptAction(context, draft) {
  return prompt(context, actionMenuText(ctxInfo(context).language), 'custom_command_action', draft);
}

async function promptPermissions(context, draft) {
  const { language } = ctxInfo(context);
  return prompt(
    context,
    '> *' + L(language, 'menu.custom_commands.stepPermissions') + '*\n\n' +
    '1. 🔒 ' + L(language, 'menu.custom_commands.permAdminOnly') + ': ' + L(language, draft.adminOnly ? 'common.onFlag' : 'common.offFlag') + '\n' +
    '2. 👥 ' + L(language, 'menu.custom_commands.permGroupAllowed') + ': ' + L(language, draft.groupAllowed ? 'common.onFlag' : 'common.offFlag') + '\n' +
    '3. ✅ ' + L(language, 'menu.custom_commands.save') + '\n' +
    '4. ✏️ ' + L(language, 'menu.custom_commands.review') + '\n\n' +
    '0. ' + L(language, 'common.back'),
    'custom_command_permissions',
    draft
  );
}

async function promptConfigText(context, draft) {
  const { language } = ctxInfo(context);
  return prompt(
    context,
    '> *' + L(language, 'menu.custom_commands.stepConfigText') + '*\n\n' +
    L(language, 'menu.custom_commands.textHint') + '\n\n0. ' + L(language, 'common.back'),
    'custom_command_config',
    draft
  );
}

async function promptConfigPrefix(context, draft) {
  const { language } = ctxInfo(context);
  return prompt(
    context,
    '> *' + L(language, 'menu.custom_commands.stepConfigPrefix') + '*\n\n' +
    L(language, 'menu.custom_commands.prefixHint') + '\n\n0. ' + L(language, 'common.back'),
    'custom_command_config',
    draft
  );
}

async function promptPicker(context, draft, items, titleKey, hintKey) {
  const { language } = ctxInfo(context);
  const page = draft.page || 0;
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safe = Math.min(page, pages - 1);
  const slice = items.slice(safe * PAGE_SIZE, safe * PAGE_SIZE + PAGE_SIZE);
  const lines = slice.map((it, i) => `${safe * PAGE_SIZE + i + 1}. ${it.line}`);
  return prompt(
    context,
    '> *' + L(language, titleKey) + '*\n\n' +
    (lines.length ? lines.join('\n') : L(language, 'menu.custom_commands.noneAvailable')) + '\n\n' +
    L(language, hintKey) + '\n\n0. ' + L(language, 'common.back'),
    'custom_command_pick',
    { ...draft, page: safe, total: pages, pickKind: draft.pickKind }
  );
}

async function menuItems(draft) {
  const { getAllMenus } = await import('../config/menus/registry.js');
  return getAllMenus().map((m) => ({ id: m.id, line: m.headingKey + '' })).map((m) => ({ id: m.id, line: m.id }));
}

async function ruleItems() {
  const { getAllRules } = await import('../services/chatRuleService.js');
  return getAllRules().map((r) => ({ id: r.id, line: (r.name || r.id) + '' }));
}

// ---------------------------------------------------------------------------
// Add wizard
// ---------------------------------------------------------------------------

export async function startAddWizard(context) {
  const draft = { mode: 'add', name: null, aliases: [], description: '', action: null, actionConfig: {}, adminOnly: false, groupAllowed: true, enabled: true };
  return promptName(context, draft);
}

export async function handleWizardInput(context, text) {
  const { sender, chatId, language } = ctxInfo(context);
  const session = sessionManager.getSession(sender, chatId) || {};
  const menu = session.currentMenu;
  const draft = { ...(session.pendingData?.cc || {}) };
  const raw = String(text || '').trim();

  // 0 = cancel out of any wizard step.
  if (raw === '0' && menu !== 'custom_command_name') return openMain(context);
  if (raw === '0' && menu === 'custom_command_name') {
    sessionManager.setState(sender, chatId, { currentMenu: 'custom_commands', pendingAction: null, pendingData: null });
    return openMain(context);
  }

  const svc = await import('../services/customCommandService.js');

  if (menu === 'custom_command_name') {
    if (!svc.isValidName(raw)) {
      return promptName(context, draft, { notice: '⚠️ ' + L(language, 'menu.custom_commands.invalidName') });
    }
    const orig = draft.originalName || null;
    const own = orig ? [orig, ...(svc.getCustomCommand(orig)?.aliases || [])] : [];
    const conflicts = svc.findConflicts(raw, [], await reserved(), orig, own);
    if (conflicts.length) {
      const c = conflicts[0];
      const kind = c.kind === 'alias' ? 'menu.custom_commands.conflictAlias' : 'menu.custom_commands.conflictName';
      return promptName(context, draft, {
        notice: '⚠️ ' + L(language, kind, { name: c.value }) + '\n' + L(language, 'menu.custom_commands.conflictHint')
      });
    }
    draft.name = raw.toLowerCase();
    return promptAliases(context, draft);
  }

  if (menu === 'custom_command_aliases') {
    if (raw.toLowerCase() === 'skip' || raw === '') draft.aliases = [];
    else {
      const parts = raw.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
        .filter((a) => a !== draft.name);
      const orig = draft.originalName || null;
      const own = orig ? [orig, ...(svc.getCustomCommand(orig)?.aliases || [])] : [];
      const conflicts = svc.findConflicts(draft.name, parts, await reserved(), orig, own);
      if (conflicts.length) {
        const c = conflicts[0];
        return promptAliases(context, draft, {
          notice: '⚠️ ' + L(language, 'menu.custom_commands.conflictAlias', { name: c.value }) + '\n' + L(language, 'menu.custom_commands.conflictHint')
        });
      }
      draft.aliases = parts.slice(0, (svc.__limits?.().maxAliasesPerCommand) || 5);
    }
    return promptDescription(context, draft);
  }

  if (menu === 'custom_command_description') {
    draft.description = raw.toLowerCase() === 'skip' ? '' : raw.slice(0, 100);
    return promptAction(context, draft);
  }

  if (menu === 'custom_command_action') {
    const map = { 1: 'send_text', 2: 'open_menu', 3: 'invoke_chat_rule', 4: 'forward_to_admin' };
    const action = map[raw];
    if (!action) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
      return promptAction(context, draft);
    }
    draft.action = action;
    if (action === 'send_text') return promptConfigText(context, draft);
    if (action === 'forward_to_admin') return promptConfigPrefix(context, draft);
    draft.pickKind = action;
    draft.page = 0;
    const items = action === 'open_menu' ? await menuItems(draft) : await ruleItems();
    return promptPicker(context, draft, items,
      action === 'open_menu' ? 'menu.custom_commands.stepConfigMenu' : 'menu.custom_commands.stepConfigRule',
      'menu.custom_commands.pickHint');
  }

  if (menu === 'custom_command_pick') {
    // Command picker (edit / delete / toggle / list) vs config picker.
    if (typeof draft.pickKind === 'string' && draft.pickKind.startsWith('command_')) {
      const svc0 = await import('../services/customCommandService.js');
      const all = svc0.getAllCustomCommands().sort((a, b) => a.name.localeCompare(b.name));
      const num = Number(raw);
      if (!Number.isInteger(num) || num < 1 || num > all.length) {
        await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: all.length }));
        return pickCommand(context, draft.pickKind.slice(8), {
          edit: 'menu.custom_commands.editTitle',
          delete: 'menu.custom_commands.deleteTitle',
          toggle: 'menu.custom_commands.toggleTitle',
          list: 'menu.custom_commands.listTitle'
        }[draft.pickKind.slice(8)] || 'menu.custom_commands.listTitle');
      }
      const chosen = all[num - 1];
      if (draft.pickKind === 'command_delete') return confirmDelete(context, chosen.name);
      if (draft.pickKind === 'command_toggle') return toggleCommand(context, chosen.name);
      return startEditFlow(context, chosen.name);
    }
    const items = draft.pickKind === 'open_menu' ? await menuItems(draft) : await ruleItems();
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 1 || num > items.length) {
      await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 1, max: items.length }));
      return promptPicker(context, draft, items, 'menu.custom_commands.stepConfigMenu', 'menu.custom_commands.pickHint');
    }
    const chosen = items[num - 1];
    if (draft.pickKind === 'open_menu') draft.actionConfig = { menuId: chosen.id };
    else draft.actionConfig = { ruleId: chosen.id };
    return promptPermissions(context, draft);
  }

  if (menu === 'custom_command_config') {
    if (draft.action === 'send_text') {
      if (!raw) {
        await sendText(context.sock, sender, L(language, 'menu.custom_commands.textRequired'));
        return promptConfigText(context, draft);
      }
      draft.actionConfig = { text: raw.slice(0, 1000) };
    } else {
      draft.actionConfig = { prefix: raw.slice(0, 200) };
    }
    return promptPermissions(context, draft);
  }

  if (menu === 'custom_command_permissions') {
    if (raw === '1') { draft.adminOnly = !draft.adminOnly; return promptPermissions(context, draft); }
    if (raw === '2') { draft.groupAllowed = !draft.groupAllowed; return promptPermissions(context, draft); }
    if (raw === '4') { draft.adminOnly = false; draft.groupAllowed = true; return promptPermissions(context, draft); }
    if (raw === '3') return saveDraft(context, draft);
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 }));
    return promptPermissions(context, draft);
  }

  if (menu === 'custom_command_editpick') {
    if (raw === '1') return promptName(context, { ...draft, originalName: draft.originalName });
    if (raw === '2') return promptAliases(context, { ...draft, originalName: draft.originalName });
    if (raw === '3') return promptDescription(context, { ...draft, originalName: draft.originalName });
    if (raw === '4') { draft.action = null; return promptAction(context, draft); }
    if (raw === '5') return promptPermissions(context, draft);
    if (raw === '6') return saveDraft(context, draft);
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 }));
    return startEditFlow(context, draft.originalName);
  }

  if (menu === 'custom_command_confirm_delete') {
    if (raw === '1') return deleteCommand(context, draft.target);
    if (raw === '2' || raw === '0') return startDeleteWizard(context);
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 }));
    return confirmDelete(context, draft.target);
  }

  if (menu === 'custom_command_impex') {
    if (raw === '1') return exportAll(context);
    if (raw === '2' || raw === '3') {
      return prompt(context,
        '> *' + L(language, 'menu.custom_commands.impexTitle') + '*\n\n' +
        L(language, 'menu.custom_commands.pasteHint') + '\n\n0. ' + L(language, 'common.back'),
        'custom_command_import_input', { policy: raw === '2' ? 'skip' : 'rename' });
    }
    await sendText(context.sock, sender, L(language, 'common.invalidChoiceMinMax', { min: 0, max: 3 }));
    return startImportExport(context);
  }

  if (menu === 'custom_command_import_input') {
    return importPasted(context, text, draft.policy || 'skip');
  }

  return openMain(context);
}

async function saveDraft(context, draft) {
  const { sender, language } = ctxInfo(context);
  const svc = await import('../services/customCommandService.js');
  const { registerDynamicCommand } = await import('../handlers/commandHandler.js');
  const { buildCustomCommand } = await import('./customCommandRunner.js');
  const { logAdminAction } = await import('../services/adminLogService.js');

  const res = draft.originalName
    ? svc.updateCustomCommand(draft.originalName, draft, await reserved())
    : svc.addCustomCommand({ ...draft, createdBy: sender, updatedBy: sender }, await reserved());

  if (!res.ok) {
    if (res.error === 'conflict') {
      const c = res.conflicts[0];
      return promptName(context, draft, {
        notice: '⚠️ ' + L(language, c.kind === 'alias' ? 'menu.custom_commands.conflictAlias' : 'menu.custom_commands.conflictName', { name: c.value })
          + '\n' + L(language, 'menu.custom_commands.conflictHint')
      });
    }
    logger.warn({ err: res.error }, '[CUSTOM_CMD] save failed');
    return openMain(context, L(language, 'menu.custom_commands.saveFailed'));
  }

  // Runtime registration: no restart needed.
  if (draft.originalName && draft.originalName !== res.command.name) {
    const { unregisterDynamicCommand } = await import('../handlers/commandHandler.js');
    unregisterDynamicCommand(draft.originalName);
  }
  if (res.command.enabled) registerDynamicCommand(res.command.name, buildCustomCommand(res.command));

  logAdminAction(sender, draft.originalName ? 'custom_command_updated' : 'custom_command_added',
    JSON.stringify({ name: res.command.name }));
  sessionManager.setState(sender, ctxInfo(context).chatId, { currentMenu: 'custom_commands', pendingAction: null, pendingData: null });
  return openMain(context, L(language, 'menu.custom_commands.saved', { name: res.command.name }));
}

// ---------------------------------------------------------------------------
// List / edit / delete / toggle
// ---------------------------------------------------------------------------

export async function listCommands(context, opts = {}) {
  const { language } = ctxInfo(context);
  const svc = await import('../services/customCommandService.js');
  const all = svc.getAllCustomCommands().sort((a, b) => a.name.localeCompare(b.name));
  if (!all.length) return openMain(context, L(language, 'menu.custom_commands.noneYet'));
  const lines = all.map((c, i) => `${i + 1}. ${c.enabled ? '🟢' : '🔴'} /${c.name}${c.description ? ' — ' + c.description : ''}`);
  return prompt(context,
    '> *' + L(language, 'menu.custom_commands.listTitle') + '*\n\n' + lines.join('\n') + '\n\n' +
    L(language, opts.hint || 'menu.custom_commands.selectHint') + '\n\n0. ' + L(language, 'common.back'),
    'custom_command_pick',
    { pickKind: 'command_' + (opts.mode || 'list'), page: 0, mode: opts.mode || 'list', items: all.map((c) => c.name) });
}

async function pickCommand(context, mode, titleKey) {
  const svc = await import('../services/customCommandService.js');
  const { language } = ctxInfo(context);
  const all = svc.getAllCustomCommands().sort((a, b) => a.name.localeCompare(b.name));
  if (!all.length) return openMain(context, L(language, 'menu.custom_commands.noneYet'));
  const items = all.map((c) => ({ id: c.name, line: `${c.enabled ? '🟢' : '🔴'} /${c.name} — ${c.description || L(language, 'menu.custom_commands.noDescription')}` }));
  return promptPicker(context, { pickKind: mode, page: 0, mode }, items, titleKey, 'menu.custom_commands.pickHint');
}

export function startListWizard(context) { return listCommands(context); }
export function startEditWizard(context) { return pickCommand(context, 'edit', 'menu.custom_commands.editTitle'); }
export function startDeleteWizard(context) { return pickCommand(context, 'delete', 'menu.custom_commands.deleteTitle'); }
export function startToggleWizard(context) { return pickCommand(context, 'toggle', 'menu.custom_commands.toggleTitle'); }

/** Edit submenu for one command; each row re-enters the wizard for that field. */
async function startEditFlow(context, name) {
  const svc = await import('../services/customCommandService.js');
  const { language } = ctxInfo(context);
  const cc = svc.getCustomCommand(name);
  if (!cc) return openMain(context, L(language, 'menu.custom_commands.notFound'));
  return prompt(context,
    '> *' + L(language, 'menu.custom_commands.editTitle') + ': /' + cc.name + '*\n\n' +
    '1. 📛 ' + L(language, 'menu.custom_commands.editName') + '\n' +
    '2. 🔗 ' + L(language, 'menu.custom_commands.editAliases') + '\n' +
    '3. 📝 ' + L(language, 'menu.custom_commands.editDescription') + '\n' +
    '4. 🎯 ' + L(language, 'menu.custom_commands.editAction') + '\n' +
    '5. 🔒 ' + L(language, 'menu.custom_commands.editPermissions') + '\n' +
    '6. ✅ ' + L(language, 'menu.custom_commands.save') + '\n\n' +
    '0. ' + L(language, 'common.back'),
    'custom_command_editpick',
    { originalName: cc.name, name: cc.name, aliases: cc.aliases, description: cc.description, action: cc.action, actionConfig: cc.actionConfig, adminOnly: cc.adminOnly, groupAllowed: cc.groupAllowed, enabled: cc.enabled });
}

async function confirmDelete(context, name) {
  const { language } = ctxInfo(context);
  return prompt(context,
    L(language, 'menu.custom_commands.confirmDelete', { name }) + '\n\n' +
    '1. ✅ ' + L(language, 'admin.yes') + '\n' +
    '2. ❌ ' + L(language, 'admin.no') + '\n\n' +
    '0. ' + L(language, 'common.back'),
    'custom_command_confirm_delete',
    { target: name });
}

export async function deleteCommand(context, name) {
  const { sender, language } = ctxInfo(context);
  const svc = await import('../services/customCommandService.js');
  const { unregisterDynamicCommand } = await import('../handlers/commandHandler.js');
  const { logAdminAction } = await import('../services/adminLogService.js');
  const res = svc.deleteCustomCommand(name);
  if (!res.ok) return openMain(context, L(language, 'menu.custom_commands.notFound'));
  unregisterDynamicCommand(name);
  logAdminAction(sender, 'custom_command_deleted', JSON.stringify({ name }));
  sessionManager.setState(sender, ctxInfo(context).chatId, { currentMenu: 'custom_commands', pendingAction: null, pendingData: null });
  return openMain(context, L(language, 'menu.custom_commands.deleted', { name }));
}

export async function toggleCommand(context, name) {
  const { sender, language } = ctxInfo(context);
  const svc = await import('../services/customCommandService.js');
  const { registerDynamicCommand, unregisterDynamicCommand } = await import('../handlers/commandHandler.js');
  const { buildCustomCommand } = await import('./customCommandRunner.js');
  const { logAdminAction } = await import('../services/adminLogService.js');
  const res = svc.toggleCustomCommand(name);
  if (!res.ok) return openMain(context, L(language, 'menu.custom_commands.notFound'));
  if (res.command.enabled) registerDynamicCommand(res.command.name, buildCustomCommand(res.command));
  else unregisterDynamicCommand(res.command.name);
  logAdminAction(sender, 'custom_command_toggled', JSON.stringify({ name, newState: res.command.enabled }));
  return listCommands(context, { mode: 'toggle' });
}

export async function startImportExport(context) {
  const { language } = ctxInfo(context);
  return prompt(context,
    '> *' + L(language, 'menu.custom_commands.impexTitle') + '*\n\n' +
    '1. 📤 ' + L(language, 'menu.custom_commands.exportAll') + '\n' +
    '2. 📥 ' + L(language, 'menu.custom_commands.importPaste') + '\n' +
    '3. 📥 ' + L(language, 'menu.custom_commands.importFile') + '\n\n' +
    '0. ' + L(language, 'common.back'),
    'custom_command_impex', {});
}

export async function exportAll(context) {
  const { sender, language } = ctxInfo(context);
  const svc = await import('../services/customCommandService.js');
  const json = svc.exportCustomCommands();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  try {
    await context.sock.sendMessage(sender, {
      document: Buffer.from(json, 'utf8'),
      mimetype: 'application/json',
      fileName: `custom-commands-${stamp}.json`,
      caption: L(language, 'menu.custom_commands.exported')
    });
  } catch (err) {
    logger.error({ err }, '[CUSTOM_CMD] export send failed');
  }
  sessionManager.setState(sender, ctxInfo(context).chatId, { currentMenu: 'custom_commands', pendingAction: null, pendingData: null });
  return openMain(context, L(language, 'menu.custom_commands.exported'));
}

export async function importPasted(context, text, policy = 'skip') {
  const { sender, language } = ctxInfo(context);
  const svc = await import('../services/customCommandService.js');
  const { logAdminAction } = await import('../services/adminLogService.js');
  const { reRegisterAllCustomCommands } = await import('../handlers/commandHandler.js');
  const summary = svc.importCustomCommands(text, policy, await reserved(), (n) => n + '_cmd');
  if (!summary.ok) {
    await sendText(context.sock, sender, L(language, 'menu.custom_commands.invalidJson'));
    return startImportExport(context);
  }
  await reRegisterAllCustomCommands();
  logAdminAction(sender, 'custom_commands_imported', JSON.stringify({ added: summary.added, skipped: summary.skipped, overwritten: summary.overwritten }));
  sessionManager.setState(sender, ctxInfo(context).chatId, { currentMenu: 'custom_commands', pendingAction: null, pendingData: null });
  return openMain(context, L(language, 'menu.custom_commands.imported', { added: summary.added, skipped: summary.skipped }));
}
