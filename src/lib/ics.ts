import ICAL from 'ical.js';
import type { CalendarEvent, EventType, Subject, Task } from '../types';
import { addDays, pad, toLocalDateTime, todayISO } from './date';
import { stableUid, uid } from './id';

export interface IcsParseResult {
  events: CalendarEvent[];
  tasks: Task[];
  warnings: string[];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(',');
  if (value === null || value === undefined) return '';
  return String(value);
}

function icalTimeToLocal(time: ICAL.Time, isDate: boolean): string {
  if (isDate) {
    return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  }
  return toLocalDateTime(time.toJSDate());
}

function icalDateOnly(time: ICAL.Time): string {
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
}

function componentDate(component: ICAL.Component, key: string): string | undefined {
  const property = component.getFirstProperty(key);
  if (!property) return undefined;
  const value = property.getFirstValue();
  if (value instanceof ICAL.Time) return value.toJSDate().toISOString();
  return undefined;
}

function deriveType(summary: string, categories: string): EventType {
  const haystack = `${summary} ${categories}`.toUpperCase();
  if (haystack.includes('SBA')) return 'sba';
  if (haystack.includes('MOCK')) return 'mock';
  if (haystack.includes('DSE')) return 'dse';
  if (haystack.includes('EXAM') || haystack.includes('考試') || haystack.includes('期考')) return 'school';
  if (haystack.includes('STUDY') || haystack.includes('溫習') || haystack.includes('REVISION')) return 'study';
  return 'custom';
}

function findSubject(subjects: Subject[], summary: string, categories: string): Subject | undefined {
  const haystack = `${summary} ${categories}`.toUpperCase();
  return subjects.find((subject) => {
    if (haystack.includes(subject.name.toUpperCase())) return true;
    return haystack.includes(subject.category);
  });
}

