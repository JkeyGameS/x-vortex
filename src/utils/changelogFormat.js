// Presentation helpers for the changelog: entry-type decoration, the paginated
// option map, and input resolution.
//
// The option map lives here (not in the menu or the handler) so the rendered
// layout and the reply handling can never disagree about what "1" means on the
// current page -- option numbers shift once Previous appears.

export const TYPE_META = {
  feature: { emoji: '✨', label: 'feature' },
  improvement: { emoji: '🔧', label: 'improvement' },
  fix: { emoji: '🐛', label: 'fix' },
  breaking: { emoji: '⚠️', label: 'breaking' },
  security: { emoji: '🔒', label: 'security' },
  initial: { emoji: '🎉', label: 'initial' }
};

export function getTypeMeta(type) {
  return TYPE_META[type] || { emoji: '📝', label: 'update' };
}

/** The changelog menu has exactly three interactive rows, plus the back row. */
// menu.info.version is the Info menu's option-2 *string* label, so the
// changelog strings live under menu.info.version_history.
export const OPTION_KEYS = {
  more: 'menu.info.version_history.seeMore',
  previous: 'menu.info.version_history.previous',
  subscribe: 'menu.info.version_history.subscribe'
};

export const OPTION_EMOJI = {
  more: '📜',
  previous: '⬅️',
  subscribe: '🔔'
};

/**
 * Options for a page, already numbered.
 * See more only appears when there is more to show; Previous only past page 1;
 * Subscribe is always last so it keeps a predictable slot at the bottom.
 */
export function changelogOptions({ hasPrev, hasNext }) {
  const rows = [];
  if (hasPrev) rows.push({ key: 'previous', labelKey: OPTION_KEYS.previous, emoji: OPTION_EMOJI.previous });
  if (hasNext) rows.push({ key: 'more', labelKey: OPTION_KEYS.more, emoji: OPTION_EMOJI.more });
  rows.push({ key: 'subscribe', labelKey: OPTION_KEYS.subscribe, emoji: OPTION_EMOJI.subscribe });
  return rows.map((row, index) => ({ ...row, number: String(index + 1) }));
}

/**
 * Resolve a reply number to an action for this page.
 * @returns {'more'|'previous'|'subscribe'|null} null when nothing matches
 */
export function resolveChangelogAction(input, page) {
  const value = String(input ?? '').trim();
  if (!value) return null;
  const hit = changelogOptions(page).find((opt) => opt.number === value);
  return hit ? hit.key : null;
}

/** "1.1.0" style heading line for one entry: emoji, version, date. */
export function formatEntryHeading(entry) {
  const meta = getTypeMeta(entry?.type);
  return `${meta.emoji} *${entry?.version ?? '?'}* · ${entry?.date ?? '?'}`;
}