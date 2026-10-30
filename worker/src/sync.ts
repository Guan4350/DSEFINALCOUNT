import type { CalendarConnection, Env, RemoteEvent, SyncSummary } from './types';
import { Firestore, docIdFromName, fromFields, getBool, getString } from './firestore';
import type { FirestoreDocument } from './types';
import { decryptSecret, encryptSecret } from './crypto';
import {
  deleteCalDavEvent,
  discoverCalendar,
  getCalendarCtag,
  listCalDavEvents,
  parseIcsEvents,
  putCalDavEvent,
} from './caldav';
import {
  connectionGoogleRefreshToken,
  deleteGoogleEvent,
  listGoogleEvents,
  pushGoogleEvent,
  registerGoogleWatch,
  stopGoogleChannel,
} from './google';

interface LocalEvent {
  id: string;
  uid: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  type: string;
  subjectId?: string;
  paper?: string;
  description?: string;
  location?: string;
  rrule?: string;
  source: string;
  externalId?: string;
  etag?: string;
  updatedAt: string;
  deleted?: boolean;
}

const EMPTY_SUMMARY: SyncSummary = { provider: 'caldav', pulled: 0, pushed: 0, deleted: 0, conflicts: 0, skipped: 0 };

function eventFromDoc(doc: FirestoreDocument): LocalEvent {
  const data = fromFields(doc.fields || {});
  return {
    id: docIdFromName(doc.name),
    uid: getString(data, 'uid', docIdFromName(doc.name)),
    title: getString(data, 'title', 'Untitled event'),
    start: getString(data, 'start', new Date().toISOString().slice(0, 10)),
    end: getString(data, 'end') || undefined,
    allDay: getBool(data, 'allDay', true),
    type: getString(data, 'type', 'custom'),
    subjectId: getString(data, 'subjectId') || undefined,
    paper: getString(data, 'paper') || undefined,
    description: getString(data, 'description') || undefined,
    location: getString(data, 'location') || undefined,
    rrule: getString(data, 'rrule') || undefined,
    source: getString(data, 'source', 'local'),
    externalId: getString(data, 'externalId') || undefined,
    etag: getString(data, 'etag') || undefined,
    updatedAt: getString(data, 'updatedAt', new Date().toISOString()),
    deleted: getBool(data, 'deleted', false),
  };
}

function eventFields(event: LocalEvent, preserveUpdatedAt = false): Record<string, unknown> {
  return {
    uid: event.uid,
    title: event.title,
    start: event.start,
    end: event.end || '',
    allDay: event.allDay,
    type: event.type,
    subjectId: event.subjectId || '',
    paper: event.paper || '',
    description: event.description || '',
    location: event.location || '',
    rrule: event.rrule || '',
    source: event.source,
    externalId: event.externalId || '',
    etag: event.etag || '',
    updatedAt: preserveUpdatedAt ? new Date(event.updatedAt) : new Date(),
    deleted: Boolean(event.deleted),
  };
}

function remoteToLocal(remote: RemoteEvent, source: 'caldav' | 'google', existing?: LocalEvent): LocalEvent {
  return {
    id: existing?.id || crypto.randomUUID(),
    uid: remote.uid,
    title: remote.title,
    start: remote.start,
    end: remote.end,
    allDay: remote.allDay,
    type: existing?.type || inferType(remote.title),
    subjectId: existing?.subjectId,
    paper: existing?.paper,
    description: remote.description,
    location: remote.location,
    rrule: remote.rrule,
    source,
    externalId: remote.href || existing?.externalId,
    etag: remote.etag || existing?.etag,
    updatedAt: remote.updatedAt,
    deleted: false,
  };
}

function localToRemote(event: LocalEvent): RemoteEvent {
  return {
    uid: event.uid,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    description: event.description,
    location: event.location,
    rrule: event.rrule,
    updatedAt: event.updatedAt,
    href: event.externalId,
    etag: event.etag,
  };
}

