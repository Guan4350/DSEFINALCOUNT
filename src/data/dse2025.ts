import type { SubjectCategory } from '../types';

export interface SystemExamEvent {
  id: string;
  year: number;
  date: string;
  startTime?: string;
  endTime?: string;
  subject: string;
  subjectCategory: SubjectCategory;
  paper?: string;
  title: string;
  source: 'official' | 'estimated';
}

export const DSE_BASE_YEAR = 2025;

type Row = [
  date: string,
  start: string,
  end: string,
  subject: string,
  category: SubjectCategory,
  paper: string,
];

/**
 * 2025 HKDSE finalised written timetable, transcribed from the HKEAA circular
 * "Finalised Examination Timetable for 2025 Examination" (31 Oct 2024).
 * Speaking / practical windows are intentionally not expanded into fake daily
 * papers; the written papers are the stable revision backbone.
 */
const ROWS: Row[] = [
  ['2025-04-01', '08:30', '12:30', '視覺藝術', 'ELECTIVE', 'Paper 1, 2'],
  ['2025-04-02', '08:30', '10:00', '中國語文', 'CHI', 'Paper 1'],
  ['2025-04-02', '10:45', '13:00', '中國語文', 'CHI', 'Paper 2'],
  ['2025-04-03', '08:30', '10:00', '英國語文', 'ENG', 'Paper 1'],
  ['2025-04-03', '11:00', '13:00', '英國語文', 'ENG', 'Paper 2'],
  ['2025-04-05', '09:15', '12:10', '英國語文', 'ENG', 'Paper 3（聆聽及綜合能力）'],
  ['2025-04-07', '08:30', '10:45', '數學', 'MATH', '必修部分 Paper 1'],
  ['2025-04-07', '11:30', '12:45', '數學', 'MATH', '必修部分 Paper 2'],
  ['2025-04-08', '08:30', '10:30', '公民與社會發展', 'CSD', 'Paper 1'],
  ['2025-04-09', '08:30', '10:15', '倫理與宗教', 'ELECTIVE', 'Paper 1'],
  ['2025-04-09', '11:00', '12:45', '倫理與宗教', 'ELECTIVE', 'Paper 2'],
  ['2025-04-10', '08:30', '11:00', '化學', 'ELECTIVE', 'Paper 1'],
  ['2025-04-10', '11:45', '12:45', '化學', 'ELECTIVE', 'Paper 2'],
  ['2025-04-11', '08:30', '10:30', '健康管理與社會關懷', 'ELECTIVE', 'Paper 1'],
  ['2025-04-11', '11:15', '13:00', '健康管理與社會關懷', 'ELECTIVE', 'Paper 2'],
  ['2025-04-12', '08:30', '10:30', '資訊及通訊科技', 'ELECTIVE', 'Paper 1'],
  ['2025-04-12', '11:15', '12:45', '資訊及通訊科技', 'ELECTIVE', 'Paper 2'],
  ['2025-04-14', '08:30', '11:00', '生物', 'ELECTIVE', 'Paper 1'],
  ['2025-04-14', '11:45', '12:45', '生物', 'ELECTIVE', 'Paper 2'],
  ['2025-04-15', '08:30', '09:30', '企業、會計與財務概論', 'ELECTIVE', 'Paper 1'],
  ['2025-04-15', '10:15', '12:45', '企業、會計與財務概論', 'ELECTIVE', 'Paper 2'],
  ['2025-04-16', '08:30', '11:00', '物理', 'ELECTIVE', 'Paper 1'],
  ['2025-04-16', '11:45', '12:45', '物理', 'ELECTIVE', 'Paper 2'],
  ['2025-04-17', '08:30', '10:30', '設計與應用科技', 'ELECTIVE', 'Paper 1'],
  ['2025-04-17', '11:15', '13:15', '設計與應用科技', 'ELECTIVE', 'Paper 2'],
  ['2025-04-17', '08:30', '11:30', '英語文學', 'ELECTIVE', 'Paper 1'],
  ['2025-04-17', '13:30', '15:30', '英語文學', 'ELECTIVE', 'Paper 2'],
  ['2025-04-22', '08:30', '10:30', '中國文學', 'ELECTIVE', 'Paper 1'],
  ['2025-04-22', '11:15', '13:15', '中國文學', 'ELECTIVE', 'Paper 2'],
  ['2025-04-22', '08:30', '10:00', '科技與生活', 'ELECTIVE', 'Paper 1'],
  ['2025-04-22', '10:45', '12:45', '科技與生活', 'ELECTIVE', 'Paper 2'],
  ['2025-04-23', '08:30', '10:45', '體育', 'ELECTIVE', 'Paper 1'],
  ['2025-04-23', '11:30', '12:45', '體育', 'ELECTIVE', 'Paper 2'],
  ['2025-04-23', '08:30', '10:00', '音樂', 'ELECTIVE', 'Paper 1A'],
  ['2025-04-23', '10:45', '12:15', '音樂', 'ELECTIVE', 'Paper 1B'],
  ['2025-04-24', '08:30', '11:15', '地理', 'ELECTIVE', 'Paper 1'],
  ['2025-04-24', '12:00', '13:15', '地理', 'ELECTIVE', 'Paper 2'],
  ['2025-04-25', '08:30', '10:00', '旅遊與款待', 'ELECTIVE', 'Paper 1'],
  ['2025-04-25', '10:45', '12:30', '旅遊與款待', 'ELECTIVE', 'Paper 2'],
  ['2025-04-26', '08:30', '10:30', '歷史', 'ELECTIVE', 'Paper 1'],
  ['2025-04-26', '11:15', '12:45', '歷史', 'ELECTIVE', 'Paper 2'],
  ['2025-04-28', '08:30', '11:00', '數學', 'MATH', '延伸部分 M1 / M2'],
  ['2025-04-29', '08:30', '10:45', '中國歷史', 'ELECTIVE', 'Paper 1'],
  ['2025-04-29', '11:30', '12:50', '中國歷史', 'ELECTIVE', 'Paper 2'],
  ['2025-04-30', '08:30', '09:30', '經濟', 'ELECTIVE', 'Paper 1'],
  ['2025-04-30', '10:15', '12:45', '經濟', 'ELECTIVE', 'Paper 2'],
];

