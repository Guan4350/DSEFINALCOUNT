import type { AppData, CalendarEvent, Checkin, ImageNote, Reflection, Subject, Task } from '../types';
import { createDefaultData, DEFAULT_SUBJECTS } from './defaults';

export const STORAGE_KEY = 'dse-candidate:data:v1';
const MAX_BYTES = 4_600_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeData(input: unknown): AppData {
  const base = createDefaultData();
  if (!isRecord(input)) return base;

  const profile = isRecord(input.profile) ? input.profile : {};
  const settings = isRecord(input.settings) ? input.settings : {};
  const subjects = asArray<Subject>(input.subjects).filter(
    (subject) =>
      isRecord(subject) &&
      typeof subject.id === 'string' &&
      typeof subject.name === 'string' &&
      ['CHI', 'ENG', 'MATH', 'CSD', 'ELECTIVE'].includes(String(subject.category)),
  );

  const subjectIds = new Set(subjects.map((subject) => subject.id));
  for (const subject of DEFAULT_SUBJECTS) {
    if (!subjectIds.has(subject.id)) subjects.push({ ...subject });
  }

  return {
    version: 1,
    profile: {
      displayName: typeof profile.displayName === 'string' && profile.displayName.trim() ? profile.displayName : 'Candidate',
      leaderboardOptIn: profile.leaderboardOptIn === true,
      photoURL: typeof profile.photoURL === 'string' ? profile.photoURL : undefined,
      email: typeof profile.email === 'string' ? profile.email : undefined,
    },
    settings: {
      ...base.settings,
      ...(typeof settings.dseYear === 'number' ? { dseYear: settings.dseYear } : {}),
      ...(Array.isArray(settings.hiddenSystemExamIds)
        ? { hiddenSystemExamIds: settings.hiddenSystemExamIds.filter((item): item is string => typeof item === 'string') }
        : {}),
      ...(typeof settings.dseStartDate === 'string' ? { dseStartDate: settings.dseStartDate } : {}),
      ...(typeof settings.dseEndDate === 'string' ? { dseEndDate: settings.dseEndDate } : {}),
      ...(typeof settings.studyStartDate === 'string' ? { studyStartDate: settings.studyStartDate } : {}),
      ...(typeof settings.semesterMode === 'string' ? { semesterMode: settings.semesterMode as AppData['settings']['semesterMode'] } : {}),
    },
    subjects,
    events: asArray<CalendarEvent>(input.events).filter((event) => isRecord(event) && typeof event.id === 'string' && typeof event.start === 'string'),
    tasks: asArray<Task>(input.tasks).filter((task) => isRecord(task) && typeof task.id === 'string' && typeof task.title === 'string'),
    checkins: normalizeRecord<Checkin>(input.checkins),
    reflections: normalizeRecord<Reflection>(input.reflections),
    images: asArray<ImageNote>(input.images).filter(
      (image) => isRecord(image) && typeof image.id === 'string' && typeof image.dataUrl === 'string',
    ),
    lastRollover: typeof input.lastRollover === 'string' ? input.lastRollover : '',
  };
}

function normalizeRecord<T>(value: unknown): Record<string, T> {
  if (!isRecord(value)) return {};
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isRecord(item)) out[key] = item as T;
  }
  return out;
}

export interface SaveResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

export function loadData(): AppData {
  if (typeof localStorage === 'undefined') return createDefaultData();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultData();
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to read local dashboard data; starting clean.', error);
    return createDefaultData();
  }
}

export function saveData(data: AppData): SaveResult {
  if (typeof localStorage === 'undefined') return { ok: false, bytes: 0, error: 'localStorage unavailable' };
  try {
    const raw = JSON.stringify(data);
    const bytes = new Blob([raw]).size;
    if (bytes > MAX_BYTES) {
      return {
        ok: false,
        bytes,
        error: `本機儲存已接近上限（${(bytes / 1024 / 1024).toFixed(2)} MB / 約 5 MB）。請先匯出備份並刪除部分相片。`,
      };
    }
    localStorage.setItem(STORAGE_KEY, raw);
    return { ok: true, bytes };
  } catch (error) {
    return {
      ok: false,
      bytes: 0,
      error: error instanceof Error ? error.message : '瀏覽器本機儲存失敗，可能已滿。',
    };
  }
}

export function storageBytes(data: AppData): number {
  try {
    return new Blob([JSON.stringify(data)]).size;
  } catch {
    return 0;
  }
}

export function clearLocalData(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportBackup(data: AppData): string {
  return JSON.stringify(
    {
      ...data,
      _meta: {
        app: 'DSE Candidate Personal Learning Dashboard',
        exportedAt: new Date().toISOString(),
        schema: 1,
      },
    },
    null,
    2,
  );
}

export function importBackup(json: string): AppData {
  const parsed: unknown = JSON.parse(json);
  return normalizeData(parsed);
}

export function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
