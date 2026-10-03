// Single place where timing settings are resolved.
//
// Precedence is botContent (admin-editable) -> config.js (code default). The
// prompt said "always check getContent first"; doing that with no fallback
// would let a bad admin edit change bot behaviour with nothing to fall back on,
// so config.js is kept as the secondary fallback it also suggested.
import { getContent } from '../services/botContentService.js';
import config from '../config/config.js';

const num = (contentValue, configValue) => {
  const c = Number(contentValue);
  if (Number.isFinite(c)) return c;
  const k = Number(configValue);
  return Number.isFinite(k) ? k : 0;
};

/** Typing indicator master switch. */
export function typingIndicatorEnabled() {
  const v = getContent('timing.typingIndicatorEnabled');
  if (typeof v === 'boolean') return v;
  return config.typingIndicatorEnabled !== false;
}

/** 'adaptive' | 'fixed' */
export function typingMode() {
  return getContent('timing.typingMode') || 'adaptive';
}

export function typingDelayMs() {
  return num(getContent('timing.typingDelayMs'), 600);
}

export function typingAdaptivePerCharMs() {
  return num(getContent('timing.typingAdaptivePerCharMs'), config.typingAdaptivePerCharMs ?? 15);
}

export function typingAdaptiveMinMs() {
  return num(getContent('timing.typingAdaptiveMinMs'), config.typingAdaptiveMinMs ?? 200);
}

export function typingAdaptiveMaxMs() {
  return num(getContent('timing.typingAdaptiveMaxMs'), config.typingAdaptiveMaxMs ?? 2500);
}

/** Which sends get a typing indicator: { mainMenu, submenuTransitions, ... }. */
export function typingTargeting() {
  const t = getContent('timing.typingTargeting');
  return t && typeof t === 'object' ? t : {};
}

export function typingTargets(kind) {
  const t = typingTargeting();
  return t[kind] !== false;
}

/** Welcome-back gap thresholds. */
export function welcomeBackThresholds() {
  const w = config.welcomeBack || {};
  return {
    minGapMs: num(getContent('timing.welcomeBackThresholds.minGapMs'), w.minGapMs ?? 300000),
    shortGapMs: num(getContent('timing.welcomeBackThresholds.shortGapMs'), w.shortGapMs ?? 3600000),
    dayGapMs: num(getContent('timing.welcomeBackThresholds.dayGapMs'), w.dayGapMs ?? 86400000),
    weekGapMs: num(getContent('timing.welcomeBackThresholds.weekGapMs'), w.weekGapMs ?? 604800000)
  };
}

/** Onboarding cooldown lock length. */
export function cooldownLockMs() {
  return num(getContent('timing.cooldownLockMs'), 300000);
}

/** Unclear replies allowed before the cooldown lock engages. */
export function retryMaxAttempts() {
  return num(getContent('timing.onboardingRetryMaxAttempts'), 3);
}

/** Silence window after a "no, not now" resume. */
export function idleCloseMs() {
  const v = Number(getContent('timing.idleCloseMs'));
  return Number.isFinite(v) ? v : (config.welcomeBack?.idleCloseMs ?? 1800000);
}