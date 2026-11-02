import type { CalendarEvent, EventType, Subject } from '../types';
import { addDays, toLocalDateTime } from './date';
import { connectGoogleCalendar } from './firebase';

const TOKEN_KEY = 'dse-candidate:google-calendar-token:v1';
const API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export interface StoredGoogleToken {
  accessToken: string;
  expiresAt: number;
}

interface GoogleDate {
  date?: string;
  dateTime?: string;
}

interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  extendedProperties?: { private?: Record<string, string> };
}

export function getStoredGoogleToken(): StoredGoogleToken | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGoogleToken;
    if (!parsed.accessToken || parsed.expiresAt <= Date.now() + 30_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeGoogleToken(token: StoredGoogleToken): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    // The token remains in memory for this page only.
  }
}

export function clearGoogleToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function hasGoogleCalendarToken(): boolean {
  return Boolean(getStoredGoogleToken());
}

export async function connectCalendar(): Promise<StoredGoogleToken> {
  const token = await connectGoogleCalendar();
  storeGoogleToken(token);
  return token;
}

function tokenOrThrow(token?: string): string {
  const value = token || getStoredGoogleToken()?.accessToken;
  if (!value) throw new Error('Google Calendar 授權已過期，請重新連接。');
  return value;
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    let message = `Google Calendar 錯誤 (${response.status})`;
    try {
      const body = await response.json() as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the HTTP status message.
    }
    if (response.status === 401) message = 'Google Calendar 授權已過期，請重新連接。';
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function eventType(text: string, explicit?: string): EventType {
  if (explicit === 'dse' || explicit === 'mock' || explicit === 'school' || explicit === 'sba' || explicit === 'study' || explicit === 'custom') {
    return explicit;
  }
  const haystack = text.toUpperCase();
  if (haystack.includes('SBA')) return 'sba';
  if (haystack.includes('MOCK')) return 'mock';
  if (haystack.includes('DSE')) return 'dse';
  if (haystack.includes('EXAM') || haystack.includes('考試') || haystack.includes('期考')) return 'school';
  if (haystack.includes('STUDY') || haystack.includes('溫習') || haystack.includes('REVISION')) return 'study';
  return 'custom';
}

function findSubject(subjects: Subject[], text: string): Subject | undefined {
  const haystack = text.toUpperCase();
  return subjects.find((subject) => haystack.includes(subject.name.toUpperCase()));
}

function googleToCalendar(remote: GoogleEvent, subjects: Subject[], uid: string): CalendarEvent | null {
  if (remote.status === 'cancelled') return null;
  const startValue = remote.start?.dateTime || remote.start?.date;
  if (!startValue) return null;
  const allDay = Boolean(remote.start?.date && !remote.start?.dateTime);
  const start = allDay ? startValue.slice(0, 10) : toLocalDateTime(new Date(startValue));
  const endValue = remote.end?.dateTime || remote.end?.date;
  const end = endValue
    ? allDay ? endValue.slice(0, 10) : toLocalDateTime(new Date(endValue))
    : undefined;
  const summary = remote.summary?.trim() || '未命名 Google 事件';
  const description = remote.description?.trim() || undefined;
  const custom = remote.extendedProperties?.private || {};
  const subject = findSubject(subjects, `${summary} ${description || ''}`);
  return {
    id: `google-${hashKey(remote.id)}`,
    uid,
    title: summary.slice(0, 180),
    start,
    end,
    allDay,
    type: eventType(`${summary} ${description || ''}`, custom.dsefType),
    subjectId: subject?.id || custom.dsefSubjectId || undefined,
    paper: custom.dsefPaper || undefined,
    description,
    location: remote.location?.trim() || undefined,
    source: 'google',
    externalId: remote.id,
    etag: remote.etag,
    updatedAt: new Date().toISOString(),
  };
}

export async function pullGoogleCalendarEvents(subjects: Subject[], uid: string, token?: string): Promise<CalendarEvent[]> {
  const accessToken = tokenOrThrow(token);
  const now = new Date();
  const timeMin = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();
  const timeMax = new Date(now.getFullYear() + 2, now.getMonth(), 1).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
    showDeleted: 'false',
  });
  const data = await api<{ items?: GoogleEvent[] }>(
    `/calendars/primary/events?${params.toString()}`,
    accessToken,
  );
  return (data.items || [])
    .map((item) => googleToCalendar(item, subjects, uid))
    .filter((item): item is CalendarEvent => Boolean(item));
}

function googleBody(event: CalendarEvent): Record<string, unknown> {
  const start = event.allDay
    ? { date: event.start.slice(0, 10) }
    : { dateTime: new Date(event.start).toISOString(), timeZone: 'Asia/Hong_Kong' };
  const end = event.end
    ? event.allDay
      ? { date: event.end.slice(0, 10) }
      : { dateTime: new Date(event.end).toISOString(), timeZone: 'Asia/Hong_Kong' }
    : event.allDay
      ? { date: addDays(event.start.slice(0, 10), 1) }
      : { dateTime: new Date(new Date(event.start).getTime() + 60 * 60 * 1000).toISOString(), timeZone: 'Asia/Hong_Kong' };
  return {
    summary: event.title,
    description: event.description || '',
    location: event.location || '',
    start,
    end,
    extendedProperties: {
      private: {
        dsefType: event.type,
        dsefSubjectId: event.subjectId || '',
        dsefPaper: event.paper || '',
      },
    },
  };
}

export async function pushGoogleCalendarEvent(event: CalendarEvent, token?: string): Promise<CalendarEvent> {
  const accessToken = tokenOrThrow(token);
  if (event.externalId) {
    const remote = await api<GoogleEvent>(
      `/calendars/primary/events/${encodeURIComponent(event.externalId)}`,
      accessToken,
      { method: 'PATCH', body: JSON.stringify(googleBody(event)) },
    );
    return {
      ...event,
      externalId: remote.id || event.externalId,
      etag: remote.etag || event.etag,
      source: 'google',
      updatedAt: new Date().toISOString(),
    };
  }
  const remote = await api<GoogleEvent>('/calendars/primary/events', accessToken, {
    method: 'POST',
    body: JSON.stringify(googleBody(event)),
  });
  return {
    ...event,
    externalId: remote.id,
    etag: remote.etag,
    source: 'google',
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteGoogleCalendarEvent(externalId: string, token?: string): Promise<void> {
  const accessToken = tokenOrThrow(token);
  await api<void>(`/calendars/primary/events/${encodeURIComponent(externalId)}`, accessToken, {
    method: 'DELETE',
  });
}

export { CALENDAR_SCOPE };
