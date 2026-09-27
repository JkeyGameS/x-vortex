// Backup & Restore (Phase 6).
export default {
  id: 'backup_restore',
  headingKey: 'menu.backup_restore.heading',
  headingEmoji: '💾',
  standaloneCommand: '/backup',
  aliases: ['/backuprestore'],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'admin_to_backup',
  footerKey: 'menu.backup_restore.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.backupRestore.title',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'admin_to_backup',
  sessionMenu: 'admin_backup',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.backup_restore.export', emoji: '📤', action: 'custom:backup_export', fallbackKey: 'admin.backupRestore.optionBackup' },
    { number: '2', labelKey: 'menu.backup_restore.import', emoji: '📥', action: 'custom:backup_import', fallbackKey: 'admin.backupRestore.optionRestore' },
    { number: '3', labelKey: 'menu.backup_restore.view', emoji: null, action: 'custom:backup_view', fallbackKey: 'admin.optionExports' }
  ]
};
