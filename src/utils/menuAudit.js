// Startup menu audit.
//
// Catches the class of bug where a menu is registered but unusable: a missing
// id or heading, options that are not an array, an option with no number or no
// action, an open: pointing at a menu that does not exist, or a backTo target
// that was renamed away. The Bot Content screens were unreachable in exactly
// this way before the router's generic guard existed, and nothing warned.
//
// Pure and side-effect free apart from logging, so it is safe to call on every
// boot and to assert against in tests.
import { getAllMenus, getMenu } from '../config/menus/registry.js';
import logger from './logger.js';

/**
 * Audit an explicit list of definitions.
 *
 * Takes the list as an argument rather than reading the registry so the checks
 * can be unit-tested against deliberately broken definitions -- registerMenu
 * validates on the way in, so a broken menu can never be injected through it.
 *
 * @param {object[]} menus
 * @returns {{ menuId: string|null, reason: string }[]}
 */
export function auditMenuList(menus) {
  const issues = [];
  const notes = [];
  const byId = new Map(menus.map((m) => [m.id, m]));

  for (const menu of menus) {
    const id = menu?.id ?? null;
    if (!id) issues.push({ menuId: id, reason: 'missing id' });

    // A menu needs a heading from one source or the other. headingKey is the
    // normal path; heading is accepted for definitions that inline it.
    if (!menu?.headingKey && !menu?.heading) {
      issues.push({ menuId: id, reason: 'missing heading (headingKey/heading)' });
    }
    if (menu?.options !== undefined && !Array.isArray(menu.options)) {
      issues.push({ menuId: id, reason: 'options is not an array' });
    }

    // backTo is dereferenced by resolveMenuOption for the "0" key, so a target
    // that is not registered is a real trap.
    const backTo = menu?.backTo;
    if (backTo && backTo !== 'null' && !byId.has(backTo)) {
      issues.push({ menuId: id, reason: `backTo target "${backTo}" is not registered` });
    }
    // parent is descriptive only -- nothing dereferences it -- so a session-only
    // parent (an inline-built menu such as general_settings) is a note, not a
    // fault. Reporting it as an issue would train readers to ignore the audit.
    const parent = menu?.parent;
    if (parent && parent !== 'null' && !byId.has(parent)) {
      notes.push({ menuId: id, reason: `parent "${parent}" is not a registered menu (descriptive only)` });
    }

    const numbers = new Set();
    for (const opt of menu?.options || []) {
      const n = opt?.number;
      if (n === undefined || n === null || n === '') {
        issues.push({ menuId: id, reason: 'option missing number' });
      } else if (numbers.has(String(n))) {
        // Duplicate numbers make an option unreachable, which is the same class
        // of bug as an open: pointing nowhere.
        issues.push({ menuId: id, reason: `duplicate option number "${n}"` });
      } else {
        numbers.add(String(n));
      }
      if (!opt?.action) {
        issues.push({ menuId: id, reason: `option ${n ?? '?'} missing action` });
        continue;
      }
      const action = String(opt.action);
      if (action.startsWith('open:')) {
        const targetId = action.slice(5);
        if (!byId.has(targetId)) {
          issues.push({ menuId: id, reason: `option ${n} points at unregistered menu "${targetId}"` });
        }
      }
    }
  }

  for (const n of notes) {
    logger.debug({ menuId: n.menuId, reason: n.reason }, '[MENU_AUDIT] note');
  }
  return issues;
}

/**
 * Audit the live registry. Load-bearing problems (a missing heading, an option
 * with no number or action, a duplicate number, a dangling backTo or open:) are
 * reported as issues; a descriptive `parent` that is not a registered menu is a
 * note, because nothing dereferences it.
 */
export function auditMenus() {
  const menus = getAllMenus();
  const issues = auditMenuList(menus);

  if (issues.length === 0) {
    logger.info({ count: menus.length }, '[MENU_AUDIT] all menus OK');
  } else {
    for (const i of issues) {
      logger.warn({ menuId: i.menuId, reason: i.reason }, '[MENU_AUDIT] issue');
    }
    logger.warn({ issues: issues.length, menus: menus.length }, '[MENU_AUDIT] completed with issues');
  }
  return issues;
}

export { getMenu };