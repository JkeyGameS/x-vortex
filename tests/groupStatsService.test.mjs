// Group activity stats (Phase 6).
//
// Isolated via GROUP_STATS_DATA_PATH. Recording mutates memory only; the tests
// call flushStats() before re-reading from disk, which is exactly what the
// viewer, prune and shutdown hooks do.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-stats-test-'));
const statsFile = path.join(tmpDir, 'groupStats.json');
process.env.GROUP_STATS_DATA_PATH = statsFile;

const config = (await import('../src/config/config.js')).default;
const svc = await import('../src/services/groupStatsService.js');

/** Create the entry via the public API, then mutate the live object. */
const seed = (groupJid) => {
  svc.recordMessage(groupJid, 'seed@lid');
  svc.flushStats();
  return svc.getGroupStats(groupJid);
};

const A = '111111111111@group.gus';
const B = '222222222222@group.gus';
const U1 = '000000000001@lid';
const U2 = '000000000002@lid';

const dayKey = (d) => d.toISOString().slice(0, 10);

beforeEach(() => {
  fs.writeFileSync(statsFile, '{}', 'utf8');
  svc.reload();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('1. recordMessage increments total, daily, hourly and top members', () => {
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U2);
  const s = svc.getGroupStats(A);
  assert.strictEqual(s.totalMessages, 3);
  assert.strictEqual(s.daily[dayKey(new Date())], 3);
  assert.strictEqual(s.hourly[String(new Date().getHours())], 3);
  assert.strictEqual(s.topMembers[U1], 2);
  assert.strictEqual(s.topMembers[U2], 1);
});

test('2. recordJoin and recordLeave increment their counters', () => {
  svc.recordJoin(A);
  svc.recordJoin(A);
  svc.recordLeave(A);
  const s = svc.getGroupStats(A);
  assert.strictEqual(s.joins, 2);
  assert.strictEqual(s.leaves, 1);
  assert.strictEqual(s.totalMessages, 0, 'joins are not messages');
});

test('3. getTopMembers is sorted by count and respects the limit', () => {
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U2);
  const top = svc.getTopMembers(A, 5);
  assert.strictEqual(top[0][0], U1);
  assert.strictEqual(top[0][1], 3);
  assert.strictEqual(top[1][0], U2);
  assert.strictEqual(svc.getTopMembers(A, 1).length, 1, 'limit honoured');
});

test('4. getPeakHour returns the busiest hour bucket', () => {
  const s = seed(A);
  s.hourly = { '3': 2, '14': 9, '20': 5 };
  assert.deepStrictEqual(svc.getPeakHour(A), ['14', 9]);
});

test('getPeakHour is null when there is no data', () => {
  assert.strictEqual(svc.getPeakHour('unknown@group.gus'), null);
  svc.recordMessage(A, U1);
  assert.ok(svc.getPeakHour(A), 'a recorded message creates a bucket');
});

test('5. getDailyActivity(7) returns 7 entries oldest first', () => {
  const days = svc.getDailyActivity(A, 7);
  assert.strictEqual(days.length, 7);
  assert.strictEqual(days[0].count, 0, 'no data is zero, not missing');
  for (let i = 1; i < days.length; i++) {
    assert.ok(days[i].date > days[i - 1].date, 'ascending date order');
  }
  assert.strictEqual(days[6].date, dayKey(new Date()), 'last entry is today');
});

test('getDailyActivity reflects recorded messages on today', () => {
  svc.recordMessage(A, U1);
  const days = svc.getDailyActivity(A, 7);
  assert.strictEqual(days[6].count, 1);
});

test('6. getAggregateStats sums across groups', () => {
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U1);
  svc.recordJoin(A);
  svc.recordMessage(B, U2);
  svc.recordLeave(B);
  const totals = svc.getAggregateStats();
  assert.strictEqual(totals.groupCount, 2);
  assert.strictEqual(totals.totalMessages, 3);
  assert.strictEqual(totals.totalJoins, 1);
  assert.strictEqual(totals.totalLeaves, 1);
});

test('getTopGroups ranks busiest first', () => {
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U1);
  svc.recordMessage(B, U1);
  const rows = svc.getTopGroups(10);
  assert.strictEqual(rows[0].jid, A);
  assert.strictEqual(rows[0].totalMessages, 2);
});

