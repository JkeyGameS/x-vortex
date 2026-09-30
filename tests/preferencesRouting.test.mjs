// Preferences menu routing (Profile -> Preferences).
//
// Regression guard for two defects where live options answered
// "This menu is unavailable right now":
//   * option 5 (Advanced Options) pointed at open:preferences_advanced, an id
//     with no registry definition, so runMenuAction rejected it at its registry
//     gate -- making the legacy sendMenuFn branch for it dead code;
//   * option 6 (Message Display) pointed at open:message_display, which IS
//     registered, but the profile cluster's sendMenuFn only knew two hardcoded
//     ids and threw for everything else.
//
// It also pins the required layout: Message Display at 5, Advanced Options last
// at 6, separated by a blank line.
//
// Backups and restores data/ so a failure cannot leave preferences changed, and
// never touches the network.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { getMenu } from '../src/config/menus/registry.js';
import { renderMenu, materializeDefinition, visibleMenuOptions } from '../src/utils/menuRenderer.js';
import { resolveMenuOption, runMenuAction, getMenuActionHandler } from '../src/utils/menuRouter.js';
import { profileCustomHandlers } from '../src/utils/menuCustomHandlers.js';
import { t } from '../src/services/localeService.js';
import { toSmallCaps } from '../src/utils/smallCaps.js';
import '../src/config/menus/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
const backupDir = path.join(os.tmpdir(), 'prefsRouting-data-backup');

fs.rmSync(backupDir, { recursive: true, force: true });
fs.cpSync(dataDir, backupDir, { recursive: true });
const restoreData = () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.cpSync(backupDir, dataDir, { recursive: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
};

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 300) : ''));
  if (!cond) fails++;
}

const sent = [];
const sock = {
  sendMessage: async (jid, content) => {
    sent.push(content);
    if (content?.delete) return;
    if (content?.edit) return { key: content.edit };
    return { key: { id: 'K' + sent.length } };
  },
  sendPresenceUpdate: async () => {},
  readMessages: async () => true
};

const user = {
  jid: '199999999999999@lid',
  name: 'Pref Test',
  username: 'preftest',
  language: 'en',
  preferences: { notifications: true, announcements: false },
  stats: { commandsUsed: 0, messagesSent: 0 }
};
const ctx = { sock, sender: user.jid, chatId: user.jid, pushName: user.name, user, language: 'en' };

// Compare against the real translated string: the notice is small-capped, so a
// plain substring test for "unavailable" would silently never match.
const UNAVAILABLE = toSmallCaps(t('en', 'common.menuUnavailable')).toLowerCase();
const lastText = () => String(sent[sent.length - 1]?.text || '').toLowerCase();

