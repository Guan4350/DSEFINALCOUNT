import type { TimerSession } from '../types';
import { addDays, formatDate, startOfWeek } from './date';
import { hkDateISO } from './clock';

/** ISO Monday date (YYYY-MM-DD) used as the stable weekly key. */
export function currentWeekKey(now = new Date()): string {
  return startOfWeek(hkDateISO(now));
}

export function weekEnd(weekKey: string): string {
  return addDays(weekKey, 6);
}

export function weekLabel(weekKey: string): string {
  return `${formatDate(weekKey, { month: 'short', day: 'numeric' })} – ${formatDate(weekEnd(weekKey), { month: 'short', day: 'numeric' })}`;
}

export function weeklySeconds(sessions: TimerSession[], weekKey: string, end = weekEnd(weekKey)): number {
  return sessions.reduce((sum, session) => {
    if (!session.completed) return sum;
    return session.date >= weekKey && session.date <= end ? sum + Math.max(0, session.durationSeconds) : sum;
  }, 0);
}
