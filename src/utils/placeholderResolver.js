// Placeholder substitution for admin-editable templates.
//
// toSmallCaps is applied to the STATIC FRAGMENTS ONLY, never to the dynamic
// values and never to the finished string. That gives three properties:
//   - a user's name keeps its own case and styling
//   - a language name is always capped when languageDisplay.smallCapsEnabled
//   - an admin who pastes already-capped text gets it back unchanged, because
//     toSmallCaps is idempotent
import { toSmallCaps } from './smallCaps.js';
import { getContent } from '../services/botContentService.js';

/**
 * Placeholders that receive a raw (uncapped) value: user-supplied or brand
 * names, or plain numbers. Everything else is bot copy and gets capped like
 * the rest of the static text -- {timeOfDay} is included because it comes from
 * the localized greeting word, not from anything the user typed.
 *
 * groupName and memberCount are group-scoped dynamic values and are raw: a
 * group name keeps its own casing and a count must stay in ASCII digits.
 */
const RAW_PLACEHOLDERS = [
  'pushName',
  'languageFlag',
  'botName',
  'minutes',
  'detectedRaw',
  'groupName',
  'memberCount'
];
const CAPPED_PLACEHOLDERS = ['timeOfDay', 'languageName'];
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/**
 * @param {string} template
 * @param {{pushName?:string, languageName?:string, languageFlag?:string,
 *          timeOfDay?:string, botName?:string, cooldownMinutes?:number,
 *          minutes?:number, detectedRaw?:string, groupName?:string,
 *          memberCount?:number}} ctx
 * @returns {string}
 */
export function resolvePlaceholders(template, ctx = {}) {
  if (typeof template !== 'string') return template;

  const smallCapsOn = getContent('languageDisplay.smallCapsEnabled', true) !== false;

  const valueFor = (key) => {
    switch (key) {
      case 'pushName': return ctx.pushName || '';
      case 'languageName': {
        const raw = ctx.languageName || '';
        // A language name is one of the few dynamic values that IS capped.
        return smallCapsOn ? toSmallCaps(raw) : raw;
      }
      case 'languageFlag': return ctx.languageFlag || '';
      case 'timeOfDay': {
        const raw = ctx.timeOfDay || '';
        // Bot copy (the localized greeting word), not user input.
        return smallCapsOn ? toSmallCaps(raw) : raw;
      }
      case 'botName': return ctx.botName || 'X-Vortex';
      case 'minutes': return String(ctx.cooldownMinutes ?? ctx.minutes ?? 5);
      case 'detectedRaw': return ctx.detectedRaw || 'unknown';
      case 'groupName': return ctx.groupName || '';
      case 'memberCount': return ctx.memberCount != null ? String(ctx.memberCount) : '';
      default: return '';
    }
  };

  // Cap the literal runs between placeholders, splice values in untouched.
  let out = '';
  let last = 0;
  for (const m of String(template).matchAll(PLACEHOLDER_RE)) {
    out += toSmallCaps(template.slice(last, m.index));
    const key = m[1];
    out += RAW_PLACEHOLDERS.includes(key) || CAPPED_PLACEHOLDERS.includes(key)
      ? valueFor(key)
      : valueFor(key);
    last = m.index + m[0].length;
  }
  out += toSmallCaps(template.slice(last));

  // A placeholder that resolved to nothing leaves the surrounding emphasis
  // markers behind -- "*{pushName}*" with no name becomes "**", which WhatsApp
  // renders literally. Drop empty emphasis pairs. Real emphasis in the static
  // text (for example "*yes*" in a retry prompt) is unaffected because those
  // never collapse to an empty pair.
  return out
    .replace(/\*\*+/g, '')
    .replace(/\*[ \t\u00A0]{1,3}\*/g, '')
    // Removing an empty emphasis pair leaves the padding around it behind.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '');
}

export { RAW_PLACEHOLDERS, CAPPED_PLACEHOLDERS };