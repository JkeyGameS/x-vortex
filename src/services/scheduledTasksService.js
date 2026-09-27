import sessionManager from '../utils/sessionManager.js';
import * as scheduleService from './scheduleService.js';
import * as featureScheduleService from './featureScheduleService.js';

/**
 * Aggregate scheduled broadcasts, feature schedules, and active try sessions
 * into one newest-last list for the admin Scheduled Tasks overview.
 * @returns {Array<{ kind: 'broadcast'|'feature'|'try', id: string, title: string, detail: string, ts: number|null, key?: string }>}
 */
export function listScheduledTasks() {
  const out = [];

  for (const entry of scheduleService.listScheduled()) {
    out.push({
      kind: 'broadcast',
      id: entry.id,
      title: entry.text,
      detail: entry.recurrence && entry.recurrence !== 'once' ? `repeat: ${entry.recurrence}` : '',
      ts: typeof entry.sendAt === 'number' ? entry.sendAt : null
    });
  }

  for (const entry of featureScheduleService.listFeatureSchedules()) {
    out.push({
      kind: 'feature',
      id: entry.id,
      title: `${entry.featureId} → ${entry.newStatus}`,
      detail: '',
      ts: typeof entry.startAt === 'number' ? entry.startAt : null
    });
  }

  for (const { key, state } of sessionManager.listSessions()) {
    if (state?.isTestActive && state?.testSession?.testUserJid) {
      out.push({
        kind: 'try',
        id: state.testSession.testUserJid,
        title: state.testSession.testUserJid,
        detail: '',
        ts: state.testSession.endTime ? new Date(state.testSession.endTime).getTime() : null,
        key
      });
    }
  }

  out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return out;
}

export function getScheduledTasksCount() {
  return listScheduledTasks().length;
}

export async function cancelScheduledTask(kind, id) {
  if (kind === 'broadcast') return scheduleService.cancelSchedule(id);
  if (kind === 'feature') return featureScheduleService.cancelFeatureSchedule(id);
  if (kind === 'try') {
    const found = sessionManager.listSessions().find(
      (s) => s.state?.isTestActive && s.state?.testSession?.testUserJid === id
    );
    if (!found) return false;
    return sessionManager.clearByKey(found.key);
  }
  return false;
}

export async function clearAllScheduledTasks() {
  const broadcasts = await scheduleService.clearAllSchedules();
  const features = await featureScheduleService.clearAllFeatureSchedules();
  let sessions = 0;
  for (const { key, state } of sessionManager.listSessions()) {
    if (state?.isTestActive && state?.testSession) {
      if (sessionManager.clearByKey(key)) sessions++;
    }
  }
  return { broadcasts, features, sessions };
}
