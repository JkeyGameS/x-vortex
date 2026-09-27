// FAQ Knowledge Base main menu (Phase 7). All targets stay on existing
// builders/flows via custom re-dispatch.
export default {
  id: 'faq',
  headingKey: 'menu.faq.heading',
  headingEmoji: '📚',
  standaloneCommand: '/faq',
  aliases: [],
  parent: 'chat_faq',
  backTo: 'chat_faq',
  footerKey: 'menu.faq.footer',
  footerItalic: false,
  fallbackHeadingKey: 'faq.mainTitle',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'faq_main',
  sessionMenu: 'faq_main',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.faq.add', emoji: '➕', action: 'custom:faq_add', fallbackKey: 'faq.mainAdd' },
    { number: '2', labelKey: 'menu.faq.view', emoji: '📋', action: 'custom:faq_view', fallbackKey: 'faq.mainView' },
    { number: '3', labelKey: 'menu.faq.manage', emoji: '✏️', action: 'custom:faq_manage', fallbackKey: 'faq.mainManage' },
    { number: '4', labelKey: 'menu.faq.search', emoji: '🔍', action: 'custom:faq_search', fallbackKey: 'faq.mainSearch' },
    { number: '5', labelKey: 'menu.faq.import_export', emoji: '📦', action: 'custom:faq_impexport', fallbackKey: 'faq.mainImportExport' },
    { number: '6', labelKey: 'menu.faq.stats', emoji: '📊', action: 'custom:faq_stats', fallbackKey: 'faq.mainStats' }
  ]
};