function parseEvent(component: ICAL.Component, subjects: Subject[], warnings: string[]): CalendarEvent | undefined {
  try {
    const event = new ICAL.Event(component);
    if (!event.startDate) {
      warnings.push('略過一個沒有 DTSTART 的事件。');
      return undefined;
    }
    const allDay = Boolean(event.startDate.isDate);
    const summary = event.summary || '未命名事件';
    const categories = text(component.getFirstPropertyValue('categories'));
    const subject = findSubject(subjects, summary, categories);
    const rruleProp = component.getFirstProperty('rrule');
    const rruleValue = rruleProp?.getFirstValue();
    const rrule = rruleValue ? String(rruleValue) : undefined;
    const end = event.endDate ? icalTimeToLocal(event.endDate, allDay) : undefined;
    const updatedAt = componentDate(component, 'last-modified') || componentDate(component, 'dtstamp') || new Date().toISOString();
    const description = event.description || text(component.getFirstPropertyValue('description'));
    const location = text(component.getFirstPropertyValue('location'));

    return {
      id: uid('evt'),
      uid: event.uid || stableUid('ics-event'),
      title: summary,
      start: icalTimeToLocal(event.startDate, allDay),
      end,
      allDay,
      type: deriveType(summary, categories),
      subjectId: subject?.id,
      description: description || undefined,
      location: location || undefined,
      rrule,
      source: 'ics',
      updatedAt,
    };
  } catch (error) {
    warnings.push(`略過無法解析的事件：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function parseTask(component: ICAL.Component, subjects: Subject[], warnings: string[]): Task | undefined {
  try {
    const summary = text(component.getFirstPropertyValue('summary')) || '未命名任務';
    const description = text(component.getFirstPropertyValue('description'));
    const dueValue = component.getFirstPropertyValue('due');
    let dueDate = todayISO();
    if (dueValue instanceof ICAL.Time) dueDate = icalDateOnly(dueValue);
    const categories = text(component.getFirstPropertyValue('categories'));
    const subject = findSubject(subjects, summary, categories);
    const status = text(component.getFirstPropertyValue('status')).toUpperCase();
    const completed = status === 'COMPLETED' || status === 'CANCELLED';
    const completedValue = component.getFirstPropertyValue('completed');
    const completedAt = completedValue instanceof ICAL.Time ? completedValue.toJSDate().toISOString() : undefined;
    return {
      id: uid('task'),
      title: summary,
      subjectId: subject?.id || subjects[0]?.id || '',
      dueDate,
      completed,
      completedAt,
      notes: description || undefined,
      kind: 'study',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rolloverCount: 0,
      source: 'ics',
    };
  } catch (error) {
    warnings.push(`略過無法解析的任務：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function parseIcs(input: string, subjects: Subject[]): IcsParseResult {
  const warnings: string[] = [];
  try {
    const jcal = ICAL.parse(input);
    const root = new ICAL.Component(jcal);
    const calendars = root.name === 'vcalendar' ? [root] : root.getAllSubcomponents('vcalendar');
    const events: CalendarEvent[] = [];
    const tasks: Task[] = [];
    for (const calendar of calendars.length ? calendars : [root]) {
      for (const component of calendar.getAllSubcomponents('vevent')) {
        const event = parseEvent(component, subjects, warnings);
        if (event) events.push(event);
      }
      for (const component of calendar.getAllSubcomponents('vtodo')) {
        const task = parseTask(component, subjects, warnings);
        if (task) tasks.push(task);
      }
    }
    if (events.length === 0 && tasks.length === 0) warnings.push('這個 .ics 檔案沒有可匯入的 VEVENT 或 VTODO。');
    return { events, tasks, warnings };
  } catch (error) {
    return {
      events: [],
      tasks: [],
      warnings: [`無法解析 .ics：${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line: string): string {
  const bytes = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const charBytes = bytes.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = ` ${char}`;
      currentBytes = 1 + charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  parts.push(current);
  return parts.join('\r\n');
}

function utcStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function dateStamp(value: string): string {
  return value.slice(0, 10).replace(/-/g, '');
}

function addOneDay(value: string): string {
  return addDays(value.slice(0, 10), 1);
}

function subjectFor(subjects: Subject[], subjectId?: string): Subject | undefined {
  return subjects.find((subject) => subject.id === subjectId);
}

function eventLines(event: CalendarEvent, subjects: Subject[]): string[] {
  const subject = subjectFor(subjects, event.subjectId);
  const categories = ['DSE-CANDIDATE', event.type.toUpperCase(), ...(subject ? [subject.category] : [])];
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    `LAST-MODIFIED:${utcStamp(event.updatedAt || new Date().toISOString())}`,
  ];
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(event.start)}`);
    lines.push(`DTEND;VALUE=DATE:${dateStamp(event.end || addOneDay(event.start))}`);
  } else {
    lines.push(`DTSTART:${utcStamp(event.start)}`);
    const end = event.end || new Date(new Date(event.start).getTime() + 60 * 60 * 1000).toISOString();
    lines.push(`DTEND:${utcStamp(end)}`);
    lines.push('TRANSP:OPAQUE');
  }
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.rrule) lines.push(`RRULE:${event.rrule}`);
  lines.push(`CATEGORIES:${categories.join(',')}`);
  if (subject) lines.push(`X-DSE-SUBJECT:${escapeText(subject.name)}`);
  lines.push('BEGIN:VALARM');
  lines.push(`TRIGGER:${event.allDay ? '-P1D' : '-PT1H'}`);
  lines.push('ACTION:DISPLAY');
  lines.push(`DESCRIPTION:${escapeText(event.title)}`);
  lines.push('END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

function taskLines(task: Task, subjects: Subject[]): string[] {
  const subject = subjectFor(subjects, task.subjectId);
  const lines = [
    'BEGIN:VEVENT',
    `UID:task-${escapeText(task.id)}@dse-candidate.local`,
    `DTSTAMP:${utcStamp(new Date().toISOString())}`,
    `DTSTART;VALUE=DATE:${dateStamp(task.dueDate)}`,
    `DTEND;VALUE=DATE:${dateStamp(addOneDay(task.dueDate))}`,
    `SUMMARY:${escapeText(`[任務] ${task.title}`)}`,
    'TRANSP:TRANSPARENT',
    `CATEGORIES:DSE-CANDIDATE,TASK,${subject ? subject.category : 'ELECTIVE'}`,
    `X-DSE-COMPLETED:${task.completed ? 'TRUE' : 'FALSE'}`,
  ];
  if (task.notes) lines.push(`DESCRIPTION:${escapeText(task.notes)}`);
  if (subject) lines.push(`X-DSE-SUBJECT:${escapeText(subject.name)}`);
  lines.push('BEGIN:VALARM');
  lines.push('TRIGGER:-PT1H');
  lines.push('ACTION:DISPLAY');
  lines.push(`DESCRIPTION:${escapeText(task.title)}`);
  lines.push('END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(events: CalendarEvent[], tasks: Task[], subjects: Subject[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DSE Candidate//Personal Learning Dashboard//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:DSE Candidate',
    'X-WR-TIMEZONE:Asia/Hong_Kong',
  ];
  for (const event of events.filter((item) => !item.deleted)) lines.push(...eventLines(event, subjects));
  for (const task of tasks) lines.push(...taskLines(task, subjects));
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
