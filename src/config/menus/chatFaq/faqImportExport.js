// FAQ Import/Export submenu (Phase 7).
export default {
  id: 'faq_import_export',
  headingKey: 'menu.faq_import_export.heading',
  headingEmoji: '📦',
  standaloneCommand: null,
  aliases: [],
  parent: 'faq',
  backTo: 'faq',
  footerKey: 'menu.faq_import_export.footer',
  footerItalic: false,
  fallbackHeadingKey: 'faq.ieMenuTitle',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'faq_import_export',
  sessionMenu: 'faq_import_export',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.faq_import_export.export_json', emoji: '📤', action: 'custom:faq_ie_export', fallbackKey: 'faq.ieExportJson' },
    { number: '2', labelKey: 'menu.faq_import_export.import_json', emoji: '📥', action: 'custom:faq_ie_import', fallbackKey: 'faq.ieImportJson' },
    { number: '3', labelKey: 'menu.faq_import_export.import_csv', emoji: '📥', action: 'custom:faq_ie_csv', fallbackKey: 'faq.ieImportCsv' },
    { number: '4', labelKey: 'menu.faq_import_export.snapshots', emoji: '💾', action: 'custom:faq_ie_snapshots', fallbackKey: 'faq.ieSnapshots' }
  ]
};
