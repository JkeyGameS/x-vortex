// Chat Responses main menu (Phase 5). All targets are unmigrated builders
// (lists/wizards), so every option delegates through custom: handlers.
export default {
  id: 'chat_responses',
  headingKey: 'menu.chat_responses.heading',
  headingEmoji: null,
  standaloneCommand: '/chatresponses',
  aliases: ['/cr'],
  parent: 'chat_faq',
  backTo: 'chat_faq',
  footerKey: 'menu.chat_responses.footer',
  footerItalic: false,
  fallbackHeadingKey: 'chatResponses.title',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'chat_submenu',
  sessionMenu: 'chat_responses_main',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.chat_responses.add', emoji: '➕', action: 'custom:resp_add', fallbackKey: 'chatResponses.groupAddRule' },
    { number: '2', labelKey: 'menu.chat_responses.view', emoji: '📋', action: 'custom:resp_view', fallbackKey: 'chatResponses.groupViewRules' },
    { number: '3', labelKey: 'menu.chat_responses.manage', emoji: '✏️', action: 'custom:resp_manage', fallbackKey: 'chatResponses.groupManageRules' },
    { number: '4', labelKey: 'menu.chat_responses.search', emoji: '🔍', action: 'custom:resp_search', fallbackKey: 'chatResponses.groupSearch' },
    { number: '5', labelKey: 'menu.chat_responses.import_export', emoji: '📦', action: 'custom:resp_impexport', fallbackKey: 'chatResponses.groupImportExport' },
    { number: '6', labelKey: 'menu.chat_responses.stats', emoji: '📊', action: 'custom:resp_stats', fallbackKey: 'chatResponses.groupStats' }
  ]
};
