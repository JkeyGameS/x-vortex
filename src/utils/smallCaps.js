const smallCapsMap = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ',
  i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ',
  q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x',
  y: 'ʏ', z: 'ᴢ'
};

// Accented characters mapping to base letter
const accentMap = {
  'à': 'a', 'â': 'a', 'ä': 'a', 'æ': 'a', 'ã': 'a', 'å': 'a',
  'ç': 'ç', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'î': 'i', 'ï': 'i', 'í': 'i', 'ì': 'i',
  'ñ': 'n', 'ô': 'o', 'ö': 'o', 'ò': 'o', 'ó': 'o', 'œ': 'o',
  'ù': 'u', 'û': 'u', 'ü': 'u', 'ú': 'u', 'ü': 'u',
  'ÿ': 'y', 'ß': 's'
};

export function toSmallCaps(input) {
  if (typeof input !== 'string') return input;
  return input
    .toLowerCase()
    .split('')
    .map(char => {
      // If it's a digit or punctuation/symbol/space, return as is
      if (/[0-9\s\W_]/i.test(char) && !accentMap[char]) {
        return char;
      }
      // Check accentMap first
      if (accentMap[char]) {
        return smallCapsMap[accentMap[char]] || char;
      }
      // Then check direct small cap mapping
      return smallCapsMap[char] || char;
    })
    .join('');
}