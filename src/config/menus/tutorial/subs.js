// Tutorial static sub-menus (Phase 7). Bodies come from verbatim resolvers
// in tutorialCommand; input stays on the legacy reply handler.
const SUBS = [
  // [id, titleKey, bodyResolver, headingEmoji]
  ['tutorial_getting_started', 'gettingStartedTitle', 'tutGettingStartedBody', '🚀'],
  ['tutorial_profile_guide', 'profileGuideTitle', 'tutProfileGuideBody', '👤'],
  ['tutorial_settings_prefs', 'settingsTitle', 'tutSettingsPrefsBody', '⚙️'],
  ['tutorial_self_destruct', 'selfDestructTitle', 'tutSelfDestructBody', '⏱️'],
  ['tutorial_feedback', 'feedbackTitle', 'tutFeedbackBody', '📮'],
  ['tutorial_whats_new', 'whatNewTitle', 'tutWhatsNewBody', '🆕']
];

export const tutorialSubDefinitions = SUBS.map(([id, titleKey, bodyResolver, headingEmoji]) => ({
  id,
  headingKey: `menu.tutorial_sub.${id}`,
  headingEmoji,
  standaloneCommand: null,
  aliases: [],
  parent: 'tutorial',
  backTo: 'tutorial',
  footerKey: null,
  fallbackHeadingKey: `tutorial.${titleKey}`,
  transitionKey: id,
  sessionMenu: id,
  bodyResolver,
  options: []
}));
