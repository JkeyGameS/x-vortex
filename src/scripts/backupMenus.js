// Phase 0 safety net: snapshot current menu outputs so later migration
// phases can diff against them. Purely additive — calls existing builders
// with mock users, never touches live state.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(__dirname, '../../data/menuSnapshots');

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
  jid: '200000000000000@lid',
  name: 'Admin User',
  username: 'adminuser'
};

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function main() {
  const { buildMainMenu } = await import('../handlers/startCommand.js');
  const { buildAdminPanel, buildChatSettingsMenu, buildTestMenu, buildChatFaqMenu, buildChatFaqImportExport } = await import('../handlers/adminCommand.js');
  const { buildChatPanel } = await import('../handlers/chatCommand.js');
  const { renderMenu } = await import('../utils/menuRenderer.js');
  await import('../config/menus/index.js');

  const jobs = [
    { menuId: 'main_menu_regular', userType: 'regular', run: () => buildMainMenu('en', '@testuser', mockRegularUser) },
    { menuId: 'main_menu_admin', userType: 'admin', run: () => buildMainMenu('en', '@adminuser', mockAdminUser) },
    { menuId: 'admin_panel', userType: 'admin', run: () => buildAdminPanel('en', '', mockAdminUser.jid) },
    { menuId: 'chat_settings', userType: 'admin', run: () => buildChatSettingsMenu('en') },
    { menuId: 'test_menu', userType: 'admin', run: () => buildTestMenu('en') },
    { menuId: 'chat_panel', userType: 'admin', run: () => buildChatPanel('en') },
    { menuId: 'chat_faq', userType: 'admin', run: () => buildChatFaqMenu('en') },
    { menuId: 'chat_import_export', userType: 'admin', run: () => buildChatFaqImportExport('en') },
    { menuId: 'new_chat_faq', userType: 'admin', run: async () => (await renderMenu('chat_faq', mockAdminUser, 'en')).text },
    { menuId: 'new_chat_settings', userType: 'admin', run: async () => (await renderMenu('chat_settings', mockAdminUser, 'en')).text },
    { menuId: 'new_adminPanel', userType: 'admin', run: async () => (await renderMenu('adminPanel', mockAdminUser, 'en')).text },
    { menuId: 'new_user_management', userType: 'admin', run: async () => (await renderMenu('user_management', mockAdminUser, 'en')).text },
    { menuId: 'new_system_settings', userType: 'admin', run: async () => (await renderMenu('system_settings', mockAdminUser, 'en')).text },
    { menuId: 'new_broadcast', userType: 'admin', run: async () => (await renderMenu('broadcast', mockAdminUser, 'en')).text },
    { menuId: 'new_backup_restore', userType: 'admin', run: async () => (await renderMenu('backup_restore', mockAdminUser, 'en')).text },
    { menuId: 'new_logs', userType: 'admin', run: async () => (await renderMenu('logs', mockAdminUser, 'en')).text },
    { menuId: 'new_quick_actions', userType: 'admin', run: async () => (await renderMenu('quick_actions', mockAdminUser, 'en')).text },
    { menuId: 'new_scheduled_tasks', userType: 'admin', run: async () => (await renderMenu('scheduled_tasks', mockAdminUser, 'en')).text },
    { menuId: 'new_analytics', userType: 'admin', run: async () => (await renderMenu('analytics', mockAdminUser, 'en')).text },
    { menuId: 'new_admin_search', userType: 'admin', run: async () => (await renderMenu('admin_search', mockAdminUser, 'en')).text }
  ];

  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const at = stamp();
  let ok = 0;
  for (const job of jobs) {
    let text = null;
    let error = null;
    try {
      text = await job.run();
      if (typeof text !== 'string') throw new Error('builder did not return a string');
      ok++;
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    }
    const payload = {
      menuId: job.menuId,
      userType: job.userType,
      language: 'en',
      text,
      error,
      capturedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(SNAPSHOT_DIR, `${job.menuId}-${at}.json`), JSON.stringify(payload, null, 2));
    console.log(`${error ? 'FAIL' : 'OK  '} ${job.menuId}${error ? ' :: ' + error : ''}`);
  }
  console.log(`Captured ${ok}/${jobs.length} menus to data/menuSnapshots/`);
  process.exit(ok === jobs.length ? 0 : 1);
}

main().catch((err) => {
  console.error('backupMenus failed:', err);
  process.exit(1);
});
