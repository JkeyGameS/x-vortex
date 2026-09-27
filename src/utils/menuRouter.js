import { getMenu } from '../config/menus/registry.js';
import { visibleMenuOptions, materializeDefinition } from './menuRenderer.js';

const customHandlers = new Map();

/** Register a custom action handler for `custom:<name>` actions (wired in Phase 3+). */
export function registerMenuActionHandler(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerMenuActionHandler requires (name, function)');
  }
  customHandlers.set(name, fn);
  return true;
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
 * Execute a menu action. Navigation ('back') is handled by the caller via
 * resolveMenuOption; this runs the action itself.
 * context: { sock, sender, chatId, user, language, session, sendMenuFn, handlers }
 * @returns {*} handler result (open:* returns sendMenuFn result)
 */
export async function runMenuAction(action, context = {}) {
  if (typeof action !== 'string' || !action) throw new Error('runMenuAction requires an action string');
  if (action.startsWith('open:')) {
    const to = action.slice('open:'.length);
    if (!to) throw new Error('runMenuAction: open: action missing menu id');
    if (typeof context.sendMenuFn !== 'function') {
      throw new Error('runMenuAction: context.sendMenuFn is required for open: actions');
    }
    return context.sendMenuFn(to, context.user, context.language, {});
  }
  if (action === 'sleep' || action === 'copy_id') {
    const handler = resolveHandler(action, context);
    if (!handler) throw new Error(`runMenuAction: no handler registered for '${action}' (wire in Phase 3+)`);
    return handler(context);
  }
  if (action.startsWith('custom:')) {
    const name = action.slice('custom:'.length);
    const handler = resolveHandler(name, context);
    if (!handler) throw new Error(`runMenuAction: no handler registered for '${action}'`);
    return handler(context);
  }
  throw new Error(`runMenuAction: unknown action '${action}'`);
}
