# Menu System Migration (Phase 0 — Safety Net & Scaffolding)

## Purpose

The menu system is being migrated to a centralized, config-driven approach
(`src/config/menus/` + renderer + router) so that menu text, emojis, options,
and routing live in one place instead of being scattered across handlers.
This reduces drift between locales, duplicate emoji literals, and routing bugs
(e.g. menu states missing from the router allowlist).

Phase 0 is **purely additive**: no live behavior changes. It adds scaffolding,
a migration toggle, backup utilities, and stubs.

## Migration mode flags (`config.menuMigration`)

- `mode: 'off'` (default) — everything uses the old builders.
- `mode: 'partial'` — only menus listed in `migratedMenus` use the new renderer.
- `mode: 'full'` — everything uses the new renderer (end of the refactor).

`isMenuMigrated(menuId)` (exported from `src/config/config.js`) implements
this decision and will be called by send paths in later phases.

## Menu definition schema (`src/config/menus/schema.js`)

```js
{
  id: 'main_menu',          // stable menu id, also used in migratedMenus
  headingKey: '...',        // translation key for the heading (no emoji)
  headingEmoji: '👤',       // emoji prepended to the heading
  standaloneCommand: '/profile',
  aliases: ['/me'],
  parent: null,             // parent menu id (null for top-level)
  backTo: null,             // menu id for '0'; null = no back row (main menu)
  backLabelKey: undefined,  // override, default common.back → 0. ʙᴀᴄᴋ
  footerKey: undefined,     // override, default admin.replyPrompt (italic)
  options: [
    {
      number: '1', labelKey: '...', emoji: '👤',
      action: 'open:profile',   // open:<id> | copy_id | sleep | custom:<name>
      featureId: 'profileEditing', adminOnly: false, hidden: false
    }
  ]
}
```

`validateMenuDefinition(def)` throws on missing/malformed fields and is
called by `registerMenu()`.

## How to register a menu

```js
import { registerMenu } from '../config/menus/registry.js';
registerMenu(myDefinition); // validated + stored by id
```

Look up with `getMenu(id)`, `getAllMenus()`, `findMenuByCommand('/cmd')`.
No menus are registered yet — definitions arrive in Phases 3+.

## How to render and route

```js
import { renderMenu } from '../utils/menuRenderer.js';
import { resolveMenuOption, runMenuAction } from '../utils/menuRouter.js';
import { sendMenuById } from '../utils/menuSender.js';

const { text, options } = await renderMenu('main_menu', user, 'en');
const r = resolveMenuOption('main_menu', input, user);
// { kind: 'action', action, option } | { kind: 'back', to } | { kind: 'invalid', max } | { kind: 'error', reason }
await runMenuAction(r.action, { ...context, sendMenuFn });
await sendMenuById('main_menu', context, transitionKey); // render + hybrid send + session update
```

Renderer rules: hidden options skipped; `adminOnly` checked against
`config.adminJids`; markers via `menuFeatureMarkers`; back row only when
`backTo` is set; footer italic-wrapped. Router matching is case-insensitive
(`a`/`A`); hidden/admin-invisible options never match; `max` is the last
visible option number for invalid-choice messages. `runMenuAction` stays
decoupled via `context.sendMenuFn`; `sleep`/`copy_id`/`custom:*` resolve
through `context.handlers` or `registerMenuActionHandler()` (wired Phase 3+).

## How feature markers are integrated

`src/utils/menuFeatureMarkers.js` wraps the existing feature registry:
`getOptionMarker(featureId)` returns the effective marker (`''` when absent,
unknown, or removed by admin; unavailable features still show theirs);
`isOptionAvailable(featureId)` is true when available or when no featureId.
Unavailable options stay selectable — the runtime unavailable flow handles them.

## How to test with npm run test:menus

`src/scripts/testMenuPrimitives.js` registers a dummy menu, renders it for
regular/admin users, exercises resolve/back/invalid/error paths, the
`open:`/`custom:` engine, and marker edge cases. No translation edits:
missing keys fall back to the raw key. No live flow calls these primitives.

## Standalone commands (Phase 2)

A menu with `standaloneCommand: '/profile'` (plus `aliases: ['/me']`) is
auto-registered as a slash command by `src/handlers/menuCommandLoader.js`
(`buildMenuCommands()`). The generated command delegates entirely to
`sendMenuById()`; `adminOnly`/`groupAllowed` come from the definition
(`adminOnly === true` / `groupAllowed !== false`).

- Naming convention: `standaloneCommand` must start with `/`; the leading
  slash is stripped for the command name (aliases too, lowercased).
