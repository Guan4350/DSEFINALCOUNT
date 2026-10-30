import type {
  CalendarEvent,
  Checkin,
  Stats,
  Subject,
  SubjectStat,
  Task,
} from '../types';
import { addDays, lastNDays, parseISODate, startOfWeek, todayISO } from './date';

export function computeStats(checkins: Record<string, Checkin>, today = todayISO()): Stats {
  const dates = Object.keys(checkins)
    .filter((date) => checkins[date] && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  if (dates.length === 0) return { currentStreak: 0, longestStreak: 0, totalDays: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i += 1) {
    const diff = Math.round((parseISODate(dates[i]).getTime() - parseISODate(dates[i - 1]).getTime()) / 86_400_000);
    run = diff === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  let cursor = dates.includes(today) ? today : addDays(today, -1);
  let current = 0;
  while (checkins[cursor]) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    currentStreak: current,
    longestStreak: longest,
    totalDays: dates.length,
    lastCheckinDate: dates[dates.length - 1],
  };
}

export interface HeatmapCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export function heatmapCells(checkins: Record<string, Checkin>, end = todayISO(), days = 365): HeatmapCell[] {
  return lastNDays(days, end).map((date) => {
    const checkin = checkins[date];
    if (!checkin) return { date, count: 0, level: 0 };
    const count = Math.max(1, checkin.completedTaskCount || 1);
    const level = count >= 4 ? 4 : count === 3 ? 3 : count === 2 ? 2 : 1;
    return { date, count, level };
  });
}

export function heatmapWeeks(cells: HeatmapCell[]): HeatmapCell[][] {
  const weeks: HeatmapCell[][] = [];
  let current: HeatmapCell[] = [];
  for (const cell of cells) {
    const day = parseISODate(cell.date).getDay();
    current.push(cell);
    if (day === 0) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length) weeks.push(current);
  return weeks;
}

function completedOn(task: Task): string | undefined {
  if (!task.completed) return undefined;
  return (task.completedAt || task.dueDate || '').slice(0, 10) || undefined;
}

export function subjectStats(tasks: Task[], subjects: Subject[], end = todayISO()): SubjectStat[] {
  const weekStarts = Array.from({ length: 8 }, (_, index) => startOfWeek(addDays(end, -(7 - index) * 7)));
  return subjects.map((subject) => {
    const subjectTasks = tasks.filter((task) => task.subjectId === subject.id);
    const completed = subjectTasks.filter((task) => task.completed);
    const last30 = lastNDays(30, end);
    const last30Set = new Set(last30);
    const last30Completed = completed.filter((task) => {
      const date = completedOn(task);
      return date ? last30Set.has(date) : false;
    }).length;
    const weekly = weekStarts.map((week) =>
      completed.filter((task) => {
        const completedDate = completedOn(task);
        return completedDate ? completedDate >= week && completedDate < addDays(week, 7) : false;
      }).length,
    );
    return {
      subject,
      total: subjectTasks.length,
      completed: completed.length,
      completionRate: subjectTasks.length ? Math.round((completed.length / subjectTasks.length) * 100) : 0,
      last30Completed,
      weekly,
    };
  });
}

export interface TrendPoint {
  label: string;
  value: number;
}

export function completionTrend(tasks: Task[], end = todayISO()): TrendPoint[] {
  return Array.from({ length: 8 }, (_, index) => {
    const week = startOfWeek(addDays(end, -(7 - index) * 7));
    const due = tasks.filter((task) => task.dueDate >= week && task.dueDate < addDays(week, 7));
    const completed = due.filter((task) => task.completed).length;
    return {
      label: `${parseISODate(week).getMonth() + 1}/${parseISODate(week).getDate()}`,
      value: due.length ? Math.round((completed / due.length) * 100) : 0,
    };
  });
}

export function upcomingEvents(events: CalendarEvent[], from = todayISO(), limit = 12): CalendarEvent[] {
  return events
    .filter((event) => !event.deleted && event.start.slice(0, 10) >= from && ['dse', 'mock', 'school', 'sba'].includes(event.type))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);
}

export function nextDse(events: CalendarEvent[], dseStartDate: string, from = todayISO()): CalendarEvent | undefined {
  const fromEvents = events
    .filter((event) => !event.deleted && event.type === 'dse' && event.start.slice(0, 10) >= from)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (fromEvents[0]) return fromEvents[0];
  if (!dseStartDate) return undefined;
  return {
    id: 'settings-dse-start',
    uid: 'settings-dse-start',
    title: 'DSE 開考',
    start: dseStartDate,
    allDay: true,
    type: 'dse',
    source: 'local',
    updatedAt: new Date().toISOString(),
  };
}

export function subjectCompletionForExam(tasks: Task[], subjects: Subject[]): SubjectStat[] {
  return subjectStats(tasks, subjects).map((stat) => ({
    ...stat,
    completionRate: stat.total ? stat.completionRate : 0,
  }));
}
