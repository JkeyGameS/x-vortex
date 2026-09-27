// FAQ View submenu (Phase 7).
const OPTS = [
  ['1', 'all', '📋', 'custom:faq_view_all', 'faq.viewAll'],
  ['2', 'by_lang', '🔤', 'custom:faq_view_lang', 'faq.viewByLang'],
  ['3', 'by_category', '🗂️', 'custom:faq_view_category', 'faq.viewByCategory'],
  ['4', 'enabled', '🔛', 'custom:faq_view_enabled', 'faq.viewEnabled'],
  ['5', 'disabled', '❌', 'custom:faq_view_disabled', 'faq.viewDisabled'],
  ['6', 'drafts', '📝', 'custom:faq_view_drafts', 'faq.viewDrafts'],
  ['7', 'recent', '🕒', 'custom:faq_view_recent', 'faq.viewRecent'],
  ['8', 'favorites', '⭐', 'custom:faq_view_favorites', 'faq.viewFavorites']
];

export default {
  id: 'faq_view',
  headingKey: 'menu.faq_view.heading',
  headingEmoji: '📋',
  standaloneCommand: null,
  aliases: [],
  parent: 'faq',
  backTo: 'faq',
  footerKey: 'menu.faq_view.footer',
  footerItalic: false,
  fallbackHeadingKey: 'faq.viewMenuTitle',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'faq_view',
  sessionMenu: 'faq_view',
  adminOnly: true,
  options: OPTS.map(([number, key, emoji, action, oldKey]) => ({
    number, labelKey: `menu.faq_view.${key}`, emoji, action, fallbackKey: oldKey
  }))
};