- Conflict handling: manual commands always win. If a generated name or
  alias already exists (names and aliases share one map), the generated one
  is skipped with a `[MENU_CMD]` warning and the manual entry is preserved.
- `commandHandler.loadCommands()` loads manual commands first, then merges
  generated ones, and logs `[MENU_CMD] menu commands summary` only when
  something was registered or skipped (silent while no menus are migrated).
- Testing: `npm run test:menuCommands` (dummy menu, execute delegation,
  name + alias conflicts, plain menus ignored).

## Migrated menus (Phase 4): profile, edit_profile, preferences, my_stats

- Definitions: `src/config/menus/profile/` (index/editProfile/preferences/myStats).
- Toggle: `migratedMenus` adds the four ids (mode stays `partial`).
- Swap: conditionals inside `sendProfileView`/`sendEditSubmenu`/
  `sendPreferencesView`/`sendStatsView` (+ `backToMain` routes main via toggle).
- Session states keep legacy ids (`profile`, `profile_edit`, `preferences`,
  `stats`); the registry speaks new ids. Mapping lives in the index branch.
- Dynamic lists (edit/preferences available + Advanced node) materialize per
  user via `dynamicOptions()` mirroring the legacy numbering exactly.
- Profile card + stats body are verbatim resolver copies
  (`profileCard`/`myStatsBody`, registered from profileCommand); plain-string
  lines are small-capped like `buildMenu` does (dynamic fragments rely on it).
- Available lists suppress markers (`showMarkers: false`), matching legacy;
  the Advanced (old-builder) lists still show them.
- Preferences notification/announcement state uses `dynamicSuffix` resolvers.
- Click actions delegate to `dispatchProfileAction` via `menuCustomHandlers`
  (feature gates + prompts unchanged); unmigrated submenus
  (`message_settings`, `pref_advanced`, language, typing, self-destruct…)
  are reached through the same handlers and route on legacy states.
- Invalid input replicates legacy per-state texts (profile max 7 hardcoded).
- Standalone `/profile`, `/preferences` (+aliases) stay manual (loader skips).

## Migrated menus (Phase 3): main_menu

- Definition: `src/config/menus/mainMenu.js` (registered in `menus/index.js`).
- Toggle: `config.menuMigration = { mode: 'partial', migratedMenus: ['main_menu'] }`.
- Sending: `startCommand.sendMigratedMainMenu()` when
  `isMenuMigrated('main_menu')`, else legacy `sendOldMainMenu()`.
- Routing: the `currentMenu === 'main'` branch in `index.js` resolves via
  `resolveMenuOption` and dispatches `open:*` through existing openers;
  `0` keeps its pre-existing sleep-confirm path; invalid singles re-render;
  anything else falls through to chat rules — all exactly as before.
- Parity notes (verified byte-identical vs `data/menuSnapshots/main_menu_*`):
  option `0` keeps its emoji inline (`Asleep 💤` suffix); the admin row is
  feature-gated, not admin-gated; `{username}` stays raw-case in the heading;
  lowercase `a` behaves like the legacy branch.

## How to toggle migration

```js
menuMigration: { mode: 'partial', migratedMenus: ['main_menu'] }
```

## How to revert

Set `mode` back to `'off'` and restart — `sendOldMainMenu()` and the legacy
router branch take over again. `sendOldMainMenu` is preserved until Phase 8.

## Migrated menus (Phase 5): chat_faq, chat_responses, chat_settings, snippets, test_panel, chat_import_export

- Definitions: `src/config/menus/chatFaq/` (index/chatResponses/chatSettings/snippets/testPanel/importExport).
- Toggle: `migratedMenus` adds the six ids (mode stays `partial`).
- Swap: conditionals inside `sendChatFaqMenu`/`sendChatSettingsPanel`/
  `sendChatTestPanel`/`sendChatFaqImportExport` (adminCommand) and
  `sendChatPanel`/`sendSnippetsMenu` (chatCommand). `resultLine` forces the
  legacy builder (new renderer has no result-line support yet).
- Session keeps legacy ids; definitions carry `transitionKey`/`sessionMenu`
  consumed by `sendMenuById`.
- Suffixes replicate `chatSettingsValueText` via self-contained resolvers in
  `menuResolvers.js` (no import cycle); whole-line casing matches legacy
  `buildMenu` (labels AND suffixes capped).
- Click actions delegate to existing senders/flows via `chatFaqCustomHandlers`
  (toggles, submenu openers, snippet/import flows). Unmigrated submenus keep
  legacy states and routes. Test panel keeps legacy free-text processing;
  only `0` is router-handled.