function inferType(title: string): string {
  const value = title.toUpperCase();
  if (value.includes('SBA')) return 'sba';
  if (value.includes('MOCK')) return 'mock';
  if (value.includes('DSE')) return 'dse';
  if (value.includes('EXAM') || value.includes('考試') || value.includes('期考')) return 'school';
  return 'custom';
}

async function getConnection(fs: Firestore, uid: string): Promise<CalendarConnection | null> {
  const snap = await fs.get(`calendarConnections/${uid}`);
  if (!snap) return null;
  return fromFields(snap.fields || {}) as unknown as CalendarConnection;
}

async function saveConnection(fs: Firestore, uid: string, connection: CalendarConnection): Promise<void> {
  await fs.patch(`calendarConnections/${uid}`, {
    ...connection,
    updatedAt: new Date(),
  });
}

async function logSync(
  fs: Firestore,
  uid: string,
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await fs.patch(`users/${uid}/syncLogs/${crypto.randomUUID()}`, {
    at: new Date(),
    message,
    ...details,
  });
}

async function loadLocalEvents(fs: Firestore, uid: string): Promise<LocalEvent[]> {
  const docs = await fs.list(`users/${uid}/events`, 400);
  return docs.map(eventFromDoc).filter((event) => !event.deleted);
}

async function loadDirtyEvents(fs: Firestore, uid: string, since: string): Promise<LocalEvent[]> {
  const docs = await fs.runQuery(`users/${uid}`, {
    from: [{ collectionId: 'events' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'updatedAt' },
        op: 'GREATER_THAN',
        value: { timestampValue: since },
      },
    },
    limit: 150,
  });
  return docs.map(eventFromDoc).filter((event) => !event.deleted);
}

async function findLocalByUid(fs: Firestore, uid: string, eventUid: string): Promise<LocalEvent | undefined> {
  const docs = await fs.runQuery(`users/${uid}`, {
    from: [{ collectionId: 'events' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'uid' },
        op: 'EQUAL',
        value: { stringValue: eventUid },
      },
    },
    limit: 1,
  });
  return docs[0] ? eventFromDoc(docs[0]) : undefined;
}

async function saveLocalEvent(fs: Firestore, uid: string, event: LocalEvent, preserveUpdatedAt = false): Promise<void> {
  await fs.patch(`users/${uid}/events/${event.id}`, eventFields(event, preserveUpdatedAt));
}

