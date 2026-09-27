// Admin Panel (Phase 6). Dashboard + activity feed come from the
// adminDashboard resolver (verbatim copy of the legacy body framing).
// Options carry perm + permLock suffix (legacy 🔒 behavior); click-time
// gates stay in the legacy reply handler via re-dispatch custom actions.
const OPTS = [
  // [number, newKey, perm, action, oldKey, emoji]
  ['1', 'quick_actions', 'quick', 'custom:admin_opt_quick', 'admin.optionQuickActions', '⚡'],
  ['2', 'view_stats', 'stats.view', 'custom:admin_opt_stats', 'admin.optionStats', '📊'],
  ['3', 'broadcast', 'broadcast', 'custom:admin_opt_broadcast', 'admin.optionBroadcast', '📢'],
  ['4', 'users', 'users.manage', 'custom:admin_opt_users', 'admin.optionUserManagement', '👥'],
  ['5', 'system', 'settings', 'custom:admin_opt_system', 'admin.optionSettings', '⚙️'],
  ['6', 'chat_faq', 'chatfaq', 'custom:admin_opt_chatfaq', 'admin.optionChatFaq', '💬'],
  ['7', 'backup', 'backup', 'custom:admin_opt_backup', 'admin.optionBackupRestore', '📦'],
  ['8', 'feedback', 'feedback.reply', 'custom:admin_opt_feedback', 'admin.optionFeedbackManagement', '📮'],
  ['9', 'test', 'test', 'custom:admin_opt_test', 'admin.optionTest', '🧪'],
  ['10', 'analytics', 'stats.view', 'custom:admin_opt_analytics', 'admin.optionAnalytics', null],
  ['11', 'search', 'search', 'custom:admin_opt_search', 'admin.optionSearch', '🔍'],
  ['12', 'scheduled', 'scheduled.view', 'custom:admin_opt_scheduled', 'admin.optionScheduled', '📅'],
  ['13', 'help', null, 'custom:admin_opt_help', 'menuHelp.option', '❓']
];

export default {
  id: 'adminPanel',
  headingKey: 'menu.admin.heading',
  headingEmoji: null,
  standaloneCommand: '/admin',
  aliases: ['/panel'],
  parent: null,
  backTo: 'main_menu',
  transitionKey: 'admin_panel',
  footerKey: 'menu.admin.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.title',
  fallbackFooterKey: 'admin.replyPrompt',
  dashboardResolver: 'adminDashboard',
  transitionKey: 'admin_panel',
  sessionMenu: 'admin',
  adminOnly: true,
  options: OPTS.map(([number, key, perm, action, oldKey, emoji]) => {
    const opt = { number, labelKey: `menu.admin.${key}`, emoji, action, dynamicSuffix: 'permLock', fallbackKey: oldKey };
    if (perm) opt.perm = perm;
    return opt;
  })
};
