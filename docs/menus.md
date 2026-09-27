# X-Vortex Menu System

The menu system is **config-driven**. Every menu the bot can show is declared as a
data definition in `src/config/menus/`, registered in a central registry, and rendered
by a single renderer. Handlers no longer build menu text by hand.

> Phases 0-8 of the menu refactor are complete. The migration toggle
> (`config.menuMigration`) and the `isMenuMigrated()` helper have been **removed**;
> the config-driven path is the only path.

---

## 1. Why config-driven

Before the refactor, a single menu existed in two places: a builder function
(`buildXxxMenu`) that assembled strings, and a handler that called it. Changing a
menu label meant editing handler code, and a missing translation silently rendered a
raw key inside a hand-built string.

Now a menu is one JSON-like object. The renderer owns all formatting rules
(heading style, small caps, back row, footer, feature markers), so a definition
describes *what* the menu contains, never *how* it is formatted. Adding a menu is a
new file plus one registry line.

---

## 2. Folder structure

```
src/config/menus/
  schema.js        # validateMenuDefinition() - asserts shape at registration
  registry.js      # registerMenu / getMenu / getAllMenus / findMenuByCommand
  index.js         # imports + registers every definition (the single entry point)
  mainMenu.js      # main menu
  settings.js      # user Settings shell
  statistics.js    # user Statistics shell
  feedback.js      # user Feedback shell
  info.js          # Info hub
  infoSubs.js      # about / version / developer / website
  profile/         # profile, edit_profile, preferences, my_stats
  tutorial/        # tutorial hub + static sections
  chatFaq/         # chat hub, chat settings, responses, snippets, test panel,
                   # import/export, FAQ shells (faq, add, view, manage, impex,
                   # stats, search), snippet import/export
  admin/           # adminPanel, quick actions, broadcast, user management,
                   # system settings, backup/restore, logs, scheduled tasks,
                   # analytics, admin search
```

---

## 3. Schema reference

### MenuDefinition

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique menu ID, e.g. `'main_menu'` |
| `headingKey` | string | Translation key for the heading (no emoji in the string) |
| `headingEmoji` | string\|null | Emoji concatenated in code, prepended to heading |
| `standaloneCommand` | string | e.g. `'/profile'`; enables auto-registration |
| `aliases` | string[] | e.g. `['/me', '/myprofile']` |
| `descriptionKey` | string | Used for the generated `/help` entry |
| `adminOnly` | boolean | Generated command is admin-only |
| `groupAllowed` | boolean | Default `true` |
| `parent` | string\|null | Parent menu ID (`null` = top level) |
| `backTo` | string\|null | Menu ID returned to on `0`; `null` = no back row |
| `backLabelKey` | string | Override the back label |
| `footerKey` | string\|null | Footer prompt; `null` = no footer row |
| `footerItalic` | boolean | Default `true` |
| `transitionKey` | string | Legacy transition key for hybrid `edit`/`delete_send` sends |
| `sessionMenu` | string | Legacy session state ID (defaults to `id`) |
| `showMarkers` | boolean | Default `true`; `false` hides markers on list-style menus |
| `type` | string | e.g. `'mainMenu'` - selects renderer framing |
| `prefixLines` | string[] | Verbatim lines injected before the option block |
| `type`/`appendLines`/`dynamicSuffix` | see MenuOption | |

### MenuOption

| Field | Type | Notes |
|---|---|---|
| `number` | string | `'1'`..`'9'`, or a letter like `'A'` |
| `labelKey` | string | Translation key for the label (no emoji in the string) |
| `emoji` | string | Emoji concatenated in code, prepended to the label |
| `action` | string | `open:<menuId>` \| `copy_id` \| `sleep` \| `custom:<name>` |
| `featureId` | string | Attaches a feature marker/status |
| `hideWhenUnavailable` | boolean | Hide the row when the feature is not `available` |
| `adminOnly` | boolean | Only rendered for admins |
| `hidden` | boolean | Never rendered |
| `breakBefore` | boolean | Blank line before this option |
| `fallbackKey` | string | Legacy key used when `labelKey` is missing |
| `progressId` | string | Progress key, consumed by `progressResolver` |
| `appendLines` | string[] | Pre-formatted sub-lines rendered under the option |
| `dynamicSuffix` | string | Named suffix resolver appended after the label |
| `perm` | string | Permission id; `dynamicSuffix: 'permLock'` shows 🔒 when lacking it |
| `max` | number\|function | Upper bound for numeric input validation |

Definitions are validated by `validateMenuDefinition()` at registration time, so a
malformed definition fails fast on startup instead of rendering broken text.

---

## 4. Adding a menu

1. Create `src/config/menus/<name>.js`:

```js
import { registerMenu } from './registry.js';

export default registerMenu({
  id: 'my_menu',
  headingKey: 'menu.my_menu.heading',
  headingEmoji: '🧩',
  standaloneCommand: '/mymenu',
  aliases: ['/mm'],
  descriptionKey: 'menu.my_menu.description',
  adminOnly: false,
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.my_menu.footer',
  options: [
    { number: '1', labelKey: 'menu.my_menu.doThing', emoji: '▶️', action: 'custom:myThing' }
  ]
});
```

2. Import it in `src/config/menus/index.js`.
3. Add the label/heading/footer translation keys to all five locales in
   `translations/`.
4. If the option uses `custom:<name>`, register `myThing` in
   `src/utils/menuCustomHandlers.js`.