async function syncCalDav(
  env: Env,
  fs: Firestore,
  uid: string,
  connection: CalendarConnection,
  summary: SyncSummary,
): Promise<Partial<CalendarConnection>> {
  if (!connection.secretCipher) throw new Error('CalDAV secret is missing.');
  const password = await decryptSecret(env, connection.secretCipher);
  let calendarUrl = connection.calendarUrl;
  if (!calendarUrl) {
    const discovered = await discoverCalendar(env, connection, password);
    calendarUrl = discovered.calendarUrl;
    connection.calendarName = discovered.calendarName;
  }
  const ctag = await getCalendarCtag(env, connection, password, calendarUrl);
  const lastSyncTime = connection.lastSyncAt ? new Date(connection.lastSyncAt).getTime() : 0;

  // iCloud has no webhook. A ctag check is one cheap PROPFIND; only when it
  // changes do we read calendar-data. This is the main Spark-quota guard.
  if (connection.ctag && ctag && connection.ctag === ctag) {
    const dirtyLocal = await loadDirtyEvents(fs, uid, connection.lastSyncAt || new Date(0).toISOString());
    for (const local of dirtyLocal.filter((event) => event.source === 'local')) {
      const pushed = await putCalDavEvent(env, connection, password, calendarUrl, localToRemote(local));
      await saveLocalEvent(fs, uid, { ...local, etag: pushed.etag, externalId: `${calendarUrl}/${encodeURIComponent(local.uid)}.ics` });
      summary.pushed += 1;
    }
    return { calendarUrl, calendarName: connection.calendarName, ctag, lastError: '' };
  }

  const remoteResponses = await listCalDavEvents(
    env,
    connection,
    password,
    calendarUrl,
    new Date(Date.now() - 365 * 86_400_000),
    new Date(Date.now() + 730 * 86_400_000),
  );
  const remoteEvents: RemoteEvent[] = [];
  for (const response of remoteResponses.slice(0, 200)) {
    if (!response.ics) continue;
    for (const parsed of parseIcsEvents(response.ics)) {
      parsed.href = response.href;
      parsed.etag = response.etag;
      remoteEvents.push(parsed);
    }
  }

  const localEvents = await loadLocalEvents(fs, uid);
  const byUid = new Map(localEvents.map((event) => [event.uid, event]));
  const remoteUids = new Set(remoteEvents.map((event) => event.uid));
  const lastSync = lastSyncTime;
  const hadSync = Boolean(connection.lastSyncAt);

  for (const remote of remoteEvents) {
    const existing = byUid.get(remote.uid);
    if (!existing) {
      const created = remoteToLocal(remote, 'caldav');
      await saveLocalEvent(fs, uid, created, true);
      summary.pulled += 1;
      continue;
    }
    const remoteTime = new Date(remote.updatedAt).getTime();
    const localTime = new Date(existing.updatedAt).getTime();
    if (hadSync && localTime > lastSync && remoteTime > lastSync && localTime !== remoteTime) {
      await logSync(fs, uid, 'CalDAV conflict resolved by timestamp', {
        provider: 'caldav',
        eventUid: remote.uid,
        title: remote.title,
        localUpdatedAt: existing.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
        resolution: remoteTime >= localTime ? 'remote' : 'local',
      });
      summary.conflicts += 1;
    }
    if (remoteTime > localTime) {
      await saveLocalEvent(fs, uid, remoteToLocal(remote, 'caldav', existing), true);
      summary.pulled += 1;
    } else if (localTime > remoteTime && existing.source === 'local') {
      const pushed = await putCalDavEvent(env, connection, password, calendarUrl, localToRemote(existing));
      await saveLocalEvent(fs, uid, { ...existing, etag: pushed.etag, externalId: `${calendarUrl}/${encodeURIComponent(existing.uid)}.ics` });
      summary.pushed += 1;
    }
  }

  for (const local of localEvents) {
    if (!remoteUids.has(local.uid) && local.source === 'local' && new Date(local.updatedAt).getTime() > lastSync) {
      const pushed = await putCalDavEvent(env, connection, password, calendarUrl, localToRemote(local));
      await saveLocalEvent(fs, uid, {
        ...local,
        etag: pushed.etag,
        externalId: `${calendarUrl}/${encodeURIComponent(local.uid)}.ics`,
      });
      summary.pushed += 1;
    }
  }

  return { calendarUrl, calendarName: connection.calendarName, ctag, lastError: '' };
}

