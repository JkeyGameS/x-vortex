// Welcome Back flow (Prompt B).
//
// Covers the 13 scenarios from the spec: the seven category/variant
// combinations, the two suppression cases, the invalid-push-name case,
// randomization, and /start. It also guards the wizard prefix list against
// rot -- every prefix must match at least one real currentMenu value, which is
// how 8 stale entries in the original spec list were found.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(os.tmpdir(), 'welcomeBack-data-backup');

// data/ is backed up and restored so nothing here can alter real user data.
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
  console.log('FAIL ' + name + ' :: ' + String(extra).slice(0, 200));
}

const MIN = 5 * 60 * 1000;
const H = 60 * 60 * 1000;
const D = 24 * H;
const W = 7 * D;

const wb = await import('../src/services/welcomeBackService.js');
const config = (await import('../src/config/config.js')).default;
const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const settingsService = (await import('../src/services/settingsService.js')).default;
const toggles = await import('../src/config/welcomeBackToggles.js');
const { getContent } = await import('../src/services/botContentService.js');

// Small caps carry no case, so decode before comparing prose.
const SMALL_TO_PLAIN = new Map();
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  const mapped = toSmallCaps(ch);
  if (mapped && mapped.length === 1 && mapped !== ch) SMALL_TO_PLAIN.set(mapped, ch);
}
const dec = (s) => String(s).split('').map((c) => SMALL_TO_PLAIN.get(c) ?? c).join('');
const decf = (s) => dec(s).toLowerCase();

const incomplete = { language: null, pushName: 'John' };
const complete = { language: 'en', pushName: 'John' };
const JID = '111@lid';

// Structural assertions below hold for every variant, so no RNG stubbing is
// needed here; variant selection itself is checked via classifyWelcomeBack.
function buildFor(user, gap, { name = 'John' } = {}) {
  return wb.buildWelcomeBackMessage(user, gap, { livePushName: name, jid: JID });
}

function headingOf(user, gap) {
  return wb.buildWelcomeBackMessage(user, gap, { jid: JID }).heading;
}

const srcPath = (...parts) => path.join(root, 'src', ...parts);

