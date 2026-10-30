import type { CalendarConnection, Env, RemoteEvent } from './types';
import { randomToken, signState } from './crypto';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && googleRedirectUri(env));
}

export function googleRedirectUri(env: Env): string {
  return env.GOOGLE_REDIRECT_URI || (env.WEBHOOK_BASE_URL ? `${env.WEBHOOK_BASE_URL.replace(/\/$/, '')}/api/calendar/google/callback` : '');
}

export async function buildGoogleAuthUrl(env: Env, uid: string): Promise<string> {
  if (!googleConfigured(env)) throw new Error('Google Calendar OAuth is not configured on the Worker.');
  const state = await signState(env, uid);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(env),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: SCOPES.join(' '),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(env: Env, code: string): Promise<{ refreshToken: string; accessToken: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: googleRedirectUri(env),
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth exchange failed (${response.status}).`);
  const payload = (await response.json()) as { refresh_token?: string; access_token: string };
  if (!payload.refresh_token) throw new Error('Google did not return a refresh token; revoke the app and retry with consent.');
  return { refreshToken: payload.refresh_token, accessToken: payload.access_token };
}

const accessCache = new Map<string, { token: string; expiresAt: number }>();

export async function googleAccessToken(env: Env, refreshToken: string): Promise<string> {
  const cached = accessCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status}).`);
  const payload = (await response.json()) as { access_token: string; expires_in: number };
  accessCache.set(refreshToken, { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 });
  return payload.access_token;
}

async function googleRequest<T>(
  env: Env,
  refreshToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await googleAccessToken(env, refreshToken);
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Google Calendar ${init.method || 'GET'} ${path} failed (${response.status}): ${body.slice(0, 400)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
}

interface GoogleListResponse {
  items?: GoogleEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

export async function listGoogleEvents(
  env: Env,
  refreshToken: string,
  calendarId = 'primary',
  syncToken?: string,
  full = false,
): Promise<{ events: RemoteEvent[]; nextSyncToken?: string }> {
  const all: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const params = new URLSearchParams({
      singleEvents: 'false',
      showDeleted: 'true',
      maxResults: '2500',
    });
    if (syncToken) params.set('syncToken', syncToken);
    else if (full) {
      params.set('timeMin', new Date(Date.now() - 365 * 86_400_000).toISOString());
      params.set('timeMax', new Date(Date.now() + 730 * 86_400_000).toISOString());
    }
    if (pageToken) params.set('pageToken', pageToken);
    const response = await googleRequest<GoogleListResponse>(
      env,
      refreshToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    );
    all.push(...(response.items || []));
    pageToken = response.nextPageToken;
    nextSyncToken = response.nextSyncToken || nextSyncToken;
  } while (pageToken);

  return {
    events: all.map((item) => googleEventToRemote(item)).filter((item): item is RemoteEvent => Boolean(item)),
    nextSyncToken,
  };
}

function formatHkDate(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}:${get('second')}`;
}

function googleEventToRemote(item: GoogleEvent): RemoteEvent | null {
  if (item.status === 'cancelled') {
    return {
      uid: item.id,
      title: '__cancelled__',
      start: new Date().toISOString().slice(0, 10),
      allDay: true,
      updatedAt: item.updated || new Date().toISOString(),
    };
  }
  if (!item.start) return null;
  const allDay = Boolean(item.start.date);
  const start = allDay ? item.start.date! : formatHkDate(item.start.dateTime || new Date().toISOString());
  const end = allDay ? item.end?.date : item.end?.dateTime ? formatHkDate(item.end.dateTime) : undefined;
  const rrule = item.recurrence?.find((line) => line.toUpperCase().startsWith('RRULE:'));
  return {
    uid: item.id,
    title: item.summary || 'Untitled event',
    start,
    end,
    allDay,
    description: item.description || undefined,
    location: item.location || undefined,
    rrule: rrule ? rrule.slice('RRULE:'.length) : undefined,
    updatedAt: item.updated || new Date().toISOString(),
    href: item.id,
  };
}

function addOneDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function hkLocalToRfc3339(value: string): string {
  if (value.length <= 10) return `${value}T00:00:00+08:00`;
  return `${value}+08:00`;
}

function toGoogleBody(event: RemoteEvent): Record<string, unknown> {
  const start = event.allDay ? { date: event.start.slice(0, 10) } : { dateTime: hkLocalToRfc3339(event.start) };
  const endValue = event.end || (event.allDay ? addOneDay(event.start) : event.start);
  const end = event.allDay ? { date: endValue.slice(0, 10) } : { dateTime: hkLocalToRfc3339(endValue) };
  return {
    summary: event.title,
    description: event.description || '',
    location: event.location || '',
    start,
    end,
    ...(event.rrule ? { recurrence: [`RRULE:${event.rrule}`] } : {}),
    extendedProperties: { private: { dse_uid: event.uid } },
  };
}

export async function pushGoogleEvent(
  env: Env,
  refreshToken: string,
  calendarId: string,
  event: RemoteEvent,
  externalId?: string,
): Promise<{ externalId: string }> {
  if (externalId) {
    const updated = await googleRequest<GoogleEvent>(
      env,
      refreshToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`,
      { method: 'PATCH', body: JSON.stringify(toGoogleBody(event)) },
    );
    return { externalId: updated.id };
  }
  const created = await googleRequest<GoogleEvent>(
    env,
    refreshToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(toGoogleBody(event)) },
  );
  return { externalId: created.id };
}

export async function deleteGoogleEvent(
  env: Env,
  refreshToken: string,
  calendarId: string,
  externalId: string,
): Promise<void> {
  try {
    await googleRequest(env, refreshToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 404) throw error;
  }
}

export async function registerGoogleWatch(
  env: Env,
  refreshToken: string,
  calendarId: string,
  uid: string,
): Promise<{ channelId: string; resourceId: string; expiration: string; token: string } | null> {
  if (!env.WEBHOOK_BASE_URL) return null;
  const channelId = crypto.randomUUID();
  const token = randomToken(24);
  const response = await googleRequest<{ id: string; resourceId: string; expiration: string }>(
    env,
    refreshToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: channelId,
        type: 'web_hook',
        address: `${env.WEBHOOK_BASE_URL.replace(/\/$/, '')}/webhooks/google`,
        token,
        params: { uid },
      }),
    },
  );
  return { channelId: response.id, resourceId: response.resourceId, expiration: response.expiration, token };
}

export async function stopGoogleChannel(
  env: Env,
  refreshToken: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  try {
    await googleRequest(env, refreshToken, '/channels/stop', {
      method: 'POST',
      body: JSON.stringify({ id: channelId, resourceId }),
    });
  } catch {
    // A stale channel is harmless; it expires on its own.
  }
}

export async function connectionGoogleRefreshToken(env: Env, connection: CalendarConnection): Promise<string> {
  if (!connection.refreshCipher) throw new Error('Google connection has no refresh token.');
  const { decryptSecret } = await import('./crypto');
  return decryptSecret(env, connection.refreshCipher);
}
