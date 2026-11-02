import type { CalendarEvent, CalendarSyncConfig, Subject } from '../types';
import { parseIcs } from './ics';
import { addDays, isISODate, todayISO } from './date';
import {
  fetchCalendarSyncConfig,
  removeSyncedEvent,
  saveCalendarSyncConfig,
  saveSyncedEvent,
} from './cloud';
import {
  deleteGoogleCalendarEvent,
  getStoredGoogleToken,
  pullGoogleCalendarEvents,
  pushGoogleCalendarEvent,
} from './googleCalendar';

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export async function loadCalendarSyncConfig(uid: string): Promise<CalendarSyncConfig> {
  const remote = await fetchCalendarSyncConfig(uid).catch(() => null);
  return remote || {
    googleConnected: false,
    googleCalendarId: 'primary',
    icalUrls: [],
  };
}

export async function saveCalendarConfig(uid: string, patch: Partial<CalendarSyncConfig>): Promise<CalendarSyncConfig> {
  const current = await loadCalendarSyncConfig(uid);
  const next: CalendarSyncConfig = {
    ...current,
    ...patch,
    googleCalendarId: 'primary',
    icalUrls: patch.icalUrls ?? current.icalUrls,
  };
  await saveCalendarSyncConfig(uid, next);
  return next;
}

export interface CalendarSyncResult {
  pulled: number;
  pushed: number;
  removed: number;
}

export async function syncGoogleNow(
  uid: string,
  subjects: Subject[],
  localEvents: CalendarEvent[],
): Promise<CalendarSyncResult> {
  const token = getStoredGoogleToken()?.accessToken;
  if (!token) throw new Error('請先連接 Google Calendar。');
  const remote = await pullGoogleCalendarEvents(subjects, uid, token);
  const remoteIds = new Set(remote.map((event) => event.externalId).filter(Boolean));
  let pulled = 0;
  let pushed = 0;
  let removed = 0;

  for (const event of remote) {
    await saveSyncedEvent(uid, event);
    pulled += 1;
  }

  const lowerBound = addDays(todayISO(), -366);
  const upperBound = addDays(todayISO(), 730);
  for (const local of localEvents) {
    if (local.source !== 'google') continue;
    const date = local.start.slice(0, 10);
    if (!isISODate(date) || date < lowerBound || date > upperBound) continue;
    if (local.externalId && !remoteIds.has(local.externalId)) {
      await removeSyncedEvent(uid, local.id);
      removed += 1;
      continue;
    }
    if (!local.externalId) {
      const pushedEvent = await pushGoogleCalendarEvent(local, token);
      await saveSyncedEvent(uid, pushedEvent);
      pushed += 1;
    }
  }

  await saveCalendarConfig(uid, {
    googleConnected: true,
    lastSyncAt: new Date().toISOString(),
    lastError: '',
  });
  return { pulled, pushed, removed };
}

export async function deleteSyncedEventEverywhere(uid: string, event: CalendarEvent): Promise<void> {
  if (event.source === 'google' && event.externalId) {
    await deleteGoogleCalendarEvent(event.externalId);
  }
  await removeSyncedEvent(uid, event.id);
}

export interface IcalImportResult {
  imported: number;
  warnings: string[];
}

export async function importIcalUrl(url: string, uid: string, subjects: Subject[]): Promise<IcalImportResult> {
  const clean = url.trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(clean)) throw new Error('請輸入 http(s) 公開 .ics URL。');
  let response: Response;
  try {
    response = await fetch(clean, { headers: { Accept: 'text/calendar,text/plain,*/*' } });
  } catch {
    throw new Error('瀏覽器無法讀取此 .ics（通常是 CORS 限制）。請使用允許跨域讀取的公開訂閱 URL。');
  }
  if (!response.ok) throw new Error(`讀取 .ics 失敗（HTTP ${response.status}）。`);
  const text = await response.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('這個 URL 不是有效的 iCalendar 檔案。');
  const parsed = parseIcs(text, subjects);
  let imported = 0;
  for (const event of parsed.events.slice(0, 1000)) {
    const externalId = event.uid || `${event.title}-${event.start}`;
    const next: CalendarEvent = {
      ...event,
      id: `ical-${hashKey(externalId)}`,
      uid,
      source: 'ics',
      externalId,
      updatedAt: new Date().toISOString(),
    };
    await saveSyncedEvent(uid, next);
    imported += 1;
  }
  const current = await loadCalendarSyncConfig(uid);
  await saveCalendarConfig(uid, {
    icalUrls: Array.from(new Set([...current.icalUrls, clean])).slice(-10),
    lastError: parsed.warnings[0] || '',
  });
  return { imported, warnings: parsed.warnings };
}
