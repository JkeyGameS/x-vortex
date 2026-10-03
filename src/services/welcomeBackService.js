// Welcome-back greeting for returning users (Prompt B).
//
// Category depends on whether onboarding finished and, when it did not, on how
// long the user was away:
//   A1  5 min .. 1 h    brief nudge, then the onboarding confirmation
//   A2  1 h  .. 24 h   gentle continue
//   A3  24 h .. 7 d    warm reminder
//   A4  7 d+            long time no see
//   B1  5 min .. 24 h
//   B2  24 h .. 7 d
//   B3  7 d+
//
// The variant wording is stored as plain text and pushed through the bot's own
// toSmallCaps at build time. Storing the small-caps glyphs literally instead
// would introduce a second convention: the prompt's pre-rendered strings use a
// turned-s (U+A731) that toSmallCaps never produces, so "s" would look
// different here than in every other menu. Running the shared helper keeps the
// greeting typographically identical to the rest of the bot, and it is applied
// only to the static fragments -- the user's name is spliced in raw.
import config from '../config/config.js';
import { t } from './localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { preferredDisplayName, sanitizePushName } from '../utils/pushNameHelper.js';
import { shouldShowTip } from '../config/welcomeBackToggles.js';
import { updateUser } from './userService.js';
import { getContent } from './botContentService.js';
import { resolvePlaceholders } from '../utils/placeholderResolver.js';
import { welcomeBackThresholds, idleCloseMs } from '../utils/botTiming.js';

/**
 * Menu states that represent a half-finished wizard. If the user left off in
 * one of these, the wizard resumes silently and the welcome is suppressed.
 *
 * tests/welcomeBack.test.mjs re-derives every currentMenu value from src/ and
 * fails if a listed prefix matches nothing, because a stale entry silently
 * stops protecting anything.
 */
export const WIZARD_STATES = [
  // Chat rules
  'chat_add', 'chat_edit', 'chat_duplicate', 'chat_bulk_', 'chat_template_',
  'chat_import_', 'chat_snapshot_', 'chat_settings_', 'chat_snippet_',
  'chat_draft_', 'chat_cleanup_', 'chat_quick_', 'chat_search_input',
  'chat_rate_limit_log', 'chat_performance_', 'chat_unmatched', 'chat_dryrun',
  'chat_response_action', 'chat_trigger_variations', 'chat_multi',
  'chat_ie_', 'chat_active_', 'chat_context_',
  // FAQ
  'faq_add', 'faq_edit', 'faq_duplicate', 'faq_bulk_', 'faq_template_',
  'faq_import_', 'faq_snapshot_', 'faq_resume_', 'faq_cleanup_',
  'faq_test_', 'faq_search_input', 'faq_performance_', 'faq_pack_updates',
  'faq_multi',
  // Broadcast
  'broadcast_input', 'broadcast_schedule', 'broadcast_submenu',
  // Changelog
  'changelog_add_', 'changelog_draft_', 'changelog_entry_', 'changelog_import_',
  'changelog_set_',
  // Exports / import
  'exports_',
  // Conversation
  'conversation_',
  // Templates
  'template_',
  // Change markers
  'change_marker_', 'marker_',
  // Maintenance / sleep / try flows
  'maint_', 'sleep_', 'try_', 'blocked_', 'manage_users_',
  'admin_roles_', 'admin_search', 'admin_scheduled_', 'admin_access_',
  'admin_emergency', 'admin_quick_',
  // Self destruct / processing
  'self_destruct_', 'processing',
  // Custom commands
  'custom_commands',
  // Language onboarding owns its own greeting flow.
  'language_onboarding',
  // Testing
  'test_'
];

/**
 * Prefixes that are intentional guards rather than observed menu values, so
 * they are exempt from the "every prefix must match a real menu" test.
 */
export const WIZARD_GUARDS = ['welcome_'];

/** True when the session sits in a half-finished wizard. */
export function isWizardState(currentMenu) {
  if (!currentMenu || typeof currentMenu !== 'string') return false;
  return [...WIZARD_STATES, ...WIZARD_GUARDS].some((p) => currentMenu.startsWith(p));
}

/** True when the onboarding cooldown lock is still in force. */
export function inCooldownLock(session, now = Date.now()) {
  const until = session?.languageOnboardingLockedUntil;
  return typeof until === 'number' && until > now;
}

// Emojis are concatenated in code, never carried in translations.
const WAVE = '\u{1F44B}';

const HEADING_TEXT = {
  A1: 'Still there?',
  A2: 'Welcome back',
  A3: 'Welcome back',
  A4: 'Long time no see',
  B1: 'Welcome back',
  B2: 'Welcome back',
  B3: 'Long time no see'
};