try {
  // -------------------------------------------------------------------------
  // 1. Option set and order
  // -------------------------------------------------------------------------
  const definition = materializeDefinition(getMenu('preferences'), user, 'en');
  const options = visibleMenuOptions(definition, user);
  check('preferences offers six options', options.length === 6, String(options.length));
  check('options are numbered 1..6', options.map((o) => String(o.number)).join(',') === '1,2,3,4,5,6', options.map((o) => o.number).join(','));

  const expected = [
    ['1', 'languageSelection'],
    ['2', 'notifications'],
    ['3', 'announcements'],
    ['4', 'typingIndicator'],
    ['5', null],
    ['6', null]
  ];
  for (const [number, featureId] of expected) {
    const opt = options.find((o) => String(o.number) === number);
    check('option ' + number + ' exists', !!opt);
    if (opt && featureId) check('option ' + number + ' is ' + featureId, opt.featureId === featureId, String(opt.featureId));
  }
  check('option 5 is Message Display', options.find((o) => String(o.number) === '5')?.labelKey === 'menu.message_display.heading', options.find((o) => String(o.number) === '5')?.labelKey);
  const advanced = options.find((o) => String(o.number) === '6');
  check('option 6 is Advanced Options', advanced?.labelKey === 'menu.preferences.advanced', advanced?.labelKey);
  check('option 6 is the last option', options[options.length - 1] === advanced);
  check('option 6 asks for a separator', advanced?.separatorBefore === true);
  check('no other option asks for a separator', options.filter((o) => o.separatorBefore || o.breakBefore).length === 1);

  // -------------------------------------------------------------------------
  // 2. Rendered layout: blank line between 5 and 6, back row after 6
  // -------------------------------------------------------------------------
  const rendered = await renderMenu('preferences', user, 'en', {});
  const lines = rendered.text.split('\n');
  const rowIndex = (n) => lines.findIndex((l) => l.trim().startsWith(n + '.'));
  check('a blank line separates option 5 from option 6', rowIndex('6') === rowIndex('5') + 2, '5 at ' + rowIndex('5') + ', 6 at ' + rowIndex('6'));
  check('back row follows Advanced Options', rowIndex('0') > rowIndex('6'), '0 at ' + rowIndex('0'));
  check('rendered option rows match the option set', rendered.options.length === options.length, rendered.options.length + ' vs ' + options.length);

  // -------------------------------------------------------------------------
  // 3. Every option action resolves
  // -------------------------------------------------------------------------
  for (const opt of options) {
    const action = String(opt.action || '');
    if (action.startsWith('open:')) {
      check('option ' + opt.number + ' open: target registered (' + action + ')', !!getMenu(action.slice(5)), 'no definition for ' + action);
    } else if (action.startsWith('custom:')) {
      const name = action.slice('custom:'.length);
      check('option ' + opt.number + ' custom handler wired (' + action + ')', typeof profileCustomHandlers[name] === 'function' || !!getMenuActionHandler(name), 'no handler for ' + action);
    } else {
      check('option ' + opt.number + ' uses a known action form', false, action);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Routing: no option may answer with the unavailable notice.
  //    The toggles (2, 3) are resolved but not executed so the test cannot
  //    rewrite real preferences.
  // -------------------------------------------------------------------------
  for (const input of ['1', '2', '3', '4', '5', '6']) {
    const r = resolveMenuOption('preferences', input, user, 'en');
    check('input ' + input + ' resolves to an action', r.kind === 'action', JSON.stringify(r));
    if (r.kind !== 'action') continue;
    if (input === '2' || input === '3') continue;
    sent.length = 0;
    // Same context shape index.js builds for the profile cluster.
    await runMenuAction(r.action, { ...ctx, handlers: profileCustomHandlers });
    check('input ' + input + ' does not answer "unavailable"', !lastText().includes(UNAVAILABLE), lastText().slice(0, 120));
    check('input ' + input + ' produces output', sent.length > 0);
  }

  const back = resolveMenuOption('preferences', '0', user, 'en');
  check('input 0 returns to profile', back.kind === 'back' && back.to === 'profile', JSON.stringify(back));

  const bad = resolveMenuOption('preferences', '7', user, 'en');
  check('input 7 is invalid with max 6', bad.kind === 'invalid' && String(bad.max) === '6', JSON.stringify(bad));

  // -------------------------------------------------------------------------
  // 5. Edit Profile had the same defect: its Advanced row pointed at
  //    open:edit_profile_advanced, which has no registry definition.
  // -------------------------------------------------------------------------
  const editDefinition = materializeDefinition(getMenu('edit_profile'), user, 'en');
  const editOptions = visibleMenuOptions(editDefinition, user);
  const editAdvanced = editOptions.find((o) => o.labelKey === 'menu.edit_profile.advanced');
  check('edit profile offers an Advanced row', !!editAdvanced, editOptions.map((o) => o.labelKey).join(','));
  if (editAdvanced) {
    check('edit profile Advanced is not an open: target', !String(editAdvanced.action).startsWith('open:'), String(editAdvanced.action));
    sent.length = 0;
    await runMenuAction(editAdvanced.action, { ...ctx, handlers: profileCustomHandlers });
    check('edit profile Advanced does not answer "unavailable"', !lastText().includes(UNAVAILABLE), lastText().slice(0, 120));
    check('edit profile Advanced produces output', sent.length > 0);
  }
  for (const opt of editOptions) {
    const action = String(opt.action || '');
    if (action.startsWith('open:')) {
      check('edit profile option ' + opt.number + ' open: target registered (' + action + ')', !!getMenu(action.slice(5)), 'no definition for ' + action);
    } else if (action.startsWith('custom:')) {
      const name = action.slice('custom:'.length);
      check('edit profile option ' + opt.number + ' custom handler wired (' + action + ')', typeof profileCustomHandlers[name] === 'function' || !!getMenuActionHandler(name), 'no handler for ' + action);
    }
  }
} finally {
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);