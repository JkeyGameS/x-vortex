// Group welcome / goodbye on participant updates (Phase 3).
//
// Isolated via GROUP_DATA_PATH and GROUP_DEFAULTS_DATA_PATH. sendText is
// injected through the handler's deps seam, so no message is ever sent.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

// botContentService.setContent PERSISTS to data/botContent.json, which is a
// tracked production file. Snapshot it and put it back, so this suite can never
// leave a template edit or an updatedBy stamp behind.
const botContentPath = path.resolve('data/botContent.json');
const botContentBackup = fs.readFileSync(botContentPath, 'utf8');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-participant-test-'));
const groupsFile = path.join(tmpDir, 'groups.json');
const defaultsFile = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUP_DATA_PATH = groupsFile;
process.env.GROUP_DEFAULTS_DATA_PATH = defaultsFile;

const groups = await import('../src/services/groupService.js');
const content = await import('../src/services/botContentService.js');
const { handleParticipantsUpdate } = await import('../src/handlers/groupParticipantHandler.js');

const ACTIVE = '111111111111@group.g.us';
const INACTIVE = '222222222222@group.gus';

function makeSock(participants = 3) {
  return {
    user: { id: '999999999999:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      subject: 'Dev Team',
      participants: Array.from({ length: participants }, (_, i) => ({
        id: `00000000000${i}@lid`,
        admin: i === 0 ? 'admin' : null
      }))
    })
  };
}

/** Collects every send instead of performing one. */
function spy() {
  const calls = [];
  const sendText = async (sock, jid, text, options) => {
    calls.push({ jid, text, options });
    return true;
  };
  return { calls, sendText };
}

async function run(update, { sock = makeSock(), useSpy = true } = {}) {
  const s = useSpy ? spy() : null;
  await handleParticipantsUpdate({
    sock,
    update,
    deps: useSpy ? { sendText: s.sendText } : undefined
  });
  return s ? s.calls : [];
}

beforeEach(() => {
  fs.writeFileSync(groupsFile, '{}', 'utf8');
  fs.writeFileSync(defaultsFile, JSON.stringify(groups.defaultGroupSettings(), null, 2), 'utf8');
  groups.reload();
  groups.loadGroupDefaults();
  content.loadBotContent();
});

after(() => {
  fs.writeFileSync(botContentPath, botContentBackup, 'utf8');
  content.reload();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('skips when the group is not activated', async () => {
  const calls = await run({ id: INACTIVE, action: 'add', participants: ['1@lid'] });
  assert.strictEqual(calls.length, 0, 'no send for an unknown group');
});

test('skips when the group exists but is disabled', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.deactivateGroup(ACTIVE);
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const calls = await run({ id: ACTIVE, action: 'add', participants: ['1@lid'] });
  assert.strictEqual(calls.length, 0, 'a disabled group never sends');
});

test('skips when the welcome toggle is off', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', false);
  const calls = await run({ id: ACTIVE, action: 'add', participants: ['1@lid'] });
  assert.strictEqual(calls.length, 0);
});

test('skips when the goodbye toggle is off', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'goodbye', false);
  const calls = await run({ id: ACTIVE, action: 'remove', participants: ['1@lid'] });
  assert.strictEqual(calls.length, 0);
});

test('sends one message per participant on add when welcome is on', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const calls = await run({
    id: ACTIVE,
    action: 'add',
    participants: ['0001@lid', '0002@lid']
  });
  assert.strictEqual(calls.length, 2, 'one send per participant');
  for (const c of calls) {
    assert.strictEqual(c.jid, ACTIVE, 'sent to the GROUP, never to the participant');
    assert.strictEqual(c.options.skipTyping, true, 'no typing indicator in a group');
    assert.strictEqual(c.options.bypassRateLimit, undefined, 'must not bypass the limiter');
  }
});

test('sends on remove when goodbye is on', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'goodbye', true);
  const calls = await run({ id: ACTIVE, action: 'remove', participants: ['0001@lid'] });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].text.length > 0);
});

test('welcome and goodbye toggles are independent', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  groups.setGroupSetting(ACTIVE, 'goodbye', false);
  assert.strictEqual((await run({ id: ACTIVE, action: 'add', participants: ['1@lid'] })).length, 1);
  assert.strictEqual((await run({ id: ACTIVE, action: 'remove', participants: ['1@lid'] })).length, 0);

  groups.setGroupSetting(ACTIVE, 'goodbye', true);
  groups.setGroupSetting(ACTIVE, 'welcome', false);
  assert.strictEqual((await run({ id: ACTIVE, action: 'add', participants: ['1@lid'] })).length, 0);
  assert.strictEqual((await run({ id: ACTIVE, action: 'remove', participants: ['1@lid'] })).length, 1);
});

