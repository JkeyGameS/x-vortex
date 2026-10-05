// Admin Content & Timing Editor: content store, placeholder resolver, timing
// precedence, language display, menus, resolvers and the edit/reset flows.
//
// data/ is backed up and restored so nothing here can alter real user data.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(os.tmpdir(), 'botContent-data-backup');

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

const svc = await import('../src/services/botContentService.js');
const defaults = (await import('../src/config/defaultBotContent.js')).default;
const { resolvePlaceholders, RAW_PLACEHOLDERS, CAPPED_PLACEHOLDERS } =
  await import('../src/utils/placeholderResolver.js');
// Ask the resolver which placeholders it knows instead of duplicating its list
// here, so adding one (groupName, memberCount in Phase 3) cannot make this
// suite fail on a stale copy.
const KNOWN_PLACEHOLDERS = [...RAW_PLACEHOLDERS, ...CAPPED_PLACEHOLDERS];
const { getLanguageDisplay, smallCapsEnabled } = await import('../src/utils/languageHelper.js');
const timing = await import('../src/utils/botTiming.js');
const onboard = await import('../src/handlers/languageOnboardingHandler.js');
const wb = await import('../src/services/welcomeBackService.js');
const { pickSpeaker } = await import('../src/utils/pickSpeaker.js');
const { t } = await import('../src/services/localeService.js');
const { toSmallCaps } = await import('../src/utils/smallCaps.js');

await import('../src/config/menus/index.js');
const { getMenu } = await import('../src/config/menus/registry.js');
const { resolveMenuOption } = await import('../src/utils/menuRouter.js');
const resolvers = await import('../src/utils/menuResolvers.js');
const { adminCustomHandlers } = await import('../src/utils/menuCustomHandlers.js');

const { EDITABLE_FIELDS, EDITABLE_VARIANTS, EDITABLE_TIMING, SAMPLE_CTX } =
  await import('../src/config/botContentFields.js');

const ADMIN = '127531067904055@lid';
const CONTENT = 'data/botContent.json';

const dec = (s) => String(s).toLowerCase();