async function syncGoogle(
  env: Env,
  fs: Firestore,
  uid: string,
  connection: CalendarConnection,
  summary: SyncSummary,
): Promise<Partial<CalendarConnection>> {
  const refreshToken = await connectionGoogleRefreshToken(env, connection);
  let syncToken = connection.syncToken;
  let remote;
  try {
    remote = await listGoogleEvents(env, refreshToken, connection.calendarId || 'primary', syncToken, !syncToken);
  } catch (error) {
    if ((error as Error & { status?: number }).status === 410) {
      syncToken = undefined;
      remote = await listGoogleEvents(env, refreshToken, connection.calendarId || 'primary', undefined, true);
    } else {
      throw error;
    }
  }

  const lastSync = connection.lastSyncAt ? new Date(connection.lastSyncAt).getTime() : 0;
  const hadSync = Boolean(connection.lastSyncAt);
  const localEvents = hadSync ? await loadDirtyEvents(fs, uid, connection.lastSyncAt || new Date(0).toISOString()) : await loadLocalEvents(fs, uid);
  const byUid = new Map(localEvents.map((event) => [event.uid, event]));
  const remoteUids = new Set(remote.events.map((event) => event.uid));

  for (const item of remote.events) {
    if (item.title === '__cancelled__') {
      const existing = localEvents.find((event) => event.externalId === item.uid || event.uid === item.uid);
      if (existing) {
        await fs.patch(`users/${uid}/events/${existing.id}`, { deleted: true, updatedAt: new Date() });
        summary.deleted += 1;
      }
      continue;
    }
    const existing = byUid.get(item.uid) || (hadSync ? await findLocalByUid(fs, uid, item.uid) : undefined);
    if (!existing) {
      const created = remoteToLocal(item, 'google');
      await saveLocalEvent(fs, uid, created, true);
      summary.pulled += 1;
      continue;
    }
    const remoteTime = new Date(item.updatedAt).getTime();
    const localTime = new Date(existing.updatedAt).getTime();
    if (hadSync && localTime > lastSync && remoteTime > lastSync && localTime !== remoteTime) {
      await logSync(fs, uid, 'Google Calendar conflict resolved by timestamp', {
        provider: 'google',
        eventUid: item.uid,
        title: item.title,
        localUpdatedAt: existing.updatedAt,
        remoteUpdatedAt: item.updatedAt,
        resolution: remoteTime >= localTime ? 'remote' : 'local',
      });
      summary.conflicts += 1;
    }
    if (remoteTime > localTime) {
      await saveLocalEvent(fs, uid, remoteToLocal(item, 'google', existing), true);
      summary.pulled += 1;
    } else if (localTime > remoteTime && existing.source === 'local') {
      const pushed = await pushGoogleEvent(env, refreshToken, connection.calendarId || 'primary', localToRemote(existing), existing.externalId);
      await saveLocalEvent(fs, uid, { ...existing, externalId: pushed.externalId, etag: '' });
      summary.pushed += 1;
    }
  }

  for (const local of localEvents) {
    if (!remoteUids.has(local.uid) && local.source === 'local' && new Date(local.updatedAt).getTime() > lastSync) {
      const pushed = await pushGoogleEvent(env, refreshToken, connection.calendarId || 'primary', localToRemote(local), local.externalId);
      await saveLocalEvent(fs, uid, { ...local, externalId: pushed.externalId, etag: '' });
      summary.pushed += 1;
    }
  }

  let patch: Partial<CalendarConnection> = {
    syncToken: remote.nextSyncToken || syncToken,
    lastError: '',
  };
  if (env.WEBHOOK_BASE_URL && (!connection.channelId || !connection.channelExpiration || new Date(connection.channelExpiration).getTime() < Date.now() + 3_600_000)) {
    const watch = await registerGoogleWatch(env, refreshToken, connection.calendarId || 'primary', uid);
    if (watch) {
      patch = {
        ...patch,
        channelId: watch.channelId,
        channelResourceId: watch.resourceId,
        channelExpiration: watch.expiration,
      };
      await fs.patch(`webhookChannels/${watch.channelId}`, {
        uid,
        token: watch.token,
        resourceId: watch.resourceId,
        expiration: watch.expiration,
        createdAt: new Date(),
      });
    }
  }
  return patch;
}

