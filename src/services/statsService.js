import { getUsersObject } from './userService.js';
import { getTopCommands as analyticsTopCommands } from './analyticsService.js';
import { getAverageRating, getAllFeedback } from './feedbackService.js';

function allUsers() {
  try {
    return Object.values(getUsersObject());
  } catch {
    return [];
  }
}

function parseTime(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return isNaN(ts) ? 0 : ts;
}

/**
 * Global bot statistics for the main Statistics menu.
 */
export function getGlobalStats() {
  const users = allUsers();
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  let totalCommands = 0;
  let totalMessages = 0;
  let newUsers7d = 0;
  let activeUsers24h = 0;
  for (const u of users) {
    totalCommands += u?.stats?.commandsUsed || 0;
    totalMessages += u?.stats?.messagesSent || 0;
    if (now - parseTime(u?.joined) <= week) newUsers7d++;
    if (u?.lastActive && now - parseTime(u.lastActive) <= day) activeUsers24h++;
  }
  const { average, count } = getAverageRating();
  return {
    totalUsers: users.length,
    totalCommands,
    totalMessages,
    avgRating: average,
    ratingCount: count,
    newUsers7d,
    activeUsers24h
  };
}

export function getTopCommands(limit = 10) {
  return analyticsTopCommands(limit);
}

export function getTopUsers(limit = 10) {
  return allUsers()
    .map((u) => ({
      jid: u.jid || '-',
      username: u.username || null,
      name: u.name || null,
      commandsUsed: u?.stats?.commandsUsed || 0,
      messagesSent: u?.stats?.messagesSent || 0
    }))
    .sort((a, b) => b.commandsUsed - a.commandsUsed)
    .slice(0, limit);
}

export function getLanguageDistribution() {
  const dist = { en: 0, fr: 0, de: 0, es: 0, ar: 0, unknown: 0 };
  for (const u of allUsers()) {
    const lang = u?.language;
    if (Object.prototype.hasOwnProperty.call(dist, lang)) dist[lang]++;
    else dist.unknown++;
  }
  return dist;
}

export function getFeatureUsage() {
  const usage = {};
  for (const u of allUsers()) {
    const fu = u?.stats?.featureUsage || {};
    for (const [feature, count] of Object.entries(fu)) {
      usage[feature] = (usage[feature] || 0) + (count || 0);
    }
  }
  return Object.entries(usage)
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count);
}

export function getPeakUsageHour() {
  const hours = new Array(24).fill(0);
  let total = 0;
  for (const u of allUsers()) {
    const list = u?.stats?.recentCommandTimestamps || [];
    for (const ts of list) {
      const d = new Date(ts);
      if (isNaN(d.getTime())) continue;
      hours[d.getHours()]++;
      total++;
    }
  }
  let hour = 0;
  for (let h = 1; h < 24; h++) {
    if (hours[h] > hours[hour]) hour = h;
  }
  return { hour, count: hours[hour], total };
}

export function getSuccessErrorRate() {
  let success = 0;
  let error = 0;
  for (const u of allUsers()) {
    success += u?.stats?.successCommands || 0;
    error += u?.stats?.errorCommands || 0;
  }
  const total = success + error;
  return {
    success,
    error,
    total,
    successRate: total === 0 ? 0 : Math.round((success / total) * 1000) / 10
  };
}

function averageOf(ratings) {
  if (!ratings.length) return { average: 0, count: 0 };
  const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length };
}

export function getFeedbackTrend() {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const { ratings } = getAllFeedback();
  const last7d = ratings.filter((r) => now - parseTime(r.timestamp) <= week);
  const prev7d = ratings.filter((r) => {
    const age = now - parseTime(r.timestamp);
    return age > week && age <= 2 * week;
  });
  const last = averageOf(last7d);
  const prev = averageOf(prev7d);
  return {
    last7d: last,
    prev7d: prev,
    delta: Math.round((last.average - prev.average) * 10) / 10
  };
}

const STOP_WORDS = new Set([
  // en
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'from', 'please', 'would', 'could', 'should', 'when', 'what', 'there', 'their', 'about', 'into', 'more', 'very', 'just', 'like', 'add', 'app', 'bot',
  // fr
  'les', 'des', 'une', 'pour', 'avec', 'dans', 'plus', 'vous', 'nous', 'sur', 'pas', 'que', 'qui', 'est', 'etre', 'etre', 'une', 'des',
  // de
  'und', 'der', 'die', 'das', 'mit', 'für', 'von', 'den', 'eine', 'einer', 'nicht', 'auch', 'sich', 'wird',
  // es
  'los', 'las', 'una', 'para', 'con', 'por', 'que', 'los', 'del', 'como', 'pero', 'esto', 'esta',
  // ar (common particles)
  'من', 'في', 'على', 'أن', 'إلى', 'هذا', 'التي', 'الذي'
]);

export function getTopSuggestionKeywords(limit = 10) {
  const { suggestions } = getAllFeedback();
  const freq = {};
  for (const s of suggestions) {
    const words = String(s.description || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/);
    for (const w of words) {
      if (w.length < 3 || STOP_WORDS.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1))
    .slice(0, limit);
}
