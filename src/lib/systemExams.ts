import type { CalendarEvent, Subject } from '../types';
import { DSE_BASE_YEAR, DSE_2025_EVENTS, defaultDseYear, estimatedTimetable, type SystemExamEvent } from '../data/dse2025';

export interface OfficialTimetable {
  year: number;
  source: 'official' | 'estimated';
  label: string;
  events: SystemExamEvent[];
  updatedAt?: string;
}

export function timetableForYear(year: number, official?: OfficialTimetable): OfficialTimetable {
  if (official && official.year === year && official.events.length) {
    return { ...official, source: 'official' };
  }
  if (year === DSE_BASE_YEAR) {
    return {
      year,
      source: 'official',
      label: '2025 HKEAA 官方時間表',
      events: DSE_2025_EVENTS,
    };
  }
  return {
    year,
    source: 'estimated',
    label: `預估 ${year} 考期（以 2025 HKEAA 時間表年份 +${year - DSE_BASE_YEAR} 推算）`,
    events: estimatedTimetable(year),
  };
}

function categorySubjectId(category: SystemExamEvent['subjectCategory'], subjects: Subject[]): string {
  const defaultId: Record<SystemExamEvent['subjectCategory'], string> = {
    CHI: 'sub-chi',
    ENG: 'sub-eng',
    MATH: 'sub-math',
    CSD: 'sub-csd',
    ELECTIVE: 'sub-elective',
  };
  return subjects.find((subject) => subject.id === defaultId[category])?.id || subjects[0]?.id || '';
}

export function resolveSystemSubjectId(event: SystemExamEvent, subjects: Subject[]): string {
  const exact = subjects.find((subject) => subject.name === event.subject);
  if (exact) return exact.id;
  const contains = subjects.find((subject) => event.subject.includes(subject.name) || subject.name.includes(event.subject));
  if (contains) return contains.id;
  return categorySubjectId(event.subjectCategory, subjects);
}

export function toCalendarEvents(
  timetable: OfficialTimetable,
  subjects: Subject[],
  hiddenIds: string[],
): CalendarEvent[] {
  const hidden = new Set(hiddenIds);
  return timetable.events
    .filter((event) => !hidden.has(event.id))
    .map((event) => {
      const allDay = !event.startTime || !event.endTime;
      const start = allDay ? event.date : `${event.date}T${event.startTime}:00`;
      const end = allDay ? event.date : `${event.date}T${event.endTime}:00`;
      const suffix = timetable.source === 'estimated'
        ? '\n\n預估日期：以 2025 HKEAA 官方時間表按年份推算，一切以 HKEAA 正式公告為準。'
        : '\n\n2025 HKEAA 最終考試時間表（2024-10-31 修訂）。';
      return {
        id: event.id,
        uid: `${event.id}@dse-candidate.system`,
        title: event.title,
        start,
        end,
        allDay,
        type: 'dse',
        subjectId: resolveSystemSubjectId(event, subjects),
        paper: event.paper,
        description: `${timetable.label}${suffix}`,
        source: 'system',
        updatedAt: timetable.updatedAt || new Date().toISOString(),
      } satisfies CalendarEvent;
    });
}

export function nextSystemExamYear(currentYear: number): number {
  return Math.max(DSE_BASE_YEAR, currentYear);
}

export { DSE_BASE_YEAR, defaultDseYear };
