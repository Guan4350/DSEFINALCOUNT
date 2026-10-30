export type SubjectCategory = 'CHI' | 'ENG' | 'MATH' | 'CSD' | 'ELECTIVE';

export type EventType = 'dse' | 'mock' | 'school' | 'sba' | 'study' | 'custom';

export type DataSource = 'local' | 'ics' | 'caldav' | 'google' | 'system';

export type SemesterMode = 'auto' | 's1' | 's2' | 'mock' | 'dse' | 'holiday';

export interface Subject {
  id: string;
  name: string;
  category: SubjectCategory;
  custom?: boolean;
}

export interface CalendarEvent {
  id: string;
  uid: string;
  title: string;
  /** YYYY-MM-DD for all-day events, otherwise local ISO date-time without Z. */
  start: string;
  /** Exclusive end for all-day events. */
  end?: string;
  allDay: boolean;
  type: EventType;
  subjectId?: string;
  paper?: string;
  description?: string;
  location?: string;
  rrule?: string;
  source: DataSource;
  externalId?: string;
  etag?: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface Task {
  id: string;
  title: string;
  subjectId: string;
  dueDate: string;
  dueTime?: string;
  completed: boolean;
  completedAt?: string;
  completedDate?: string;
  notes?: string;
  kind: 'study' | 'revision' | 'assignment' | 'other';
  createdAt: string;
  updatedAt: string;
  rolledFrom?: string;
  rolloverCount: number;
  source?: 'local' | 'ics' | 'caldav' | 'google' | 'system';
}

export interface Checkin {
  date: string;
  completedTaskCount: number;
  taskId?: string;
  createdAt: string;
  source: 'local' | 'cloud' | 'worker';
}

export interface Reflection {
  date: string;
  text: string;
  updatedAt: string;
}

export interface ImageNote {
  id: string;
  date: string;
  subjectId?: string;
  caption: string;
  dataUrl: string;
  createdAt: string;
  bytes: number;
}

export interface Settings {
  dseYear: number;
  dseStartDate: string;
  dseEndDate: string;
  studyStartDate: string;
  hiddenSystemExamIds: string[];
  semesterMode: SemesterMode;
  timezone: 'Asia/Hong_Kong';
}

export interface Profile {
  displayName: string;
  leaderboardOptIn: boolean;
  photoURL?: string;
  email?: string;
}

export interface AppData {
  version: 1;
  profile: Profile;
  settings: Settings;
  subjects: Subject[];
  events: CalendarEvent[];
  tasks: Task[];
  checkins: Record<string, Checkin>;
  reflections: Record<string, Reflection>;
  images: ImageNote[];
  lastRollover: string;
}

export interface Stats {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  lastCheckinDate?: string;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  currentStreak: number;
  totalDays: number;
  visible: boolean;
  updatedAt?: string;
}

export type LeaderboardMetric = 'currentStreak' | 'totalDays';

export interface SubjectStat {
  subject: Subject;
  total: number;
  completed: number;
  completionRate: number;
  last30Completed: number;
  weekly: number[];
}

export interface SyncStatus {
  connected: boolean;
  provider?: 'caldav' | 'google';
  label?: string;
  lastSyncAt?: string;
  lastError?: string;
  status?: 'idle' | 'syncing' | 'error' | 'ok';
}

export interface UsageSnapshot {
  date: string;
  reads: number;
  writes: number;
}

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  dse: 'DSE',
  mock: 'Mock',
  school: '校內',
  sba: 'SBA',
  study: '溫習',
  custom: '自訂',
};

export const SUBJECT_CATEGORY_LABEL: Record<SubjectCategory, string> = {
  CHI: '中文',
  ENG: '英文',
  MATH: '數學',
  CSD: '公民與社會發展',
  ELECTIVE: '選修科',
};

export const TASK_KIND_LABEL: Record<Task['kind'], string> = {
  study: '溫習',
  revision: '重溫',
  assignment: '功課',
  other: '其他',
};

export const LEADERBOARD_METRIC_LABEL: Record<LeaderboardMetric, string> = {
  currentStreak: '連續打卡',
  totalDays: '累計天數',
};
