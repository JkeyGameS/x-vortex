// Group registry service (Phase 1).
//
// Runs against a temporary registry file via GROUPS_DATA_PATH so the live
// data/groups.json is never read or written by this suite. No boot, no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-test-'));
const tmpFile = path.join(tmpDir, 'groups.json');
// Phase 2 added an editable defaults file that activateGroup reads. Point it at
// a temp file too, so this suite never reads the live data/groupDefaults.json.
const tmpDefaults = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUPS_DATA_PATH = tmpFile;
process.env.GROUP_DEFAULTS_DATA_PATH = tmpDefaults;

const svc = await import('../src/services/groupService.js');
const {
  activateGroup,
  deactivateGroup,
  getGroup,
  getAllGroups,
  getEnabledGroups,
  isGroupEnabled,
  getGroupSettings,
  setGroupSetting,
  updateGroup,
  removeGroup,
  reload,
  defaultGroupSettings
} = svc;

const A = '111111111111@group.g.us';
const B = '222222222222@group.g.us';

before(() => {
  fs.writeFileSync(tmpDefaults, JSON.stringify(svc.defaultGroupSettings(), null, 2), 'utf8');
  reload();
  svc.loadGroupDefaults();
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('activateGroup creates an entry with the Phase 1 defaults', () => {
  const g = activateGroup(A, { name: 'Alpha', activatedBy: 'admin@lid' });
  assert.ok(g, 'entry returned');
  assert.strictEqual(g.id, A);
  assert.strictEqual(g.name, 'Alpha');
  assert.strictEqual(g.enabled, true);
  assert.strictEqual(g.activatedBy, 'admin@lid');
  assert.ok(g.activatedAt, 'activatedAt is set');
  assert.ok(!Number.isNaN(Date.parse(g.activatedAt)), 'activatedAt is a real date');
  assert.strictEqual(g.language, 'en');
  assert.deepStrictEqual(g.settings, defaultGroupSettings());
  assert.deepStrictEqual(g.moderation, { warnings: {}, mutes: {}, bans: {} });
});

test('Phase 1 defaults store flags without enabling behaviour', () => {
  const s = defaultGroupSettings();
  // Activation alone must not switch on chat rules, welcome, goodbye or links.
  assert.strictEqual(s.chatRules, false);
  assert.strictEqual(s.welcome, false);
  assert.strictEqual(s.goodbye, false);
  assert.strictEqual(s.antiLink, false);
  assert.strictEqual(s.mentionOnly, true);
  assert.strictEqual(s.antiSpam, true);
  assert.strictEqual(s.respondToCommands, true);
});

test('activateGroup is idempotent and refreshes the activation stamp', () => {
  const first = getGroup(A).activatedAt;
  const again = activateGroup(A, { name: 'Alpha Renamed', activatedBy: 'admin@lid' });
  assert.strictEqual(again.name, 'Alpha Renamed');
  assert.strictEqual(Object.keys(getAllGroups()).length >= 1, true);
  assert.ok(again.activatedAt >= first, 'stamp advanced or held');
  // Re-activating must not duplicate or drop the settings block.
  assert.deepStrictEqual(again.settings, defaultGroupSettings());
});

test('deactivateGroup sets enabled false and keeps the entry', () => {
  activateGroup(B, { name: 'Beta', activatedBy: 'admin@lid' });
  assert.strictEqual(isGroupEnabled(B), true);
  const g = deactivateGroup(B);
  assert.ok(g, 'entry returned');
  assert.strictEqual(g.enabled, false);
  assert.strictEqual(getGroup(B).name, 'Beta', 'entry is retained, not deleted');
  assert.strictEqual(isGroupEnabled(B), false);
});

test('deactivateGroup on an unknown group returns null', () => {
  assert.strictEqual(deactivateGroup('nope@group.g.us'), null);
});

test('an unknown group is not enabled', () => {
  assert.strictEqual(isGroupEnabled('nope@group.g.us'), false);
  assert.strictEqual(getGroup('nope@group.g.us'), null);
});

test('getEnabledGroups returns only enabled groups', () => {
  activateGroup(A, { name: 'Alpha', activatedBy: 'admin@lid' });
  deactivateGroup(B);
  const enabled = getEnabledGroups();
  assert.ok(enabled.length >= 1);
  assert.ok(enabled.every((g) => g.enabled === true));
  assert.ok(enabled.some((g) => g.id === A));
  assert.ok(!enabled.some((g) => g.id === B));
});

test('setGroupSetting mutates only the named key', () => {
  const before = { ...getGroupSettings(A) };
  const after = setGroupSetting(A, 'mentionOnly', false);
  assert.strictEqual(after.mentionOnly, false);
  assert.strictEqual(after.chatRules, before.chatRules, 'siblings untouched');
  assert.strictEqual(after.welcome, before.welcome);
  assert.strictEqual(after.goodbye, before.goodbye);
  assert.strictEqual(after.antiSpam, before.antiSpam);
  assert.strictEqual(after.antiLink, before.antiLink);
  assert.strictEqual(after.respondToCommands, before.respondToCommands);
});

test('setGroupSetting on an unknown group returns null', () => {
  assert.strictEqual(setGroupSetting('nope@group.g.us', 'mentionOnly', false), null);
});

test('getGroupSettings returns null for an unknown group', () => {
  assert.strictEqual(getGroupSettings('nope@group.g.us'), null);
});

test('updateGroup merges a patch without dropping settings', () => {
  // Compare against the live settings, not the defaults: an earlier test has
  // already changed mentionOnly on this group.
  const before = { ...getGroupSettings(A) };
  const g = updateGroup(A, { name: 'Alpha Patched' });
  assert.strictEqual(g.name, 'Alpha Patched');
  assert.deepStrictEqual(g.settings, before, 'settings survive the patch');
  assert.strictEqual(updateGroup('nope@group.g.us', { name: 'x' }), null);
});

test('changes persist to disk and survive a reload', () => {
  setGroupSetting(A, 'antiLink', true);
  assert.ok(fs.existsSync(tmpFile), 'registry file written');
  const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.strictEqual(raw[A].settings.antiLink, true);
  // Drop the cache and re-read from disk.
  reload();
  assert.strictEqual(getGroup(A).settings.antiLink, true, 'value survived reload');
  assert.strictEqual(getGroup(A).name, 'Alpha Patched');
});

test('removeGroup deletes the entry entirely', () => {
  activateGroup(B, { name: 'Beta', activatedBy: 'admin@lid' });
  const gone = removeGroup(B);
  assert.ok(gone);
  assert.strictEqual(getGroup(B), null);
  assert.strictEqual(deactivateGroup(B), null);
});

test('a corrupt registry file degrades to empty instead of throwing', () => {
  fs.writeFileSync(tmpFile, '{ this is not json', 'utf8');
  const result = reload();
  assert.deepStrictEqual(result, {});
  assert.deepStrictEqual(getAllGroups(), []);
  assert.strictEqual(isGroupEnabled(A), false);
});

test('a non-object registry file degrades to empty', () => {
  fs.writeFileSync(tmpFile, '[1,2,3]', 'utf8');
  assert.deepStrictEqual(reload(), {});
});

test('the registry file is created on first use', () => {
  fs.rmSync(tmpFile, { force: true });
  reload();
  assert.ok(fs.existsSync(tmpFile), 'file auto-created');
  assert.deepStrictEqual(getAllGroups(), []);
});