import { DSE_2025_EVENTS } from '../data/dse2025';
import type { Subject, TimerMode } from '../types';
import { resolveSystemSubjectId } from './systemExams';

export interface PaperPreset {
  key: string;
  subjectId: string;
  subjectName: string;
  paper: string;
  title: string;
  minutes: number;
}

function minutesBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

/**
 * Official 2025 written-paper durations, derived from the same HKEAA base
 * timetable that drives the calendar. Keeping one source avoids a paper timer
 * that disagrees with the exam countdown.
 */
export function paperPresets(subjects: Subject[]): PaperPreset[] {
  const seen = new Set<string>();
  return DSE_2025_EVENTS.map((event) => {
    const minutes = minutesBetween(event.startTime, event.endTime);
    const subjectId = resolveSystemSubjectId(event, subjects);
    const paper = event.paper || 'Paper';
    return {
      key: `${event.subject}::${paper}`,
      subjectId,
      subjectName: event.subject,
      paper,
      title: event.title,
      minutes,
    };
  })
    .filter((preset) => preset.subjectId && preset.minutes > 0)
    .filter((preset) => {
      if (seen.has(preset.key)) return false;
      seen.add(preset.key);
      return true;
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName) || a.paper.localeCompare(b.paper));
}

export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`;
}

export function modeLabel(mode: TimerMode): string {
  return mode === 'countdown' ? '倒數' : '正計時';
}

export function todayInHongKong(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
