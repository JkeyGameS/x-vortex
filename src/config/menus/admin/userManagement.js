// User Management (Phase 6). Live counts come from the userMgmtSummary
// resolver (verbatim copy); flows stay on existing handlers via re-dispatch.
const OPTS = [
  // [number, newKey, emoji, action, oldKey]
  ['1', 'search', '🔍', 'custom:users_search', 'admin.userManagement.search'],
  ['2', 'list', '📄', 'custom:users_list', 'admin.userManagement.list'],
  ['3', 'delete', '❌', 'custom:users_delete', 'admin.userManagement.delete'],
  ['4', 'block', '⛔', 'custom:users_block', 'admin.userManagement.block'],
  ['5', 'unblock', '✅', 'custom:users_unblock', 'admin.userManagement.unblock'],
  ['6', 'list_blocked', '📋', 'custom:users_list_blocked', 'admin.userManagement.listBlocked'],
  ['7', 'purge_test', '🗑️', 'custom:users_purge_test', 'admin.userManagement.purge'],
  ['8', 'advanced', '🔧', 'custom:users_advanced', 'admin.userManagement.advanced'],
  ['9', 'bulk', '👥', 'custom:users_bulk', 'admin.userManagement.bulk'],
  ['10', 'segments', '🎯', 'custom:users_segments', 'admin.userManagement.segments']
];

export default {
  id: 'user_management',
  headingKey: 'menu.user_management.heading',
  headingEmoji: '👥',
  standaloneCommand: '/users',
  aliases: ['/um'],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'admin_to_users',
  footerKey: null,
  fallbackHeadingKey: 'admin.userManagement.title',
  fallbackFooterKey: 'admin.replyPrompt',
  summaryResolver: 'userMgmtSummary',
  transitionKey: 'admin_to_users',
  sessionMenu: 'admin_users',
  adminOnly: true,
  options: OPTS.map(([number, key, emoji, action, oldKey]) => ({
    number, labelKey: `menu.user_management.${key}`, emoji, action, fallbackKey: oldKey
  }))
};
