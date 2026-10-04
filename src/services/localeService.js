import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { toSmallCaps } from '../utils/smallCaps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const translationsDir = path.join(__dirname, '../../translations');

// Cache loaded translations
const translations = {};

for (const lang of config.supportedLanguages) {
  try {
    const filePath = path.join(translationsDir, `${lang}.json`);
    translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Failed to load translations for ${lang}:`, err.message);
  }
}

/**
 * Translate a key with optional parameters
 * @param {string} lang - language code
 * @param {string} key - dot notation key (e.g., 'menu.profile')
 * @param {object} [params] - replacement values
 * @returns {string} translated string
 */
export function t(lang, key, params = {}) {
  const langData = translations[lang] || translations[config.defaultLanguage] || {};
  const keys = key.split('.');
  let value = keys.reduce((acc, k) => acc?.[k], langData);

  if (value === undefined) {
    const defaultLang = config.defaultLanguage;
    // Fallback to default language: the key is missing in the requested language.
    if (lang !== defaultLang) {
      logger.warn({ lang, key, fallback: defaultLang }, 'Translation key missing, falling back to default language');
    }
    const defaultData = translations[defaultLang] || {};
    value = keys.reduce((acc, k) => acc?.[k], defaultData);
  }

  if (value === undefined) {
    // Missing in the default language as well.
    //
    // Returning the raw key leaked dotted paths like
    // "menu.bot_content.variant.a1" into menus as small caps. Fall back to the
    // last key segment instead, which stays recognisable without looking like a
    // file path. The key is still logged in full so it can be fixed.
    logger.error({ lang, key }, 'Translation key missing in all languages');
    return humanizeMissingKey(key);
  }

  // Replace placeholders like {username}
  if (typeof value === 'string') {
    return Object.entries(params).reduce(
      (str, [k, v]) => str.replace(new RegExp(`{${k}}`, 'g'), v),
      value
    );
  }
  return value;
}

/**
 * Render a missing key as its last dotted segment, in small caps.
 * "menu.bot_content.variant.a1" -> "ᴀ1"
 */
export function humanizeMissingKey(key) {
  const last = String(key ?? '').split('.').pop() || String(key ?? '');
  // Replace _ and - with spaces so "option_bot_content" reads as words rather
  // than one long token.
  const words = last.replace(/[_-]+/g, ' ').trim();
  return toSmallCaps(words || last);
}