function slug(value: string): string {
  return value
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .slice(0, 40);
}

export const DSE_2025_EVENTS: SystemExamEvent[] = ROWS.map(
  ([date, startTime, endTime, subject, subjectCategory, paper], index) => ({
    id: `system-2025-${String(index + 1).padStart(2, '0')}-${slug(subject)}`,
    year: 2025,
    date,
    startTime,
    endTime,
    subject,
    subjectCategory,
    paper,
    title: `DSE ${subject} ${paper}`,
    source: 'official',
  }),
);

function shiftYear(date: string, targetYear: number): string {
  const [, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(targetYear, month - 1, day));
  // Keep 29 Feb safe for a non-leap target year.
  if (shifted.getUTCMonth() !== month - 1) shifted.setUTCDate(0);
  return shifted.toISOString().slice(0, 10);
}

export function estimatedTimetable(targetYear: number): SystemExamEvent[] {
  if (targetYear === DSE_BASE_YEAR) return DSE_2025_EVENTS;
  return DSE_2025_EVENTS.map((event, index) => ({
    ...event,
    id: `system-${targetYear}-${String(index + 1).padStart(2, '0')}-${slug(event.subject)}`,
    year: targetYear,
    date: shiftYear(event.date, targetYear),
    title: `DSE ${event.subject} ${event.paper || ''}`.trim(),
    source: 'estimated',
  }));
}

export function defaultDseYear(now = new Date()): number {
  const year = now.getFullYear();
  const reference = new Date(year, 3, 15); // mid-April: the written exam window
  return now <= reference ? year : year + 1;
}
