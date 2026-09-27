import { toSmallCaps } from './smallCaps.js';

/**
 * Build a menu string with small caps static text and proper heading.
 * @param {string} headingStatic - Static part of the heading (will be converted to small caps).
 * @param {string} [dynamicHeadingPart] - Optional dynamic text appended to heading without small caps (e.g., username).
 * @param {Array<string|{static: string, dynamic?: string}|{segments: Array<{static?: string}|{dynamic?: string}>}>} bodyLines - Menu body lines. Strings are fully small-capped; objects combine a static small-caps part and an optional dynamic normal-case part; segment arrays interleave several static (small-caps) and dynamic (normal-case) parts in order.
 * @returns {string} The complete menu text.
 */
export function buildMenu(headingStatic, dynamicHeadingPart = '', bodyLines = []) {
  const heading = `> *${toSmallCaps(headingStatic)}${dynamicHeadingPart ? ' ' + dynamicHeadingPart : ''}*`;
  const lines = [heading, ''];

  for (const line of bodyLines) {
    if (typeof line === 'string') {
      lines.push(toSmallCaps(line));
    } else if (line && typeof line === 'object') {
      if (Array.isArray(line.segments)) {
        lines.push(line.segments.map((seg) => {
          if (seg && typeof seg === 'object' && 'dynamic' in seg) return seg.dynamic ?? '';
          if (seg && typeof seg === 'object' && 'static' in seg) return toSmallCaps(seg.static ?? '');
          return '';
        }).join(''));
      } else {
        const staticPart = line.static ?? '';
        const dynamicPart = line.dynamic ?? '';
        lines.push(toSmallCaps(staticPart) + dynamicPart);
      }
    } else {
      lines.push('');
    }
  }

  return lines.join('\n');
}