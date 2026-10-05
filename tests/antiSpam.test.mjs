// Anti-spam detection (Phase 5).
//
// The service keeps history in memory keyed by group+user, so each test uses a
// unique pair and/or a reset. No socket and no messages are involved.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import config from '../src/config/config.js';
import {
  recordMessage,
  recordOffense,
  getOffenseCount,
  clearUser,
  resetAntiSpam,
  getMuteDurationForOffense,
  normalize,
  antiSpamActive
} from '../src/services/antiSpamService.js';

const G = '111111111111@group.gus';
let seq = 0;
const user = () => `u${++seq}@lid`;

beforeEach(() => {
  resetAntiSpam();
});

test('a single message is never flagged', () => {
  const r = recordMessage(G, user(), 'hello everyone');
  assert.strictEqual(r.flagged, false);
});

test('1. three identical messages within the window are flagged as repeat', () => {
  const u = user();
  assert.strictEqual(recordMessage(G, u, 'join my server').flagged, false);
  assert.strictEqual(recordMessage(G, u, 'join my server').flagged, false);
  const third = recordMessage(G, u, 'join my server');
  assert.strictEqual(third.flagged, true);
  assert.strictEqual(third.reason, 'repeat');
  assert.strictEqual(third.count, 3);
});

test('repeat detection ignores case, punctuation and extra whitespace', () => {
  const u = user();
  recordMessage(G, u, 'Join my server');
  recordMessage(G, u, 'join   my server!!');
  const third = recordMessage(G, u, 'JOIN MY SERVER');
  assert.strictEqual(third.flagged, true);
  assert.strictEqual(third.reason, 'repeat');
});

test('2. ten distinct messages in the flood window are flagged as flood', () => {
  const u = user();
  let flagged = null;
  for (let i = 0; i < 10; i++) {
    const r = recordMessage(G, u, `message number ${i}`);
    if (r.flagged) { flagged = r; break; }
  }
  assert.ok(flagged, 'expected a flood flag');
  assert.strictEqual(flagged.reason, 'flood');
  assert.strictEqual(flagged.count, 10);
});

test('3. two distinct messages are not flagged', () => {
  const u = user();
  assert.strictEqual(recordMessage(G, u, 'first thing').flagged, false);
  assert.strictEqual(recordMessage(G, u, 'second thing').flagged, false);
});

test('two different users do not share a flood window', () => {
  const a = user();
  const b = user();
  for (let i = 0; i < 9; i++) recordMessage(G, a, `a${i}`);
  assert.strictEqual(recordMessage(G, b, 'hello').flagged, false);
});

test('two different groups do not share a flood window', () => {
  const u = user();
  for (let i = 0; i < 9; i++) recordMessage(G, u, `a${i}`);
  assert.strictEqual(recordMessage('other@group.gus', u, 'hello').flagged, false);
});

test('very short repeated text is not treated as spam', () => {
  const u = user();
  recordMessage(G, u, 'ok');
  recordMessage(G, u, 'ok');
  const third = recordMessage(G, u, 'ok');
  assert.strictEqual(third.flagged, false, 'a 2-char repeat is skipped');
});

test('the kill switch stops detection entirely', () => {
  const u = user();
  const original = config.antiSpamEnabled;
  config.antiSpamEnabled = false;
  try {
    for (let i = 0; i < 20; i++) {
      assert.strictEqual(recordMessage(G, u, 'same thing').flagged, false);
    }
    assert.strictEqual(antiSpamActive(), false);
  } finally {
    config.antiSpamEnabled = original;
  }
});

test('the block-level enabled flag also stops detection', () => {
  const u = user();
  const original = config.antiSpam.enabled;
  config.antiSpam.enabled = false;
  try {
    for (let i = 0; i < 20; i++) {
      assert.strictEqual(recordMessage(G, u, 'same thing').flagged, false);
    }
  } finally {
    config.antiSpam.enabled = original;
  }
});

test('4. offense count increments', () => {
  const u = user();
  assert.strictEqual(getOffenseCount(G, u), 0);
  assert.strictEqual(recordOffense(G, u).count, 1);
  assert.strictEqual(recordOffense(G, u).count, 2);
  assert.strictEqual(recordOffense(G, u).count, 3);
  assert.strictEqual(getOffenseCount(G, u), 3);
});

test('4. offense count decays after offenseDecayMs', () => {
  const u = user();
  recordOffense(G, u);
  recordOffense(G, u);
  assert.strictEqual(getOffenseCount(G, u), 2);
  // Query as if well past the decay window rather than waiting 24 hours.
  const later = Date.now() + config.antiSpam.offenseDecayMs + 60_000;
  assert.strictEqual(getOffenseCount(G, u, later), 0, 'reads as zero once decayed');
  // And the next offense restarts from 1.
  assert.strictEqual(recordOffense(G, u, later).count, 1);
});

test('offense counts are per user', () => {
  const a = user();
  const b = user();
  recordOffense(G, a);
  recordOffense(G, a);
  assert.strictEqual(getOffenseCount(G, b), 0);
});

test('5. the first offense yields the short mute', () => {
  assert.strictEqual(
    getMuteDurationForOffense(1),
    config.antiSpam.firstOffenseMuteMs
  );
  assert.strictEqual(
    getMuteDurationForOffense(0),
    config.antiSpam.firstOffenseMuteMs,
    'zero offenses still uses the first duration'
  );
});

test('6. the second offense yields the long mute', () => {
  assert.strictEqual(
    getMuteDurationForOffense(2),
    config.antiSpam.secondOffenseMuteMs
  );
  assert.strictEqual(getMuteDurationForOffense(9), config.antiSpam.secondOffenseMuteMs);
  assert.ok(
    config.antiSpam.secondOffenseMuteMs > config.antiSpam.firstOffenseMuteMs,
    'the second duration is genuinely longer'
  );
});

test('clearUser forgets both history and offenses', () => {
  const u = user();
  recordMessage(G, u, 'x');
  recordOffense(G, u);
  clearUser(G, u);
  assert.strictEqual(getOffenseCount(G, u), 0);
  // History is gone too: three repeats are needed again from scratch.
  // "join now" rather than "y": repeat detection skips normalized text under
  // 3 characters, so a one-letter message would never trip it.
  assert.strictEqual(recordMessage(G, u, 'join now').flagged, false);
  assert.strictEqual(recordMessage(G, u, 'join now').flagged, false);
  assert.strictEqual(recordMessage(G, u, 'join now').flagged, true);
});

test('normalize collapses case, spacing and punctuation', () => {
  assert.strictEqual(normalize('  Hello   World!!  '), 'hello world');
  assert.strictEqual(normalize('A'), 'a');
  assert.strictEqual(normalize(''), '');
  assert.strictEqual(normalize(null), '');
});

test('history is capped so a long conversation cannot grow without bound', () => {
  const u = user();
  for (let i = 0; i < 40; i++) recordMessage(G, u, `unique ${i}`);
  // After the cap, the flood window still fires rather than silently resetting.
  assert.strictEqual(recordMessage(G, u, 'unique 40').flagged, true);
});
