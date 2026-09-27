import sessionManager from './sessionManager.js';
import { renderMenu } from './menuRenderer.js';
import { sendMenu } from './messageHelper.js';
import { getMenu } from '../config/menus/registry.js';
import { toSmallCaps } from './smallCaps.js';

/**
 * Render a registered menu and send it with hybrid edit/delete behavior.
 * Updates session currentMenu (opts.sessionMenu overrides the stored state,
 * e.g. legacy 'main' for menu id 'main_menu').
 * opts: { headingParams, prefixLines, sessionMenu, type, resultLine }
 * A resultLine is prepended (small-capped) exactly like legacy builders.
 */
export async function sendMenuById(menuId, context, transitionKey, opts = {}) {
  const { sock, sender, chatId, user, language } = context;
  // Lazy registration guarantee: direct importers (tests, scripts) may not
  // have loaded menus/index.js yet. No-op when already registered.
  await import('../config/menus/index.js');
  const definition = getMenu(menuId);
  const key = transitionKey || definition?.transitionKey || menuId;
  const sessionState = opts.sessionMenu || definition?.sessionMenu || menuId;
  const prefixLines = [
    ...(opts.resultLine ? [toSmallCaps(opts.resultLine), ''] : []),
    ...(Array.isArray(opts.prefixLines) ? opts.prefixLines : [])
  ];
  const { text } = await renderMenu(menuId, user, language, { sender, chatId, ...opts, prefixLines });
  await sendMenu({ sock, sender, chatId, text, transitionKey: key, type: opts.type || 'submenuTransition' });
  try {
    if (sender && chatId && sessionManager && typeof sessionManager.setState === 'function') {
      sessionManager.setState(sender, chatId, { currentMenu: sessionState });
    } else if (context.session && typeof context.session === 'object') {
      context.session.currentMenu = sessionState;
    }
  } catch { /* session update must never break sending */ }
  return true;
}
