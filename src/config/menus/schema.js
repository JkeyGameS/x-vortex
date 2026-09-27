/**
 * Menu definition schema (Phase 1 — canonical reference).
 *
 * @typedef {Object} MenuOption
 * @property {string} number          - Option number or letter (e.g., '1', 'A')
 * @property {string} labelKey        - Translation key for the label (no emoji)
 * @property {string} [emoji]         - Emoji to prepend to the label
 * @property {string} action          - Action to perform: 'open:<menuId>' | 'copy_id' | 'sleep' | 'custom:<handlerName>'
 * @property {string} [featureId]     - Optional feature registry ID; adds a marker
 * @property {boolean} [adminOnly]    - If true, only visible to admins
 * @property {boolean} [hidden]       - If true, never rendered
 * @property {string} [customHandler] - Name of a custom handler function if action is 'custom'
 * @property {boolean} [hideWhenUnavailable] - Hide when featureId status is not 'available'
 * @property {boolean} [breakBefore] - Render a blank line before this option
 * @property {string} [fallbackKey] - Old translation key if labelKey is missing
 * @property {string} [dynamicSuffix] - Named suffix resolver appended after the label
 *
 * @typedef {Object} MenuDefinition
 * @property {string} id                       - Unique menu ID (e.g., 'main_menu')
 * @property {string} headingKey               - Translation key for the heading
 * @property {string} [headingEmoji]           - Emoji prepended to heading
 * @property {string} [standaloneCommand]      - e.g., '/profile'
 * @property {string[]} [aliases]              - e.g., ['/me', '/myprofile']
 * @property {string|null} parent              - Parent menu ID (null for top-level)
 * @property {string|null} backTo              - Menu ID to return to on '0'; null means no back (e.g., main menu)
 * @property {string} [backLabelKey]           - Optional translation key override for the back option
 * @property {string|null} [footerKey]        - Translation key for footer prompt (null = no footer row)
 * @property {boolean} [footerItalic]          - Italic-wrap footer (default true; false = legacy plain)
 * @property {string} [transitionKey]          - Legacy transition key for hybrid send (defaults to menu id)
 * @property {string} [sessionMenu]            - Legacy session state id (defaults to menu id)
 * @property {boolean} [showMarkers]           - Show feature markers (default true; false = legacy lists that hide them)
 * @property {string} [cardResolver]           - Named card resolver (verbatim lines above options)
 * @property {string} [dashboardResolver]      - Named dashboard resolver (dynamic summary block)
 * @property {string} [summaryResolver]        - Named summary resolver (short dynamic block)
 * @property {string} [progressResolver]       - Named progress resolver (option prefixes)
 * @property {string} [progressId]             - (Option) progress key for progressResolver
 * @property {string[]} [appendLines]          - (Option) pre-formatted sub-lines after the option
 * @property {string} [perm]                   - (Option) permission id; with dynamicSuffix permLock shows 🔒 when lacking
 * @property {string} [bodyResolver]           - Named body resolver (replaces options/back/footer)
 * @property {Function} [dynamicOptions]       - (user, language) => MenuOption[] (alternative to static options)
 * @property {string} [fallbackHeadingKey]     - Old heading key if headingKey is missing
 * @property {string} [fallbackFooterKey]      - Old footer key if footerKey is missing
 * @property {MenuOption[]} options            - Menu options (excluding back, which is auto-added)
 */

const ACTION_RE = /^(open:[A-Za-z0-9_]+|copy_id|sleep|custom:[A-Za-z0-9_]+)$/;

function assert(cond, message) {
  if (!cond) throw new Error(`Invalid menu definition: ${message}`);
}

/**
 * Validate a menu definition. Throws on missing/malformed fields.
 * Called when menus are registered.
 */
