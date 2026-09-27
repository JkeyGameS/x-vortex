// FAQ Search prompt (Phase 7). Free-text stage: body owns the legacy
// layout; input stays on handleFaqSearchPrompt (only '0' is router-handled).
export default {
  id: 'faq_search',
  headingKey: 'menu.faq_search.heading',
  headingEmoji: '🔍',
  standaloneCommand: null,
  aliases: [],
  parent: 'faq',
  backTo: 'faq',
  footerKey: null,
  fallbackHeadingKey: 'faq.searchMenuTitle',
  transitionKey: 'faq_search',
  sessionMenu: 'faq_search',
  adminOnly: true,
  bodyResolver: 'faqSearchBody',
  options: []
};