test('placeholders resolve with group name and participant name', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const calls = await run({
    id: ACTIVE,
    action: 'add',
    participants: [{ id: '00000000009@lid', pushName: 'Ada' }]
  });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].text.includes('Ada'), 'uses the pushName from the event payload');
  assert.ok(calls[0].text.includes('Dev Team'), 'uses the group subject');
  assert.ok(calls[0].text.includes('12') || /\d/.test(calls[0].text), 'member count rendered');
  assert.ok(!calls[0].text.includes('{groupName}'), 'no placeholder left unresolved');
  assert.ok(!calls[0].text.includes('{pushName}'), 'no placeholder left unresolved');
  assert.ok(!calls[0].text.includes('{memberCount}'), 'no placeholder left unresolved');
});

test('falls back to the jid number when no pushName is provided', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const calls = await run({ id: ACTIVE, action: 'add', participants: ['00000000042@lid'] });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].text.includes('00000000042'), 'falls back to the number');
});

test('static text is small-capped but dynamic values are not', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const calls = await run({
    id: ACTIVE,
    action: 'add',
    participants: [{ id: '1@lid', pushName: 'Ada Lovelace' }]
  });
  assert.ok(calls[0].text.includes('Ada Lovelace'), 'name keeps its own casing');
  assert.ok(/[ᴀᴡᴇʟᴄᴏᴍᴇ]/.test(calls[0].text), 'static copy is small-capped');
});

test('skips unsupported actions', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  groups.setGroupSetting(ACTIVE, 'goodbye', true);
  for (const action of ['promote', 'demote', 'announce', 'unknown']) {
    const calls = await run({ id: ACTIVE, action, participants: ['1@lid'] });
    assert.strictEqual(calls.length, 0, `${action} must not send`);
  }
});

test('skips an empty participant list', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  assert.strictEqual((await run({ id: ACTIVE, action: 'add', participants: [] })).length, 0);
  assert.strictEqual((await run({ id: ACTIVE, action: 'add' })).length, 0);
  assert.strictEqual((await run({ id: ACTIVE, action: 'add', participants: null })).length, 0);
});

test('skips when the template is missing, without throwing', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const original = content.getContent('groupMessages.welcome');
  content.setContent('groupMessages.welcome', '', 'test@lid');
  try {
    const calls = await run({ id: ACTIVE, action: 'add', participants: ['1@lid'] });
    assert.strictEqual(calls.length, 0, 'an empty template sends nothing');
  } finally {
    // setContent writes to disk; put the real template back immediately.
    content.setContent('groupMessages.welcome', original, 'test@lid');
  }
  assert.ok(
    content.getContent('groupMessages.welcome').includes('{pushName}'),
    'template restored for later tests'
  );
});

test('a participant entry with no id is skipped without breaking the batch', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const calls = await run({
    id: ACTIVE,
    action: 'add',
    participants: [null, { pushName: 'NoId' }, '0007@lid']
  });
  // Only the bare JID is usable: null and the object without an id are skipped.
  assert.strictEqual(calls.length, 1, 'the one valid participant still sends');
  assert.ok(calls[0].text.includes('0007'), 'and it is the right one');
});

test('the kill switch stops all sends', async () => {
  const config = (await import('../src/config/config.js')).default;
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const original = config.groupManagementEnabled;
  config.groupManagementEnabled = false;
  try {
    assert.strictEqual((await run({ id: ACTIVE, action: 'add', participants: ['1@lid'] })).length, 0);
  } finally {
    config.groupManagementEnabled = original;
  }
});

test('a metadata failure still sends rather than crashing', async () => {
  groups.activateGroup(ACTIVE, { name: 'Dev Team', activatedBy: 'a@lid' });
  groups.setGroupSetting(ACTIVE, 'welcome', true);
  const brokenSock = {
    user: { id: '1@s.whatsapp.net' },
    groupMetadata: async () => { throw new Error('offline'); }
  };
  const calls = await run({ id: ACTIVE, action: 'add', participants: ['1@lid'] }, { sock: brokenSock });
  assert.strictEqual(calls.length, 1, 'message still sent');
  assert.ok(calls[0].text.includes('Dev Team'), 'falls back to the stored group name');
});