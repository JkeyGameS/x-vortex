import { getMenu } from '../config/menus/registry.js';
import { visibleMenuOptions, materializeDefinition } from './menuRenderer.js';
import logger from './logger.js';
import { toSmallCaps } from './smallCaps.js';
import { t } from '../services/localeService.js';
import config from '../config/config.js';
import { getRole } from '../services/rolesService.js';

const customHandlers = new Map();

/** Register a custom action handler for `custom:<name>` actions (wired in Phase 3+). */
export function registerMenuActionHandler(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerMenuActionHandler requires (name, function)');
  }
  customHandlers.set(name, fn);
  return true;
}

/**
 * Publish every exported custom handler into this module's registry.
 *
 * resolveHandler falls back to this Map when the caller does not pass a
 * `handlers` map. That fallback used to be dead -- nothing ever called
 * registerMenuActionHandler -- so a custom: action only worked from the three
 * cluster routers that happen to pass `handlers`, and every other router path
 * answered "this menu is unavailable right now". Registering here makes
 * resolution independent of the call site.
 *
 * Safe to call more than once; later calls overwrite.
 *
 * @param {Record<string, Function>} handlers
 * @returns {number} how many were registered
 */
export function registerAllMenuActionHandlers(handlers) {
  if (!handlers || typeof handlers !== 'object') return 0;
  let n = 0;
  for (const [name, fn] of Object.entries(handlers)) {
    if (typeof name === 'string' && name && typeof fn === 'function') {
      customHandlers.set(name, fn);
      n++;
    }
  }
  return n;
}

/** Names currently resolvable without a caller-supplied map. */
export function registeredMenuActionHandlerNames() {
  return [...customHandlers.keys()].sort();
}

export function getMenuActionHandler(name) {
  return customHandlers.get(name) || null;
}

function maxOptionNumber(definition, user) {
  const nums = visibleMenuOptions(definition, user).map((o) => o.number);
  return nums.length ? nums[nums.length - 1] : '0';
}

/**
 * Resolve raw input against a registered menu.
 * @returns {{ kind: 'action', action: string, option: object }
 *   | { kind: 'back', to: string }
 *   | { kind: 'invalid', max: string }
 *   | { kind: 'error', reason: string }}
 */
export function resolveMenuOption(menuId, input, user, language) {
  const raw = getMenu(menuId);
  if (!raw) return { kind: 'error', reason: 'menu_not_found' };
  const definition = materializeDefinition(raw, user, language);
  const normalized = String(input ?? '').trim().toUpperCase();
  if (normalized === '0' && definition.backTo !== null && definition.backTo !== undefined) {
    return { kind: 'back', to: definition.backTo };
  }
  for (const opt of visibleMenuOptions(definition, user)) {
    if (String(opt.number).toUpperCase() === normalized && normalized !== '') {
      return { kind: 'action', action: opt.action, option: opt };
    }
  }
  return { kind: 'invalid', max: maxOptionNumber(definition, user) };
}

function resolveHandler(name, context) {
  if (context && context.handlers && typeof context.handlers[name] === 'function') {
    return context.handlers[name];
  }
  return getMenuActionHandler(name) || null;
}

/**
 * Reply to the user when a menu action cannot be completed. Silently swallowing
 * these left users staring at an unchanged menu with no explanation, so every
 * failure path in runMenuAction reports back.
 *
 * Admins additionally get the action, the reason and any error text: the
 * generic "unavailable" notice gave no way to tell a missing handler from a
 * handler that threw, which is exactly the kind of bug that reaches production.
 */