export function validateMenuDefinition(def) {
  assert(def && typeof def === 'object' && !Array.isArray(def), 'definition must be an object');
  assert(typeof def.id === 'string' && def.id.trim(), 'id must be a non-empty string');
  assert(typeof def.headingKey === 'string' && def.headingKey.trim(), 'headingKey must be a non-empty string');
  if (def.headingEmoji !== undefined && def.headingEmoji !== null) assert(typeof def.headingEmoji === 'string', 'headingEmoji must be a string');
  if (def.standaloneCommand !== undefined && def.standaloneCommand !== null) {
    assert(typeof def.standaloneCommand === 'string' && def.standaloneCommand.startsWith('/'), 'standaloneCommand must start with /');
  }
  if (def.aliases !== undefined) {
    assert(Array.isArray(def.aliases) && def.aliases.every((a) => typeof a === 'string' && a.startsWith('/')), 'aliases must be an array of /commands');
  }
  assert(def.parent === null || def.parent === undefined || typeof def.parent === 'string', 'parent must be a string or null');
  assert(def.backTo === null || def.backTo === undefined || typeof def.backTo === 'string', 'backTo must be a string or null');
  if (def.backLabelKey !== undefined) assert(typeof def.backLabelKey === 'string' && def.backLabelKey.trim(), 'backLabelKey must be a non-empty string');
  if (def.footerKey !== undefined && def.footerKey !== null) assert(typeof def.footerKey === 'string' && def.footerKey.trim(), 'footerKey must be a non-empty string');
  if (def.transitionKey !== undefined) assert(typeof def.transitionKey === 'string' && def.transitionKey.trim(), 'transitionKey must be a non-empty string');
  if (def.sessionMenu !== undefined) assert(typeof def.sessionMenu === 'string' && def.sessionMenu.trim(), 'sessionMenu must be a non-empty string');
  if (def.fallbackHeadingKey !== undefined) assert(typeof def.fallbackHeadingKey === 'string' && def.fallbackHeadingKey.trim(), 'fallbackHeadingKey must be a non-empty string');
  if (def.fallbackFooterKey !== undefined) assert(typeof def.fallbackFooterKey === 'string' && def.fallbackFooterKey.trim(), 'fallbackFooterKey must be a non-empty string');
  if (def.footerItalic !== undefined) assert(typeof def.footerItalic === 'boolean', 'footerItalic must be boolean');
  if (def.showMarkers !== undefined) assert(typeof def.showMarkers === 'boolean', 'showMarkers must be boolean');
  if (def.cardResolver !== undefined) assert(typeof def.cardResolver === 'string' && def.cardResolver.trim(), 'cardResolver must be a non-empty string');
  if (def.bodyResolver !== undefined) assert(typeof def.bodyResolver === 'string' && def.bodyResolver.trim(), 'bodyResolver must be a non-empty string');
  if (def.dynamicOptions !== undefined) assert(typeof def.dynamicOptions === 'function', 'dynamicOptions must be a function');
  for (const key of ['cardResolver', 'dashboardResolver', 'summaryResolver', 'progressResolver']) {
    if (def[key] !== undefined) assert(typeof def[key] === 'string' && def[key].trim(), `${key} must be a non-empty string`);
  }
  const hasStaticOptions = Array.isArray(def.options) && def.options.length > 0;
  const hasDynamicOptions = typeof def.dynamicOptions === 'function';
  const hasBody = typeof def.bodyResolver === 'string' && def.bodyResolver.trim().length > 0;
  assert(hasStaticOptions || hasDynamicOptions || hasBody, 'options must be a non-empty array (unless dynamicOptions or bodyResolver is set)');
  if (def.options !== undefined) assert(Array.isArray(def.options), 'options must be an array');
  const seen = new Set();
  for (const opt of def.options || []) {
    assert(opt && typeof opt === 'object', 'each option must be an object');
    assert(typeof opt.number === 'string' && opt.number.trim(), 'option.number must be a non-empty string');
    const num = opt.number.toUpperCase();
    assert(!seen.has(num), `duplicate option number '${opt.number}'`);
    seen.add(num);
    assert(typeof opt.labelKey === 'string' && opt.labelKey.trim(), 'option.labelKey must be a non-empty string');
    if (opt.emoji !== undefined && opt.emoji !== null) assert(typeof opt.emoji === 'string', 'option.emoji must be a string');
    assert(typeof opt.action === 'string' && ACTION_RE.test(opt.action), `option.action '${opt.action}' must be open:<id> | copy_id | sleep | custom:<name>`);
    if (opt.featureId !== undefined) assert(typeof opt.featureId === 'string' && opt.featureId.trim(), 'option.featureId must be a non-empty string');
    if (opt.adminOnly !== undefined) assert(typeof opt.adminOnly === 'boolean', 'option.adminOnly must be boolean');
    if (opt.hidden !== undefined) assert(typeof opt.hidden === 'boolean', 'option.hidden must be boolean');
    if (opt.customHandler !== undefined) assert(typeof opt.customHandler === 'string', 'option.customHandler must be a string');
    if (opt.hideWhenUnavailable !== undefined) assert(typeof opt.hideWhenUnavailable === 'boolean', 'option.hideWhenUnavailable must be boolean');
    if (opt.breakBefore !== undefined) assert(typeof opt.breakBefore === 'boolean', 'option.breakBefore must be boolean');
    if (opt.fallbackKey !== undefined) assert(typeof opt.fallbackKey === 'string' && opt.fallbackKey.trim(), 'option.fallbackKey must be a non-empty string');
    if (opt.dynamicSuffix !== undefined) assert(typeof opt.dynamicSuffix === 'string' && opt.dynamicSuffix.trim(), 'option.dynamicSuffix must be a non-empty string');
    if (opt.progressId !== undefined) assert(typeof opt.progressId === 'string' && opt.progressId.trim(), 'option.progressId must be a non-empty string');
    if (opt.perm !== undefined && opt.perm !== null) assert(typeof opt.perm === 'string' && opt.perm.trim(), 'option.perm must be a non-empty string');
    if (opt.appendLines !== undefined) assert(Array.isArray(opt.appendLines), 'option.appendLines must be an array');
  }
  return true;
}
