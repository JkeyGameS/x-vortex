// Phase 1 test harness: exercises renderer, router, markers, registry.
// No live flow calls these primitives; safe to run anytime.
import { registerMenu, getMenu, findMenuByCommand, unregisterMenu } from '../src/config/menus/registry.js';
import { validateMenuDefinition } from '../src/config/menus/schema.js';
import { renderMenu } from '../src/utils/menuRenderer.js';
import { resolveMenuOption, runMenuAction, registerMenuActionHandler } from '../src/utils/menuRouter.js';
import { getOptionMarker, isOptionAvailable } from '../src/utils/menuFeatureMarkers.js';

const mockRegularUser = {
  jid: '100000000000000@lid',
  name: 'Test User',
  username: 'testuser',
  language: 'en',
  preferences: { replyStyle: 'friendly' },
  stats: { commandsUsed: 0, messagesSent: 0 }
};

const mockAdminUser = {
  ...mockRegularUser,
  jid: '127531067904055@lid',
  name: 'Admin User',
  username: 'adminuser'
};

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 200) : ''));
  if (!cond) fails++;
}

const testMenu = {
  id: 'test_menu',
  headingKey: 'menu.test.heading',
  headingEmoji: '🧪',
  standaloneCommand: '/testmenu',
  aliases: ['/tm'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.replyPrompt',
  options: [
    { number: '1', labelKey: 'menu.test.option1', emoji: '①', action: 'open:profile' },
    { number: '2', labelKey: 'menu.test.option2', emoji: '②', action: 'custom:sayHello' },
    { number: 'A', labelKey: 'menu.test.admin', emoji: '🛡️', action: 'open:adminPanel', adminOnly: true }
  ]
};

// validator rejects garbage
let threw = false;
try {
  validateMenuDefinition({ id: 'bad' });
} catch {
  threw = true;
}
check('validator rejects malformed def', threw);

registerMenu(testMenu);
check('registered', !!getMenu('test_menu'));
check('find by command', findMenuByCommand('/testmenu')?.id === 'test_menu');
check('find by alias', findMenuByCommand('tm')?.id === 'test_menu');

// render regular (admin option hidden)
const reg = await renderMenu('test_menu', mockRegularUser, 'en');
console.log('--- regular render ---');
console.log(reg.text);
console.log('----------------------');
check('regular sees 2 options', reg.options.length === 2, reg.options.length);
check('back row present', reg.text.includes('0. ') && reg.text.includes('ʙᴀᴄᴋ'));
const footerLine = reg.text.split('\n').filter((l) => l.trim()).slice(-1)[0] || '';
check('footer present (italic-wrapped fallback, no translation edits)', footerLine.startsWith('_') && footerLine.endsWith('_'), footerLine);
check('heading format', reg.text.startsWith('> *🧪 '));

// render admin (admin option visible)
const adm = await renderMenu('test_menu', mockAdminUser, 'en');
check('admin sees 3 options', adm.options.length === 3, adm.options.length);

// router
let r = resolveMenuOption('test_menu', '1', mockRegularUser);
check('resolve 1 → open:profile', r.kind === 'action' && r.action === 'open:profile', JSON.stringify(r));
r = resolveMenuOption('test_menu', 'A', mockRegularUser);
check('resolve A regular → invalid', r.kind === 'invalid', JSON.stringify(r));
r = resolveMenuOption('test_menu', 'a', mockAdminUser);
check('resolve a admin → open:adminPanel', r.kind === 'action' && r.action === 'open:adminPanel', JSON.stringify(r));
r = resolveMenuOption('test_menu', '0', mockRegularUser);
check('resolve 0 → back', r.kind === 'back' && r.to === 'main_menu', JSON.stringify(r));
r = resolveMenuOption('test_menu', '9', mockRegularUser);
check('resolve 9 → invalid+max', r.kind === 'invalid' && r.max === '2', JSON.stringify(r));
r = resolveMenuOption('nope', '1', mockRegularUser);
check('unknown menu → error', r.kind === 'error' && r.reason === 'menu_not_found', JSON.stringify(r));

// transition engine
const opened = [];
const sendMenuFn = async (menuId) => { opened.push(menuId); return true; };
await runMenuAction('open:profile', { sendMenuFn });
check('open: delegates to sendMenuFn', opened[0] === 'profile', opened.join(','));
registerMenuActionHandler('sayHello', async () => 'hello');
check('custom handler runs', (await runMenuAction('custom:sayHello', {})) === 'hello');
let sleepThrew = false;
try {
  await runMenuAction('sleep', {});
} catch {
  sleepThrew = true;
}
check('sleep without handler throws (wired Phase 3+)', sleepThrew);

// markers (no live dependency beyond the feature registry)
check('marker none without featureId', getOptionMarker(undefined) === '' && getOptionMarker(null) === '');
check('available without featureId', isOptionAvailable(undefined) === true);
check('unknown feature safe', getOptionMarker('no_such_feature_xyz') === '' && isOptionAvailable('no_such_feature_xyz') === false);

unregisterMenu('test_menu');
check('unregistered', getMenu('test_menu') === null);

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