export async function syncUser(
  env: Env,
  fs: Firestore,
  uid: string,
  _reason = 'manual',
): Promise<SyncSummary> {
  const connection = await getConnection(fs, uid);
  if (!connection) throw new Error('No calendar connection for this user.');
  const summary: SyncSummary = { ...EMPTY_SUMMARY, provider: connection.provider };
  try {
    const patch =
      connection.provider === 'caldav'
        ? await syncCalDav(env, fs, uid, connection, summary)
        : await syncGoogle(env, fs, uid, connection, summary);
    const nextSyncAt = new Date(Date.now() + (connection.provider === 'google' ? 60 : 15) * 60_000).toISOString();
    await saveConnection(fs, uid, {
      ...connection,
      ...patch,
      status: 'ok',
      lastSyncAt: new Date().toISOString(),
      nextSyncAt,
      lastError: '',
    });
    if (summary.pulled + summary.pushed + summary.deleted + summary.conflicts > 0) {
      await logSync(fs, uid, 'Sync completed', { ...summary });
    }
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveConnection(fs, uid, {
      ...connection,
      status: 'error',
      lastError: message.slice(0, 500),
      nextSyncAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    await logSync(fs, uid, 'Sync failed', { message: message.slice(0, 500), provider: connection.provider });
    throw error;
  }
}

export async function createCalDavConnection(
  env: Env,
  fs: Firestore,
  uid: string,
  input: { label: string; url: string; username: string; password: string },
): Promise<CalendarConnection> {
  const draft: CalendarConnection = {
    provider: 'caldav',
    label: input.label.slice(0, 80),
    url: input.url,
    username: input.username,
    secretCipher: await encryptSecret(env, input.password),
    status: 'idle',
    createdAt: new Date().toISOString(),
  };
  const discovered = await discoverCalendar(env, draft, input.password);
  const connection: CalendarConnection = {
    ...draft,
    calendarUrl: discovered.calendarUrl,
    calendarName: discovered.calendarName,
    nextSyncAt: new Date().toISOString(),
  };
  await saveConnection(fs, uid, connection);
  return connection;
}

export async function createGoogleConnection(
  env: Env,
  fs: Firestore,
  uid: string,
  refreshToken: string,
): Promise<CalendarConnection> {
  const connection: CalendarConnection = {
    provider: 'google',
    label: 'Google Calendar',
    calendarId: 'primary',
    refreshCipher: await encryptSecret(env, refreshToken),
    status: 'idle',
    createdAt: new Date().toISOString(),
    nextSyncAt: new Date().toISOString(),
  };
  await saveConnection(fs, uid, connection);
  return connection;
}

export async function disconnectUser(env: Env, fs: Firestore, uid: string): Promise<void> {
  const connection = await getConnection(fs, uid);
  if (connection?.provider === 'google' && connection.refreshCipher && connection.channelId && connection.channelResourceId) {
    try {
      const refreshToken = await decryptSecret(env, connection.refreshCipher);
      await stopGoogleChannel(env, refreshToken, connection.channelId, connection.channelResourceId);
    } catch {
      // The channel expires on its own; still remove the connection.
    }
  }
  await fs.delete(`calendarConnections/${uid}`);
}

export async function listDueConnections(fs: Firestore, now = new Date()): Promise<{ uid: string; connection: CalendarConnection }[]> {
  const docs = await fs.runQuery('', {
    from: [{ collectionId: 'calendarConnections' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'nextSyncAt' },
        op: 'LESS_THAN_OR_EQUAL',
        value: { stringValue: now.toISOString() },
      },
    },
    limit: 10,
  });
  return docs.map((doc) => ({
    uid: docIdFromName(doc.name),
    connection: fromFields(doc.fields || {}) as unknown as CalendarConnection,
  }));
}

export async function pushLocalDeletionToRemote(
  env: Env,
  fs: Firestore,
  uid: string,
  event: LocalEvent,
): Promise<void> {
  const connection = await getConnection(fs, uid);
  if (!connection) return;
  if (connection.provider === 'caldav' && connection.secretCipher && event.externalId && connection.calendarUrl) {
    const password = await decryptSecret(env, connection.secretCipher);
    await deleteCalDavEvent(env, connection, password, connection.calendarUrl, event.externalId);
  }
  if (connection.provider === 'google' && connection.refreshCipher && event.externalId) {
    const refreshToken = await decryptSecret(env, connection.refreshCipher);
    await deleteGoogleEvent(env, refreshToken, connection.calendarId || 'primary', event.externalId);
  }
}

export async function deleteRemoteEventById(
  env: Env,
  fs: Firestore,
  uid: string,
  eventId: string,
): Promise<void> {
  const doc = await fs.get(`users/${uid}/events/${eventId}`);
  if (!doc) return;
  const data = fromFields(doc.fields || {});
  const event: LocalEvent = {
    id: eventId,
    uid: getString(data, 'uid', eventId),
    title: getString(data, 'title'),
    start: getString(data, 'start'),
    end: getString(data, 'end') || undefined,
    allDay: getBool(data, 'allDay', true),
    type: getString(data, 'type', 'custom'),
    source: getString(data, 'source', 'local'),
    externalId: getString(data, 'externalId') || undefined,
    etag: getString(data, 'etag') || undefined,
    updatedAt: getString(data, 'updatedAt'),
  };
  await pushLocalDeletionToRemote(env, fs, uid, event);
}
