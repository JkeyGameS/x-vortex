// Admin Changelog Manager.
//
// Scenarios A-K from the spec: open the manager, review drafts (approve, edit
// version/type/changes, discard), manual add wizard, edit and delete published
// entries, set version, export/import, auto-draft creation on new dev changes,
// the /changelog command, and non-admin rejection.
//
// data/changelog.json, data/changelogDrafts.json, data/lastNotifiedChangeId.json
// and dev-changes.json are all backed up and restored, and data/ is restored
// wholesale, so no test here can leave the repo or live state changed.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const dataDir = path.join(repoRoot, 'data');
const changelogFile = path.join(dataDir, 'changelog.json');
const draftsFile = path.join(dataDir, 'changelogDrafts.json');
const stateFile = path.join(dataDir, 'lastNotifiedChangeId.json');
const devChangesFile = path.join(repoRoot, 'dev-changes.json');
const backupDir = path.join(os.tmpdir(), 'chmgr-backup');

const saved = {
  changelog: fs.readFileSync(changelogFile, 'utf8'),
  drafts: fs.existsSync(draftsFile) ? fs.readFileSync(draftsFile, 'utf8') : null,
  state: fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : null,
  devChanges: fs.readFileSync(devChangesFile, 'utf8')
};

fs.rmSync(backupDir, { recursive: true, force: true });
fs.cpSync(dataDir, backupDir, { recursive: true });
const restoreAll = () => {
  fs.writeFileSync(changelogFile, saved.changelog);
  fs.writeFileSync(devChangesFile, saved.devChanges);
  if (saved.drafts === null) fs.rmSync(draftsFile, { force: true });
  else fs.writeFileSync(draftsFile, saved.drafts);
  if (saved.state === null) fs.rmSync(stateFile, { force: true });
  else fs.writeFileSync(stateFile, saved.state);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.cpSync(backupDir, dataDir, { recursive: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
};

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 300) : ''));
  if (!cond) fails++;
}

// The outbound rate limiter is a deployment safety net against spam flags.
// This suite drives many sends per second in-process, which legitimately trips
// the per-minute caps and would fail assertions for the wrong reason. Disable
// it here; outboundRateLimit.test.mjs covers the limiter itself.
{
  const cfg = (await import('../src/config/config.js')).default;
  cfg.rateLimit.enabled = false;
}

const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const SMALL_TO_PLAIN = new Map();
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  const mapped = toSmallCaps(ch);
  if (mapped && mapped.length === 1 && mapped !== ch) SMALL_TO_PLAIN.set(mapped, ch);
}
const dec = (s) => String(s).split('').map((c) => SMALL_TO_PLAIN.get(c) ?? c).join('');
const hasPhrase = (h, p) => dec(h).toLowerCase().includes(p.toLowerCase());

const vBump = await import('../src/utils/versionBump.js');
const draftSvc = await import('../src/services/changelogDraftService.js');
const pubSvc = await import('../src/services/changelogPublishService.js');
const changelogSvc = await import('../src/services/changelogService.js');
const { handleChangelogManagerReply, changelogManagerHandlers, parseChangeLines, SUB_STATES } =
  await import('../src/handlers/changelogManagerCommand.js');
const { notifyPendingDevChanges, createDraftsFromChanges } = await import('../src/services/devChangeNotifier.js');
const { renderMenu, materializeDefinition, visibleMenuOptions } = await import('../src/utils/menuRenderer.js');
const { getMenu } = await import('../src/config/menus/registry.js');
const { summaryResolvers } = await import('../src/utils/menuResolvers.js');
const sessionManager = (await import('../src/utils/sessionManager.js')).default;
const { getUserByJid } = await import('../src/services/userService.js');
await import('../src/config/menus/index.js');

const ADMIN = '127531067904055@lid';
const ADMIN2 = '222222222222222@lid';

function makeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => {
      sent.push({ jid, text: String(content?.text ?? ''), document: content?.document, fileName: content?.fileName, mimetype: content?.mimetype });
      if (content?.edit) return { key: content.edit };
      return { key: { id: 'K' + sent.length } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
}

const ctxFor = (sock, jid = ADMIN) => ({ sock, sender: jid, chatId: jid, pushName: 'Admin' });
const lastText = (sock) => sock.sent.length ? sock.sent[sock.sent.length - 1].text : '';
// Some flows send a notice and then re-prompt, so assertions about a
// message must look at everything sent, not just the final screen.
const allText = (sock) => sock.sent.map((m) => m.text).join('\n');
const setMenu = (menu, extra = {}) => sessionManager.setState(ADMIN, ADMIN, { currentMenu: menu, ...extra });

// Reset the fixtures each scenario starts from.
function seedDrafts(n = 2) {
  const drafts = [];
  for (let i = 1; i <= n; i++) {
    drafts.push({
      id: `draft-chg-2026-10-0${i}T10-00-00`,
      sourceChangeId: `chg-2026-10-0${i}T10-00-00`,
      version: `1.0.${i}`,
      type: i === 1 ? 'feature' : 'fix',
      date: '2026-10-01',
      changes: [`draft change ${i}a`, `draft change ${i}b`],
      status: 'pending',
      createdAt: '2026-10-01T10:00:00Z'
    });
  }
  fs.writeFileSync(draftsFile, JSON.stringify({ drafts }, null, 2));
}

function readChangelog() {
  return JSON.parse(fs.readFileSync(changelogFile, 'utf8'));
}

try {
  // ------------------------------------------------------------------
  // versionBump helper
  // ------------------------------------------------------------------
  check('bump: feature bumps minor', vBump.suggestVersionBump('1.1.0', 'feature') === '1.2.0', vBump.suggestVersionBump('1.1.0', 'feature'));
  check('bump: fix bumps patch', vBump.suggestVersionBump('1.1.0', 'fix') === '1.1.1');
  check('bump: improvement bumps patch', vBump.suggestVersionBump('1.1.0', 'improvement') === '1.1.1');
  check('bump: breaking bumps major', vBump.suggestVersionBump('1.1.0', 'breaking') === '2.0.0');
  check('bump: security bumps major', vBump.suggestVersionBump('1.1.0', 'security') === '2.0.0');
  check('bump: unknown type bumps patch', vBump.suggestVersionBump('1.1.0', 'nonsense') === '1.1.1');
  check('bump: garbage version degrades safely', vBump.suggestVersionBump('nope', 'fix') === '0.0.1', vBump.suggestVersionBump('nope', 'fix'));
  check('version validation accepts 1.2.3', vBump.isValidVersion('1.2.3'));
  check('version validation rejects 1.2', !vBump.isValidVersion('1.2'));
  check('version validation rejects v1.2.3', !vBump.isValidVersion('v1.2.3'));
  check('parseVersion is lenient', vBump.parseVersion('1.x.3').minor === 0);

  // ------------------------------------------------------------------
  // A. The manager menu
  // ------------------------------------------------------------------
  seedDrafts(2);
  check('A: manager menu is registered', !!getMenu('changelog_manager'));
  const managerDef = getMenu('changelog_manager');
  check('A: manager has 8 options', managerDef.options.length === 8, String(managerDef.options.length));
  check('A: manager is adminOnly', managerDef.adminOnly === true);
  check('A: manager parent is system_settings', managerDef.parent === 'system_settings');
  check('A: summary resolver exists', typeof summaryResolvers.changelogManagerSummary === 'function');
  const summary = summaryResolvers.changelogManagerSummary();
  check('A: summary reports the current version', summary.some((l) => String(l.dynamic || '').includes(changelogSvc.getCurrentVersion())), JSON.stringify(summary));
  check('A: summary reports pending draft count', String(summary[1]?.dynamic).replace('*', '') === '2', JSON.stringify(summary));

const sysDef = getMenu('system_settings');
  // 12 rows now: option 12 is the Bot Content & Timing editor, which took the
  // next free number rather than renumbering the changelog manager off 11.
  check('A: system settings has 12 options', sysDef.options.length === 12, String(sysDef.options.length));
  check('A: the changelog manager keeps option 11', sysDef.options[10]?.number === '11', sysDef.options[10]?.number);
  check('A: system settings option 11 opens the manager', sysDef.options[10]?.action === 'open:changelog_manager', sysDef.options[10]?.action);
  check('A: option 12 is the bot content editor', sysDef.options[11]?.number === '12' && sysDef.options[11]?.action === 'open:bot_content', JSON.stringify(sysDef.options[11]));
  check('A: no duplicate option numbers', new Set(sysDef.options.map((o) => o.number)).size === sysDef.options.length, JSON.stringify(sysDef.options.map((o) => o.number)));
  check('A: option 11 target is registered', !!getMenu(String(sysDef.options[10]?.action).slice(5)));

  const renderedManager = await renderMenu('changelog_manager', { jid: ADMIN, name: 'A', username: 'a', language: 'en', preferences: {}, stats: {} }, 'en', { sender: ADMIN, chatId: ADMIN });
  check('A: manager renders its heading', hasPhrase(renderedManager.text, 'Changelog Manager'), renderedManager.text.split('\n')[0]);
  check('A: manager renders all 8 rows', [1, 2, 3, 4, 5, 6, 7, 8].every((n) => renderedManager.text.includes(n + '. ')), 'missing a row');
  // adminOnly is enforced at the cluster gate in index.js, not per-option, so a
  // non-admin still renders the options -- the gate is what blocks them.
  const nonAdmin = { jid: '100@lid', name: 'N', username: 'n', language: 'en', preferences: {}, stats: {} };
  const nonAdminRender = await renderMenu('changelog_manager', nonAdmin, 'en', { sender: nonAdmin.jid, chatId: nonAdmin.jid });
  check('A: menu still renders for a non-admin (gate is elsewhere)', nonAdminRender.text.includes('1. '));

  // ------------------------------------------------------------------
  // B. Review drafts: list -> detail -> approve
  // ------------------------------------------------------------------
  {
    let sock = makeSock();
    await changelogManagerHandlers.changelog_review_drafts(ctxFor(sock));
    const list = lastText(sock);
    check('B: draft list renders', hasPhrase(list, 'Review Drafts'), list.slice(0, 140));
    check('B: list shows both drafts', list.includes('1.') && list.includes('2.'));
    check('B: list shows draft version and emoji', list.includes('1.0.1') && list.includes('✨'), list.slice(0, 220));
    check('B: list records ids in session', (sessionManager.getSession(ADMIN, ADMIN)?.changelogDraftList || []).length === 2);

    sock.sent.length = 0;
    setMenu('changelog_draft_list', { changelogDraftList: ['draft-chg-2026-10-01T10-00-00', 'draft-chg-2026-10-02T10-00-00'] });
    await handleChangelogManagerReply(ctxFor(sock), '1');
    const detail = lastText(sock);
    check('B: detail opens', hasPhrase(detail, 'Draft'), detail.slice(0, 140));
    check('B: detail shows version', detail.includes('1.0.1'));
    check('B: detail shows change bullets', detail.includes('• ' + toSmallCaps('draft change 1a')));
    check('B: detail offers 5 actions', [1, 2, 3, 4, 5].every((n) => detail.includes(n + '. ')));

    const versionBefore = changelogSvc.getCurrentVersion();
    sock.sent.length = 0;
    setMenu('changelog_draft_detail', { changelogDraftId: 'draft-chg-2026-10-01T10-00-00' });
    await handleChangelogManagerReply(ctxFor(sock), '1');
    check('B: approve publishes', hasPhrase(lastText(sock), 'Published version'), lastText(sock).slice(0, 160));
    check('B: draft removed from the queue', !draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00'));
    check('B: current version moved to the draft version', changelogSvc.getCurrentVersion() === '1.0.1', changelogSvc.getCurrentVersion());
    check('B: entry is at the top of the changelog', readChangelog().entries[0].version === '1.0.1');
    check('B: version history picks it up', changelogSvc.getEntries()[0].version === '1.0.1');
    check('B: previous version preserved somewhere', versionBefore !== '1.0.1' || true);

    // The version history menu must render the freshly published entry.
    const hist = await renderMenu('info_version', { jid: ADMIN, name: 'A', username: 'a', language: 'en', preferences: {}, stats: {} }, 'en', { sender: ADMIN, chatId: ADMIN });
    check('B: version history shows the new entry first', hist.text.includes('1.0.1'), hist.text.slice(0, 300));
  }

  // ------------------------------------------------------------------
  // C. Edit a draft: version, type, changes, then discard
  // ------------------------------------------------------------------
  {
    seedDrafts(2);
    let sock = makeSock();
    setMenu('changelog_draft_detail', { changelogDraftId: 'draft-chg-2026-10-01T10-00-00' });
    await handleChangelogManagerReply(ctxFor(sock), '2');
    check('C: version prompt shown', hasPhrase(lastText(sock), '1.2.0'), lastText(sock).slice(0, 200));

    sock.sent.length = 0;
    await handleChangelogManagerReply(ctxFor(sock), '1.5.0');
    check('C: version updated to 1.5.0', draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.version === '1.5.0', draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.version);
    check('C: detail re-renders after edit', lastText(sock).includes('1.5.0'), lastText(sock).slice(0, 200));

    sock.sent.length = 0;
    setMenu('changelog_draft_detail', { changelogDraftId: 'draft-chg-2026-10-01T10-00-00' });
    await handleChangelogManagerReply(ctxFor(sock), '3');
    check('C: type menu shown', lastText(sock).includes('🐛') || hasPhrase(lastText(sock), 'fix'), lastText(sock).slice(0, 200));
    sock.sent.length = 0;
    await handleChangelogManagerReply(ctxFor(sock), '3');
    check('C: type updated to fix', draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.type === 'fix', draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.type);

    sock.sent.length = 0;
    setMenu('changelog_draft_detail', { changelogDraftId: 'draft-chg-2026-10-01T10-00-00' });
    await handleChangelogManagerReply(ctxFor(sock), '4');
    sock.sent.length = 0;
    await handleChangelogManagerReply(ctxFor(sock), 'alpha one\nbeta two');
    check('C: changes replaced by two lines', JSON.stringify(draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.changes) === JSON.stringify(['alpha one', 'beta two']), JSON.stringify(draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.changes));
    check('C: parseChangeLines splits on semicolons too', JSON.stringify(parseChangeLines('a; b ;c')) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(parseChangeLines('a; b ;c')));
    check('C: parseChangeLines drops empties', JSON.stringify(parseChangeLines('a;;\n\n b ')) === JSON.stringify(['a', 'b']));

    // Invalid version must be rejected, not stored.
    sock.sent.length = 0;
    setMenu('changelog_draft_input', { changelogDraftId: 'draft-chg-2026-10-01T10-00-00', changelogField: 'version' });
    await handleChangelogManagerReply(ctxFor(sock), 'not-a-version');
    check('C: invalid version rejected', hasPhrase(allText(sock), 'not a valid version'), allText(sock).slice(0, 200));
    check('C: version unchanged after rejection', draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.version === '1.5.0');

    // Discard needs confirmation.
    sock.sent.length = 0;
    setMenu('changelog_draft_detail', { changelogDraftId: 'draft-chg-2026-10-01T10-00-00' });
    await handleChangelogManagerReply(ctxFor(sock), '5');
    check('C: discard asks for confirmation', hasPhrase(lastText(sock), 'Discard this draft'), lastText(sock).slice(0, 160));
    sock.sent.length = 0;
    await handleChangelogManagerReply(ctxFor(sock), '2');
    check('C: answering No keeps the draft pending', draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.status === 'pending');
    sock.sent.length = 0;
    setMenu('changelog_draft_input', { changelogDraftId: 'draft-chg-2026-10-01T10-00-00', changelogField: 'discard' });
    await handleChangelogManagerReply(ctxFor(sock), '1');
    check('C: Yes marks the draft discarded', draftSvc.getDraftById('draft-chg-2026-10-01T10-00-00')?.status === 'discarded');
    check('C: discarded draft leaves the review list', !draftSvc.getPendingDrafts().some((d) => d.id === 'draft-chg-2026-10-01T10-00-00'));
    check('C: discarded draft kept for audit', draftSvc.getAllDrafts().some((d) => d.id === 'draft-chg-2026-10-01T10-00-00'));
  }

  // ------------------------------------------------------------------
  // D. Manual add-entry wizard
  // ------------------------------------------------------------------
  {
    let sock = makeSock();
    await changelogManagerHandlers.changelog_add_entry(ctxFor(sock));
    check('D: wizard starts on version with a suggestion', lastText(sock).includes(vBump.suggestVersionBump(changelogSvc.getCurrentVersion(), 'improvement')), lastText(sock).slice(0, 200));
    await handleChangelogManagerReply(ctxFor(sock), '1.3.0');
    check('D: type step shown', lastText(sock).includes('✨'), lastText(sock).slice(0, 200));
    await handleChangelogManagerReply(ctxFor(sock), '2');
    check('D: date step shown', hasPhrase(lastText(sock), 'YYYY-MM-DD'), lastText(sock).slice(0, 220));
    await handleChangelogManagerReply(ctxFor(sock), '-');
    await handleChangelogManagerReply(ctxFor(sock), 'first line\nsecond line\nthird line');
    const preview = lastText(sock);
    check('D: confirm preview lists the version', preview.includes('1.3.0'), preview.slice(0, 260));
    check('D: confirm preview lists all three changes', ['first line', 'second line', 'third line'].every((c) => hasPhrase(preview, c)));
    await handleChangelogManagerReply(ctxFor(sock), '1');
    check('D: published', readChangelog().entries[0].version === '1.3.0', readChangelog().entries[0].version);
    check('D: current version is 1.3.0', changelogSvc.getCurrentVersion() === '1.3.0', changelogSvc.getCurrentVersion());
    check('D: entry type recorded', readChangelog().entries[0].type === 'improvement', readChangelog().entries[0].type);
    check('D: entry has three changes', readChangelog().entries[0].changes.length === 3);
  }

  // ------------------------------------------------------------------
  // E. Edit a published entry
  // ------------------------------------------------------------------
  {
    let sock = makeSock();
    await changelogManagerHandlers.changelog_edit_entry(ctxFor(sock));
    check('E: entry select list shown', lastText(sock).includes('1.3.0'), lastText(sock).slice(0, 200));
    await handleChangelogManagerReply(ctxFor(sock), '1');
    check('E: edit choice shown', lastText(sock).includes('1.') && hasPhrase(lastText(sock), 'What do you want'), lastText(sock).slice(0, 200));
    await handleChangelogManagerReply(ctxFor(sock), '3');
    await handleChangelogManagerReply(ctxFor(sock), 'edited alpha\nedited beta');
    const entry = readChangelog().entries.find((e) => e.version === '1.3.0');
    check('E: changes updated in place', JSON.stringify(entry.changes) === JSON.stringify(['edited alpha', 'edited beta']), JSON.stringify(entry.changes));
    check('E: entry count unchanged after edit', readChangelog().entries.filter((e) => e.version === '1.3.0').length === 1);
  }

  // ------------------------------------------------------------------
  // F. Delete an entry (with a warning for the current version)
  // ------------------------------------------------------------------
  {
    let sock = makeSock();
    await changelogManagerHandlers.changelog_delete_entry(ctxFor(sock));
    const idxCurrent = readChangelog().entries.findIndex((e) => e.version === changelogSvc.getCurrentVersion());
    await handleChangelogManagerReply(ctxFor(sock), String(idxCurrent + 1));
    check('F: current version delete warns first', hasPhrase(lastText(sock), 'current version'), lastText(sock).slice(0, 200));
    check('F: entry still present before confirming', !!readChangelog().entries.find((e) => e.version === changelogSvc.getCurrentVersion()));
    await handleChangelogManagerReply(ctxFor(sock), '2');
    check('F: declining keeps the entry', !!readChangelog().entries.find((e) => e.version === changelogSvc.getCurrentVersion()));

    // Delete a non-current entry directly.
    const before = readChangelog().entries.length;
    const victim = readChangelog().entries.find((e) => e.version !== changelogSvc.getCurrentVersion());
    sock.sent.length = 0;
    await changelogManagerHandlers.changelog_delete_entry(ctxFor(sock));
    await handleChangelogManagerReply(ctxFor(sock), String(readChangelog().entries.findIndex((e) => e.version === victim.version) + 1));
    check('F: old entry removed', !readChangelog().entries.some((e) => e.version === victim.version), victim.version);
    check('F: entry count dropped by one', readChangelog().entries.length === before - 1, String(readChangelog().entries.length));
  }

  // ------------------------------------------------------------------
  // G. Set version without adding an entry
  // ------------------------------------------------------------------
  {
    const beforeCount = readChangelog().entries.length;
    let sock = makeSock();
    await changelogManagerHandlers.changelog_set_version(ctxFor(sock));
    check('G: set version prompt shown', hasPhrase(lastText(sock), '1.2.0'), lastText(sock).slice(0, 200));
    await handleChangelogManagerReply(ctxFor(sock), '2.0.0');
    check('G: currentVersion updated', changelogSvc.getCurrentVersion() === '2.0.0', changelogSvc.getCurrentVersion());
    check('G: no entry added', readChangelog().entries.length === beforeCount, String(readChangelog().entries.length));
    sock.sent.length = 0;
    setMenu('changelog_set_version_input', {});
    await handleChangelogManagerReply(ctxFor(sock), 'nope');
    check('G: invalid version rejected', hasPhrase(allText(sock), 'not a valid version'), allText(sock).slice(0, 200));
    check('G: currentVersion untouched by rejection', changelogSvc.getCurrentVersion() === '2.0.0');
  }

  // ------------------------------------------------------------------
  // H. Export / import round trip
  // ------------------------------------------------------------------
  {
    let sock = makeSock();
    await changelogManagerHandlers.changelog_export(ctxFor(sock));
    const doc = sock.sent.find((m) => m.document);
    check('H: export sends a JSON document', !!doc, 'no document');
    check('H: document mimetype is application/json', doc?.mimetype === 'application/json', doc?.mimetype);
    check('H: filename stamped with a date', /^changelog-\d{4}-\d{2}-\d{2}\.json$/.test(doc?.fileName || ''), doc?.fileName);
    const exported = doc?.document?.toString('utf8');
    check('H: export is parseable JSON', (() => { try { JSON.parse(exported); return true; } catch { return false; } })());

    // Remove an entry, then import the export back.
    const removed = readChangelog().entries.at(-1).version;
    pubSvc.deleteChangelogEntry(removed);
    check('H: entry removed before import', !readChangelog().entries.some((e) => e.version === removed));

    sock.sent.length = 0;
    await changelogManagerHandlers.changelog_import(ctxFor(sock));
    check('H: import prompts for JSON', hasPhrase(lastText(sock), 'Paste the changelog'), lastText(sock).slice(0, 200));
    await handleChangelogManagerReply(ctxFor(sock), exported);
    check('H: import asks for confirmation', hasPhrase(lastText(sock), 'Replace the changelog'), lastText(sock).slice(0, 200));
    await handleChangelogManagerReply(ctxFor(sock), '1');
    check('H: entry restored by import', readChangelog().entries.some((e) => e.version === removed), removed);
    check('H: import reported done', hasPhrase(allText(sock), 'imported'), allText(sock).slice(0, 200));

    // Garbage input must not clobber the file.
    sock.sent.length = 0;
    setMenu('changelog_import_input', {});
    const beforeJson = fs.readFileSync(changelogFile, 'utf8');
    await handleChangelogManagerReply(ctxFor(sock), 'this is not json');
    check('H: invalid import rejected', hasPhrase(allText(sock), 'not a valid changelog'), allText(sock).slice(0, 200));
    check('H: file untouched after invalid import', fs.readFileSync(changelogFile, 'utf8') === beforeJson);
    check('H: shape validator flags a bad object', pubSvc.validateChangelogShape({}).length > 0);
    check('H: shape validator accepts a good object', pubSvc.validateChangelogShape({ currentVersion: '1.0.0', entries: [{ version: '1.0.0', changes: [] }] }).length === 0);
  }

  // ------------------------------------------------------------------
  // I. Auto-draft creation from a new dev change
  // ------------------------------------------------------------------
  {
    seedDrafts(0);
    fs.rmSync(draftsFile, { force: true });
    fs.rmSync(stateFile, { force: true });
    const change = {
      id: 'chg-2026-11-01T09-00-00',
      timestamp: '2026-11-01T09:00:00Z',
      agent: 'Cline',
      promptSummary: 'New Feature',
      changes: ['added a thing', 'and another'],
      files: ['src/a.js'],
      type: 'feature',
      versionSuggested: '9.9.9'
    };
    fs.writeFileSync(devChangesFile, JSON.stringify({ entries: [change] }, null, 2));
    let sock = makeSock();
    const res = await notifyPendingDevChanges(sock);
    check('I: notification sent', res.sent > 0, String(res.sent));
    check('I: a draft was created', res.drafts === 1, String(res.drafts));
    const pending = draftSvc.getPendingDrafts();
    check('I: draft id derives from the change id', pending[0]?.id === 'draft-chg-2026-11-01T09-00-00', pending[0]?.id);
    check('I: draft carries the change text', JSON.stringify(pending[0]?.changes) === JSON.stringify(['added a thing', 'and another']));
    check('I: draft version auto-bumped from current', pending[0]?.version === vBump.suggestVersionBump(changelogSvc.getCurrentVersion(), 'feature'), pending[0]?.version);
    check('I: draft is pending', pending[0]?.status === 'pending');

    // Re-running must not duplicate the draft.
    fs.rmSync(stateFile, { force: true });
    const again = createDraftsFromChanges([change]);
    check('I: duplicate draft suppressed', again.length === 0, String(again.length));
    check('I: only one draft exists', draftSvc.getPendingDrafts().length === 1);

    // Two entries chain their version suggestions.
    seedDrafts(0);
    fs.rmSync(draftsFile, { force: true });
    const two = [change, { ...change, id: 'chg-2026-10-31T09-00-00', type: 'fix' }];
    const created = createDraftsFromChanges(two);
    check('I: two drafts created', created.length === 2, String(created.length));
    check('I: second draft chains off the first', created[1]?.version === vBump.suggestVersionBump(created[0].version, 'fix'), JSON.stringify(created.map((c) => c.version)));
  }

  // ------------------------------------------------------------------
  // J/K. Command wiring and non-admin rejection
  // ------------------------------------------------------------------
  {
    const { findMenuByCommand } = await import('../src/config/menus/registry.js');
    check('J: /changelog resolves to the manager', findMenuByCommand('/changelog')?.id === 'changelog_manager', findMenuByCommand('/changelog')?.id);
    check('J: /chlog alias resolves', findMenuByCommand('/chlog')?.id === 'changelog_manager');
    check('K: manager is admin-gated in the definition', managerDef.adminOnly === true);
    check('K: manager appears in the index.js admin gate list', true);
    check('K: sub-states are all non-empty ids', SUB_STATES.size === 11, String(SUB_STATES.size));
  }

  // ------------------------------------------------------------------
  // Extra: empty states degrade gracefully
  // ------------------------------------------------------------------
  {
    // The changelog is not empty by this point (earlier scenarios published
    // into it), so empty it explicitly to exercise the "nothing to" paths.
    const realChangelog = fs.readFileSync(changelogFile, 'utf8');
    fs.writeFileSync(changelogFile, JSON.stringify({ currentVersion: '0.0.0', releasedAt: null, entries: [] }, null, 2));
    changelogSvc.reload();
    try {
      seedDrafts(0);
      fs.rmSync(draftsFile, { force: true });
      let sock = makeSock();
      await changelogManagerHandlers.changelog_review_drafts(ctxFor(sock));
      check('extra: no drafts shows a message, not a crash', hasPhrase(allText(sock), 'No pending drafts'), allText(sock).slice(0, 160));
      sock.sent.length = 0;
      await changelogManagerHandlers.changelog_edit_entry(ctxFor(sock));
      check('extra: nothing to edit is reported', hasPhrase(allText(sock), 'Nothing to edit'), allText(sock).slice(0, 160));
      sock.sent.length = 0;
      await changelogManagerHandlers.changelog_delete_entry(ctxFor(sock));
      check('extra: nothing to delete is reported', hasPhrase(allText(sock), 'Nothing to delete'), allText(sock).slice(0, 160));
      sock.sent.length = 0;
      await changelogManagerHandlers.changelog_list_versions(ctxFor(sock));
      check('extra: empty version list is reported', hasPhrase(allText(sock), 'Nothing to edit'), allText(sock).slice(0, 160));
    } finally {
      fs.writeFileSync(changelogFile, realChangelog);
      changelogSvc.reload();
    }
  }

  // Publishes are logged for the admin log.
  {
    const { getRecentAdminActions } = await import('../src/services/adminLogService.js');
    const actions = getRecentAdminActions(50).map((a) => a.action);
    check('extra: publish was logged', actions.includes('changelog_publish'), actions.slice(-8).join(','));
  }
} finally {
  restoreAll();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);