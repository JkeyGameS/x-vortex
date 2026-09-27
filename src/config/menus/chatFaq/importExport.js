// Import / Export menu (Phase 5). Options 1-6 keep inline emojis (legacy
// translation strings); 7-8 use code-concatenated emojis.
export default {
  id: 'chat_import_export',
  headingKey: 'menu.chat_import_export.heading',
  headingEmoji: '📦',
  standaloneCommand: null,
  aliases: [],
  parent: 'chat_faq',
  backTo: 'chat_faq',
  footerKey: 'menu.chat_import_export.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.chatFaq.importExportTitle',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'chat_import_export',
  sessionMenu: 'chat_import_export',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.chat_import_export.export_all', emoji: '📤', action: 'custom:ie_export_all', fallbackKey: 'admin.chatFaq.exportAll' },
    { number: '2', labelKey: 'menu.chat_import_export.import_all', emoji: '📥', action: 'custom:ie_import_all', fallbackKey: 'admin.chatFaq.importAll' },
    { number: '3', labelKey: 'menu.chat_import_export.export_chat', emoji: '📤', action: 'custom:ie_export_chat', fallbackKey: 'admin.chatFaq.exportChat' },
    { number: '4', labelKey: 'menu.chat_import_export.import_chat', emoji: '📥', action: 'custom:ie_import_chat', fallbackKey: 'admin.chatFaq.importChat' },
    { number: '5', labelKey: 'menu.chat_import_export.export_faq', emoji: '📤', action: 'custom:ie_export_faq', fallbackKey: 'admin.chatFaq.exportFaq' },
    { number: '6', labelKey: 'menu.chat_import_export.import_faq', emoji: '📥', action: 'custom:ie_import_faq', fallbackKey: 'admin.chatFaq.importFaq' },
    { number: '7', labelKey: 'menu.chat_import_export.export_analytics', emoji: '📤', action: 'custom:ie_export_analytics', fallbackKey: 'admin.chatFaq.exportAnalytics' },
    { number: '8', labelKey: 'menu.chat_import_export.import_analytics', emoji: '📥', action: 'custom:ie_import_analytics', fallbackKey: 'admin.chatFaq.importAnalytics' }
  ]
};
