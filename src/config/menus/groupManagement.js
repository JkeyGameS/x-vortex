/**
 * Group Management.
 *
 * Four options, not seven. Activate, Deactivate and About Stats used to be
 * top-level entries, which split one job across three screens and left the user
 * with no single place to see which groups they actually have:
 *
 *   - Activate / Deactivate are now folded into My Groups, which lists every
 *     group the user manages with an explicit status (active / deactivated /
 *     available) and gives each one an action that makes sense for that status.
 *   - About Stats is now a one-line footnote on the Aggregate Stats panel.
 *
 * The list is capped and the summary shows counts, so the menu stays readable
 * no matter how many groups the user manages.
 *
 * `/groups` stays primary and `/gm` stays the alias. Users know both; swapping
 * them would break muscle memory for no gain.
 */
export default {
  id: 'group_management',
  headingKey: 'menu.group_management.heading',
  headingEmoji: '\u{1F465}',
  standaloneCommand: '/groups',
  aliases: ['/gm'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.replyPrompt',
  adminOnly: false,
  summaryResolver: 'groupManagementSummary',
  options: [
    {
      number: '1',
      labelKey: 'menu.group_management.my_groups',
      emoji: '\u{1F4CB}',
      action: 'custom:groups_my_groups'
    },
    {
      number: '2',
      labelKey: 'menu.group_management.aggregate_stats',
      emoji: '\u{1F4CA}',
      action: 'custom:groups_aggregate_stats'
    },
    {
      // moderation_menu_label, not moderation: `moderation` collides with the
      // Moderation menu's own heading key and resolved to the wrong label.
      number: '3',
      labelKey: 'menu.group_management.moderation_menu_label',
      emoji: '\u26A0\uFE0F',
      action: 'custom:groups_moderation'
    },
    {
      number: '4',
      labelKey: 'menu.group_management.defaults',
      emoji: '\u2699\uFE0F',
      action: 'custom:groups_defaults'
    }
  ]
};