- Invalid input replicates legacy per-state texts (hub/snippets resend,
  responses max 6 + resend, settings max 35, import/export max 8).
- Standalone `/chatfaq`, `/chatresponses`, `/snippets`, `/testpanel`
  auto-register (admin-only); manual `/chatsettings` wins. Non-admins are
  denied by the dispatcher (`adminOnly: true`).
- Dynamic/paginated menus (rule/FAQ lists, wizards, stats views) stay on
  builders until Phase 7.

## Migrated menus (Phase 6): adminPanel, quick_actions, broadcast, user_management, system_settings, backup_restore, logs, scheduled_tasks, analytics, admin_search

- Definitions: `src/config/menus/admin/` (10 files).
- Toggle: `migratedMenus` adds the ten ids (mode stays `partial`).
- Swap: conditionals inside existing senders; `resultLine` forces legacy.
  Session keeps legacy ids (`admin`, `admin_quick_actions`,
  `broadcast_submenu`, `admin_users`, `system_settings`, `admin_backup`,
  `logs`, `admin_search`, `admin_scheduled_tasks`, `command_analytics`).
- Dynamic content via verbatim resolvers registered from adminCommand:
  `adminDashboard` (status/uptime/counts + activity feed),
  `userMgmtSummary` (totals), `scheduledTasksBody` (paginated, session page),
  `adminSearchBody` (static prompt). Unmigrated `sendAdminLogsMenu`
  (grouped `admin_logs` state) is intentionally left alone — the live flow
  is `sendLogsPanel` (state `logs`).
- Admin option 🔒 suffixes via `perm` + `permLock` resolver (mirrors the
  legacy builder; click-time gates stay in legacy reply handlers).
- Click actions re-dispatch through legacy reply handlers
  (`adminCustomHandlers`), preserving locks, perms, confirms, and sub-flows.
  Free-text states (search, scheduled, test panel) keep legacy processors;
  only their renders migrated.
- Invalid input replicates legacy per-state texts (panel max 13, quick max
  5, broadcast max 3, system max 8, analytics/logs max 2, resends for
  users/backup); the help interceptor (`9`, `10` in system_settings) runs
  before resolve, as in legacy.
- Back rows use legacy per-source transition keys (all `delete_send`);
  `adminPanel → main_menu` reuses the main-menu toggle path.
- Standalone `/scheduled`, `/tasks`, `/logs` auto-register (admin-only);
  manual `/admin`, `/broadcast`, `/users`, `/syssettings`, `/backup`,
  `/analytics` win. Non-admins are denied by the dispatcher.
- Dynamic/paginated flows (user lists, exports detail, log viewers,
  broadcast scheduling, feature tree, feedback subsystem) stay on builders
  for Phase 7+.

## Migrated menus (Phase 7): settings, statistics, tutorial (+6 static subs), info (+4 subs), feedback, faq (+6 subs), snippet_impex

- Definitions: `src/config/menus/` root + `tutorial/` + `chatFaq/` additions.
- Toggle: `migratedMenus` adds 24 ids (mode stays `partial`).
- Swap: conditionals inside existing senders; `resultLine` forces legacy.
  Session keeps legacy ids (`settings`, `stats_main`, `tutorial_main`,
  `info`, `feedback_main`, `faq_main`, …).
- Dynamic content via verbatim resolvers registered from owner modules
  (`tutorialProgress`, stats/info dashboards, tutorial/info/faq bodies).
  Tutorial progress checkmarks via `progressId` + async resolver; feedback
  per-user notes via `dynamicOptions` + `appendLines`.
- Click actions re-dispatch legacy reply handlers with fixed input
  (`userCustomHandlers`), preserving gates, side effects (tutorial progress),
  wizards, and pagination. Free-text states (faq_search) keep legacy
  processors; only `0` is router-handled.
- Invalid input re-dispatches legacy with the original input (exact edge
  behavior); back rows navigate via `backTo` (+ toggle-aware main backs).
- The `tutorial_commands`/`tutorial_search`/quick-tips flows, feedback
  sub-flows, FAQ lists/details/wizards, `pref_advanced`, and the help
  subsystem stay fully legacy (no render migration).
- Standalone: no new manual collisions found beyond existing; generated
  commands defer to manuals per Phase 2 rules. Non-admin FAQ access denied
  by legacy branch gates (mirrored in the new branch).

## Temporary artifacts (removed in Phase 8)

- `src/config/emojiFallback.js` — emoji safety net for missing keys.
- `data/menuSnapshots/` — baseline menu outputs (`npm run backup:menus`).
