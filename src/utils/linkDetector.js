/**
 * URL detection for group anti-link (Phase 5).
 *
 * Two passes:
 *   1. explicit URLs -- http://, https://, www. -- always treated as links
 *   2. bare domains  -- "example.com", "sub.example.co.uk" -- treated as links
 *      UNLESS the trailing segment looks like a file extension
 *
 * The file-extension blocklist exists because the bare-domain pattern cannot
 * tell "example.com" from "package.json". Measured false positives without it:
 * package.json, file.txt, node.js, image.png, Readme.md, test.py, hello.world.
 * Warning or muting someone for typing "package.json" is far worse than missing
 * an obscure bare domain, which people post with https:// anyway.
 */

// Scheme-bearing or www-prefixed. No trailing punctuation is captured.
const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

// Bare hostnames with an optional path.
const BARE_DOMAIN_REGEX = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;

/**
 * Trailing segments that mean "a file", not "a site". Compared lowercased.
 */
const FILE_EXTENSIONS = new Set([
  // code / config
  'json', 'txt', 'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'md', 'py', 'rb',
  'go', 'rs', 'java', 'php', 'html', 'htm', 'css', 'scss', 'xml', 'yml',
  'yaml', 'toml', 'ini', 'conf', 'env', 'log', 'lock', 'sh', 'bash', 'bat',
  'ps1', 'sql', 'csv', 'tsv',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'heic',
  // media
  'mp3', 'mp4', 'wav', 'ogg', 'flac', 'mkv', 'mov', 'avi', 'webm',
  // documents / archives
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'rtf', 'epub',
  'zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'dmg', 'iso', 'apk', 'deb', 'rpm'
]);

/** Strip trailing sentence punctuation that the regex happily swallows. */
function trimTrailing(url) {
  return url.replace(/[.,;:!?)\]}'"]+$/, '');
}

function normalizeHostname(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'http://' + url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when the candidate's last dotted segment is a known file extension. */
function looksLikeFile(candidate) {
  const path = candidate.split(/[/?#]/)[0];
  const segs = path.split('.');
  if (segs.length < 2) return false;
  const last = segs[segs.length - 1].toLowerCase();
  return FILE_EXTENSIONS.has(last);
}

/**
 * Detect URLs in a text body.
 * @param {string} text
 * @returns {{ hasLink: boolean, urls: string[], hostnames: string[] }}
 */
export function detectLinks(text) {
  if (!text || typeof text !== 'string') {
    return { hasLink: false, urls: [], hostnames: [] };
  }

  // Explicit URLs win: if both passes match the same host, keep only this form.
  const explicit = (text.match(URL_REGEX) || []).map(trimTrailing).filter(Boolean);
  const explicitHosts = new Set(explicit.map(normalizeHostname).filter(Boolean));

  const bare = (text.match(BARE_DOMAIN_REGEX) || [])
    .map(trimTrailing)
    .filter(Boolean)
    .filter((c) => !looksLikeFile(c))
    .filter((c) => {
      const host = normalizeHostname(c);
      // Skip when the bare pass merely re-found an explicit URL's host.
      return !(host && explicitHosts.has(host));
    });

  const urls = [...new Set([...explicit, ...bare])];
  const hostnames = [...new Set(urls.map(normalizeHostname).filter(Boolean))];
  return { hasLink: urls.length > 0, urls, hostnames };
}

/**
 * True when any detected hostname is covered by the whitelist. A whitelist
 * entry also covers its subdomains, so "example.com" allows "sub.example.com".
 */
export function isWhitelisted(hostnames, whitelist) {
  if (!Array.isArray(hostnames) || !Array.isArray(whitelist) || whitelist.length === 0) {
    return false;
  }
  const entries = whitelist
    .map((w) => String(w || '').toLowerCase().replace(/^www\./, '').trim())
    .filter(Boolean);
  if (!entries.length) return false;
  return hostnames.some((h) => {
    const host = String(h || '').toLowerCase();
    return entries.some((w) => host === w || host.endsWith('.' + w));
  });
}

/** True when any detected URL is a WhatsApp group-chat invite. */
export function isInviteLink(urls) {
  if (!Array.isArray(urls)) return false;
  return urls.some((u) => /chat\.whatsapp\.com\//i.test(String(u || '')));
}

export { FILE_EXTENSIONS };
