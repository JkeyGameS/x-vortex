# Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - Menu Refactor Complete

### Added
- Config-driven menu system under `src/config/menus/`: every static menu is a data
  definition validated at registration time.
- Central registry (`registerMenu` / `getMenu` / `getAllMenus` / `findMenuByCommand`).
- Single renderer (`src/utils/menuRenderer.js`) owning all formatting: heading
  `> *...*`, small-caps static text, `0. ʙᴀᴄᴋ` back row, footer prompts, feature
  markers, dashboards, cards, progress checkmarks and dynamic suffixes.
- Resolvers: `cardResolver`, `bodyResolver`, `dashboardResolver`, `summaryResolver`,
  `progressResolver`, plus named `dynamicSuffix` and `dynamicOptions` resolution.
- Custom handler dispatch centralized in `src/utils/menuCustomHandlers.js`
  (`profileCustomHandlers`, `chatFaqCustomHandlers`, `adminCustomHandlers`,
  `userCustomHandlers`).
- Standalone command auto-registration from `standaloneCommand` in menu
  definitions, with manual-wins conflict resolution.
- Feature markers bound to options via `featureId`.
- Test suites moved to `tests/`: `menuPrimitives.test.mjs`, `menuCommands.test.mjs`.

### Changed
- All menu conditionals removed; the config-driven path is now the only path.
- Return-to-menu flows (help back, sleep confirm, rule actions, admin/tutorial/
  stats/info/feedback back) now route through `sendMigratedMainMenu()` /
  `sendAdminPanel()` instead of re-invoking legacy builders.
- Hybrid `edit` / `delete_send` transitions preserved per menu via
  `transitionKey`; session compatibility preserved via `sessionMenu`.
- Version bumped to 1.1.0.

### Removed
- `config.menuMigration` block and the `isMenuMigrated()` helper.
- All `sendOld*` functions and the dead legacy builders
  (`buildMainMenu`, `buildAdminPanel`, `buildUserManagementMenu`,
  `buildChatSettingsMenu`, `buildBackupRestoreMenu`, `buildSystemSettingsMenu`,
  `buildLogsMenu`, `buildQuickActionsMenu`, `buildScheduledTasksMenu`,
  `buildInfoMenu`).
- Unreachable code left behind by the migration (dead branches after early
  returns, now-folding `sendNew*` wrappers).
- Temporary migration files: `src/config/emojiFallback.js`,
  `src/scripts/backupMenus.js`, `data/menuSnapshots/`, stray root test scripts.
- Four translation keys orphaned by the deleted builders, from all five locales.
- Obsolete test assertions that exercised the removed migration toggle.

### Known limitations
- Paginated lists, multi-step wizards and interactive prompts (FAQ editing,
  user bulk actions, template packs, scheduled broadcast flows, help pagination)
  remain in their owning handlers. They are reached through custom handlers and
  are intentionally not data-driven.
- `p4test.mjs` "style ignored when off" is a pre-existing flaky assertion: with
  style personalization off the selector draws from the full reply pool, so the
  expected `friendly` reply appears only ~1/3 of runs. Not a menu-system issue.

## [1.0.0]

- Initial release: conversation engine, chat rules, FAQ, templates, snippets,
  analytics, admin tooling, backups and trash.
