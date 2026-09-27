import logger from './logger.js';
import config from '../config/config.js';
import { getSnippetText } from '../services/snippetService.js';
import { getSettings as getChatSettings } from '../services/chatSettingsService.js';

const SNIPPET_PATTERN = /\{snippet:([A-Za-z0-9_]{1,30})\}/g;

function resolveMaxDepth() {
  try {
    const live = getChatSettings();
    const n = Math.floor(Number(live && live.snippetMaxDepth) || 0);
    if (n > 0) return Math.min(10, n);
  } catch { /* fall through to file config */ }
  const n = Math.floor(Number(config.chatSnippetMaxDepth) || 0);
  return n > 0 ? Math.min(10, n) : 3;
}

/**
 * Expand {snippet:name} placeholders recursively (depth-limited).
 * Unknown snippet names are left unchanged and logged once per call.
 * @returns {{ text: string, expanded: string[] }}
 */
export function expandSnippetsWithMeta(text, language = 'en') {
  const maxDepth = resolveMaxDepth();
  const expanded = [];
  let out = String(text || '');
  for (let depth = 0; depth < maxDepth; depth++) {
    let changed = false;
    out = out.replace(SNIPPET_PATTERN, (m, name) => {
      let snippetText = null;
      try {
        snippetText = getSnippetText(name, language);
      } catch (err) {
        logger.warn({ err, snippet: name }, 'Snippet lookup failed');
      }
      if (snippetText != null) {
        changed = true;
        if (!expanded.includes(name)) expanded.push(name);
        return snippetText;
      }
      logger.warn({ snippet: name }, 'Unknown snippet referenced, leaving placeholder unchanged');
      return m;
    });
    if (!changed) break;
  }
  return { text: out, expanded };
}

/**
 * Replace {snippet:name} with the snippet text for the given language,
 * recursively up to the configured max depth (prevents infinite loops).
 */
export function expandSnippets(text, language = 'en') {
  return expandSnippetsWithMeta(text, language).text;
}
