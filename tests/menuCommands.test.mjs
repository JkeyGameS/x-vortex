// Phase 2 test harness: auto-registration of standalone menu commands,
// conflict handling (manual wins), and execute() delegation to sendMenuById.
import { registerMenu, unregisterMenu } from '../src/config/menus/registry.js';
import { buildMenuCommands } from '../src/handlers/menuCommandLoader.js';
import { loadCommands } from '../src/handlers/commandHandler.js';

const sent = [];
const sock = {
  sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'x' } }; },
  sendPresenceUpdate: async () => {},
  readMessages: async () => true
};

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 200) : ''));
  if (!cond) fails++;
}

const dummy = {
  id: 'test_menu_cmd',
  headingKey: 'menu.test.heading',
  headingEmoji: '🧪',
  standaloneCommand: '/menutestdummy',
  aliases: ['/mtd'],
  parent: 'main_menu',
  backTo: 'main_menu',
  adminOnly: true,
  groupAllowed: false,
  options: [
    { number: '1', labelKey: 'menu.test.option1', emoji: '①', action: 'open:profile' }
  ]
};
registerMenu(dummy);

// 1. buildMenuCommands picks it up
const { commands, skipped } = buildMenuCommands();
const cmd = commands.find((c) => c.name === 'menutestdummy');
check('command named menutestdummy exists', !!cmd);
check('aliases include mtd', !!cmd && cmd.aliases.includes('mtd'), JSON.stringify(cmd?.aliases));
check('adminOnly from definition', !!cmd && cmd.adminOnly === true);
check('groupAllowed from definition', !!cmd && cmd.groupAllowed === false);
check('usage keeps slash', !!cmd && cmd.usage === '/menutestdummy');
check('nothing malformed skipped', skipped.length === 0, JSON.stringify(skipped));

// 2. execute() renders + sends via sendMenuById
sent.length = 0;
const res = await cmd.execute({ sock, sender: '100000000000000@lid', chatId: '100000000000000@lid', pushName: 'T' });
check('execute succeeds', res && res.success === true, JSON.stringify(res));
check('execute sent the menu', sent.some((s) => s.content && typeof s.content.text === 'string' && s.content.text.startsWith('> *🧪')));

// 3. conflict: manual command wins through the real loader
const clash = {
  id: 'clash_menu',
  headingKey: 'menu.test.heading',
  standaloneCommand: '/start',
  parent: null,
  backTo: null,
  options: [{ number: '1', labelKey: 'menu.test.option1', action: 'open:profile' }]
};
registerMenu(clash);
const { commands: cmds2 } = buildMenuCommands();
check('clashing definition still builds (loader decides)', cmds2.some((c) => c.name === 'start'));
const map = await loadCommands();
const startCmd = map.get('start');
check('manual /start preserved', !!startCmd && !startCmd.menuId, startCmd?.menuId);
check('generated /menutestdummy registered', map.get('menutestdummy')?.menuId === 'test_menu_cmd', map.get('menutestdummy')?.menuId);
check('alias /mtd registered', map.get('mtd')?.menuId === 'test_menu_cmd');
// Manual alias wins over a generated name: /test is aliased as 'testmenu' manually.
check('manual alias testmenu untouched', map.get('testmenu')?.name === 'test', map.get('testmenu')?.name);

// 4. menu without standaloneCommand is ignored
registerMenu({
  id: 'plain_menu',
  headingKey: 'menu.test.heading',
  parent: null,
  backTo: null,
  options: [{ number: '1', labelKey: 'menu.test.option1', action: 'open:profile' }]
});
const { commands: cmds3 } = buildMenuCommands();
check('plain menu ignored', !cmds3.some((c) => c.menuId === 'plain_menu'));

unregisterMenu('test_menu_cmd');
unregisterMenu('clash_menu');
unregisterMenu('plain_menu');

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
