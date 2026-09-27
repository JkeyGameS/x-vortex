// Tutorial main menu (Phase 7). Progress checkmarks via tutorialProgress.
const OPTS = [
  // [number, newKey, emoji, action, oldKey, progressId]
  ['1', 'getting_started', '🚀', 'custom:tut_getting_started', 'tutorial.gettingStarted', 'gettingStarted'],
  ['2', 'useful_commands', '📋', 'custom:tut_useful_commands', 'tutorial.usefulCommands', 'usefulCommands'],
  ['3', 'profile_guide', '👤', 'custom:tut_profile_guide', 'tutorial.profileGuide', 'profileGuide'],
  ['4', 'settings_prefs', '⚙️', 'custom:tut_settings_prefs', 'tutorial.settingsGuide', 'settingsPrefs'],
  ['5', 'self_destruct', '⏱️', 'custom:tut_self_destruct', 'tutorial.selfDestruct', 'selfDestruct'],
  ['6', 'feedback', '📮', 'custom:tut_feedback', 'tutorial.feedback', 'feedback'],
  ['7', 'quick_tips', '💡', 'custom:tut_quick_tips', 'tutorial.quickTips', null],
  ['8', 'whats_new', '🆕', 'custom:tut_whats_new', 'tutorial.whatNew', null],
  ['9', 'search', '🔍', 'custom:tut_search', 'tutorial.search', null]
];

export default {
  id: 'tutorial',
  headingKey: 'menu.tutorial.heading',
  headingEmoji: '📚',
  standaloneCommand: '/tutorial',
  aliases: ['/guide'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.tutorial.footer',
  footerItalic: false,
  fallbackHeadingKey: 'tutorial.title',
  fallbackFooterKey: 'tutorial.replyPrompt',
  progressResolver: 'tutorialProgress',
  transitionKey: 'tutorial_main',
  sessionMenu: 'tutorial_main',
  options: OPTS.map(([number, key, emoji, action, oldKey, progressId]) => {
    const opt = { number, labelKey: `menu.tutorial.${key}`, emoji, action, fallbackKey: oldKey };
    if (progressId) opt.progressId = progressId;
    return opt;
  })
};
