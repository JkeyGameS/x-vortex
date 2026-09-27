import config from '../config/config.js';

const FALLBACK_RANGES = {
  morning: { start: '05:00', end: '11:59' },
  afternoon: { start: '12:00', end: '16:59' },
  evening: { start: '17:00', end: '21:59' },
  night: { start: '22:00', end: '04:59' }
};

function getRanges() {
  const cfg = config.chatTimeRanges;
  if (cfg && typeof cfg === 'object') {
    const out = {};
    for (const bucket of ['morning', 'afternoon', 'evening', 'night']) {
      const r = cfg[bucket];
      if (r && typeof r.start === 'string' && typeof r.end === 'string') {
        out[bucket] = { start: r.start, end: r.end };
      }
    }
    if (Object.keys(out).length === 4) return out;
  }
  return FALLBACK_RANGES;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hourInUserTz(date, timezone) {
  const d = date instanceof Date ? date : new Date(date);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || 'UTC'
    }).formatToParts(d);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    return get('hour') * 60 + get('minute');
  } catch {
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/**
 * Compute the time-of-day bucket for a date in the given IANA timezone.
 * @returns {'morning'|'afternoon'|'evening'|'night'}
 */
export function getTimeOfDay(date = new Date(), timezone = 'UTC') {
  const ranges = getRanges();
  const mins = hourInUserTz(date, timezone);
  const inRange = (start, end) => {
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (s <= e) return mins >= s && mins <= e;
    return mins >= s || mins <= e;
  };
  for (const bucket of ['morning', 'afternoon', 'evening', 'night']) {
    if (inRange(ranges[bucket].start, ranges[bucket].end)) return bucket;
  }
  return 'night';
}