// Short/long resume headings live in the resume content, not here.

// {name} is substituted after small-capping so it stays readable. Every entry
// also carries a `without` phrasing: dropping the name out of "Hey {name}, ..."
// by string surgery would leave a dangling comma, and the spec asks for the
// name clause to be omitted outright when there is no usable push name.
const BODIES = {
  A1: [
    { with: "Hey {name}, let's finish setting up!", without: "Hey, let's finish setting up!" },
    { with: '{name}, we were this close! Ready to continue?', without: 'We were this close! Ready to continue?' },
    { with: "Still there, {name}? Let's finish this!", without: "Still there? Let's finish this!" }
  ],
  A2: [
    {
      with: "Hey {name}, good to see you again!\n\nLet's continue where we left off.",
      without: "Good to see you again!\n\nLet's continue where we left off."
    },
    { with: 'Welcome back, {name}! Pick up where you left.', without: 'Welcome back! Pick up where you left.' }
  ],
  A3: [
    { with: 'Hey {name}, ready to finish the setup?', without: 'Ready to finish the setup?' },
    { with: "Welcome back, {name}. Let's wrap this up!", without: "Welcome back. Let's wrap this up!" }
  ],
  A4: [
    {
      with: "Wow {name}, it's been a while! Let's get you started.",
      without: "It's been a while! Let's get you started."
    },
    { with: 'Welcome back, {name}! Better late than never.', without: 'Welcome back! Better late than never.' }
  ],
  B1: [
    { with: 'Hey {name}, great to see you again!', without: 'Great to see you again!' },
    { with: 'Welcome back, {name}!', without: 'Welcome back!' }
  ],
  B2: [
    { with: 'Hey {name}, nice to see you again!', without: 'Nice to see you again!' },
    { with: 'Welcome back, {name}!', without: 'Welcome back!' }
  ],
  B3: [
    { with: "Welcome back {name}! Hope you're doing well.", without: "Welcome back! Hope you're doing well." },
    { with: "Long time no see, {name}! Glad you're back.", without: "Long time no see! Glad you're back." }
  ]
};

/**
 * Variants come from botContent.welcomeBack.<variant>, falling back to the
 * code table. An admin may shorten, lengthen or empty a pool, so a missing
 * array degrades to the built-in one rather than throwing.
 */
function variantsFor(variant) {
  const configured = getContent(`welcomeBack.${variant}`);
  return Array.isArray(configured) && configured.length ? configured : BODIES[variant];
}

