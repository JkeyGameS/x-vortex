/**
 * Render a duration in milliseconds as a short human string, for {duration}
 * in the moderation DM templates. Static bot copy, so it is returned in normal
 * case and the template resolver small-caps it at render.
 *
 * @param {number} ms
 * @returns {string}
 */
export function humanizeDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '0 seconds';
  if (n < 60_000) {
    const s = Math.round(n / 1000);
    return s + (s === 1 ? ' second' : ' seconds');
  }
  const minutes = Math.round(n / 60_000);
  if (minutes < 60) return minutes + (minutes === 1 ? ' minute' : ' minutes');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour' : ' hours');
  const days = Math.round(hours / 24);
  return days + (days === 1 ? ' day' : ' days');
}