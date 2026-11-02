import paperRows from '../data/dsePapers.json';
import type { SystemExamEvent } from '../data/dse2025';
import type { Subject, TimerMode } from '../types';
import { resolveSystemSubjectId } from './systemExams';

export interface PaperPreset {
  key: string;
  subjectId: string;
  subjectName: string;
  paper: string;
  title: string;
  startTime: string;
  endTime: string;
  minutes: number;
}

interface PaperRow {
  subject: string;
  subjectCategory: SystemExamEvent['subjectCategory'];
  paper: string;
  title: string;
  startTime: string;
  endTime: string;
  minutes: number;
}

const OFFICIAL_PAPERS = paperRows as PaperRow[];

/**
 * Built-in official paper durations, transcribed into dsePapers.json from the
 * HKEAA timetable used by the calendar. A user can override the duration when
 * starting a countdown. The JSON is intentionally independent of calendar
 * events so the timer library is inspectable and auditable.
 */
export function paperPresets(subjects: Subject[]): PaperPreset[] {
  const seen = new Set<string>();
  return OFFICIAL_PAPERS.map((row) => {
    const paper = row.paper || 'Paper';
    const event: SystemExamEvent = {
      id: `paper-${row.subject}-${paper}`,
      year: 2025,
      date: '',
      startTime: row.startTime,
      endTime: row.endTime,
      subject: row.subject,
      subjectCategory: row.subjectCategory,
      paper,
      title: row.title,
      source: 'official',
    };
    return {
      key: `${row.subject}::${paper}`,
      subjectId: resolveSystemSubjectId(event, subjects),
      subjectName: row.subject,
      paper,
      title: row.title,
      startTime: row.startTime,
      endTime: row.endTime,
      minutes: row.minutes,
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
