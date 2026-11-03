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

export type IcalInputKind = 'url' | 'raw';

export interface SanitizedIcalInput {
  kind: IcalInputKind;
  value: string;
  sourceUrl?: string;
}

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];

function cleanRawIcal(input: string): string {
  return input
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}

function cleanUrlInput(input: string): string {
  const stripped = input
    .trim()
    .replace(/^[<"'`]+|[>"'`]+$/g, '')
    .trim()
    .replace(/^webcal:\/\//i, 'https://');
  const url = new URL(stripped);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('只支援 http(s) 或 webcal:// 的 .ics 網址。');
  }
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAMS.includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

/**
 * Detect pasted raw iCalendar or a URL, strip BOM/zero-width characters,
 * remove trailing whitespace and tracking params, and convert webcal://.
 */
export function sanitizeIcalInput(input: string): SanitizedIcalInput {
  let text = input.replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('請貼上 .ics 網址或完整 iCalendar 內容。');
  if (/^```(?:ics|ical|text)?\s*/i.test(text)) {
    text = text.replace(/^```(?:ics|ical|text)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  if (/<html|<!doctype html/i.test(text.slice(0, 400))) {
    throw new Error('呢段內容似係網頁 HTML，唔係 .ics。請貼上原始 iCalendar 或訂閱網址。');
  }
  if (/BEGIN:VCALENDAR/i.test(text)) {
    return { kind: 'raw', value: cleanRawIcal(text) };
  }
  try {
    const value = cleanUrlInput(text);
    return { kind: 'url', value, sourceUrl: value };
  } catch (error) {
    if (error instanceof Error && error.message.includes('只支援')) throw error;
    throw new Error('無法辨識輸入。請貼上 https://…/calendar.ics 或由 BEGIN:VCALENDAR 開始的完整內容。');
  }
}

function proxyUrl(base: string, target: string): string {
  if (base.includes('{url}')) return base.replace('{url}', encodeURIComponent(target));
  return `${base}${base.includes('?') ? '&' : '?'}url=${encodeURIComponent(target)}`;
}

async function fetchIcalText(url: string, proxy?: string): Promise<string> {
  const read = async (target: string): Promise<string> => {
    const response = await fetch(target, {
      headers: { Accept: 'text/calendar,text/plain,*/*' },
      mode: 'cors',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  };

  let text: string;
  try {
    text = await read(url);
  } catch (directError) {
    if (!proxy?.trim()) {
      throw new Error(
        '瀏覽器無法直接讀取此 .ics（通常是 Apple iCloud 的 CORS 攔截）。請改貼完整 .ics 原始內容，或設定相容 CORS proxy。',
      );
    }
    try {
      text = await read(proxyUrl(proxy.trim(), url));
    } catch (proxyError) {
      const detail = proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(`直接讀取及 CORS proxy 都失敗（${detail}）。請改貼完整 .ics 原始內容。`);
    }
  }
  const cleaned = cleanRawIcal(text);
  if (!/BEGIN:VCALENDAR/i.test(cleaned)) {
    throw new Error('呢個來源唔係有效 iCalendar（搵唔到 BEGIN:VCALENDAR）。');
  }
  return cleaned;
}

async function importIcalText(
  text: string,
  uid: string,
  subjects: Subject[],
  sourceUrl?: string,
  proxy?: string,
): Promise<IcalImportResult> {
  const parsed = parseIcs(text, subjects);
  if (parsed.events.length === 0) {
    const detail = parsed.warnings.slice(0, 2).join(' ') || '沒有找到 VEVENT。';
    throw new Error(`iCal 解析失敗：${detail}`);
  }
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
    icalUrls: sourceUrl
      ? Array.from(new Set([...current.icalUrls, sourceUrl])).slice(-10)
      : current.icalUrls,
    icalProxyUrl: proxy?.trim() || current.icalProxyUrl || '',
    lastError: parsed.warnings[0] || '',
  });
  return { imported, warnings: parsed.warnings };
}

export async function importIcalInput(
  input: string,
  uid: string,
  subjects: Subject[],
  proxy?: string,
): Promise<IcalImportResult> {
  const sanitized = sanitizeIcalInput(input);
  if (sanitized.kind === 'raw') {
    return importIcalText(sanitized.value, uid, subjects, undefined, proxy);
  }
  const text = await fetchIcalText(sanitized.value, proxy);
  return importIcalText(text, uid, subjects, sanitized.sourceUrl, proxy);
}

/** Backwards-compatible wrapper for URL-only callers. */
export async function importIcalUrl(url: string, uid: string, subjects: Subject[]): Promise<IcalImportResult> {
  return importIcalInput(url, uid, subjects);
}
