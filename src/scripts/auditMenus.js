/**
 * Static menu audit (diagnostic).
 *
 * Enumerates every registered menu and cross-checks its options:
 *   - duplicate / non-sequential numbers
 *   - open:<id> targets that are not registered
 *   - custom:<name> handlers that do not exist
 *   - backTo targets that are not registered
 *   - standaloneCommand / alias collisions across menus
 *
 * Exit code is non-zero when any ERROR is found.
 */
import '../config/menus/index.js';
import { getAllMenus, getMenu } from '../config/menus/registry.js';
import {
  profileCustomHandlers, chatFaqCustomHandlers, adminCustomHandlers,
  userCustomHandlers, botNotificationCustomHandlers, messageDisplayCustomHandlers,
  customCommandCustomHandlers
} from '../utils/menuCustomHandlers.js';

const HANDLERS = {
  ...profileCustomHandlers, ...chatFaqCustomHandlers, ...adminCustomHandlers,
  ...userCustomHandlers, ...botNotificationCustomHandlers, ...messageDisplayCustomHandlers,
  ...customCommandCustomHandlers
};
const BUILTIN_ACTIONS = new Set(['sleep', 'copy_id']);

const errors = [];
const warnings = [];
const err = (m) => { errors.push(m); };
const warn = (m) => { warnings.push(m); };

/**
 * `open:` targets that intentionally have no registry entry because they are
 * legacy builders reached through the `sendMenuFn` bridge in index.js.
 * Each one is verified to exist there; a typo in this list would be a bug.
 */
const LEGACY_OPEN_TARGETS = new Set(['edit_profile_advanced', 'preferences_advanced']);

/**
 * Menus whose option numbers intentionally do not start at 1.
 * settings: only "9 = help" (0 = back is implicit).
 * main_menu: 0 = exit, 1-6 sections, 9 = help, A = admin.
 */
const SPARSE_NUMBERING = { settings: true, main_menu: true };

const menus = getAllMenus();
console.log('REGISTERED MENUS: ' + menus.length + '\n');

const pad = (s, n) => String(s === null || s === undefined ? '-' : s).padEnd(n);

console.log('=== MENU REGISTRATION TABLE ===');
console.log(pad('ID', 24) + pad('OPTS', 5) + pad('backTo', 20) + pad('standalone', 16) + 'aliases');
for (const m of menus) {
  const n = Array.isArray(m.options) ? m.options.length : (m.dynamicOptions ? 'dyn' : 0);
  console.log(pad(m.id, 24) + pad(n, 5) + pad(m.backTo, 20) + pad(m.standaloneCommand, 16) + (m.aliases || []).join(','));
}

console.log('\n=== OPTION DETAIL ===');
for (const m of menus) {
  let opts = m.options;
  if (typeof m.dynamicOptions === 'function') {
    try { opts = m.dynamicOptions(); } catch (e) { opts = []; err(`${m.id}: dynamicOptions threw: ${e.message}`); }
  }
  console.log(`\n[${m.id}] backTo=${m.backTo}  parent=${m.parent}  ${m.adminOnly ? 'ADMIN-ONLY ' : ''}${m.messageMode ? 'messageMode=' + m.messageMode : ''}`);
  if (!opts || !opts.length) { console.log('   (no options)'); continue; }

  const seen = new Map();
  const numbers = [];
  for (const o of opts) {
    const num = String(o.number);
    numbers.push({ num, int: Number(num) });
    if (seen.has(num)) err(`${m.id}: duplicate option number "${num}"`);
    seen.set(num, o);

    // action resolvable?
    const a = o.action;
    if (typeof a === 'string') {
      if (a.startsWith('open:')) {
        const target = a.slice(5);
        if (!getMenu(target) && !LEGACY_OPEN_TARGETS.has(target)) {
          err(`${m.id} option ${num}: open target "${target}" is NOT registered`);
        }
      } else if (a.startsWith('custom:')) {
        const h = a.slice(7);
        if (typeof HANDLERS[h] !== 'function') err(`${m.id} option ${num}: custom handler "${h}" MISSING`);
      } else if (!BUILTIN_ACTIONS.has(a)) {
        warn(`${m.id} option ${num}: action "${a}" is not a known builtin`);
      }
    } else {
      err(`${m.id} option ${num}: missing action`);
    }
  }

  // sequential check for the numeric run 1..N (skipped for intentionally sparse menus)
  const ints = numbers.map((x) => x.int).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!SPARSE_NUMBERING[m.id]) {
    const expected = [];
    for (let i = 1; i <= ints.length; i++) expected.push(i);
    const missing = expected.filter((n) => !ints.includes(n));
    if (missing.length) err(`${m.id}: numeric gap in option numbers (missing ${missing.join(',')})`);
  }
  for (const o of opts) {
    console.log('   ' + pad(o.number, 4) + pad((o.labelKey || o.label || ''), 38) + pad(o.action, 34) + (o.dynamicSuffix ? 'suffix=' + o.dynamicSuffix : ''));
  }
}

console.log('\n=== BACK NAVIGATION ===');
for (const m of menus) {
  if (m.backTo === null || m.backTo === undefined) { console.log(`[${m.id}] backTo=null (root)`); continue; }
  const ok = !!getMenu(m.backTo);
  if (!ok) err(`${m.id}: backTo "${m.backTo}" is NOT registered`);
  console.log(`[${m.id}] backTo -> ${m.backTo} ${ok ? 'OK' : 'MISSING'}`);
}

console.log('\n=== STANDALONE COMMAND COLLISIONS ===');
const owner = new Map();
for (const m of menus) {
  if (!m.standaloneCommand) continue;
  for (const c of [m.standaloneCommand, ...(m.aliases || [])]) {
    const k = String(c).toLowerCase();
    if (owner.has(k)) err(`command collision: "${c}" claimed by ${owner.get(k)} and ${m.id}`);
    else owner.set(k, m.id);
  }
}
console.log('unique menu commands: ' + owner.size);
console.log([...owner.entries()].map(([c, m]) => '  ' + c + ' -> ' + m).join('\n'));

console.log('\n=== SUMMARY ===');
console.log('ERRORS:   ' + errors.length);
errors.forEach((e) => console.log('  ERROR  ' + e));
console.log('WARNINGS: ' + warnings.length);
warnings.forEach((w) => console.log('  WARN   ' + w));
process.exit(errors.length ? 1 : 0);
