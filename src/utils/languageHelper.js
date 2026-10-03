// Language display data, editable from the admin menu.
//
// The language name + flag pairing lives in botContent, not in code, so an
// admin can correct a flag (say 🇬🇧 -> 🇺🇸) without a deploy. The code-level
// defaults stay in src/config/defaultBotContent.js as the fallback.
import { getContent } from '../services/botContentService.js';
import { toSmallCaps } from './smallCaps.js';

/**
 * @param {string} code language code, e.g. 'en'
 * @returns {{ name: string, nameDisplay: string, flag: string, full: string }}
 */
export function getLanguageDisplay(code) {
  const fallback = { name: String(code ?? ''), flag: '' };
  const lang = getContent(`languageDisplay.languages.${code}`, fallback) || fallback;
  const smallCapsOn = getContent('languageDisplay.smallCapsEnabled', true) !== false;
  const nameDisplay = smallCapsOn ? toSmallCaps(lang.name) : lang.name;
  return {
    name: lang.name,
    nameDisplay,
    flag: lang.flag || '',
    full: `${nameDisplay} ${lang.flag || ''}`.trim()
  };
}

/** Every configured language, for menus and previews. */
export function listLanguageDisplay(codes) {
  return (codes || []).map((c) => ({ code: c, ...getLanguageDisplay(c) }));
}

export function smallCapsEnabled() {
  return getContent('languageDisplay.smallCapsEnabled', true) !== false;
}