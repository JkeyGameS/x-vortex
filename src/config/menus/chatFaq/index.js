// Chat & FAQ Management hub (Phase 5).
// Options 1-7 keep emojis inline (legacy translation strings); 8-9 use
// code-concatenated emojis. Unmigrated targets (faq/stats/unmatched/cleanup)
// go through custom: handlers delegating to existing senders.
export default {
  id: 'chat_faq',
  headingKey: 'menu.chat_faq.heading',
  headingEmoji: '💬',
  standaloneCommand: '/chatfaq',
  aliases: ['/cf'],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  footerKey: 'menu.chat_faq.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.chatFaq.title',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'chat_faq_menu',
  sessionMenu: 'chat_faq_menu',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.chat_faq.chat_responses', emoji: null, action: 'open:chat_responses', fallbackKey: 'admin.optionChatResponses' },
    { number: '2', labelKey: 'menu.chat_faq.faq', emoji: null, action: 'custom:hub_faq', fallbackKey: 'admin.optionFaq' },
    { number: '3', labelKey: 'menu.chat_faq.snippets', emoji: '🧩', action: 'open:snippets', fallbackKey: 'admin.chatFaq.optionSnippets' },
    { number: '4', labelKey: 'menu.chat_faq.stats', emoji: '📊', action: 'custom:hub_stats', fallbackKey: 'admin.chatFaq.optionStats' },
    { number: '5', labelKey: 'menu.chat_faq.unmatched', emoji: '❓', action: 'custom:hub_unmatched', fallbackKey: 'admin.chatFaq.optionUnmatched' },
    { number: '6', labelKey: 'menu.chat_faq.import_export', emoji: '📦', action: 'open:chat_import_export', fallbackKey: 'admin.chatFaq.optionImportExport' },
    { number: '7', labelKey: 'menu.chat_faq.test_panel', emoji: '🧪', action: 'open:test_panel', fallbackKey: 'admin.chatFaq.optionTest' },
    { number: '8', labelKey: 'menu.chat_faq.cleanup', emoji: '🧹', action: 'custom:hub_cleanup', fallbackKey: 'admin.chatFaq.optionCleanup' },
    { number: '9', labelKey: 'menu.chat_faq.settings', emoji: '⚙️', action: 'open:chat_settings', fallbackKey: 'admin.chatFaq.optionChatSettings' }
  ]
};
