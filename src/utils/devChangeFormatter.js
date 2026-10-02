// Renders dev-change entries for the admin notification.
//
// Static labels are small-capped in code; dynamic values (ids, agent names,
// timestamps, file paths, change text) are inserted as-is. Emojis live here in
// code, never in translations.

import { toSmallCaps } from './smallCaps.js';

const MAX_FILES_SHOWN = 8;
const MAX_SUMMARIES_SHOWN = 5;

export function relativeTime(ts) {
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return toSmallCaps('unknown time');
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return toSmallCaps('just now');
  if (mins < 60) return mins + ' ' + toSmallCaps('min ago');
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ' + toSmallCaps('ago');
  const days = Math.floor(hrs / 24);
  return days + 'd ' + toSmallCaps('ago');
}

function fmtTime(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function fileList(entry) {
  const files = Array.isArray(entry.files) ? entry.files : [];
  if (!files.length) return [];
  const lines = ['', '📂 ' + '*' + toSmallCaps('Files') + ' (' + files.length + ')*'];
  const shown = files.slice(0, MAX_FILES_SHOWN);
  for (const f of shown) lines.push('· ' + f);
  if (files.length > shown.length) {
    lines.push(toSmallCaps('… and ') + (files.length - shown.length) + toSmallCaps(' more'));
  }
  return lines;
}

/** Full detail for a single entry. */
export function formatSingleChange(entry) {
  if (!entry) return '';
  const lines = [];
  lines.push('🛠️ ' + '*' + toSmallCaps('Code Update') + '*');
  lines.push('');
  lines.push(toSmallCaps('Change') + ': `' + entry.id + '`');
  lines.push(toSmallCaps('Agent') + ': ' + (entry.agent || 'unknown'));
  lines.push(toSmallCaps('When') + ': ' + relativeTime(entry.timestamp));
  lines.push('');
  lines.push('📝 ' + '*' + toSmallCaps('Task') + '*');
  lines.push(entry.promptSummary || '(no summary)');
  lines.push('');
  lines.push('✨ ' + '*' + toSmallCaps('Changes') + '*');
  for (const c of entry.changes || []) {
    lines.push('• ' + toSmallCaps(c));
  }
  lines.push(...fileList(entry));
  lines.push('');
  lines.push('💡 ' + toSmallCaps('Add to changelog?') + ' → /changelog');
  return lines.join('\n');
}

/** Roll-up used when more than one entry is pending. */
export function formatAggregatedChanges(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return '';
  const lines = [];
  lines.push('🛠️ ' + '*' + toSmallCaps('Code Update') + '* (' + list.length + ' ' + toSmallCaps('changes') + ')');
  lines.push('');
  lines.push(toSmallCaps('Latest') + ': `' + list[0].id + '`');
  if (list.length > 1) {
    const newest = new Date(list[0].timestamp);
    const oldest = new Date(list[list.length - 1].timestamp);
    lines.push(toSmallCaps('Window') + ': ' + fmtTime(oldest) + ' – ' + fmtTime(newest));
  }
  lines.push('');
  list.slice(0, MAX_SUMMARIES_SHOWN).forEach((e, i) => {
    lines.push((i + 1) + '. ' + toSmallCaps(e.promptSummary || '(no summary)'));
  });
  if (list.length > MAX_SUMMARIES_SHOWN) {
    lines.push(toSmallCaps('… and ') + (list.length - MAX_SUMMARIES_SHOWN) + toSmallCaps(' more'));
  }

  const filesSet = new Set();
  for (const e of list) for (const f of e.files || []) filesSet.add(f);
  lines.push('');
  lines.push('📂 ' + toSmallCaps('Total') + ': ' + filesSet.size + ' ' + toSmallCaps('files changed'));
  lines.push('');
  lines.push('💡 ' + toSmallCaps('Review draft changelog') + ' → /changelog');
  return lines.join('\n');
}

export const __testing = { MAX_FILES_SHOWN, MAX_SUMMARIES_SHOWN, fmtTime };