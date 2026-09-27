// Quick Actions (Phase 6). Maintenance/notifications rows carry live state
// suffixes; perm locks mirror the legacy builder. Clicks re-dispatch.
const OPTS = [
  // [number, newKey, perm, action, oldKey, emoji, suffix]
  ['1', 'broadcast', 'broadcast', 'custom:quick_broadcast', 'admin.quick.broadcast', '📢', null],
  ['2', 'maintenance', 'settings', 'custom:quick_maintenance', 'admin.quick.maintenance', '🛠️', 'quickMaintenanceState'],
  ['3', 'purge_test', 'purge', 'custom:quick_purge_test', 'admin.quick.purge', '🧹', null],
  ['4', 'notifications', 'settings', 'custom:quick_admin_notifs', 'admin.quick.notifications', '🔔', 'quickNotifsState'],
  ['5', 'emergency', 'emergency', 'custom:quick_emergency', 'admin.quick.emergency', '🚨', null]
];

export default {
  id: 'quick_actions',
  headingKey: 'menu.quick_actions.heading',
  headingEmoji: '⚡',
  standaloneCommand: null,
  aliases: [],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'admin_quick_actions',
  footerKey: 'menu.quick_actions.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.quick.title',
  fallbackFooterKey: 'admin.systemSettings.replyPrompt',
  transitionKey: 'admin_quick_actions',
  sessionMenu: 'admin_quick_actions',
  adminOnly: true,
  options: OPTS.map(([number, key, perm, action, oldKey, emoji, suffix]) => {
    const opt = { number, labelKey: `menu.quick_actions.${key}`, emoji, action, dynamicSuffix: suffix || 'permLock', perm, fallbackKey: oldKey };
    return opt;
  })
};