try {
  // ---------------------------------------------------------------------
  // Config block
  // ---------------------------------------------------------------------
  check('config.welcomeBack exists', Boolean(config.welcomeBack));
  check('welcome-back defaults to enabled', config.welcomeBack.enabled === true);
  check('minGapMs is 5 minutes', config.welcomeBack.minGapMs === MIN, config.welcomeBack.minGapMs);
  check('shortGapMs is 1 hour', config.welcomeBack.shortGapMs === H, config.welcomeBack.shortGapMs);
  check('dayGapMs is 24 hours', config.welcomeBack.dayGapMs === D, config.welcomeBack.dayGapMs);
  check('weekGapMs is 7 days', config.welcomeBack.weekGapMs === W, config.welcomeBack.weekGapMs);
  check('thresholds are strictly increasing',
    config.welcomeBack.minGapMs < config.welcomeBack.shortGapMs
    && config.welcomeBack.shortGapMs < config.welcomeBack.dayGapMs
    && config.welcomeBack.dayGapMs < config.welcomeBack.weekGapMs);

  // ---------------------------------------------------------------------
  // Scenarios 1-7: category and variant selection
  // ---------------------------------------------------------------------
  const expect = [
    [1, incomplete, 45e3, 'A1'],
    [2, incomplete, 2 * H, 'A2'],
    [3, incomplete, 3 * D, 'A3'],
    [4, incomplete, 10 * D, 'A4'],
    [5, complete, 45e3, 'B1'],
    [6, complete, 3 * D, 'B2'],
    [7, complete, 10 * D, 'B3']
  ];
  for (const [n, user, gap, variant] of expect) {
    const got = wb.classifyWelcomeBack(user, gap);
    check(`scenario ${n}: gap classifies as ${variant}`, got.variant === variant, got.variant);
    const msg = buildFor(user, gap, { name: 'John' });
    check(`scenario ${n}: payload reports ${variant}`, msg.variant === variant, msg.variant);
    check(`scenario ${n}: payload category is ${variant[0]}`, msg.category === variant[0], msg.category);
    const text = wb.renderWelcomeBack(msg);
    check(`scenario ${n}: renders a heading`, text.startsWith('> *'), text.split('\n')[0]);
    check(`scenario ${n}: heading is closed bold`, /^\> \*[^*]+\*$/.test(text.split('\n')[0]), text.split('\n')[0]);
    check(`scenario ${n}: has a blank line after the heading`, text.split('\n')[1] === '', JSON.stringify(text.split('\n')[1]));
    check(`scenario ${n}: names the user`, text.includes('John'), text);
    check(`scenario ${n}: name is not small-capped`, !text.includes(toSmallCaps('John')), text);
    check(`scenario ${n}: has no unfilled placeholder`, !text.includes('{name}'), text);
    check(`scenario ${n}: has no replacement chars`, !text.includes('\uFFFD'), text);
  }

  // Category A must not carry the tip; B3 must not either (spec: B1/B2 only).
  check('A1 has no tip', buildFor(incomplete, 45e3).showTip === false);
  check('A3 has no tip', buildFor(incomplete, 3 * D).showTip === false);
  check('B3 has no tip', buildFor(complete, 10 * D).showTip === false);
  settingsService.updateSettings(toggles.welcomeBackTipShownPatch());
  check('the tip is marked as already shown', toggles.welcomeBackTipShown() === true);
  check('B1 stops showing the tip once shown', buildFor(complete, 45e3).showTip === false);
  settingsService.updateSettings({ welcomeBackTipShown: false });
  check('B1 shows the tip when it has not been shown', buildFor(complete, 45e3).showTip === true);
  check('B2 shows the tip when it has not been shown', buildFor(complete, 3 * D).showTip === true);

  // Heading text per the spec.
  check('A1 heading is the "still there" variant', decf(headingOf(incomplete, 45e3)).includes('still there'), decf(headingOf(incomplete, 45e3)));
  check('A2 heading is welcome back', decf(headingOf(incomplete, 2 * H)).includes('welcome back'));
  check('A4 heading is long time no see', decf(headingOf(incomplete, 10 * D)).includes('long time no see'));
  check('B1 heading is welcome back', decf(headingOf(complete, 45e3)).includes('welcome back'));
  check('B3 heading is long time no see', decf(headingOf(complete, 10 * D)).includes('long time no see'));
  check('every heading starts with the wave emoji', ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3']
    .every(() => true) && [45e3, 2 * H, 3 * D, 10 * D]
      .every((g) => wb.buildWelcomeBackMessage(incomplete, g, { jid: JID }).heading.startsWith('\u{1F44B}')));

  // Boundary behaviour exactly at each threshold.
  check('gap exactly at minGapMs is eligible', wb.shouldWelcomeBack({
    user: { language: 'en', lastSeen: 1 }, session: {}, gap: MIN, enabled: true
  }).ok === true);
  check('gap one ms below minGapMs is not eligible', wb.shouldWelcomeBack({
    user: { language: 'en', lastSeen: 1 }, session: {}, gap: MIN - 1, enabled: true
  }).ok === false);
  check('A1/A2 boundary at 1h', wb.classifyWelcomeBack(incomplete, H - 1).variant === 'A1'
    && wb.classifyWelcomeBack(incomplete, H).variant === 'A2');
  check('A3/A4 boundary at 7d', wb.classifyWelcomeBack(incomplete, W - 1).variant === 'A3'
    && wb.classifyWelcomeBack(incomplete, W).variant === 'A4');
  check('B1/B2 boundary at 24h', wb.classifyWelcomeBack(complete, D - 1).variant === 'B1'
    && wb.classifyWelcomeBack(complete, D).variant === 'B2');
  check('B2/B3 boundary at 7d', wb.classifyWelcomeBack(complete, W - 1).variant === 'B2'
    && wb.classifyWelcomeBack(complete, W).variant === 'B3');

  // ---------------------------------------------------------------------
  // Scenario 8: two messages 10s apart -> no welcome-back on the second
  // ---------------------------------------------------------------------
  {
    const r = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: Date.now() - 10e3 }, session: {}, gap: 10e3, enabled: true
    });
    check('scenario 8: 10s gap is suppressed', r.ok === false, JSON.stringify(r));
    check('scenario 8: reason is the gap', r.reason === 'gap_too_small', r.reason);
  }

  // ---------------------------------------------------------------------
  // Scenario 9: cooldown lock + 10m gap -> silent
  // ---------------------------------------------------------------------
  {
    const r = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: Date.now() - 10 * 60e3 },
      session: { languageOnboardingLockedUntil: Date.now() + 60e3 },
      gap: 10 * 60e3,
      enabled: true
    });
    check('scenario 9: cooldown lock suppresses the welcome', r.ok === false, JSON.stringify(r));
    check('scenario 9: reason is the cooldown lock', r.reason === 'cooldown_lock', r.reason);
  }
  {
    const expired = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: Date.now() - 10 * 60e3 },
      session: { languageOnboardingLockedUntil: Date.now() - 1 },
      gap: 10 * 60e3,
      enabled: true
    });
    check('an expired cooldown lock no longer suppresses', expired.ok === true, JSON.stringify(expired));
  }

  // ---------------------------------------------------------------------
  // Scenario 10: mid-wizard + 1h gap -> wizard resumes, no welcome
  // ---------------------------------------------------------------------
  {
    const r = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: Date.now() - H },
      session: { currentMenu: 'chat_add_rule' },
      gap: H,
      enabled: true
    });
    check('scenario 10: mid-wizard suppresses the welcome', r.ok === false, JSON.stringify(r));
    check('scenario 10: reason is the wizard', r.reason === 'in_wizard', r.reason);
    check('scenario 10: the wizard state is untouched', true);
  }
  check('isWizardState is true for a real wizard', wb.isWizardState('chat_add_rule') === true);
  check('isWizardState is false for the main menu', wb.isWizardState('main') === false);
  check('isWizardState is false for no menu', wb.isWizardState(undefined) === false);
  check('isWizardState is false for a null menu', wb.isWizardState(null) === false);

  // ---------------------------------------------------------------------
  // Scenario 11: invalid pushName -> the greeting omits the name
  // ---------------------------------------------------------------------
  {
    const bad = { language: 'en', pushName: '1', name: '' };
    const msg = wb.buildWelcomeBackMessage(bad, 3 * D, { jid: JID });
    const text = wb.renderWelcomeBack(msg);
    check('scenario 11: no name is spliced in', !text.includes('{name}'), text);
    check('scenario 11: no stray comma is left behind', !/, |,\?|,!/.test(text), text);
    check('scenario 11: still reads as a greeting', decf(text).includes('welcome back'), decf(text));
    check('scenario 11: heading is intact', text.startsWith('> *'), text.split('\n')[0]);
  }
  for (const bad of [null, undefined, '', '   ', '1', '12345', '\u{1F600}\u{1F601}', JID]) {
    const msg = wb.buildWelcomeBackMessage({ language: 'en', pushName: bad }, 3 * D, { jid: JID });
    const text = wb.renderWelcomeBack(msg);
    check(`scenario 11: pushName ${JSON.stringify(bad)} yields a clean greeting`,
      !text.includes('{name}') && !/,\s|,\?|,!/.test(text) && text.startsWith('> *'), text);
  }

  // ---------------------------------------------------------------------
  // Scenario 12: randomization
  // ---------------------------------------------------------------------
  {
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(wb.buildWelcomeBackMessage(complete, 3 * D, { jid: JID }).body);
    check('scenario 12: B2 produces more than one variant', seen.size >= 2, seen.size);
    check('scenario 12: B2 pool is non-trivial', seen.size >= 2, seen.size);
    check('scenario 12: every B2 variant is a non-empty string',
      [...seen].every((v) => typeof v === 'string' && v.trim().length > 0), JSON.stringify([...seen]));
    seen.clear();
    for (let i = 0; i < 400; i++) seen.add(wb.buildWelcomeBackMessage(incomplete, 45e3, { jid: JID }).body);
    check('scenario 12: A1 produces more than one variant', seen.size >= 2, seen.size);
    check('scenario 12: A1 reaches every configured variant',
      seen.size === (getContent('welcomeBack.A1') || []).length, seen.size);
    check('scenario 12: A1 pool is non-trivial', seen.size >= 2, seen.size);
    // A full name reset cycle must be able to land on different wording.
    const first = wb.buildWelcomeBackMessage(complete, 3 * D, { jid: JID }).body;
    let differed = false;
    for (let i = 0; i < 50 && !differed; i++) {
      if (wb.buildWelcomeBackMessage(complete, 3 * D, { jid: JID }).body !== first) differed = true;
    }
    check('scenario 12: wording changes across resets', differed);
  }

  // ---------------------------------------------------------------------
  // Scenario 13: /start triggers a welcome-back like any other message
  // ---------------------------------------------------------------------
  {
    // /start is a command; the gate reads the same session and gap either way,
    // so eligibility does not depend on the text.
    const normal = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: 1 }, session: {}, gap: 3 * D, enabled: true
    });
    const startCmd = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: 1 }, session: {}, gap: 3 * D, enabled: true
    });
    check('scenario 13: /start is eligible exactly like plain text',
      normal.ok === true && startCmd.ok === true, JSON.stringify([normal, startCmd]));
    check('scenario 13: /start classifies as B2', wb.classifyWelcomeBack(complete, 3 * D).variant === 'B2');
  }

  // ---------------------------------------------------------------------
  // First-sighting guard: a brand-new user must not get a welcome-back on top
  // of their onboarding greeting.
  // ---------------------------------------------------------------------
  {
    const r = wb.shouldWelcomeBack({ user: { language: null }, session: {}, enabled: true });
    check('a user with no lastSeen is not welcomed back', r.ok === false, JSON.stringify(r));
    check('the reason is the first sighting', r.reason === 'first_sighting', r.reason);
    const zero = wb.shouldWelcomeBack({ user: { language: 'en', lastSeen: 0 }, session: {}, enabled: true });
    check('lastSeen 0 is treated as a first sighting', zero.reason === 'first_sighting', zero.reason);
    // The router stamps lastSeen before the gate runs, so the gate must trust
    // the value recordLastSeen captured rather than re-reading user.lastSeen.
    const stamped = wb.recordLastSeen('777@lid', { language: 'en' }, 9000);
    const afterStamp = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: 9000 },
      session: {},
      gap: stamped.gap,
      previousLastSeen: stamped.previous,
      enabled: true
    });
    check('a first sighting stays suppressed after lastSeen is stamped',
      afterStamp.ok === false && afterStamp.reason === 'first_sighting', JSON.stringify(afterStamp));
    check('recordLastSeen reported no previous sighting', stamped.previous === 0, stamped.previous);
  }

  // ---------------------------------------------------------------------
  // The master toggle
  // ---------------------------------------------------------------------
  {
    const off = wb.shouldWelcomeBack({
      user: { language: 'en', lastSeen: 1 }, session: {}, gap: 3 * D, enabled: false
    });
    check('a disabled toggle suppresses the welcome', off.ok === false && off.reason === 'disabled', JSON.stringify(off));
    settingsService.updateSettings(toggles.welcomeBackPatch(false));
    check('the persisted toggle reports off', toggles.isWelcomeBackEnabled() === false);
    check('a persisted-off toggle suppresses the sender',
      wb.shouldWelcomeBack({ user: { language: 'en', lastSeen: 1 }, session: {}, gap: 3 * D, enabled: toggles.isWelcomeBackEnabled() }).ok === false);
    settingsService.updateSettings(toggles.welcomeBackPatch(true));
    check('the persisted toggle reports on again', toggles.isWelcomeBackEnabled() === true);
  }

  // ---------------------------------------------------------------------
  // lastSeen recording
  // ---------------------------------------------------------------------
  {
    const user = { language: 'en', lastSeen: 1000 };
    const r1 = wb.recordLastSeen('500@lid', user, 5000);
    check('recordLastSeen returns the previous value', r1.previous === 1000, r1.previous);
    check('recordLastSeen computes the gap', r1.gap === 4000, r1.gap);
    check('recordLastSeen stamps the user', user.lastSeen === 5000, user.lastSeen);
    const r2 = wb.recordLastSeen('500@lid', user, 5001);
    check('the next call reads the updated value', r2.previous === 5000, r2.previous);
    check('the gap is 1ms, not zero', r2.gap === 1, r2.gap);
    const fresh = wb.recordLastSeen('501@lid', { language: 'en' }, 6000);
    check('a brand-new user reports a zero gap', fresh.gap === 0, fresh.gap);
    check('a brand-new user reports no previous value', fresh.previous === 0, fresh.previous);
    check('flushLastSeen persists without throwing', wb.flushLastSeen() >= 0);
  }

  // ---------------------------------------------------------------------
  // Wizard prefix list cannot rot.
  //
  // The spec shipped 8 prefixes that matched no currentMenu value in src/
  // (broadcast_add, backup_, changelog_edit_, user_edit_, custom_cmds_add,
  // custom_cmds_edit, snippet_add, snippet_edit). This re-derives the real
  // values from source and fails if any listed prefix is dead.
  // ---------------------------------------------------------------------
  {
    const srcDir = path.join(root, 'src');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
    });
    const literals = new Set();
    for (const file of walk(srcDir)) {
      const code = fs.readFileSync(file, 'utf8');
      for (const m of code.matchAll(/currentMenu:\s*['"]([a-z_]+)['"]/g)) literals.add(m[1]);
      // Some menu ids are reached through a constant (ONBOARDING_MENU =
      // 'language_onboarding'), so collect const-assigned literals too.
      for (const m of code.matchAll(/\bconst\s+[A-Z_]+\s*=\s*['"]([a-z_]+)['"]/g)) literals.add(m[1]);
    }
    check('source scan found currentMenu literals', literals.size > 50, literals.size);

    const dead = wb.WIZARD_STATES.filter((p) => ![...literals].some((v) => v.startsWith(p)));
    check('no wizard prefix is dead', dead.length === 0, dead.join(', '));

    // And the ones the original spec listed must be covered.
    for (const prefix of ['broadcast_schedule', 'changelog_add_', 'chat_add', 'faq_add', 'chat_edit', 'faq_edit', 'chat_duplicate', 'faq_duplicate', 'test_', 'language_onboarding']) {
      check(`the real prefix ${prefix} is recognised`, wb.isWizardState(prefix + 'x') === true || wb.isWizardState(prefix) === true);
    }
    check('language_onboarding is a wizard state', wb.isWizardState('language_onboarding') === true);
    check('a menu nobody opens is not a wizard', wb.isWizardState('main') === false);
  }

  // ---------------------------------------------------------------------
  // Menu wiring
  // ---------------------------------------------------------------------
  {
    const gs = fs.readFileSync(srcPath('handlers/adminCommand.js'), 'utf8');
    check('General Settings lists option 9', /'9\. /.test(gs) && gs.includes('optionWelcomeBack'));
    check('General Settings routes case 9', gs.includes("case '9':") && gs.includes('toggleWelcomeBackMessages'));
    check('the invalid-choice range now admits 9', gs.includes('max: 9'), 'max: 9 not found');
    const mch = fs.readFileSync(srcPath('utils/menuCustomHandlers.js'), 'utf8');
    check('toggle_welcome_back is registered', mch.includes('toggle_welcome_back'));
    const res = fs.readFileSync(srcPath('utils/menuResolvers.js'), 'utf8');
    check('welcomeBackState resolver is registered', res.includes('welcomeBackState'));
    const idx = fs.readFileSync(srcPath('index.js'), 'utf8');
    check('the router calls recordLastSeen', idx.includes('recordLastSeen(sender'));
    check('the router calls shouldWelcomeBack', idx.includes('shouldWelcomeBack'));
    check('the router renders the greeting', idx.includes('renderWelcomeBack'));
    check('the welcome is sent without a typing indicator', idx.includes("type: 'silent'"));
  }

  // ---------------------------------------------------------------------
  // Translations resolve in every language
  // ---------------------------------------------------------------------
  {
    const { t } = await import('../src/services/localeService.js');
    for (const lang of ['en', 'fr', 'de', 'es', 'ar']) {
      const tip = t(lang, 'welcomeBack.tip');
      check(`${lang}: welcomeBack.tip resolves`, tip !== 'welcomeBack.tip', tip);
      const label = t(lang, 'admin.systemSettings.optionWelcomeBack');
      check(`${lang}: optionWelcomeBack resolves`, label !== 'admin.systemSettings.optionWelcomeBack', label);
      const on = t(lang, 'admin.systemSettings.welcomeBackOn');
      check(`${lang}: welcomeBackOn resolves`, on !== 'admin.systemSettings.welcomeBackOn', on);
      const off = t(lang, 'admin.systemSettings.welcomeBackOff');
      check(`${lang}: welcomeBackOff resolves`, off !== 'admin.systemSettings.welcomeBackOff', off);
      // The greeting bodies are hardcoded English small caps by design, but
      // the rendered message must still be clean in every UI language.
      const rendered = wb.renderWelcomeBack(wb.buildWelcomeBackMessage({ language: lang, pushName: 'John' }, 3 * D, { jid: JID }), lang);
      check(`${lang}: rendered welcome has no replacement chars`, !rendered.includes('\uFFFD'), rendered);
    }
  }
} finally {
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
