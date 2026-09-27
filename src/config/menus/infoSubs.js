// Info static sub-menus (Phase 7). Bodies verbatim via infoCommand.
const SUBS = [
  // [id, titleKey, bodyResolver, headingEmoji]
  ['info_about', 'aboutTitle', 'infoAboutBody', '🤖'],
  ['info_version', 'versionTitle', 'infoVersionBody', '📝'],
  ['info_developer', 'developerTitle', 'infoDeveloperBody', '👨‍💻'],
  ['info_website', 'websiteTitle', 'infoWebsiteBody', '🌐']
];

export const infoSubDefinitions = SUBS.map(([id, titleKey, bodyResolver, headingEmoji]) => ({
    id,
    headingKey: `menu.info_sub.${id}`,
    headingEmoji,
    standaloneCommand: null,
    aliases: [],
    parent: 'info',
    backTo: 'info',
    footerKey: null,
    fallbackHeadingKey: `info.${titleKey}`,
    transitionKey: id,
    sessionMenu: id,
    bodyResolver,
    options: []
  }));
