// Logs menu (Phase 6). Lives under System Settings. Note: the live sender
// is sendLogsPanel (state 'logs'), not sendAdminLogsMenu ('admin_logs').
export default {
  id: 'logs',
  headingKey: 'menu.logs.heading',
  headingEmoji: '❗',
  standaloneCommand: '/logs',
  aliases: [],
  parent: 'system_settings',
  backTo: 'system_settings',
  footerKey: 'menu.logs.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.systemSettings.logsTitle',
  fallbackFooterKey: 'admin.systemSettings.replyPrompt',
  transitionKey: 'system_logs',
  sessionMenu: 'logs',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.logs.admin_log', emoji: null, action: 'custom:logs_admin', fallbackKey: 'admin.logs.adminLog' },
    { number: '2', labelKey: 'menu.logs.error_log', emoji: null, action: 'custom:logs_error', fallbackKey: 'admin.logs.errorLog' }
  ]
};