function pick(variant) {
  const pool = variantsFor(variant);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * The {with, without} pair keeps a nameless greeting grammatical. Content
 * templates use {pushName} only, so a nameless render falls back to the
 * nameless phrasing when the configured variant still references the name.
 */
function fill(variant, name) {
  const chosen = variantsFor(variant.key);
  const source = chosen[variant.index];
  const template = typeof source === 'string' ? source : (name ? source.with : source.without);
  if (!name && /\{pushName\}/.test(String(template))) {
    const fallback = BODIES[variant.key][variant.index];
    return resolvePlaceholders(typeof fallback === 'string' ? fallback : fallback.without, {});
  }
  return resolvePlaceholders(String(template), { pushName: name || '' });
}

/** Usable display name, or null when there is nothing safe to show. */
function nameFor(user, livePushName, jid) {
  return preferredDisplayName(user, livePushName, jid);
}

/**
 * Classify a returning user.
 * @returns {{ category: 'A'|'B', variant: 'A1'|'A2'|'A3'|'A4'|'B1'|'B2'|'B3' }}
 */
export function classifyWelcomeBack(user, gapMs) {
  const { shortGapMs, dayGapMs, weekGapMs } = welcomeBackThresholds();
  if (!user?.language) {
    if (gapMs < shortGapMs) return { category: 'A', variant: 'A1' };
    if (gapMs < dayGapMs) return { category: 'A', variant: 'A2' };
    if (gapMs < weekGapMs) return { category: 'A', variant: 'A3' };
    return { category: 'A', variant: 'A4' };
  }
  if (gapMs < dayGapMs) return { category: 'B', variant: 'B1' };
  if (gapMs < weekGapMs) return { category: 'B', variant: 'B2' };
  return { category: 'B', variant: 'B3' };
}

/** Heading text for a variant, with the emoji and small caps applied. */
/**
 * Welcome-back headings are structural (they label a gap bucket), not editable
 * copy: A4/B3 say "Long time no see" while the resume flow's headingLong says
 * "Welcome back", so the two must not share a key. The prompt's content draft
 * defines no heading for these, so they stay here.
 */
export function headingFor(variant) {
  return WAVE + ' ' + toSmallCaps(HEADING_TEXT[variant] || HEADING_TEXT.A2);
}

/**
 * Build the welcome-back payload for a returning user.
 * @param {object} user user record
 * @param {number} gapMs milliseconds since their previous message
 * @param {{ livePushName?: string, jid?: string }} [opts]
 * @returns {{ heading: string, body: string, category: string, variant: string, showTip: boolean }}
 */
export function buildWelcomeBackMessage(user, gapMs, opts = {}) {
  const { category, variant } = classifyWelcomeBack(user, gapMs);
  const name = nameFor(user, opts.livePushName, opts.jid);
  const pool = variantsFor(variant);
  const body = fill({ key: variant, index: Math.floor(Math.random() * pool.length) }, name);
  return {
    heading: headingFor(variant),
    body,
    category,
    variant,
    showTip: shouldShowTip(variant)
  };
}

/** Render the payload as the final WhatsApp message. */
export function renderWelcomeBack(msg, language = 'en') {
  const lines = [`> *${msg.heading}*`, '', msg.body];
  if (msg.showTip) {
    lines.push('', toSmallCaps(t(language, 'welcomeBack.tip')));
  }
  return lines.join('\n');
}

/**
 * The one gate the router needs.
 *
 * A user with no previous sighting is excluded on purpose: an absent lastSeen
 * means this is their first message ever, which the onboarding flow already
 * greets -- without this guard the gap would read as ~56 years and every new
 * user would get a welcome-back on top of their onboarding.
 *
 * `previousLastSeen` must be passed explicitly by the router. recordLastSeen
 * overwrites user.lastSeen before this runs, so reading it back from the user
 * would always see the value written a moment ago.
 *
 * @returns {{ ok: boolean, reason?: string, gap?: number }}
 */
export function shouldWelcomeBack({ user, session, gap, enabled, previousLastSeen, now = Date.now() }) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (!user) return { ok: false, reason: 'no_user' };
  const previous = previousLastSeen !== undefined ? previousLastSeen : user.lastSeen;
  if (typeof previous !== 'number' || previous <= 0) return { ok: false, reason: 'first_sighting' };
  const effectiveGap = Number.isFinite(gap) ? gap : now - previous;
  if (!(effectiveGap >= welcomeBackThresholds().minGapMs)) return { ok: false, reason: 'gap_too_small', gap: effectiveGap };
  if (inCooldownLock(session, now)) return { ok: false, reason: 'cooldown_lock' };
  if (isWizardState(session?.currentMenu)) return { ok: false, reason: 'in_wizard', menu: session?.currentMenu };
  return { ok: true, gap: effectiveGap };
}

export { sanitizePushName };

// ---------------------------------------------------------------------------
// lastSeen tracking
// ---------------------------------------------------------------------------
//
// updateUser rewrites data/users.json on every call, and the router already
// persists lastActive per message. Writing lastSeen per message too would
// double that disk traffic, so the in-memory value is always exact (welcome-back
// reads it from the live user object) while the disk write is batched. The only
// consequence is that a hard restart can lose up to one flush interval.

const pendingLastSeen = new Map();
let lastFlushAt = 0;

/**
 * Stamp the current message time onto the user and return the gap since their
 * previous one. The previous value is read before it is overwritten, otherwise
 * the gap is always zero.
 *
 * @returns {{ previous: number, gap: number, lastSeen: number }}
 */
export function recordLastSeen(jid, user, now = Date.now()) {
  const previous = typeof user?.lastSeen === 'number' && user.lastSeen > 0 ? user.lastSeen : 0;
  if (user) user.lastSeen = now;
  pendingLastSeen.set(jid, now);
  const interval = Number.isFinite(config.welcomeBack?.lastSeenFlushMs)
    ? config.welcomeBack.lastSeenFlushMs
    : 30000;
  if (now - lastFlushAt >= interval) flushLastSeen(now);
  return { previous, gap: previous > 0 ? now - previous : 0, lastSeen: now };
}

/**
 * Persist every pending lastSeen. Safe to call at any time; returns how many
 * users were written.
 */
export function flushLastSeen(now = Date.now()) {
  lastFlushAt = now;
  if (!pendingLastSeen.size) return 0;
  const entries = [...pendingLastSeen.entries()];
  pendingLastSeen.clear();
  for (const [jid, lastSeen] of entries) {
    try {
      updateUser(jid, { lastSeen });
    } catch { /* a failed presence write must never break the router */ }
  }
  return entries.length;
}