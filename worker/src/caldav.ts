import ICAL from 'ical.js';
import type { CalendarConnection, Env, RemoteEvent } from './types';

export interface DiscoveredCalendar {
  calendarUrl: string;
  calendarName: string;
}

export interface DavResponse {
  href: string;
  etag?: string;
  ics?: string;
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function xmlUnescape(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

function responseBlocks(xml: string): string[] {
  const matches = xml.match(/<(?:[a-z0-9]+:)?response\b[\s\S]*?<\/(?:[a-z0-9]+:)?response>/gi);
  return matches || [];
}

function firstTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${tag}>`, 'i'));
  return match ? xmlUnescape(match[1]).trim() : undefined;
}

function allHrefs(block: string): string[] {
  const matches = [...block.matchAll(/<(?:[a-z0-9]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?href>/gi)];
  return matches.map((match) => xmlUnescape(match[1]).trim()).filter(Boolean);
}

function hrefIn(block: string, tag: string): string | undefined {
  const inner = firstTag(block, tag);
  if (!inner) return undefined;
  return allHrefs(inner)[0] || inner;
}

function resolveHref(base: string, href: string): string {
  return new URL(href, base).toString();
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

export function assertSafeUrl(value: string, env: Env): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('CalDAV URL must use HTTPS.');
  if (isPrivateHost(url.hostname)) throw new Error('Private / local CalDAV hosts are not allowed.');
  if (env.ALLOWED_CALDAV_HOSTS) {
    const allowed = env.ALLOWED_CALDAV_HOSTS.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(url.hostname.toLowerCase())) {
      throw new Error(`Host not in ALLOWED_CALDAV_HOSTS: ${url.hostname}`);
    }
  }
  return url;
}

async function davRequest(
  env: Env,
  connection: Pick<CalendarConnection, 'username' | 'secretCipher'>,
  password: string,
  url: string,
  method: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<Response> {
  const safeUrl = assertSafeUrl(url, env);
  const response = await fetch(safeUrl.toString(), {
    method,
    headers: {
      Authorization: basicAuth(connection.username || '', password),
      'User-Agent': 'DSE-Candidate-Calendar-Bridge/1.0',
      ...(body ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
      ...(headers || {}),
    },
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  return response;
}

const PROPFIND_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:current-user-principal/>
    <c:calendar-home-set/>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;

const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:getetag/>
  </d:prop>
</d:propfind>`;

export async function discoverCalendar(
  env: Env,
  connection: CalendarConnection,
  password: string,
): Promise<DiscoveredCalendar & { baseUrl: string }> {
  const base = assertSafeUrl(connection.url || '', env).toString();
  const principalResponse = await davRequest(env, connection, password, base, 'PROPFIND', PROPFIND_PRINCIPAL, {
    Depth: '0',
  });
  if (!principalResponse.ok) throw new Error(`CalDAV PROPFIND failed (${principalResponse.status}).`);
  const principalXml = await principalResponse.text();
  const rootBlock = responseBlocks(principalXml)[0] || principalXml;
  const principalHref = hrefIn(rootBlock, 'current-user-principal') || '';
  const homeHref = hrefIn(rootBlock, 'calendar-home-set') || principalHref;
  const homeUrl = homeHref ? resolveHref(base, homeHref) : base;

  const listResponse = await davRequest(env, connection, password, homeUrl, 'PROPFIND', PROPFIND_CALENDARS, {
    Depth: '1',
  });
  if (!listResponse.ok) throw new Error(`CalDAV calendar listing failed (${listResponse.status}).`);
  const listXml = await listResponse.text();
  const candidates: { href: string; name: string; isCalendar: boolean }[] = [];
  for (const block of responseBlocks(listXml)) {
    const href = allHrefs(block)[0];
    if (!href) continue;
    const resourceType = firstTag(block, 'resourcetype') || '';
    candidates.push({
      href: resolveHref(homeUrl, href),
      name: firstTag(block, 'displayname') || 'Calendar',
      isCalendar: /calendar/i.test(resourceType),
    });
  }

  const named = candidates.find((item) => item.isCalendar && item.name === connection.label);
  const firstCalendar = candidates.find((item) => item.isCalendar);
  const chosen = named || firstCalendar;
  if (!chosen) throw new Error('No CalDAV calendar found for this account.');
  return { calendarUrl: chosen.href.replace(/\/$/, ''), calendarName: chosen.name, baseUrl: base };
}

export function parseIcsEvents(ics: string): RemoteEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  const out: RemoteEvent[] = [];
  for (const component of root.getAllSubcomponents('vevent')) {
    try {
      const event = new ICAL.Event(component);
      if (!event.startDate) continue;
      const allDay = Boolean(event.startDate.isDate);
      const start = formatHk(event.startDate, allDay);
      const end = event.endDate ? formatHk(event.endDate, allDay) : undefined;
      const rruleValue = component.getFirstProperty('rrule')?.getFirstValue();
      const lastModified = component.getFirstPropertyValue('last-modified');
      const stamp = component.getFirstPropertyValue('dtstamp');
      const updatedAt =
        lastModified instanceof ICAL.Time
          ? lastModified.toJSDate().toISOString()
          : stamp instanceof ICAL.Time
            ? stamp.toJSDate().toISOString()
            : new Date().toISOString();
      out.push({
        uid: event.uid || crypto.randomUUID(),
        title: event.summary || 'Untitled event',
        start,
        end,
        allDay,
        description: event.description || undefined,
        location: String(component.getFirstPropertyValue('location') || '') || undefined,
        rrule: rruleValue ? String(rruleValue) : undefined,
        updatedAt,
      });
    } catch {
      // A malformed VEVENT should not discard the rest of the calendar.
    }
  }
  return out;
}

function formatHk(time: ICAL.Time, allDay: boolean): string {
  if (allDay) return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(time.toJSDate());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}:${get('second')}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function hkLocalToUtc(value: string): string {
  if (value.length <= 10) return value;
  const [datePart, timePart = '00:00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  return new Date(utcMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '');
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = ` ${char}`;
      currentBytes = 1 + charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  parts.push(current);
  return parts.join('\r\n');
}

export function buildIcsFromEvent(event: RemoteEvent, subjectName?: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DSE Candidate//Calendar Bridge//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(event.uid)}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
  ];
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.start)}`);
    if (event.end) lines.push(`DTEND;VALUE=DATE:${icsDate(event.end)}`);
  } else {
    lines.push(`DTSTART:${hkLocalToUtc(event.start)}`);
    if (event.end) lines.push(`DTEND:${hkLocalToUtc(event.end)}`);
  }
  lines.push(`SUMMARY:${escapeIcs(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
  if (event.rrule) lines.push(`RRULE:${event.rrule}`);
  lines.push(`CATEGORIES:DSE-CANDIDATE${subjectName ? `,${escapeIcs(subjectName)}` : ''}`);
  lines.push(`LAST-MODIFIED:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
  lines.push('BEGIN:VALARM');
  lines.push('TRIGGER:-PT1H');
  lines.push('ACTION:DISPLAY');
  lines.push(`DESCRIPTION:${escapeIcs(event.title)}`);
  lines.push('END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

const PROPFIND_CTAG = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop><cs:getctag/><d:sync-token/></d:prop>
</d:propfind>`;

export async function getCalendarCtag(
  env: Env,
  connection: CalendarConnection,
  password: string,
  calendarUrl: string,
): Promise<string | undefined> {
  const response = await davRequest(env, connection, password, calendarUrl, 'PROPFIND', PROPFIND_CTAG, {
    Depth: '0',
  });
  if (!response.ok) return undefined;
  const xml = await response.text();
  return firstTag(xml, 'getctag') || firstTag(xml, 'sync-token');
}

export async function listCalDavEvents(
  env: Env,
  connection: CalendarConnection,
  password: string,
  calendarUrl: string,
  start: Date,
  end: Date,
): Promise<DavResponse[]> {
  const report = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}" end="${end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
  const response = await davRequest(env, connection, password, calendarUrl, 'REPORT', report, {
    Depth: '1',
    'Content-Type': 'application/xml; charset=utf-8',
  });
  if (response.status === 405 || response.status === 501) {
    return listByPropfind(env, connection, password, calendarUrl);
  }
  if (!response.ok) throw new Error(`CalDAV REPORT failed (${response.status}).`);
  const xml = await response.text();
  const results: DavResponse[] = [];
  for (const block of responseBlocks(xml)) {
    const href = allHrefs(block)[0];
    if (!href) continue;
    const etag = firstTag(block, 'getetag');
    const data = firstTag(block, 'calendar-data');
    if (data) results.push({ href: resolveHref(calendarUrl, href), etag, ics: data });
  }
  return results;
}

async function listByPropfind(
  env: Env,
  connection: CalendarConnection,
  password: string,
  calendarUrl: string,
): Promise<DavResponse[]> {
  const response = await davRequest(env, connection, password, calendarUrl, 'PROPFIND', PROPFIND_CALENDARS, {
    Depth: '1',
  });
  if (!response.ok) throw new Error(`CalDAV fallback PROPFIND failed (${response.status}).`);
  const xml = await response.text();
  const results: DavResponse[] = [];
  for (const block of responseBlocks(xml)) {
    const href = allHrefs(block).find((item) => item.endsWith('.ics'));
    if (!href) continue;
    const url = resolveHref(calendarUrl, href);
    const getResponse = await davRequest(env, connection, password, url, 'GET');
    if (!getResponse.ok) continue;
    results.push({ href: url, etag: firstTag(block, 'getetag'), ics: await getResponse.text() });
  }
  return results;
}

export async function putCalDavEvent(
  env: Env,
  connection: CalendarConnection,
  password: string,
  calendarUrl: string,
  event: RemoteEvent,
): Promise<{ etag?: string }> {
  const url = `${calendarUrl.replace(/\/$/, '')}/${encodeURIComponent(event.uid)}.ics`;
  const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' };
  const response = await davRequest(env, connection, password, url, 'PUT', buildIcsFromEvent(event), headers);
  if (!response.ok) throw new Error(`CalDAV PUT failed (${response.status}).`);
  return { etag: response.headers.get('etag') || undefined };
}

export async function deleteCalDavEvent(
  env: Env,
  connection: CalendarConnection,
  password: string,
  calendarUrl: string,
  href: string,
): Promise<void> {
  const response = await davRequest(env, connection, password, href, 'DELETE');
  if (!response.ok && response.status !== 404) throw new Error(`CalDAV DELETE failed (${response.status}).`);
  void calendarUrl;
}
