// System Settings (Phase 6). All emojis inline in legacy keys; children
// stay on existing builders via re-dispatch custom actions.
const OPTS = [
  // [number, newKey, action, oldKey, emoji]
  ['1', 'general', 'custom:sys_general', 'admin.systemSettings.optionGeneral', '🛠️'],
  ['2', 'admin_access', 'custom:sys_admin_access', 'admin.systemSettings.optionAdminAccess', '🔐'],
  ['3', 'feature_flags', 'custom:sys_feature_flags', 'admin.systemSettings.optionFeatureFlags', '🧩'],
  ['4', 'notifications', 'custom:sys_notifications', 'admin.systemSettings.optionNotifications', '📢'],
  ['5', 'conversation', 'custom:sys_conversation', 'admin.systemSettings.optionConversation', '💬'],
  ['6', 'updates', 'custom:sys_updates', 'admin.systemSettings.optionUpdates', '📡'],
  ['7', 'data', 'custom:sys_data', 'admin.systemSettings.optionDataManagement', '🧹'],
  ['8', 'logs', 'custom:sys_logs', 'admin.systemSettings.optionLogs', '❗']
];

export default {
  id: 'system_settings',
  headingKey: 'menu.system_settings.heading',
  headingEmoji: '⚙️',
  standaloneCommand: '/syssettings',
  aliases: ['/sysset'],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'system_settings',
  footerKey: 'menu.system_settings.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.systemSettings.title',
  fallbackFooterKey: 'admin.systemSettings.replyPrompt',
  transitionKey: 'system_settings',
  sessionMenu: 'system_settings',
  adminOnly: true,
  options: OPTS.map(([number, key, action, oldKey, emoji]) => ({
    number, labelKey: `menu.system_settings.${key}`, emoji, action, fallbackKey: oldKey
  }))
};
