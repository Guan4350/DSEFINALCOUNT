import type { CalendarEvent, Settings, SemesterMode } from '../types';

export const HK_TIME_ZONE = 'Asia/Hong_Kong';

export function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function isISODate(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function parseISODate(value: string): Date {
  if (value.includes('T')) {
    return new Date(value);
  }
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toLocalDateTime(date: Date): string {
  return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function addDays(value: string, days: number): string {
  const date = parseISODate(value);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function addDaysDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Calendar-day difference, immune to DST and time-of-day. */
export function dayDiff(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

export function daysUntil(value: string, from = todayISO()): number {
  return dayDiff(from, value);
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return '—';
  const date = parseISODate(value);
  return new Intl.DateTimeFormat('zh-HK', options ?? { month: 'short', day: 'numeric' }).format(date);
}

export function formatFullDate(value: string): string {
  return formatDate(value, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

export function formatMonthTitle(value: string): string {
  return formatDate(value, { year: 'numeric', month: 'long' });
}

export function formatDateTime(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function startOfWeek(value: string): string {
  const date = parseISODate(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toISODate(date);
}

export function endOfMonth(value: string): string {
  const date = parseISODate(value);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function monthMatrix(value: string): string[][] {
  const first = parseISODate(value);
  first.setDate(1);
  const start = parseISODate(startOfWeek(toISODate(first)));
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const row: string[] = [];
    for (let d = 0; d < 7; d += 1) {
      const current = new Date(start);
      current.setDate(start.getDate() + w * 7 + d);
      row.push(toISODate(current));
    }
    weeks.push(row);
  }
  return weeks;
}

export function lastNDays(n: number, end = todayISO()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(addDays(end, -i));
  return out;
}

export function humanDays(days: number): string {
  if (days === 0) return '今日';
  if (days > 0) return `${days} 日`;
  return `${Math.abs(days)} 日前`;
}

export interface SemesterInfo {
  id: SemesterMode;
  label: string;
  shortLabel: string;
  start: string;
  end: string;
  progress: number;
}

function modeLabel(mode: SemesterMode): { label: string; shortLabel: string } {
  switch (mode) {
    case 's1':
      return { label: '學期一 · 建立節奏', shortLabel: 'S1' };
    case 's2':
      return { label: '學期二 · 深化與鞏固', shortLabel: 'S2' };
    case 'mock':
      return { label: 'Mock 衝刺期 · 以考代練', shortLabel: 'MOCK' };
    case 'dse':
      return { label: 'DSE 衝刺期 · 收斂與沉穩', shortLabel: 'DSE' };
    case 'holiday':
      return { label: '長假期 · 自主編排', shortLabel: 'BREAK' };
    default:
      return { label: '自動學期', shortLabel: 'AUTO' };
  }
}

/**
 * Hong Kong school-year heuristic. It is intentionally configurable: schools
 * differ, so the mode can be overridden in settings. DSE proximity wins over
 * the calendar month because revision behaviour changes near the exam.
 */
export function getSemester(settings: Settings, date = todayISO()): SemesterInfo {
  const day = parseISODate(date);
  const month = day.getMonth() + 1;
  let mode: SemesterMode = settings.semesterMode;

  if (mode === 'auto') {
    const dseDays = settings.dseStartDate ? daysUntil(settings.dseStartDate, date) : null;
    if (dseDays !== null && dseDays >= 0 && dseDays <= 90) {
      mode = 'dse';
    } else if (month >= 9 || month === 1) {
      mode = 's1';
    } else if (month >= 2 && month <= 3) {
      mode = 'mock';
    } else if (month >= 4 && month <= 6) {
      mode = 's2';
    } else {
      mode = 'holiday';
    }
  }

  const { label, shortLabel } = modeLabel(mode);
  let start: string;
  let end: string;

  if (mode === 'dse') {
    start = settings.dseStartDate ? addDays(settings.dseStartDate, -90) : `${day.getFullYear()}-01-01`;
    end = settings.dseStartDate || `${day.getFullYear()}-12-31`;
  } else if (mode === 'mock') {
    start = `${day.getFullYear()}-01-01`;
    end = `${day.getFullYear()}-03-31`;
  } else if (mode === 's1') {
    start = `${day.getFullYear()}-09-01`;
    end = `${day.getFullYear() + 1}-01-31`;
  } else if (mode === 's2') {
    start = `${day.getFullYear()}-02-01`;
    end = `${day.getFullYear()}-06-30`;
  } else if (mode === 'holiday') {
    start = `${day.getFullYear()}-07-01`;
    end = `${day.getFullYear()}-08-31`;
  } else {
    start = `${day.getFullYear()}-01-01`;
    end = `${day.getFullYear()}-12-31`;
  }

  const total = Math.max(1, dayDiff(start, end));
  const elapsed = Math.min(total, Math.max(0, dayDiff(start, date)));
  return { id: mode, label, shortLabel, start, end, progress: Math.round((elapsed / total) * 100) };
}

export function eventDate(event: CalendarEvent): string {
  return event.start.slice(0, 10);
}

export function sortByStart(a: CalendarEvent, b: CalendarEvent): number {
  return a.start.localeCompare(b.start);
}

export function weekdayShort(value: string): string {
  return new Intl.DateTimeFormat('zh-HK', { weekday: 'short' }).format(parseISODate(value));
}