The menu is now renderable via `sendMenuById('my_menu', ctx)` and reachable at
`/mymenu`.

## 5. Adding an option

Append to the menu's `options` array. That is the whole change - no handler edits.

For a dynamic list, replace `options` with a function:

```js
dynamicOptions: async (user, language) => getItems(user).map((it, i) => ({
  number: String(i + 1),
  labelKey: 'menu.my_menu.item',
  params: { name: it.name },
  action: 'open:my_menu_detail'
}))
```

---

## 6. Resolvers

Resolvers generate the parts of a menu that depend on live data. They are
registered by name in `src/utils/menuResolvers.js` and referenced from the
definition, so data access stays out of the definitions.

| Resolver | Definition field | Purpose |
|---|---|---|
| `cardResolver` | `cardResolver` | Verbatim lines above the option block (profile cards, dashboard headers) |
| `dashboardResolver` | `dashboardResolver` | Dynamic summary block (statistics, analytics) |
| `summaryResolver` | `summaryResolver` | Short dynamic block |
| `bodyResolver` | `bodyResolver` | Replaces options/back/footer entirely (tutorial sections, FAQ help) |
| `progressResolver` | `progressResolver` | Option prefixes; combines with each option's `progressId` to add ✅ |
| rating / value | `dynamicSuffix` | Named suffix appended after a label (on/off, 🔒 for permissions) |
| `dynamicOptions` | `dynamicOptions` | `(user, language) => MenuOption[]` for paginated lists |

Resolvers receive `(user, language, context)`.

Registering one:

```js
registerDashboardResolver('my_stats', async (user, language) => {
  const s = await getStats();
  return [`📊 ${toSmallCaps(t(language, 'menu.my_menu.users'))}: ${s.total}`];
});
```

---

## 7. Custom handlers

`action: 'custom:<name>'` dispatches to a handler map passed to `runMenuAction()`.
The maps live in `src/utils/menuCustomHandlers.js`:

- `profileCustomHandlers`
- `chatFaqCustomHandlers`
- `adminCustomHandlers`
- `userCustomHandlers`

```js
export const userCustomHandlers = {
  myThing: async (context) => {
    const { sender, chatId, user, language } = context;
    await doThing(user);
    await sendMenuById('my_menu', { ...context, resultLine: t(language, 'menu.my_menu.done') });
  }
};
```

A handler returns after rendering so the router does not fall through.

---

## 8. Standalone commands

`src/handlers/menuCommandLoader.js` walks the registry at startup and builds a slash
command for every definition with a `standaloneCommand`. The generated command calls
`sendMenuById(menu.id, ctx)` and inherits `adminOnly` from the definition.

**Conflict resolution is manual-wins.** If a command with the same name is already
registered by a handler module, the manual one is kept and the loader logs:

```
[MENU_CMD] Skipping auto-registration for '/settings' — already exists manually
```

This is intentional for commands that carry behavior beyond opening a menu - for
example `/start` performs onboarding for new users, `/chatsettings` supports
`on|off|list|reset` subcommands, and `/profile` and `/stats` run a feature gate
before opening. Those handlers stay; only genuinely redundant openers are omitted
from the definitions. A summary of registered vs skipped commands is logged at
startup.

---

## 9. Feature markers

Attach `featureId` to an option to bind it to the feature registry:

```js
{ number: '3', labelKey: 'profile.optionStats', emoji: '📊',
  featureId: 'statistics', hideWhenUnavailable: false }
```

`src/utils/menuFeatureMarkers.js` resolves the effective marker
(`getOptionMarker`) and availability (`isOptionAvailable`) from the feature flag
service, so an admin disabling a feature immediately changes the rendered menu.
`hideWhenUnavailable: true` removes the row entirely instead of marking it.

---

## 10. Back navigation

`0` is resolved by the router:

- `backTo` names the parent menu ID; the sender renders it with the correct
  transition.
- `backTo: null` means the menu has no back row (the main menu uses its own
  `0 = exit` option).
- `backLabelKey` overrides the default localized `back` label.

Session state and the new menu IDs are bridged by `sessionMenu`, so legacy session
values keep working while the registry speaks the new IDs.

---

## 11. Testing

```bash
npm test                # both suites
npm run test:menus      # renderer / schema / router / markers primitives
npm run test:menuCommands   # auto-registration + conflict resolution
```

`tests/menuPrimitives.test.mjs` registers a synthetic menu and asserts rendering,
markers, back rows, validation failures and router outcomes.
`tests/menuCommands.test.mjs` asserts that every definition with a
`standaloneCommand` produces a registered command and that manual commands win
conflicts.

---

## 12. Migration history

| Phase | Scope |
|---|---|
| 0 | Scaffolding: schema, registry, renderer, router, sender, snapshots |
| 1 | Primitives + standalone command auto-registration |
| 2 | Standalone command loader |
| 3 | Main menu |
| 4 | Profile, edit profile, preferences, my stats |
| 5 | Chat/FAQ cluster |
| 6 | Admin cluster |
| 7 | User cluster (settings, statistics, tutorial, info, feedback, FAQ shells) |
| 8 | Cleanup: conditionals, toggle, legacy builders and temp files removed |

Legacy code that is not a static menu (paginated lists, wizards, interactive
prompts) still lives in its owning handler and is reached through custom handlers.
Those flows are out of scope for the config-driven renderer by design.
