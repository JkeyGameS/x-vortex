import { t } from '../services/localeService.js';
import { toSmallCaps } from './smallCaps.js';

function shortDuration(language, seconds) {
  const units = [
    [365 * 24 * 60 * 60, 'yearsShort'],
    [30 * 24 * 60 * 60, 'monthsShort'],
    [60 * 60, 'hoursShort'],
    [60, 'minutesShort'],
    [1, 'secondsShort']
  ];
  for (const [size, key] of units) {
    if (seconds >= size && seconds % size === 0) {
      return `${seconds / size} ${toSmallCaps(t(language, 'messageSettings.' + key))}`;
    }
  }
  return `${seconds} ${toSmallCaps(t(language, 'messageSettings.secondsShort'))}`;
}

function selfDestructIsActive(setting) {
  if (setting?.enabled !== true) return false;
  return setting.always === true || Number(setting.remainingCount) > 0;
}

export function buildMessageSettingsStatus(language, user) {
  const selfDestruct = user?.preferences?.selfDestruct;
  const nativeSeconds = Number(user?.preferences?.nativeDisappearing || 0);
  const selfActive = selfDestructIsActive(selfDestruct);
  const nativeActive = nativeSeconds > 0;
  if (!selfActive && !nativeActive) return '';

  const parts = [];
  if (selfActive) parts.push('> *⏳ ' + shortDuration(language, Number(selfDestruct.durationSeconds) || 0) + '*');
  if (nativeActive) parts.push('> *💬 ' + shortDuration(language, nativeSeconds) + '*');

  if (parts.length === 1) {
    const suffixKey = selfActive ? 'selfDestructStatus' : 'nativeStatus';
    return parts[0] + ' — ' + toSmallCaps(t(language, 'messageSettings.' + suffixKey));
  }
  return parts.join(' | ');
}
