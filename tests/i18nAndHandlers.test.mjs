// Regression cover for the two bugs reported together:
//
//   1. Menu labels rendering as raw dotted keys. The Bot Content menus read
//      menu.bot_content.group.firstMessage / .variant.A1 / .language.en while
//      the translations only carried the flat group_firstMessage / variant_A1 /
//      language_en forms, so every one of those rows leaked its key path.
//
//   2. "This menu is unavailable right now" on Bot Content options 5-9. The
//      handlers were exported correctly but menuRouter's own registry was never
//      populated, so any router path that did not pass a `handlers` map --
//      including the generic menu guard -- found nothing to run.
//
// Also covers the Custom Commands menu, whose six handlers lived in a map that
// no runtime caller ever passed, and the admin diagnostic notice.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(os.tmpdir(), 'i18n-handlers-data-backup');

fs.rmSync(backupDir, { recursive: true, force: true });
fs.cpSync(dataDir, backupDir, { recursive: true });
const restoreData = () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.cpSync(backupDir, dataDir, { recursive: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
};

let fails = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log('PASS ' + name); return; }
  fails++;
  console.log('FAIL ' + name + ' :: ' + String(extra).slice(0, 220));
}

const LANGS = ['en', 'fr', 'de', 'es', 'ar'];
const registry = await import('../src/config/menus/registry.js');
await import('../src/config/menus/index.js');
const { t, humanizeMissingKey } = await import('../src/services/localeService.js');
const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const router = await import('../src/utils/menuRouter.js');
const { allMenuCustomHandlers } = await import('../src/utils/menuCustomHandlers.js');

const ADMIN = '127531067904055@lid';
const USER = '999999999999@lid';

function mkSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => {
      sent.push({ jid, text: String(content?.text ?? '') });
      return { key: { id: 'K' + sent.length } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
}

const baseCtx = (sender) => ({
  sock: mkSock(),
  sender,
  chatId: sender,
  language: 'en',
  user: { jid: sender },
  session: { state: null }
});

/** Every dotted key a menu definition references, per language. */
function referencedKeys() {
  const perLang = {};
  for (const lang of LANGS) {
    const file = JSON.parse(fs.readFileSync(path.join(root, 'translations', `${lang}.json`), 'utf8'));
    const missing = [];
    for (const menu of registry.getAllMenus()) {
      const candidates = [];
      if (menu.headingKey) candidates.push(menu.headingKey);
      if (menu.fallbackHeadingKey) candidates.push(menu.fallbackHeadingKey);
      if (menu.fallbackKey) candidates.push(menu.fallbackKey);
      if (menu.footerKey) candidates.push(menu.footerKey);
      for (const opt of menu.options || []) {
        if (opt.labelKey) candidates.push(opt.labelKey);
        if (opt.fallbackKey) candidates.push(opt.fallbackKey);
        for (const dyn of opt.dynamicOptions || []) {
          if (dyn.labelKey) candidates.push(dyn.labelKey);
        }
      }
      for (const key of candidates) {
        const resolved = key.split('.').reduce((acc, k) => acc?.[k], file);
        if (resolved === undefined) missing.push(`${menu.id}: ${key}`);
      }
    }
    perLang[lang] = missing;
  }
  return perLang;
}

try {
  // -------------------------------------------------------------------------
  // 1. Translation coverage
  // -------------------------------------------------------------------------
  {
    const perLang = referencedKeys();
    for (const lang of LANGS) {
      check(`1.1 ${lang}: no menu label resolves to undefined`,
        perLang[lang].length === 0, perLang[lang].slice(0, 6).join(' | '));
    }

    // The exact keys that regressed, spelled out so a future rename is caught.
    const en = JSON.parse(fs.readFileSync(path.join(root, 'translations', 'en.json'), 'utf8'));
    for (const key of [
      'menu.bot_content.group.onboarding',
      'menu.bot_content.group.firstMessage',
      'menu.bot_content.group.welcomeBack',
      'menu.bot_content.group.language',
      'menu.bot_content.variant.A1',
      'menu.bot_content.variant.B3',
      'menu.bot_content.language.en',
      'menu.bot_content.language.ar',
      'menu.bot_content.field.onboardingRetryMaxAttempts',
      'admin.systemSettings.optionBotContent'
    ]) {
      const v = key.split('.').reduce((acc, k) => acc?.[k], en);
      check(`1.2 en has ${key}`, typeof v === 'string' && v.length > 0, v);
    }

    // The dotted forms must be real strings, not aliases pointing at a raw key.
    check('1.3 variant.A1 is a label, not a key',
      !/variant\.A1$/.test(en.menu.bot_content.variant.A1), en.menu.bot_content.variant.A1);
    check('1.4 group.firstMessage is a label, not a key',
      !/group\.firstMessage$/.test(en.menu.bot_content.group.firstMessage));
    check('1.5 language.de is a label, not a key',
      !/language\.de$/.test(en.menu.bot_content.language.de));

    // Every locale must carry the same Bot Content key shape as en.
    const enBc = JSON.stringify(Object.keys(en.menu.bot_content).sort());
    for (const lang of LANGS.slice(1)) {
      const other = JSON.parse(fs.readFileSync(path.join(root, 'translations', `${lang}.json`), 'utf8'));
      check(`1.6 ${lang} bot_content keys match en`,
        JSON.stringify(Object.keys(other.menu.bot_content).sort()) === enBc,
        `en=${enBc} ${lang}=${JSON.stringify(Object.keys(other.menu.bot_content).sort())}`);
      // Scoped to the keys this change added. menu.bot_content.language also
      // carries pre-existing per-character entries ('L','a','n', ... from a
      // string flattened into indices) whose length differs per locale and
      // which are not part of this fix.
      const EXPECTED = {
        group: ['onboarding', 'firstMessage', 'resumeMessage', 'welcomeMessage', 'unsupportedLanguage', 'retry', 'cooldownLock', 'welcomeBack', 'timing', 'language'],
        variant: ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3'],
        language: ['en', 'fr', 'de', 'es', 'ar'],
        field: ['onboardingRetryMaxAttempts']
      };
      for (const [ns, keys] of Object.entries(EXPECTED)) {
        for (const k of keys) {
          check(`1.7 ${lang} bot_content.${ns}.${k} exists`,
            typeof other.menu.bot_content[ns]?.[k] === 'string' && other.menu.bot_content[ns][k].length > 0,
            other.menu.bot_content[ns]?.[k]);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. The safe fallback: never leak a dotted path
  // -------------------------------------------------------------------------
  {
    check('2.1 humanizeMissingKey drops the namespace',
      humanizeMissingKey('menu.bot_content.variant.a1') === toSmallCaps('a1'),
      humanizeMissingKey('menu.bot_content.variant.a1'));
    check('2.2 humanizeMissingKey splits underscores into words',
      humanizeMissingKey('option_bot_content_reset') === toSmallCaps('option bot content reset'));
    check('2.3 humanizeMissingKey survives a bare key',
      humanizeMissingKey('nokey') === toSmallCaps('nokey'));
    check('2.4 humanizeMissingKey survives an empty-ish key',
      typeof humanizeMissingKey('') === 'string');

    const missing = t('en', 'menu.bot_content.variant.does_not_exist');
    check('2.5 t() does not return the dotted key', !missing.includes('.'), missing);
    check('2.6 t() does not return a namespace prefix',
      !/menu|bot_content|variant/.test(missing), missing);
    check('2.7 t() fallback is small-cased per the typography rule',
      missing === toSmallCaps('does not exist') || missing === toSmallCaps('does_not_exist'),
      missing);

    // A key that does exist must be untouched by the fallback.
    check('2.8 t() still returns real translations',
      t('en', 'menu.bot_content.variant.A1') === 'A1 (5m-1h)', t('en', 'menu.bot_content.variant.A1'));
    check('2.9 placeholder substitution still works',
      t('en', 'onboarding.mainMenuGreeting', { username: 'John' }).includes('John'),
      t('en', 'onboarding.mainMenuGreeting', { username: 'John' }));
  }

  // -------------------------------------------------------------------------
  // 3. Handler resolution no longer depends on the call site
  // -------------------------------------------------------------------------
  {
    // This is the registration step src/index.js performs at boot.
    const registered = router.registerAllMenuActionHandlers(allMenuCustomHandlers);
    check('3.1 registration published the full aggregate',
      registered === Object.keys(allMenuCustomHandlers).length, `${registered}`);

    // The Bot Content tool options, run with NO handlers map at all. This is
    // the exact call shape the generic menu guard used and it failed before.
    const TOOL_OPTIONS = [
      'custom:bot_content_preview',
      'custom:bot_content_export',
      'custom:bot_content_import',
      'custom:bot_content_snapshots',
      'custom:bot_content_reset'
    ];
    for (const action of TOOL_OPTIONS) {
      const ctx = baseCtx(USER);
      await router.runMenuAction(action, ctx);
      const text = ctx.sock.sent.map((m) => m.text).join('\n');
      check(`3.2 ${action} resolves without a handlers map`,
        typeof router.getMenuActionHandler(action.slice(7)) === 'function');
      check(`3.3 ${action} does not answer "unavailable"`,
        !/unavailable|indisponible|nicht ver/i.test(text), text.slice(0, 160));
      check(`3.4 ${action} produced output`, ctx.sock.sent.length > 0);
    }

    // Every custom: action referenced by a menu must now resolve.
    const unreachable = [];
    for (const menu of registry.getAllMenus()) {
      for (const opt of menu.options || []) {
        const a = String(opt.action || '');
        if (!a.startsWith('custom:')) continue;
        const name = a.slice(7);
        if (typeof router.getMenuActionHandler(name) !== 'function') unreachable.push(`${menu.id}#${opt.number} -> ${a}`);
      }
    }
    check('3.5 every custom: menu action resolves from the registry',
      unreachable.length === 0, unreachable.slice(0, 8).join(' | '));

    // Regression guard for the Custom Commands menu, whose handlers were in a
    // map no runtime caller passed.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      check(`3.6 custom_commands option ${n} resolves`,
        typeof router.getMenuActionHandler('custom_cmds_' + ['list', 'add', 'edit', 'delete', 'toggle', 'impex'][n - 1]) === 'function');
    }
  }

  // -------------------------------------------------------------------------
  // 4. Failure diagnostics
  // -------------------------------------------------------------------------
  {
    const cases = [
      ['custom:definitely_not_a_handler', 'missing_handler'],
      ['open:no_such_menu_at_all', 'missing_menu'],
      ['weird:thing', 'unknown_action']
    ];
    for (const [action, reason] of cases) {
      const adminCtx = baseCtx(ADMIN);
      await router.runMenuAction(action, adminCtx);
      const adminText = adminCtx.sock.sent.at(-1)?.text || '';
      check(`4.1 admin sees the reason for ${action}`, adminText.includes(reason), adminText.slice(0, 160));
      check(`4.2 admin sees the action for ${action}`, adminText.includes(action));
      check(`4.3 admin notice is not the bare generic line for ${action}`,
        !/^❌/.test(adminText.trim()), adminText.slice(0, 80));

      const userCtx = baseCtx(USER);
      await router.runMenuAction(action, userCtx);
      const userText = userCtx.sock.sent.at(-1)?.text || '';
      check(`4.4 non-admin gets no internals for ${action}`,
        !userText.includes(reason), userText.slice(0, 160));
      check(`4.5 non-admin still gets told for ${action}`, userText.trim().length > 0);
    }

    // A handler that throws must report the error text, not "missing handler".
    allMenuCustomHandlers.__throwing_handler = async () => { throw new Error('boom from handler'); };
    router.registerAllMenuActionHandlers(allMenuCustomHandlers);
    const throwCtx = baseCtx(ADMIN);
    await router.runMenuAction('custom:__throwing_handler', throwCtx);
    const throwText = throwCtx.sock.sent.at(-1)?.text || '';
    check('4.6 a throwing handler reports handler_threw',
      throwText.includes('handler_threw'), throwText.slice(0, 200));
    check('4.7 a throwing handler surfaces the error message',
      throwText.includes('boom from handler'), throwText.slice(0, 200));
    check('4.8 a throwing handler is not mislabelled missing_handler',
      !throwText.includes('missing_handler'), throwText.slice(0, 200));

    // An admin granted the role at runtime is not in config.adminJids, and must
    // still receive the diagnostic rather than the generic notice.
    const { setRole, removeRole } = await import('../src/services/rolesService.js');
    const promoted = '900000000000777@lid';
    setRole(promoted, 'admin');
    try {
      const promotedCtx = baseCtx(promoted);
      await router.runMenuAction('custom:definitely_not_a_handler', promotedCtx);
      const promotedText = promotedCtx.sock.sent.at(-1)?.text || '';
      check('4.9 a runtime-promoted admin gets the diagnostic',
        promotedText.includes('missing_handler'), promotedText.slice(0, 160));

      // A plain user must never see internals, even with a role lookup in play.
      const viewerCtx = baseCtx(USER);
      await router.runMenuAction('custom:definitely_not_a_handler', viewerCtx);
      const viewerText = viewerCtx.sock.sent.at(-1)?.text || '';
      check('4.10 a non-admin still gets no internals',
        !viewerText.includes('missing_handler'), viewerText.slice(0, 160));
    } finally {
      removeRole(promoted);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Shipped diagnostics agree with the runtime
  // -------------------------------------------------------------------------
  {
    const { auditMenus } = await import('../src/scripts/auditMenus.js');
    check('5.1 the startup menu audit stays clean', auditMenus().length === 0,
      JSON.stringify(auditMenus()).slice(0, 200));
  }

} finally {
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);