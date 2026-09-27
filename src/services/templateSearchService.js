import { getPacks } from './chatTemplateService.js';

/**
 * Search packs by triggers, replies (all languages), tags, category and id.
 * nameMatches: array of pack ids whose translated label matches (resolved by caller).
 */
export function searchTemplates(query, { nameMatches = [] } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const pack of getPacks()) {
    const hits = [];
    if (pack.id.toLowerCase().includes(q)) hits.push({ field: 'id', context: pack.id });
    if (nameMatches.includes(pack.id)) hits.push({ field: 'name', context: pack.id });
    if ((pack.category || '').toLowerCase().includes(q)) hits.push({ field: 'category', context: pack.category });
    for (const tag of pack.tags || []) {
      if (String(tag).toLowerCase().includes(q)) hits.push({ field: 'tag', context: String(tag) });
    }
    for (const rule of pack.rules || []) {
      for (const tr of rule.triggers || []) {
        if (String(tr).toLowerCase().includes(q)) hits.push({ field: 'trigger', context: String(tr) });
      }
      const replies = rule.replies || {};
      const all = Array.isArray(replies) ? replies : Object.values(replies).flat();
      for (const rp of all) {
        if (String(rp).toLowerCase().includes(q)) {
          hits.push({ field: 'reply', context: String(rp).slice(0, 60) });
          break;
        }
      }
    }
    if (hits.length) out.push({ packId: pack.id, hits: hits.slice(0, 3) });
  }
  return out;
}

export function collectTags() {
  const set = new Map();
  for (const pack of getPacks()) {
    for (const tag of pack.tags || []) {
      const key = String(tag).toLowerCase();
      if (!set.has(key)) set.set(key, { tag: String(tag), count: 0 });
      set.get(key).count += 1;
    }
  }
  return [...set.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

export function packsWithTag(tag) {
  const key = String(tag).toLowerCase();
  return getPacks().filter((p) => (p.tags || []).some((t) => String(t).toLowerCase() === key));
}

export function getFeaturedPacks() {
  return getPacks().filter((p) => p.featured === true);
}