async function notifyMenuFailure(context, key, detail = {}) {
  const sock = context?.sock;
  const sender = context?.sender;
  if (!sock || !sender) return;
  try {
    const language = context?.language || 'en';
    if (detail.reason && isAdminSender(sender)) {
      const L = (k) => toSmallCaps(t(language, k));
      const lines = [
        '> *\u26A0\uFE0F ' + L('menu.bot_content.unavailableTitle') + '*',
        '',
        L('menu.bot_content.unavailableAction') + ': ' + detail.action,
        L('menu.bot_content.unavailableReason') + ': ' + detail.reason,
      ];
      if (detail.error) lines.push(L('menu.bot_content.unavailableDetails') + ': ' + detail.error);
      lines.push('', '0. ' + L('common.back'));
      await sock.sendMessage(sender, { text: lines.join('\n') });
      return;
    }
    await sock.sendMessage(sender, { text: '\u274C ' + toSmallCaps(t(language, key)) });
  } catch (err) {
    logger.error({ err, key }, '[MENU] failed to deliver menu error notice');
  }
}

/**
 * Admin check that degrades safely: any failure falls through to the generic
 * notice rather than breaking the menu reply.
 *
 * Checks the static admin list and rolesService, because an admin granted the
 * role at runtime is not in config.adminJids and would otherwise silently lose
 * the diagnostic.
 */
function isAdminSender(sender) {
  try {
    if (Array.isArray(config.adminJids) && config.adminJids.includes(sender)) return true;
  } catch { /* fall through to the role check */ }
  try {
    const role = getRole(sender);
    if (role === 'owner' || role === 'admin') return true;
  } catch { /* roles unavailable; the generic notice is fine */ }
  return false;
}

/**
 * Execute a menu action. Navigation ('back') is handled by the caller via
 * resolveMenuOption; this runs the action itself.
 * context: { sock, sender, chatId, user, language, session, sendMenuFn, handlers }
 * @returns {*} handler result (open:* returns sendMenuFn result)
 */
export async function runMenuAction(action, context = {}) {
  if (typeof action !== 'string' || !action) {
    logger.error({ action }, '[MENU] runMenuAction called without an action string');
    return { success: false };
  }
  try {
    if (action.startsWith('open:')) {
      const to = action.slice('open:'.length);
      if (!to) throw new Error('runMenuAction: open: action missing menu id');
      if (!getMenu(to)) {
        logger.error({ menuId: to }, '[MENU] open: target is not registered');
        await notifyMenuFailure(context, 'common.menuUnavailable', { action, reason: 'missing_menu' });
        return { success: false };
      }
      // Clusters normally pass sendMenuFn so legacy panels can be opened in
      // place of a registry definition. When none is supplied, fall back to the
      // shared sender instead of failing: any registered id is openable, so a
      // missing cluster opener must not strand a live option.
      const opener = typeof context.sendMenuFn === 'function'
        ? context.sendMenuFn
        : async (menuId, menuUser, menuLang) => {
          const { sendMenuById } = await import('./menuSender.js');
          return sendMenuById(menuId, {
            sock: context.sock,
            sender: context.sender,
            chatId: context.chatId,
            user: menuUser,
            language: menuLang
          });
        };
      return await opener(to, context.user, context.language, {});
    }
    if (action === 'sleep' || action === 'copy_id') {
      const handler = resolveHandler(action, context);
      if (!handler) {
        logger.error({ action }, '[MENU] no handler registered');
        await notifyMenuFailure(context, 'common.menuUnavailable', { action, reason: 'missing_handler' });
        return { success: false };
      }
      return await handler(context);
    }
    if (action.startsWith('custom:')) {
      const name = action.slice('custom:'.length);
      const handler = resolveHandler(name, context);
      if (!handler) {
        logger.error({ name }, '[MENU] custom handler not found');
        await notifyMenuFailure(context, 'common.menuUnavailable', { action, reason: 'missing_handler' });
        return { success: false };
      }
      return await handler(context);
    }
    logger.warn({ action }, '[MENU] unknown action');
    await notifyMenuFailure(context, 'common.menuUnavailable', { action, reason: 'unknown_action' });
    return { success: false };
  } catch (err) {
    logger.error({ err, action }, '[MENU] runMenuAction failed');
    await notifyMenuFailure(context, 'common.menuUnavailable', {
      action,
      reason: 'handler_threw',
      error: err?.message ? String(err.message) : String(err)
    });
    return { success: false };
  }
}
