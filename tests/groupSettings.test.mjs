// Per-group settings and the editable new-group defaults (Phase 2).
//
// Runs entirely against temporary files via GROUP_DATA_PATH and
// GROUP_DEFAULTS_DATA_PATH, so neither live data file is read or written.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-settings-test-'));
const groupsFile = path.join(tmpDir, 'groups.json');
const defaultsFile = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUP_DATA_PATH = groupsFile;
process.env.GROUP_DEFAULTS_DATA_PATH = defaultsFile;

const svc = await import('../src/services/groupService.js');
const {
  activateGroup,
  getGroup,
  getGroupSettings,
  setGroupSetting,
  getGroupDefaults,
  setGroupDefault,
  loadGroupDefaults,
  reload,
  EDITABLE_GROUP_DEFAULTS
} = svc;

const G = '999888777@group.g.us';
const OTHER = '555444333@group.gus';
const ALL_SEVEN = [
  'mentionOnly', 'chatRules', 'welcome', 'goodbye', 'antiSpam', 'antiLink', 'respondToCommands'
];

beforeEach(() => {
  fs.writeFileSync(groupsFile, '{}', 'utf8');
  fs.writeFileSync(defaultsFile, JSON.stringify(svc.defaultGroupSettings(), null, 2), 'utf8');
  reload();
  loadGroupDefaults();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('getGroupDefaults returns all seven keys', () => {
  const d = getGroupDefaults();
  for (const k of ALL_SEVEN) {
    assert.ok(k in d, `missing key ${k}`);
    assert.strictEqual(typeof d[k], 'boolean', `${k} should be boolean`);
  }
  assert.strictEqual(Object.keys(d).length, ALL_SEVEN.length);
});

test('getGroupDefaults returns a copy, not the cache', () => {
  const a = getGroupDefaults();
  a.mentionOnly = false;
  assert.strictEqual(getGroupDefaults().mentionOnly, true, 'cache not mutated by caller');
});

test('activateGroup seeds settings from the current defaults', () => {
  setGroupDefault('chatRules', true);
  setGroupDefault('antiLink', true);
  const g = activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  assert.strictEqual(g.settings.chatRules, true, 'inherits edited default');
  assert.strictEqual(g.settings.antiLink, true);
  assert.strictEqual(g.settings.mentionOnly, true, 'unedited default still applies');
});

test('setGroupDefault persists and is returned by getGroupDefaults', () => {
  setGroupDefault('chatRules', true);
  assert.strictEqual(getGroupDefaults().chatRules, true);
  const onDisk = JSON.parse(fs.readFileSync(defaultsFile, 'utf8'));
  assert.strictEqual(onDisk.chatRules, true, 'written to disk');
  // A fresh read must agree.
  loadGroupDefaults();
  assert.strictEqual(getGroupDefaults().chatRules, true);
});

test('setGroupDefault refuses a key outside the editable set', () => {
  assert.strictEqual(setGroupDefault('respondToCommands', false), null,
    'respondToCommands is implicit and must not be editable');
  assert.strictEqual(setGroupDefault('nonsense', true), null);
  assert.strictEqual(getGroupDefaults().respondToCommands, true, 'unchanged');
});

test('EDITABLE_GROUP_DEFAULTS is the six toggleable keys', () => {
  assert.deepStrictEqual(EDITABLE_GROUP_DEFAULTS, [
    'mentionOnly', 'chatRules', 'welcome', 'goodbye', 'antiSpam', 'antiLink'
  ]);
});

test('setGroupSetting changes only the target key', () => {
  activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  const before = { ...getGroupSettings(G) };
  const after = setGroupSetting(G, 'mentionOnly', false);
  assert.strictEqual(after.mentionOnly, false);
  for (const k of ALL_SEVEN.filter((x) => x !== 'mentionOnly')) {
    assert.strictEqual(after[k], before[k], `${k} must not change`);
  }
});

test('setGroupSetting persists to disk', () => {
  activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  setGroupSetting(G, 'antiLink', true);
  const raw = JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
  assert.strictEqual(raw[G].settings.antiLink, true, 'flag is on disk');
  reload();
  assert.strictEqual(getGroup(G).settings.antiLink, true, 'survives reload');
});

test('toggling a setting twice returns the original value', () => {
  activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  const start = getGroupSettings(G).antiSpam;
  setGroupSetting(G, 'antiSpam', !start);
  assert.strictEqual(getGroupSettings(G).antiSpam, !start);
  setGroupSetting(G, 'antiSpam', start);
  assert.strictEqual(getGroupSettings(G).antiSpam, start);
});

test('a defaults change does NOT overwrite an existing group settings', () => {
  activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  setGroupSetting(G, 'mentionOnly', false);
  // Flip the default, then re-activate the same group.
  setGroupDefault('mentionOnly', true);
  activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  assert.strictEqual(getGroupSettings(G).mentionOnly, false,
    'stored value must win over the new default');
});

test('a defaults change fills in keys the group was missing', () => {
  activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  // Simulate an entry written before a key existed.
  const g = getGroup(G);
  delete g.settings.antiLink;
  setGroupDefault('antiLink', true);
  activateGroup(G, { name: 'Alpha', activatedBy: 'admin@lid' });
  assert.strictEqual(getGroupSettings(G).antiLink, true,
    'missing key backfilled from the current default');
});

test('the defaults file is auto-created when absent', () => {
  fs.rmSync(defaultsFile, { force: true });
  const d = loadGroupDefaults();
  assert.ok(fs.existsSync(defaultsFile), 'file created');
  for (const k of ALL_SEVEN) assert.ok(k in d, `${k} present in the fresh default`);
});

test('a corrupt defaults file falls back to the built-in defaults', () => {
  fs.writeFileSync(defaultsFile, 'not json at all', 'utf8');
  const d = loadGroupDefaults();
  assert.deepStrictEqual(d, svc.defaultGroupSettings());
});

test('a partially written defaults file is completed from the defaults', () => {
  fs.writeFileSync(defaultsFile, JSON.stringify({ mentionOnly: false }), 'utf8');
  const d = loadGroupDefaults();
  assert.strictEqual(d.mentionOnly, false, 'stored value kept');
  assert.strictEqual(d.antiSpam, true, 'missing key filled from defaults');
});

test('defaults and per-group settings are independent files', () => {
  setGroupDefault('welcome', true);
  activateGroup(OTHER, { name: 'Beta', activatedBy: 'admin@lid' });
  setGroupSetting(OTHER, 'welcome', false);
  assert.strictEqual(getGroupSettings(OTHER).welcome, false, 'group overrides the default');
  assert.strictEqual(getGroupDefaults().welcome, true, 'default itself is unchanged');
});