test('7. adjustMemberCount increments and decrements a known baseline', () => {
  svc.setMemberCount(A, 12);
  assert.strictEqual(svc.getCurrentMemberCount(A), 12);
  assert.strictEqual(svc.adjustMemberCount(A, 1), 13);
  assert.strictEqual(svc.adjustMemberCount(A, -1), 12);
  assert.strictEqual(svc.getCurrentMemberCount(A), 12);
});

test('adjustMemberCount never goes below zero', () => {
  svc.setMemberCount(A, 1);
  assert.strictEqual(svc.adjustMemberCount(A, -5), 0);
});

test('adjustMemberCount returns null and stays null without a baseline', () => {
  // This is the "member #1" bug guard: with no baseline the count must stay
  // unknown so the caller falls back to metadata, not report 1.
  assert.strictEqual(svc.adjustMemberCount(A, 1), null);
  assert.strictEqual(svc.getCurrentMemberCount(A), null);
});

test('setMemberCount rejects nonsense values', () => {
  assert.strictEqual(svc.setMemberCount(A, NaN), null);
  assert.strictEqual(svc.setMemberCount(A, -3), null);
  assert.strictEqual(svc.getCurrentMemberCount(A), null);
});

test('a 12-member group joining shows 13, not 1', () => {
  // Mirrors the real flow in groupParticipantHandler: recordJoin plus
  // adjustMemberCount. recordJoin on its own only bumps the joins counter.
  svc.setMemberCount(A, 12);
  svc.recordJoin(A);
  svc.adjustMemberCount(A, 1);
  assert.strictEqual(svc.getCurrentMemberCount(A), 13);
  assert.strictEqual(svc.getGroupStats(A).joins, 1);
});

test('8. pruneOldStats removes daily entries beyond retention', () => {
  const s = seed(A);
  const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  s.daily[old] = 99;
  s.daily[dayKey(new Date())] = 5;
  const res = svc.pruneOldStats();
  assert.ok(res.pruned >= 1);
  assert.ok(!(old in svc.getGroupStats(A).daily), 'the old day is gone');
});

test('9. pruneOldStats keeps entries inside the retention window', () => {
  const s = seed(A);
  const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const today = dayKey(new Date());
  s.daily[recent] = 7;
  s.daily[today] = 3;
  svc.pruneOldStats();
  const d = svc.getGroupStats(A).daily;
  assert.strictEqual(d[recent], 7, '10 days old survives a 90 day window');
  assert.strictEqual(d[today], 3);
});

test('pruning never touches lifetime counters', () => {
  const s = seed(A);
  s.daily[new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)] = 1;
  s.totalMessages = 500;
  s.joins = 7;
  svc.pruneOldStats();
  const after = svc.getGroupStats(A);
  assert.strictEqual(after.totalMessages, 500);
  assert.strictEqual(after.joins, 7);
});

// --- debounced flush -------------------------------------------------------
test('recording does not write to disk synchronously', () => {
  svc.recordMessage(A, U1);
  const raw = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  assert.deepStrictEqual(raw, {}, 'the write is deferred');
  assert.strictEqual(svc.getGroupStats(A).totalMessages, 1, 'but memory has it');
});

test('flushStats writes pending counters to disk', () => {
  svc.recordMessage(A, U1);
  svc.recordMessage(A, U1);
  assert.strictEqual(svc.flushStats(), true);
  const raw = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  assert.strictEqual(raw[A].totalMessages, 2);
});

test('flushStats is a no-op when nothing is pending', () => {
  assert.strictEqual(svc.flushStats(), false);
});

test('counters survive a reload, which is what a redeploy does', () => {
  svc.recordMessage(A, U1);
  svc.recordJoin(A);
  svc.setMemberCount(A, 12);
  svc.flushStats();
  svc.reload();
  const s = svc.getGroupStats(A);
  assert.strictEqual(s.totalMessages, 1);
  assert.strictEqual(s.joins, 1);
  assert.strictEqual(s.currentMembers, 12);
});

test('the kill switch stops all recording', () => {
  const original = config.groupStatsEnabled;
  config.groupStatsEnabled = false;
  try {
    svc.recordMessage(A, U1);
    svc.recordJoin(A);
    svc.recordLeave(A);
    svc.setMemberCount(A, 5);
    assert.strictEqual(svc.getGroupStats(A), null, 'nothing was created');
  } finally {
    config.groupStatsEnabled = original;
  }
});

test('a corrupt stats file degrades to empty', () => {
  fs.writeFileSync(statsFile, 'not json', 'utf8');
  assert.deepStrictEqual(svc.reload(), {});
});
