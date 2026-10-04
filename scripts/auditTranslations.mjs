// Static audit of menu definitions against translations and handlers.
//
// Reads menu definitions and translation files only; it never starts the bot, so
// it is safe to run locally. Reports:
//   1. every labelKey / headingKey / footerKey / fallbackKey that does not
//      resolve in a language file
//   2. every custom:<name> action with no resolvable handler
//   3. every open:<id> action pointing at an unregistered menu
//
// node scripts/auditTranslations.js            -> audit en across all menus
// node scripts/auditTranslations.js --all-langs -> every language
// node scripts/auditTranslations.js --json       -> machine readable
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'fr', 'de', 'es', 'ar'];
const allLangs = process.argv.includes('--all-langs');
const asJson = process.argv.includes('--json');

const url = (rel) => new URL('../' + rel, import.meta.url).href;

const { getAllMenus } = await import(url('src/config/menus/registry.js'));
await import(url('src/config/menus/index.js'));
const { allMenuCustomHandlers } =
  await import(url('src/utils/menuCustomHandlers.js'));
const { getMenuActionHandler, registerAllMenuActionHandlers } =
  await import(url('src/utils/menuRouter.js'));

const translations = {};
for (const lang of LANGS) {
  translations[lang] = JSON.parse(fs.readFileSync(path.join(root, 'translations', `${lang}.json`), 'utf8'));
}

const dig = (obj, dotted) => String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const menus = getAllMenus();
const KEY_FIELDS = ['headingKey', 'footerKey', 'fallbackHeadingKey', 'fallbackFooterKey'];

const missingKeys = {};
for (const lang of allLangs ? LANGS : ['en']) {
  const t = translations[lang];
  const found = new Map();
  const note = (menuId, field, key) => {
    if (!key || typeof key !== 'string') return;
    // A dotted key is a namespace prefix only when the value is missing; the
    // renderer chains headingKey -> fallbackHeadingKey, so a missing primary
    // is not itself a fault.
    if (dig(t, key) !== undefined) return;
    if (!found.has(menuId)) found.set(menuId, []);
    found.get(menuId).push(`${field}=${key}`);
  };
  for (const menu of menus) {
    for (const field of KEY_FIELDS) note(menu.id, field, menu[field]);
    for (const opt of menu.options || []) {
      note(menu.id, 'labelKey', opt.labelKey);
      note(menu.id, 'fallbackKey', opt.fallbackKey);
      if (opt.emojiFallbackKey) note(menu.id, 'emojiFallbackKey', opt.emojiFallbackKey);
    }
    // dynamicOptions() menus carry no labels at definition time.
  }
  missingKeys[lang] = Object.fromEntries(found);
}

// Mirror the bot's startup step. Without this the audit reports every exported
// handler as "resolvable only via a caller-supplied map", which is precisely the
// state that shipped as a bug: the handlers existed, but menuRouter's registry
// was empty.
const registeredCount = registerAllMenuActionHandlers(allMenuCustomHandlers);

const routerSrc = fs.readFileSync(fileURLToPath(url('src/index.js')), 'utf8');
/** True when src/index.js has a dedicated inline router branch for this menu id. */
const hasInlineRouterBranch = (menuId) =>
  new RegExp("['\"]" + menuId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['\"]").test(routerSrc);

const handlerReport = { missing: [], inlineBranch: [], ok: 0 };
const openReport = [];
const seenAction = new Set();
for (const menu of menus) {
  for (const opt of menu.options || []) {
    const action = String(opt.action || '');
    if (action.startsWith('open:')) {
      const to = action.slice(5);
      if (!getAllMenus().some((m) => m.id === to)) {
        openReport.push(`${menu.id}#${opt.number} -> open:${to}`);
      }
    } else if (action.startsWith('custom:')) {
      const name = action.slice(7);
      const key = menu.id + '#' + opt.number;
      if (seenAction.has(name + key)) continue;
      seenAction.add(name + key);
      const inExports = typeof allMenuCustomHandlers[name] === 'function';
      // The only thing that matters now: does a caller of runMenuAction find a
      // handler, with or without an explicit map?
      const resolvable = inExports || typeof getMenuActionHandler(name) === 'function';
      if (resolvable) {
        handlerReport.ok++;
      } else if (hasInlineRouterBranch(menu.id)) {
        // Never reaches runMenuAction; the router handles it inline.
        handlerReport.inlineBranch.push(`${menu.id}#${opt.number} -> custom:${name}`);
      } else {
        handlerReport.missing.push(`${menu.id}#${opt.number} -> custom:${name}`);
      }
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ missingKeys, handlerReport, openReport }, null, 2));
  process.exit(0);
}

const langs = allLangs ? LANGS : ['en'];
for (const lang of langs) {
  const groups = missingKeys[lang] || {};
  const total = Object.values(groups).reduce((n, arr) => n + arr.length, 0);
  console.log(`\n=== missing translation keys (${lang}) : ${total} ===`);
  if (!total) console.log('  none');
  for (const [menuId, keys] of Object.entries(groups)) {
    console.log(`  ${menuId}`);
    for (const k of keys) console.log(`    - ${k}`);
  }
}

console.log(`\n=== custom: actions resolvable after startup registration: ${handlerReport.ok} ===`);
console.log(`  (${registeredCount} handlers published into menuRouter's registry)`);

console.log(`\n=== custom: actions handled by a dedicated inline router branch: ${handlerReport.inlineBranch.length} ===`);
console.log('  (never reach runMenuAction; listed for visibility, not a defect)');

console.log(`\n=== custom: actions with NO handler and NO inline branch: ${handlerReport.missing.length} ===`);
handlerReport.missing.forEach((m) => console.log('  - ' + m));
if (!handlerReport.missing.length) console.log('  none -- this is the tier that must stay empty');

console.log(`\n=== open: actions pointing at unregistered menus: ${openReport.length} ===`);
openReport.forEach((m) => console.log('  - ' + m));
if (!openReport.length) console.log('  none');

const keyTotal = Object.values(missingKeys).reduce(
  (n, groups) => n + Object.values(groups).reduce((m, arr) => m + arr.length, 0), 0);
process.exit(keyTotal + handlerReport.missing.length + openReport.length ? 1 : 0);
