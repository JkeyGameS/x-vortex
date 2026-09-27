// FAQ Statistics (Phase 7). Dynamic counts + top list come from the
// faqStatsBody resolver (verbatim); option 1 opens the dashboard.
export default {
  id: 'faq_stats',
  headingKey: 'menu.faq_stats.heading',
  headingEmoji: '📊',
  standaloneCommand: null,
  aliases: [],
  parent: 'faq',
  backTo: 'faq',
  footerKey: null,
  fallbackHeadingKey: 'faq.statsTitle',
  transitionKey: 'faq_stats',
  sessionMenu: 'faq_stats',
  adminOnly: true,
  cardResolver: 'faqStatsBody',
  options: [
    { number: '1', labelKey: 'menu.faq_stats.performance', emoji: '📈', action: 'custom:faq_stats_dashboard', fallbackKey: 'faq.statsPerformance' }
  ]
};
