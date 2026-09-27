// My Statistics content view (Phase 4, Option A).
// bodyResolver owns the full layout (verbatim copy of the legacy body,
// including its own back row + footer), so options stays empty and the
// renderer skips auto-generated rows. Router '0' still resolves via backTo.
export default {
  id: 'my_stats',
  headingKey: 'menu.my_stats.heading',
  headingEmoji: null,
  standaloneCommand: null,
  aliases: [],
  parent: 'profile',
  backTo: 'profile',
  footerKey: 'menu.my_stats.footer',
  fallbackHeadingKey: 'stats.title',
  fallbackFooterKey: 'stats.replyPrompt',
  bodyResolver: 'myStatsBody',
  options: []
};
