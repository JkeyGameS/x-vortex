/**
 * Refresh menu/typing defaults for existing installs.
 *
 * Why this exists: the global message display default moved from 'hybrid'
 * (the sentinel that left every transition on its own legacy edit/delete
 * behavior) to 'send_new'. Any user who had pinned preferences.messageDisplayMode
 * would keep their old mode forever, because a user override always beats the
 * global default in resolveMessageMode(). Same story for preferences.typing.
 *
 * The fix is to null both preferences so every user inherits the new defaults.
 * Null means "use the global default" -- nothing else about the user record is
 * touched.
 *
 * Safe to re-run: it only ever writes null over a non-null value, so a second
 * run is a no-op. Snapshots are taken first and the newest 5 of each kind are
 * kept.
 *
 * Usage:  node scripts/refreshMenuDefaults.js [--dry-run]
 *
 * MENU_DEFAULTS_DATA_DIR overrides the data directory. Production never sets it;
 * it exists so the test suite can exercise the migration against a temp copy
 * instead of the real data/users.json.
 *
 * Note: this rewrites real user data in data/users.json. It is deliberately
 * NOT staged for git -- the runtime applies the new defaults on deploy.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.MENU_DEFAULTS_DATA_DIR
  ? path.resolve(process.env.MENU_DEFAULTS_DATA_DIR)
  : path.join(ROOT, 'data');
// A dedicated subdirectory, and a filename prefix that is NOT "botContent-".
// botContentService.listSnapshots() scans data/snapshots non-recursively and
// keeps every file matching `botContent-*.json`, so writing a snapshot here
// under a botContent- prefix would inject foreign files into the admin
// snapshot list and push real ones past MAX_SNAPSHOTS.
const SNAP_DIR = path.join(DATA_DIR, 'snapshots', 'menu-defaults');

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const MESSAGE_SETTINGS_PATH = path.join(DATA_DIR, 'messageSettings.json');
const BOT_CONTENT_PATH = path.join(DATA_DIR, 'botContent.json');

const KEEP_SNAPSHOTS = 5;
const DRY_RUN = process.argv.includes('--dry-run');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** Plural-key convention used by botContent.timing (NOT typingSettings.json). */
const BOT_CONTENT_TARGETING = {
  mainMenu: false,
  submenuTransitions: false,
  chatReplies: true,
  confirmations: false,
  errors: false
};

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`  ! skipped ${path.basename(file)}: ${err.message}`);
    return null;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Snapshot a file, then trim that kind down to KEEP_SNAPSHOTS. */
function snapshot(file, kind) {
  if (!fs.existsSync(file)) return null;
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
  const target = path.join(SNAP_DIR, `menuDefaults-${kind}-pre-refresh-${stamp()}.json`);
  fs.copyFileSync(file, target);
  const prefix = `menuDefaults-${kind}-pre-refresh-`;
  const kept = fs
    .readdirSync(SNAP_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .slice(-KEEP_SNAPSHOTS);
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (f.startsWith(prefix) && !kept.includes(f)) {
      fs.rmSync(path.join(SNAP_DIR, f), { force: true });
    }
  }
  return target;
}

function refreshUsers() {
  const users = readJson(USERS_PATH);
  if (!users) return { users: 0, messageDisplayMode: 0, typing: 0, touched: [] };

  let modeResets = 0;
  let typingResets = 0;
  const touched = [];

  for (const jid of Object.keys(users)) {
    const prefs = users[jid]?.preferences;
    if (!prefs) continue;
    let hit = false;

    // Any non-null value is an override that would shadow the new default.
    if (prefs.messageDisplayMode !== undefined && prefs.messageDisplayMode !== null) {
      prefs.messageDisplayMode = null;
      modeResets++;
      hit = true;
    }
    if (prefs.typing !== undefined && prefs.typing !== null) {
      prefs.typing = null;
      typingResets++;
      hit = true;
    }
    if (hit) touched.push(jid);
  }

  if (touched.length && !DRY_RUN) writeJson(USERS_PATH, users);
  return { users: touched.length, messageDisplayMode: modeResets, typing: typingResets, touched };
}

function refreshMessageSettings() {
  const settings = readJson(MESSAGE_SETTINGS_PATH);
  if (!settings) return { changed: false, reason: 'missing' };
  const before = settings.defaultMode;
  settings.defaultMode = 'send_new';
  if (before !== 'send_new' && !DRY_RUN) writeJson(MESSAGE_SETTINGS_PATH, settings);
  return { changed: before !== 'send_new', from: before, to: 'send_new' };
}

function refreshBotContent() {
  const content = readJson(BOT_CONTENT_PATH);
  if (!content) return { changed: false, reason: 'missing' };
  if (!content.timing || typeof content.timing !== 'object') {
    return { changed: false, reason: 'no timing section' };
  }
  const before = JSON.stringify(content.timing.typingTargeting);
  content.timing.typingIndicatorEnabled = true;
  content.timing.typingTargeting = { ...BOT_CONTENT_TARGETING };
  const after = JSON.stringify(content.timing.typingTargeting);
  if (before !== after && !DRY_RUN) writeJson(BOT_CONTENT_PATH, content);
  return { changed: before !== after, targeting: content.timing.typingTargeting };
}

console.log(`refreshMenuDefaults${DRY_RUN ? ' (dry run, nothing written)' : ''}`);
console.log('');
console.log('Snapshots:');
for (const [file, kind] of [
  [USERS_PATH, 'users'],
  [MESSAGE_SETTINGS_PATH, 'messageSettings'],
  [BOT_CONTENT_PATH, 'botContent']
]) {
  const s = DRY_RUN ? '(dry run)' : snapshot(file, kind) || 'skipped';
  console.log(`  ${kind}: ${s}`);
}

const users = refreshUsers();
const msg = refreshMessageSettings();
const content = refreshBotContent();

console.log('');
console.log('Users reset:');
console.log(`  users touched                 : ${users.users}`);
console.log(`  preferences.messageDisplayMode : ${users.messageDisplayMode}`);
console.log(`  preferences.typing             : ${users.typing}`);
if (users.touched.length) console.log(`  jids: ${users.touched.join(', ')}`);
console.log('');
console.log('Settings:');
console.log(`  messageSettings.defaultMode    : ${msg.from} -> ${msg.to}`);
console.log(`  botContent.timing.typingTargeting: ${JSON.stringify(content.targeting)}`);
console.log('');
console.log('Done.');