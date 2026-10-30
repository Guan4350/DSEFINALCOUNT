import type { CalendarEvent } from '../types';
import { eventStartMs } from './clock';

export const EXAM_TYPES: CalendarEvent['type'][] = ['dse', 'mock', 'school', 'sba'];

export function isExamEvent(event: CalendarEvent): boolean {
  return !event.deleted && EXAM_TYPES.includes(event.type);
}

/**
 * All upcoming exams, sorted by the exact Hong Kong timestamp. Timed papers
 * are only kept while they are in the future; an all-day exam remains visible
 * for the rest of its day so it does not disappear at midnight.
 */
export function upcomingExamEvents(
  events: CalendarEvent[],
  nowMs: number,
  subjectIds?: ReadonlySet<string>,
): CalendarEvent[] {
  return events
    .filter((event) => {
      if (!isExamEvent(event)) return false;
      if (subjectIds && (!event.subjectId || !subjectIds.has(event.subjectId))) return false;
      const target = eventStartMs(event);
      if (Number.isNaN(target)) return false;
      if (event.allDay) return target + 86_400_000 > nowMs;
      return target >= nowMs;
    })
    .sort((a, b) => {
      const diff = eventStartMs(a) - eventStartMs(b);
      if (diff) return diff;
      return a.title.localeCompare(b.title);
    });
}

export function nextExamEvent(
  events: CalendarEvent[],
  nowMs: number,
  subjectIds?: ReadonlySet<string>,
): CalendarEvent | undefined {
  return upcomingExamEvents(events, nowMs, subjectIds)[0];
}
