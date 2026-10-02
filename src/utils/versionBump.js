// Semantic version parsing and bump suggestions for changelog drafts.

export function parseVersion(v) {
  // Defaults matter: a version like "nope" splits to one element, and without
  // them the missing parts are undefined and any bump yields "NaN".
  const [major = 0, minor = 0, patch = 0] = String(v ?? '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  return { major, minor, patch };
}

/** X.Y.Z with no leading zeros and non-negative parts. */
export function isValidVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(String(v ?? '').trim());
}

/**
 * Next version for a change of the given type.
 * breaking/security bump major, feature bumps minor, everything else patches.
 */
export function suggestVersionBump(current, type) {
  const { major, minor, patch } = parseVersion(current);
  switch (type) {
    case 'breaking':
    case 'security':
      return `${major + 1}.0.0`;
    case 'feature':
      return `${major}.${minor + 1}.0`;
    case 'fix':
    case 'improvement':
    case 'initial':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}