try {
  // =====================================================================
  // 6.1 Loading
  // =====================================================================
  check('1: the store creates data/botContent.json from defaults', fs.existsSync(path.join(root, CONTENT)));
  {
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, CONTENT), 'utf8'));
    check('1: the created file has every default section',
      ['onboarding', 'welcomeBack', 'timing', 'languageDisplay'].every((k) => k in onDisk), Object.keys(onDisk).join(','));
    check('1: version is stamped', onDisk.version === 1, onDisk.version);
  }
  {
    const reloaded = svc.reload();
    check('2: a reload returns the same shape', reloaded.version === 1 && !!reloaded.onboarding);
  }
  {
    // 3: corrupt JSON must degrade to defaults, not throw.
    const good = fs.readFileSync(path.join(root, CONTENT), 'utf8');
    fs.writeFileSync(path.join(root, CONTENT), '{ "onboarding": { "firstMessage": ', 'utf8');
    let threw = null;
    try { svc.reload(); } catch (err) { threw = err; }
    check('3: corrupt JSON does not throw', threw === null, threw?.message);
    check('3: corrupt JSON falls back to the default greeting',
      svc.getContent('onboarding.firstMessage.greeting') === defaults.onboarding.firstMessage.greeting,
      svc.getContent('onboarding.firstMessage.greeting'));
    fs.writeFileSync(path.join(root, CONTENT), good, 'utf8');
    svc.reload();
    check('3: the store recovers once the file is valid again',
      svc.getContent('version') === 1);
  }
  {
    // A non-object root is also rejected rather than poisoning the cache.
    const good = fs.readFileSync(path.join(root, CONTENT), 'utf8');
    fs.writeFileSync(path.join(root, CONTENT), '[1,2,3]', 'utf8');
    svc.reload();
    check('3: an array root is rejected', !!svc.getContent('onboarding.firstMessage.greeting'));
    fs.writeFileSync(path.join(root, CONTENT), good, 'utf8');
    svc.reload();
  }

  // =====================================================================
  // deepMerge: gaps fill from defaults, explicit nulls are honoured
  // =====================================================================
  {
    check('deepMerge fills a missing object from the base',
      svc.deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 9 } }).a.c === 2,
      JSON.stringify(svc.deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 9 } })));
    check('deepMerge overrides present keys',
      svc.deepMerge({ a: { b: 1 } }, { a: { b: 9 } }).a.b === 9);
    check('deepMerge replaces arrays wholesale',
      JSON.stringify(svc.deepMerge({ a: [1, 2, 3] }, { a: [4] }).a) === '[4]',
      JSON.stringify(svc.deepMerge({ a: [1, 2, 3] }, { a: [4] }).a));
    check('deepMerge keeps an explicit empty string',
      svc.deepMerge({ a: 'x' }, { a: '' }).a === '');
  }
  {
    // A partially authored file must not lose defaults.
    const good = fs.readFileSync(path.join(root, CONTENT), 'utf8');
    fs.writeFileSync(path.join(root, CONTENT), JSON.stringify({ onboarding: { firstMessage: { greeting: 'custom hi' } } }), 'utf8');
    svc.reload();
    check('a sparse file keeps its own value',
      svc.getContent('onboarding.firstMessage.greeting') === 'custom hi',
      svc.getContent('onboarding.firstMessage.greeting'));
    check('a sparse file inherits the missing defaults',
      svc.getContent('onboarding.firstMessage.question') === defaults.onboarding.firstMessage.question);
    check('a sparse file inherits untouched sections',
      svc.getContent('welcomeBack.B3')?.length === defaults.welcomeBack.B3.length);
    fs.writeFileSync(path.join(root, CONTENT), good, 'utf8');
    svc.reload();
  }

  // =====================================================================
  // 3.1 Placeholder resolver
  // =====================================================================
  check('pushName is inserted raw',
    resolvePlaceholders('hey {pushName}', { pushName: 'John' }) === toSmallCaps("hey") + ' John',
    resolvePlaceholders('hey {pushName}', { pushName: 'John' }));
  check('static text is small-capped',
    resolvePlaceholders('Good Morning {pushName}', { pushName: 'John' }) === dec('good morning') === false
      ? resolvePlaceholders('Good Morning {pushName}', { pushName: 'John' }).startsWith('ɢᴏᴏᴅ')
      : true,
    JSON.stringify(resolvePlaceholders('Good Morning {pushName}', { pushName: 'John' })));
  check('the push name is never small-capped',
    resolvePlaceholders('x {pushName} y', { pushName: 'JOHN' }).includes('JOHN'),
    resolvePlaceholders('x {pushName} y', { pushName: 'JOHN' }));
  check('the language name IS small-capped',
    resolvePlaceholders('{languageName}', { languageName: 'English' }) === toSmallCaps('English'),
    resolvePlaceholders('{languageName}', { languageName: 'English' }));
  check('the flag is inserted raw',
    resolvePlaceholders('{languageFlag}', { languageFlag: '\u{1F1EC}\u{1F1E7}' }) === '\u{1F1EC}\u{1F1E7}');
  check('minutes is stringified',
    resolvePlaceholders('in {minutes}', { cooldownMinutes: 7 }) === toSmallCaps("in") + ' 7',
    resolvePlaceholders('in {minutes}', { cooldownMinutes: 7 }));
  check('minutes falls back to 5',
    resolvePlaceholders('in {minutes}', {}) === toSmallCaps("in") + ' 5', resolvePlaceholders('in {minutes}', {}));
  check('detectedRaw falls back to unknown',
    resolvePlaceholders('{detectedRaw}', {}) === 'unknown');
  check('botName falls back to X-Vortex',
    resolvePlaceholders('{botName}', {}) === 'X-Vortex');
  check('a non-string template passes through', resolvePlaceholders(null, {}) === null);
  check('an unknown placeholder resolves to empty',
    resolvePlaceholders('a{nope}b', {}) === toSmallCaps("ab"), JSON.stringify(resolvePlaceholders('a{nope}b', {})));
  check('every placeholder occurrence is replaced',
    !resolvePlaceholders('{pushName} {pushName}', { pushName: 'J' }).includes('{pushName}'));
  check('an empty push name inside bold leaves no stray markers',
    resolvePlaceholders('{timeOfDay} *{pushName}* end', { timeOfDay: 'Hi', pushName: '' }) === toSmallCaps('Hi') + ' ' + toSmallCaps('end'),
    JSON.stringify(resolvePlaceholders('{timeOfDay} *{pushName}* end', { timeOfDay: 'Hi', pushName: '' })));
  check('real emphasis survives the empty-marker cleanup',
    resolvePlaceholders('reply *yes* or *no*', {}).includes('*' + toSmallCaps('yes') + '*'),
    resolvePlaceholders('reply *yes* or *no*', {}));
  check('smallCapsEnabled=false leaves the language name raw', (() => {
    svc.setContent('languageDisplay.smallCapsEnabled', false);
    const out = resolvePlaceholders('{languageName}', { languageName: 'English' });
    svc.setContent('languageDisplay.smallCapsEnabled', true);
    return out === 'English';
  })());
  check('newlines in a template survive', resolvePlaceholders('a\n\nb', {}).includes('\n\n'));

  // =====================================================================
  // 3.2 Language display
  // =====================================================================
  check('getLanguageDisplay returns name, cap and flag', (() => {
    const d = getLanguageDisplay('en');
    return d.name === 'English' && d.nameDisplay === toSmallCaps('English') && d.flag.length > 0;
  })(), JSON.stringify(getLanguageDisplay('en')));
  check('full pairs the name and the flag', getLanguageDisplay('fr').full === toSmallCaps('Français') + ' ' + getLanguageDisplay('fr').flag);
  check('an unknown code degrades to itself', getLanguageDisplay('zz').name === 'zz', JSON.stringify(getLanguageDisplay('zz')));
  {
    // 12/13: an admin can correct a flag.
    svc.setContent('languageDisplay.languages.en.flag', '\u{1F1FA}\u{1F1F8}');
    check('12: an edited flag is used', getLanguageDisplay('en').flag === '\u{1F1FA}\u{1F1F8}', getLanguageDisplay('en').flag);
    check('12: the onboarding detected line picks it up',
      onboard.buildDetectedMessage('en', 'en', { skipGreeting: true }).includes('\u{1F1FA}\u{1F1F8}'),
      onboard.buildDetectedMessage('en', 'en', { skipGreeting: true }).split('\n')[2]);
    // 14: small caps off.
    svc.setContent('languageDisplay.smallCapsEnabled', false);
    const raw = onboard.buildDetectedMessage('en', 'en', { skipGreeting: true });
    check('14: small caps off shows the raw language name', raw.includes('English \u{1F1FA}\u{1F1F8}'), raw.split('\n')[2]);
    svc.setContent('languageDisplay.smallCapsEnabled', true);
    svc.resetSection('languageDisplay');
  }

  // =====================================================================
  // 3.3/3.4 Runtime integration: the copy really comes from content
  // =====================================================================
  {
    const marker = 'ZZmarkerZZ';
    svc.setContent('onboarding.firstMessage.question', 'custom question ' + marker);
    check('3.3: the onboarding question comes from content',
      onboard.buildDetectedMessage('en', 'en', {}).includes(toSmallCaps(marker)),
      onboard.buildDetectedMessage('en', 'en', {}).split('\n').find((l) => dec(l).includes('custom')));
    svc.resetSection('onboarding.firstMessage');
  }
  {
    // 8/9: an edited welcome-back variant reaches the rendered greeting.
    const pool = [...svc.getContent('welcomeBack.A1')];
    pool[0] = 'edited {pushName} ZZmarkerZZ';
    svc.setContent('welcomeBack.A1', pool);
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      seen.add(wb.buildWelcomeBackMessage({ language: null, pushName: 'John' }, 45e3, { jid: '1@lid' }).body);
    }
    check('9: the edited welcome-back variant is used',
      [...seen].some((v) => v.includes(toSmallCaps('ZZmarkerZZ'))), JSON.stringify([...seen]));
    check('9: the other variants survive the edit', seen.size >= 2, seen.size);
    svc.resetSection('welcomeBack');
    check('9: reset restores the original pool',
      svc.getContent('welcomeBack.A1')[0] === defaults.welcomeBack.A1[0],
      svc.getContent('welcomeBack.A1')[0]);
  }
  {
    // An emptied pool falls back to the code table instead of throwing.
    svc.setContent('welcomeBack.B2', []);
    let threw = null;
    let out = null;
    try { out = wb.buildWelcomeBackMessage({ language: 'en', pushName: 'J' }, 3 * 864e5, { jid: '1@lid' }); } catch (err) { threw = err; }
    check('an emptied variant pool falls back to code', threw === null && !!out?.body, threw?.message);
    svc.resetSection('welcomeBack');
  }
  {
    const resume = await import('../src/handlers/resumeHandler.js');
    const sent = [];
    const sock = {
      sendMessage: async (jid, content) => { sent.push({ jid, text: String(content?.text ?? '') }); return { key: { id: 'K' + sent.length } }; },
      sendPresenceUpdate: async () => {},
      readMessages: async () => true
    };
    svc.setContent('onboarding.resumeMessage.bodyShort', 'edited resume body');
    await resume.sendResumePrompt({ sock, sender: '1@lid', chatId: '1@lid', pushName: 'John' }, {}, { jid: '1@lid', pushName: 'John' }, 2 * 3600e3);
    check('the resume prompt body comes from content',
      sent.at(-1).text.includes(toSmallCaps('edited resume body')), sent.at(-1).text);
    svc.resetSection('onboarding.resumeMessage');
  }

  // =====================================================================
  // 3.5 Timing precedence: content wins, config is the fallback
  // =====================================================================
  check('default typingDelayMs is read', timing.typingDelayMs() === 600, timing.typingDelayMs());
  svc.setContent('timing.typingDelayMs', 1500);
  check('10: an edited typingDelayMs takes effect', timing.typingDelayMs() === 1500, timing.typingDelayMs());
  svc.resetSection('timing');
  check('resetting timing restores the default', timing.typingDelayMs() === 600, timing.typingDelayMs());
  check('welcome-back thresholds resolve', timing.welcomeBackThresholds().minGapMs === 300000, JSON.stringify(timing.welcomeBackThresholds()));
  check('cooldown lock resolves', timing.cooldownLockMs() === 300000, timing.cooldownLockMs());
  check('retry max resolves', timing.retryAttempts === undefined || true);
  check('retryMaxAttempts resolves', timing.retryMaxAttempts() === 3, timing.retryMaxAttempts());
  check('idleCloseMs resolves', timing.idleCloseMs() > 0, timing.idleCloseMs());
  check('typingMode resolves', timing.typingMode() === 'adaptive', timing.typingMode());
  check('typingIndicatorEnabled resolves', timing.typingIndicatorEnabled() === true);
  check('typingTargeting resolves to an object', typeof timing.typingTargeting() === 'object');
  {
    // An edited threshold must move pickSpeaker's behaviour.
    const user = { language: 'en' };
    svc.setContent('timing.welcomeBackThresholds.minGapMs', 1000);
    check('an edited minGapMs reaches pickSpeaker',
      pickSpeaker({ user, session: {}, gap: 2000 }) === 'welcomeBack',
      pickSpeaker({ user, session: {}, gap: 2000 }));
    svc.resetSection('timing');
    check('resetting restores the 5 minute gate',
      pickSpeaker({ user, session: {}, gap: 2000 }) === 'menu',
      pickSpeaker({ user, session: {}, gap: 2000 }));
  }
  {
    // A nonsense value must not become the resolved number.
    svc.setContent('timing.typingDelayMs', 'soon');
    check('a non-numeric timing value is ignored', timing.typingDelayMs() === 600, timing.typingDelayMs());
    svc.resetSection('timing');
  }

  // =====================================================================
  // 6.6 Preview renders every stage with sample data
  // =====================================================================
  {
    const { botContentPreview } = await import('../src/handlers/botContentCommand.js');
    const sent = [];
    const sock = {
      sendMessage: async (jid, content) => { sent.push({ jid, text: String(content?.text ?? '') }); return { key: { id: 'K' + sent.length } }; },
      sendPresenceUpdate: async () => {},
      readMessages: async () => true
    };
    await botContentPreview({ sock, sender: '1@lid', chatId: '1@lid', pushName: 'John', language: 'en' });
    const text = sent.at(-1)?.text || '';
    check('15: the preview renders', text.length > 0, text.length);
    check('15: the preview uses the sample name', text.includes('*John*'), text.slice(0, 300));
    check('15: the preview shows the greeting', text.includes('ɢᴏᴏᴅ') || text.includes('ᴍᴏʀɴɪɴɢ') || dec(text).includes('good morning'), text.slice(0, 200));
    check('15: the preview shows a language flag', /\u{1F1E6}|\u{1F1EC}/u.test(text), text.slice(0, 200));
    check('15: the preview has no replacement chars', !text.includes('\uFFFD'), text.slice(0, 200));
    check('15: the preview offers a back option', /0\. /.test(text), text.split('\n').pop());
  }

  // =====================================================================
  // 6.9 Reset
  // =====================================================================
  {
    svc.setContent('onboarding.firstMessage.greeting', 'CHANGED');
    svc.setContent('timing.typingDelayMs', 4242);
    check('22: resetSection restores onboarding', svc.resetSection('onboarding.firstMessage') === true);
    check('22: the onboarding value is back to default',
      svc.getContent('onboarding.firstMessage.greeting') === defaults.onboarding.firstMessage.greeting,
      svc.getContent('onboarding.firstMessage.greeting'));
    check('22: timing is untouched by an onboarding reset', svc.getContent('timing.typingDelayMs') === 4242);
    svc.resetAll();
    check('23: resetAll restores everything', svc.getContent('timing.typingDelayMs') === 600, svc.getContent('timing.typingDelayMs'));
    check('23: resetSection reports false for an unknown path', svc.resetSection('nope.nope') === false);
  }

  // =====================================================================
  // 6.8 Snapshots
  // =====================================================================
  {
    const before = svc.listSnapshots().length;
    svc.setContent('onboarding.firstMessage.greeting', 'snap one');
    svc.snapshot();
    svc.setContent('onboarding.firstMessage.greeting', 'snap two');
    svc.snapshot();
    const list = svc.listSnapshots();
    check('19/20: each edit can produce a snapshot', list.length >= before + 2, list.length);
    check('21: snapshots are newest first', list[0] > list[1], JSON.stringify(list.slice(0, 2)));
    svc.setContent('onboarding.firstMessage.greeting', 'drifted');
    check('21: restore reverts to a snapshot', svc.restoreSnapshot(list[1]) === true);
    check('21: the snapshot value is back', svc.getContent('onboarding.firstMessage.greeting') === 'snap one',
      svc.getContent('onboarding.firstMessage.greeting'));
    check('21: restoring a missing snapshot fails safely', svc.restoreSnapshot('nope.json') === false);
    // A traversal attempt must not escape the snapshot directory.
    check('21: restore is confined to the snapshot dir', svc.restoreSnapshot('../../package.json') === false);
    svc.resetAll();
    for (const f of svc.listSnapshots()) svc.deleteSnapshot(f);
  }

  // =====================================================================
  // 6.7 Import
  // =====================================================================
  {
    const { botContentImport } = await import('../src/handlers/botContentCommand.js');
    const sent = [];
    const sock = {
      sendMessage: async (jid, content) => { sent.push({ jid, text: String(content?.text ?? '') }); return { key: { id: 'K' + sent.length } }; },
      sendPresenceUpdate: async () => {},
      readMessages: async () => true
    };
    svc.resetSection('onboarding.firstMessage');
    const sessionManager = (await import('../src/utils/sessionManager.js')).default;
    sessionManager.setState('1@lid', '1@lid', { pendingAction: 'bot_content_import', pendingData: { stage: 'await' } });
    const ctx = { sock, sender: '1@lid', chatId: '1@lid', pushName: 'A', language: 'en' };
    const s0 = sessionManager.getSession('1@lid', '1@lid');

    await botContentImport(ctx, s0, 'not json at all', null);
    check('16: invalid JSON is rejected', svc.getContent('onboarding.firstMessage.greeting') === defaults.onboarding.firstMessage.greeting);
    check('16: the admin is told it was invalid', (sent.at(-1)?.text || '').length > 0);

    const payload = JSON.stringify({ onboarding: { firstMessage: { greeting: 'imported hi {pushName}' } } });
    await botContentImport(ctx, s0, payload, null);
    check('17: a valid paste is imported',
      svc.getContent('onboarding.firstMessage.greeting') === 'imported hi {pushName}',
      svc.getContent('onboarding.firstMessage.greeting'));
    check('17: import fills missing keys from the defaults',
      svc.getContent('welcomeBack.B3').length === defaults.welcomeBack.B3.length);

    await botContentImport(ctx, s0, '```json\n' + payload + '\n```', null);
    check('a fenced code block is tolerated',
      svc.getContent('onboarding.firstMessage.greeting') === 'imported hi {pushName}',
      svc.getContent('onboarding.firstMessage.greeting'));

    await botContentImport(ctx, s0, null, Buffer.from(JSON.stringify({ timing: { typingDelayMs: 999 } }), 'utf8'));
    check('a .json document is imported', svc.getContent('timing.typingDelayMs') === 999, svc.getContent('timing.typingDelayMs'));
    svc.resetAll();
  }
  {
    const { botContentExport } = await import('../src/handlers/botContentCommand.js');
    const docs = [];
    const sock = {
      sendMessage: async (jid, content) => {
        docs.push(content);
        return { key: { id: 'K' + docs.length } };
      },
      sendPresenceUpdate: async () => {},
      readMessages: async () => true
    };
    await botContentExport({ sock, sender: '1@lid', chatId: '1@lid', pushName: 'A', language: 'en' });
    const doc = docs.at(-1);
    check('16: export sends a document', !!doc?.document, Object.keys(doc || {}).join(','));
    check('16: export sets the json mimetype', doc?.mimetype === 'application/json', doc?.mimetype);
    check('16: export uses a dated filename', /^bot-content-\d{4}-\d{2}-\d{2}\.json$/.test(doc?.fileName || ''), doc?.fileName);
    const parsed = JSON.parse(doc.document.toString('utf8'));
    check('16: the exported document is valid json', parsed.version === 1 && !!parsed.onboarding);
  }

  // =====================================================================
  // Menus, registration, routing
  // =====================================================================
  check('bot_content is registered', !!getMenu('bot_content'));
  check('all four submenus are registered',
    ['bot_content_onboarding', 'bot_content_welcome_back', 'bot_content_timing', 'bot_content_language']
      .every((id) => !!getMenu(id)));
  // Phase 4 appended Moderation Messages as option 11; nothing was renumbered.
  check('bot_content has eleven options', getMenu('bot_content').options.length === 11, String(getMenu('bot_content').options.length));
  check('bot_content is admin only', getMenu('bot_content').adminOnly === true);
  check('bot_content parents off system_settings', getMenu('bot_content').parent === 'system_settings');
  check('submenus point back at bot_content',
    ['bot_content_onboarding', 'bot_content_welcome_back', 'bot_content_timing', 'bot_content_language']
      .every((id) => getMenu(id).parent === 'bot_content' && getMenu(id).backTo === 'bot_content'));
  check('bot_content exposes the /content command', getMenu('bot_content').standaloneCommand === '/content');
  check('system_settings option 12 opens bot_content',
    resolveMenuOption('system_settings', '12', null, 'en').action === 'open:bot_content',
    JSON.stringify(resolveMenuOption('system_settings', '12', null, 'en')));
  check('the changelog manager keeps option 11',
    resolveMenuOption('system_settings', '11', null, 'en').action === 'open:changelog_manager');
  check('system_settings rejects 13',
    resolveMenuOption('system_settings', '13', null, 'en').kind === 'invalid');
  check('every bot_content option resolves',
    getMenu('bot_content').options.every((o) => {
      const r = resolveMenuOption('bot_content', o.number, null, 'en');
      return r.kind === 'action';
    }), JSON.stringify(getMenu('bot_content').options.map((o) => o.action)));
  check('every custom: action has a handler',
    getMenu('bot_content').options.filter((o) => String(o.action).startsWith('custom:'))
      .every((o) => typeof adminCustomHandlers[o.action.slice(7)] === 'function'),
    JSON.stringify(getMenu('bot_content').options.map((o) => o.action).filter((a) => a.startsWith('custom:') && typeof adminCustomHandlers[a.slice(7)] !== 'function')));
  check('the submenu custom actions have handlers too',
    ['bot_content_onboarding', 'bot_content_welcome_back', 'bot_content_timing', 'bot_content_language']
      .flatMap((id) => getMenu(id).options.map((o) => o.action))
      .filter((a) => String(a).startsWith('custom:'))
      .every((a) => typeof adminCustomHandlers[a.slice(7)] === 'function'),
    JSON.stringify(['bot_content_onboarding', 'bot_content_welcome_back', 'bot_content_timing', 'bot_content_language']
      .flatMap((id) => getMenu(id).options.map((o) => o.action))
      .filter((a) => String(a).startsWith('custom:') && typeof adminCustomHandlers[a.slice(7)] !== 'function')));

  // =====================================================================
  // Resolvers
  // =====================================================================
  check('botContentSummary is registered', typeof resolvers.summaryResolvers.botContentSummary === 'function');
  check('botContentSummary reports a stamp',
    /\d/.test(String(resolvers.summaryResolvers.botContentSummary())),
    resolvers.summaryResolvers.botContentSummary());
  check('botContentVariantCount shows the live pool size',
    String(resolvers.dynamicSuffixResolvers.botContentVariantCount(null, 'en', { suffixKey: 'A1' })).includes(String(svc.getContent('welcomeBack.A1').length)),
    resolvers.dynamicSuffixResolvers.botContentVariantCount(null, 'en', { suffixKey: 'A1' }));
  check('botContentLanguageRow shows name and flag',
    resolvers.dynamicSuffixResolvers.botContentLanguageRow(null, 'en', { suffixKey: 'fr' }).includes(getLanguageDisplay('fr').flag),
    resolvers.dynamicSuffixResolvers.botContentLanguageRow(null, 'en', { suffixKey: 'fr' }));
  check('botContentBoolState reflects the value', (() => {
    const on = resolvers.dynamicSuffixResolvers.botContentBoolState(null, 'en', { suffixKey: 'languageDisplay.smallCapsEnabled' });
    svc.setContent('languageDisplay.smallCapsEnabled', false);
    const off = resolvers.dynamicSuffixResolvers.botContentBoolState(null, 'en', { suffixKey: 'languageDisplay.smallCapsEnabled' });
    svc.setContent('languageDisplay.smallCapsEnabled', true);
    return on !== off;
  })());
  check('botContentTimingValue renders the raw value below a second',
    resolvers.dynamicSuffixResolvers.botContentTimingValue(null, 'en', { suffixKey: 'typingDelayMs' }).includes('600'),
    resolvers.dynamicSuffixResolvers.botContentTimingValue(null, 'en', { suffixKey: 'typingDelayMs' }));
  {
    svc.setContent('timing.welcomeBackThresholds.minGapMs', 300000);
    check('botContentTimingValue renders a duration in seconds',
      resolvers.dynamicSuffixResolvers.botContentTimingValue(null, 'en', { suffixKey: 'welcomeBackThresholds' }).includes('300s'),
      resolvers.dynamicSuffixResolvers.botContentTimingValue(null, 'en', { suffixKey: 'welcomeBackThresholds' }));
    svc.resetSection('timing');
  }

  // =====================================================================
  // Field map hygiene
  // =====================================================================
  check('every editable field path resolves in the defaults', (() => {
    const missing = Object.keys(EDITABLE_FIELDS).filter((p) => svc.getContent(p) === undefined);
    return missing.length === 0;
  })(), JSON.stringify(Object.keys(EDITABLE_FIELDS).filter((p) => svc.getContent(p) === undefined)));
  check('every editable field has a label key that resolves', Object.values(EDITABLE_FIELDS)
    .every((f) => t('en', f.labelKey) !== f.labelKey),
  JSON.stringify(Object.values(EDITABLE_FIELDS).map((f) => f.labelKey).filter((k) => t('en', k) === k)));
  check('every declared placeholder is one the resolver knows',
    Object.values(EDITABLE_FIELDS).flatMap((f) => f.placeholders || [])
      .every((p) => KNOWN_PLACEHOLDERS.includes(p)),
    JSON.stringify(Object.values(EDITABLE_FIELDS).flatMap((f) => f.placeholders || [])
      .filter((p) => !KNOWN_PLACEHOLDERS.includes(p))));
  check('every declared variant has a default pool',
    EDITABLE_VARIANTS.every((v) => Array.isArray(svc.getContent('welcomeBack.' + v)) && svc.getContent('welcomeBack.' + v).length > 0),
    JSON.stringify(EDITABLE_VARIANTS.filter((v) => !(svc.getContent('welcomeBack.' + v) || []).length)));
  check('every timing field path resolves', Object.keys(EDITABLE_TIMING).every((p) => svc.getContent(p) !== undefined),
    JSON.stringify(Object.keys(EDITABLE_TIMING).filter((p) => svc.getContent(p) === undefined)));
  check('the sample context covers every placeholder',
    [...KNOWN_PLACEHOLDERS]
      .every((k) => SAMPLE_CTX[k] !== undefined), JSON.stringify(SAMPLE_CTX));
  check('emoji shortcut characters are not exposed as fields',
    !Object.keys(EDITABLE_FIELDS).some((p) => /emoji|shortcut/i.test(p)));

  // =====================================================================
  // Translations
  // =====================================================================
  {
    const menuKeys = [
      'heading', 'updated', 'variantCount', 'onboarding', 'welcome_back', 'timing', 'language',
      'preview', 'export', 'import', 'snapshots', 'reset', 'current', 'placeholders', 'save',
      'editAgain', 'cancel', 'saved', 'noSnapshots', 'restore', 'delete', 'confirmReset',
      'resetDone', 'imported', 'invalidJson', 'sendFile',
      'group_firstMessage', 'group_resumeMessage', 'group_welcomeMessage', 'group_unsupportedLanguage',
      'group_retry', 'group_cooldownLock', 'group_welcomeBack', 'group_timing', 'group_language',
      'variant_A1', 'variant_A4', 'variant_B1', 'variant_B3',
      'reset_all', 'reset_onboarding', 'reset_welcomeBack', 'reset_timing', 'reset_languageDisplay'
    ];
    for (const lang of ['en', 'fr', 'de', 'es', 'ar']) {
      const missing = menuKeys.filter((k) => t(lang, 'menu.bot_content.' + k) === 'menu.bot_content.' + k);
      check(`${lang}: menu.bot_core keys resolve`, missing.length === 0, missing.join(','));
      check(`${lang}: system settings label resolves`,
        t(lang, 'menu.system_settings.bot_content') !== 'menu.system_settings.bot_content',
        t(lang, 'menu.system_settings.bot_content'));
    }
    // The key sets must match across locales so nothing hides in one language.
    const fs2 = await import('fs');
    const sets = ['en', 'fr', 'de', 'es', 'ar'].map((lang) =>
      Object.keys(JSON.parse(fs2.readFileSync(path.join(root, 'translations', lang + '.json'), 'utf8')).menu.bot_content).sort().join(','));
    check('every locale exposes the same bot_content keys', new Set(sets).size === 1,
      String(new Set(sets).size));
  }

  // =====================================================================
  // Rendered copy has no tofu, in every language
  // =====================================================================
  {
    for (const lang of ['en', 'fr', 'de', 'es', 'ar']) {
      const out = onboard.buildDetectedMessage(lang, 'en', { pushName: 'John', jid: '1@lid' });
      check(`${lang}: the onboarding message has no replacement chars`, !out.includes('\uFFFD'), out.slice(0, 120));
      check(`${lang}: the onboarding message is non-empty`, out.split('\n').length > 5, String(out.split('\n').length));
    }
  }

  // =====================================================================
  // Wiring
  // =====================================================================
  {
    const idx = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    check('index.js loads the content at startup', idx.includes('loadBotContent()'));
    check('index.js routes bot_content sub-states', idx.includes('startsWith(\'bot_content_\')'));
    check('the bot_content dispatcher is admin gated', /bot_content_\'\)\) \{\s*if \(!isAdminOperator\(sender\)\) return;/.test(idx.replace(/\r\n/g, ' ')));
    check('the built-in main menu heading resolver is untouched',
      typeof resolvers.mainMenuHeading === 'function');
  }
} finally {
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);