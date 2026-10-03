// Speaker coordinator.
//
// Three independent flows used to react to the same inbound message and each
// send their own text: the cooldown-expiry branch of the onboarding gate sent a
// reminder *and* a fresh confirmation, Prompt B's welcome-back sent a greeting
// based on `gap`, and the onboarding gate sent the first-time message when the
// user had no language yet. A single message could therefore produce three
// replies.
//
// Exactly one speaker is chosen per message, in this order:
//   cooldown     the onboarding lock just expired and the user must confirm
//   resume       mid-onboarding, returning after a real gap
//   onboarding   mid-onboarding, first contact
//   welcomeBack  onboarded, returning after a real gap
//   menu         onboarded, still here
//
// `cooldown` outranks `resume` because both mean "unfinished onboarding" but
// the cooldown one also has to clear a lock.
import { welcomeBackThresholds } from './botTiming.js';

/**
 * @param {{ user: object|null, session: object|null, gap: number }} input
 * @returns {'cooldown'|'resume'|'onboarding'|'welcomeBack'|'menu'}
 */
export function pickSpeaker({ user, session, gap } = {}) {
  const now = Date.now();
  const gapLong = Number.isFinite(gap) && gap >= welcomeBackThresholds().minGapMs;
  const awaiting = session?.awaitingResumeConfirmation === true;

  // No record yet: first ever contact, the onboarding greeting owns it.
  if (!user) return 'onboarding';

  const lockedUntil = session?.languageOnboardingLockedUntil;

  // The user answered "no, not now". Respect that for the idle window: skip the
  // resume prompt and let normal priority logic run, which for a user without a
  // language is the ordinary first-time onboarding path.
  const idleUntil = session?.idleCloseUntil;
  const idle = typeof idleUntil === 'number' && idleUntil > now && !user.language;
  if (idle) return 'onboarding';

  // 1. The cooldown lock has run out. The lock itself expires silently; this is
  //    the first message after it, so ask before resuming.
  //
  //    Both checks require !user.language. A stale cooldownJustExpired flag
  //    must not drag an onboarded user back into the resume prompt, which is
  //    what happened when the flag was tested on its own.
  if (
    !user.language &&
    (session?.cooldownJustExpired === true ||
      (typeof lockedUntil === 'number' && lockedUntil > 0 && lockedUntil <= now && !awaiting))
  ) {
    return 'cooldown';
  }

  // 2. Unfinished onboarding, returning after a gap.
  if (!user.language && gapLong && !awaiting) return 'resume';

  // 3. Unfinished onboarding, first contact.
  if (!user.language) return 'onboarding';

  // 4. Onboarded.
  if (gapLong) return 'welcomeBack';
  return 'menu';
}

export default pickSpeaker;