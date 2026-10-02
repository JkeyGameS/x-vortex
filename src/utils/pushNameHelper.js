// WhatsApp push-name validation, shared by the onboarding greeting and the
// welcome-back greeting. It lives in utils/ (not the onboarding handler) so a
// service can use it without importing a handler -- services must not depend on
// handlers, and the build audit flags that layering violation.

/**
 * Validate a WhatsApp push name for use in a greeting.
 * Rejects empty, too-short, letter-less (punctuation/emoji only) and JID values.
 * @param {unknown} pushName
 * @param {string|null} [jid] the sender's own JID, so "123@lid" is not echoed back
 * @returns {string|null} cleaned name, or null when unusable
 */
export function sanitizePushName(pushName, jid = null) {
  const raw = typeof pushName === 'string' ? pushName.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return null;
  if (jid && raw === jid) return null;
  // Strip variation selectors / ZWJ used by emoji sequences.
  const stripped = raw.replace(/[\u200D\uFE0F]/g, '').trim();
  if (stripped.length < 2) return null;
  // Must contain at least one real letter in any script.
  if (!/\p{L}/u.test(stripped)) return null;
  return raw.slice(0, 32);
}

/**
 * Pick the best available name for a user, preferring the live WhatsApp push
 * name (the user may have renamed themselves) over the stored profile name.
 * @returns {string|null}
 */
export function preferredDisplayName(user, livePushName = undefined, jid = null) {
  const live = sanitizePushName(livePushName, jid);
  if (live) return live;
  return sanitizePushName(user?.pushName ?? user?.name, jid);
}