// Test Panel (Phase 5). Free-text panel: the body resolver owns the full
// legacy layout (prompt + hints + back row, no footer). Input processing
// stays on handleChatTestPanelReply (only '0' is router-handled).
export default {
  id: 'test_panel',
  headingKey: 'menu.test_panel.heading',
  headingEmoji: '🧪',
  standaloneCommand: '/testpanel',
  aliases: [],
  parent: 'chat_faq',
  backTo: 'chat_faq',
  footerKey: null,
  fallbackHeadingKey: 'admin.chatFaq.testTitle',
  transitionKey: 'chat_test_panel',
  sessionMenu: 'chat_test_panel',
  adminOnly: true,
  bodyResolver: 'testPanelBody',
  options: []
};
