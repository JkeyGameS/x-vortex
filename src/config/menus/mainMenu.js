// Main menu definition (Phase 3 — first live migration).
// Byte-parity rules (verified against data/menuSnapshots/main_menu_*.json):
// - Emojis for options 1-6/9/A come from the definition (prefix position,
//   matching the old translation strings).
// - Option 0 keeps its emoji inline ("Asleep 💤" suffix) because the legacy
//   layout has it after the label — a prefix emoji field cannot reproduce it.
// - Heading has no emoji; {username} stays raw-case while static text is capped.
// - Blank lines before options 1, 9, A via breakBefore.
// - The admin row is feature-gated (visible iff adminPanel is available),
//   exactly like the old builder — NOT admin-gated. The admin check happens
//   at click time in the router branch, as before.
export default {
  id: 'main_menu',
  headingKey: 'menu.main.heading',
  headingEmoji: null,
  standaloneCommand: '/start',
  aliases: ['/begin', '/menu'],
  parent: null,
  backTo: null,
  footerKey: 'menu.main.replyPrompt',
  footerItalic: false,
  fallbackHeadingKey: 'onboarding.mainMenuGreetingStatic',
  fallbackFooterKey: 'admin.replyPrompt',
  options: [
    { number: '0', labelKey: 'menu.main.sleep', emoji: null, action: 'sleep', fallbackKey: 'onboarding.menuExit' },
    { number: '1', labelKey: 'menu.main.profile', emoji: '👤', action: 'open:profile', featureId: 'profileEditing', breakBefore: true, fallbackKey: 'onboarding.menuProfile' },
    { number: '2', labelKey: 'menu.main.settings', emoji: '⚙️', action: 'open:settings', fallbackKey: 'onboarding.menuSettings' },
    { number: '3', labelKey: 'menu.main.stats', emoji: '📊', action: 'open:statistics', featureId: 'statistics', fallbackKey: 'onboarding.menuStatistics' },
    { number: '4', labelKey: 'menu.main.tutorial', emoji: '📚', action: 'open:tutorial', featureId: 'tutorial', fallbackKey: 'onboarding.menuTutorial' },
    { number: '5', labelKey: 'menu.main.info', emoji: 'ℹ️', action: 'open:info', featureId: 'info', fallbackKey: 'onboarding.menuAbout' },
    { number: '6', labelKey: 'menu.main.feedback', emoji: '📮', action: 'open:feedback', featureId: 'feedback', fallbackKey: 'onboarding.menuFeedback' },
    { number: '7', labelKey: 'menu.main.groups', emoji: '👥', action: 'open:group_management' },
    { number: '9', labelKey: 'menu.main.help', emoji: '❓', action: 'open:help', breakBefore: true, fallbackKey: 'menuHelp.option' },
    { number: 'A', labelKey: 'menu.main.admin', emoji: '🧰', action: 'open:adminPanel', featureId: 'adminPanel', hideWhenUnavailable: true, breakBefore: true, fallbackKey: 'onboarding.menuAdmin' }
  ]
};
