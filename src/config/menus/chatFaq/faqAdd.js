// FAQ Add submenu (Phase 7). All targets stay on existing flows.
const OPTS = [
  // [number, newKey, emoji, action, oldKey]
  ['1', 'quick', '⚡', 'custom:faq_add_quick', 'faq.addQuick'],
  ['2', 'advanced', '⚙️', 'custom:faq_add_advanced', 'faq.addAdvanced'],
  ['3', 'template', '📚', 'custom:faq_add_template', 'faq.addTemplate'],
  ['4', 'bulk', '📦', 'custom:faq_add_bulk', 'faq.addBulk'],
  ['5', 'from_unmatched', '📥', 'custom:faq_add_unmatched', 'faq.addFromUnmatched'],
  ['6', 'duplicate', '📋', 'custom:faq_add_duplicate', 'faq.addDuplicate'],
  ['7', 'resume_draft', '📝', 'custom:faq_add_resume', 'faq.addResumeDraft'],
  ['8', 'from_example', '🎨', 'custom:faq_add_example', 'faq.addFromExample'],
  ['9', 'multilang', '🌐', 'custom:faq_add_multilang', 'faq.addMultilang']
];

export default {
  id: 'faq_add',
  headingKey: 'menu.faq_add.heading',
  headingEmoji: '➕',
  standaloneCommand: null,
  aliases: [],
  parent: 'faq',
  backTo: 'faq',
  footerKey: 'menu.faq_add.footer',
  footerItalic: false,
  fallbackHeadingKey: 'faq.addMenuTitle',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'faq_add',
  sessionMenu: 'faq_add',
  adminOnly: true,
  options: OPTS.map(([number, key, emoji, action, oldKey]) => ({
    number, labelKey: `menu.faq_add.${key}`, emoji, action, fallbackKey: oldKey
  }))
};
