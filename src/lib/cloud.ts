import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import type {
  AppData,
  CalendarEvent,
  CalendarSyncConfig,
  Checkin,
  LeaderboardEntry,
  Profile,
  Reflection,
  Settings,
  Stats,
  Task,
  ThemePreference,
  TimerSession,
} from '../types';
import { addDays, todayISO } from './date';
import { normalizeCategoryColors } from './categoryColors';
import { db, firebaseConfigured } from './firebase';
import type { ActiveTimerState } from './activeTimer';
import { recordUsage } from './usage';

export interface CloudSnapshot {
  profile: Profile;
  tasks: Task[];
  events: CalendarEvent[];
  syncedEvents: CalendarEvent[];
  checkins: Record<string, Checkin>;
  reflections: Record<string, Reflection>;
  timerSessions: TimerSession[];
  stats: Stats;
  settings?: Settings;
}

function toTimestamp(value: string | undefined): Timestamp | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : Timestamp.fromDate(date);
}

function timestampToISO(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function profileFromData(data: DocumentData | undefined, user: User): Profile {
  return {
    displayName: asString(data?.displayName, user.displayName || 'Candidate'),
    leaderboardOptIn: asBool(data?.leaderboardOptIn, false),
    photoURL: asString(data?.photoURL, user.photoURL || '') || undefined,
    email: asString(data?.email, user.email || '') || undefined,
  };
}

export function taskFromData(id: string, data: DocumentData): Task {
  return {
    id,
    title: asString(data.title, '未命名任務'),
    subjectId: asString(data.subjectId),
    dueDate: asString(data.dueDate, todayISO()),
    dueTime: asString(data.dueTime) || undefined,
    completed: asBool(data.completed),
    completedAt: timestampToISO(data.completedAt),
    completedDate: asString(data.completedDate) || undefined,
    notes: asString(data.notes) || undefined,
    kind: ['study', 'revision', 'assignment', 'other'].includes(data.kind) ? data.kind : 'study',
    createdAt: timestampToISO(data.createdAt) || new Date().toISOString(),
    updatedAt: timestampToISO(data.updatedAt) || new Date().toISOString(),
    rolledFrom: asString(data.rolledFrom) || undefined,
    rolloverCount: asNumber(data.rolloverCount, 0),
    source: data.source === 'ics' || data.source === 'caldav' || data.source === 'google' ? data.source : 'local',
  };
}

export function eventFromData(id: string, data: DocumentData): CalendarEvent {
  return {
    id,
    uid: asString(data.uid, id),
    title: asString(data.title, '未命名事件'),
    start: asString(data.start, todayISO()),
    end: asString(data.end) || undefined,
    allDay: asBool(data.allDay, true),
    type: ['dse', 'mock', 'school', 'sba', 'study', 'custom'].includes(data.type) ? data.type : 'custom',
    subjectId: asString(data.subjectId) || undefined,
    paper: asString(data.paper) || undefined,
    description: asString(data.description) || undefined,
    location: asString(data.location) || undefined,
    rrule: asString(data.rrule) || undefined,
    source: data.source === 'ics' || data.source === 'caldav' || data.source === 'google' ? data.source : 'local',
    externalId: asString(data.externalId) || undefined,
    etag: asString(data.etag) || undefined,
    updatedAt: timestampToISO(data.updatedAt) || new Date().toISOString(),
    deleted: asBool(data.deleted),
  };
}

export function timerSessionFromData(id: string, data: DocumentData): TimerSession {
  return {
    id,
    date: asString(data.date, todayISO()),
    subjectId: asString(data.subjectId),
    subjectName: asString(data.subjectName, '未命名科目'),
    paper: asString(data.paper, 'Paper'),
    mode: data.mode === 'stopwatch' ? 'stopwatch' : 'countdown',
    startedAt: asString(data.startedAt),
    endedAt: asString(data.endedAt),
    durationSeconds: Math.max(0, Math.round(asNumber(data.durationSeconds, 0))),
    plannedSeconds: Math.max(0, Math.round(asNumber(data.plannedSeconds, 0))),
    notes: asString(data.notes) || undefined,
    completed: asBool(data.completed, true),
  };
}

function timerSessionToData(session: TimerSession): DocumentData {
  return {
    date: session.date,
    subjectId: session.subjectId,
    subjectName: session.subjectName,
    paper: session.paper,
    mode: session.mode,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSeconds: Math.round(session.durationSeconds),
    plannedSeconds: Math.round(session.plannedSeconds),
    notes: session.notes || '',
    completed: session.completed,
    updatedAt: serverTimestamp(),
  };
}

function taskToData(task: Task): DocumentData {
  return {
    title: task.title,
    subjectId: task.subjectId,
    dueDate: task.dueDate,
    dueTime: task.dueTime || '',
    completed: task.completed,
    completedAt: toTimestamp(task.completedAt) ?? null,
    completedDate: task.completedDate || (task.completedAt || '').slice(0, 10) || '',
    notes: task.notes || '',
    kind: task.kind,
    createdAt: toTimestamp(task.createdAt) ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    rolledFrom: task.rolledFrom || '',
    rolloverCount: task.rolloverCount || 0,
    source: task.source || 'local',
  };
}

function eventToData(event: CalendarEvent): DocumentData {
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
    source: event.source || 'local',
    externalId: event.externalId || '',
    etag: event.etag || '',
    updatedAt: serverTimestamp(),
    deleted: Boolean(event.deleted),
  };
}

export async function ensureProfile(user: User, localProfile?: Profile): Promise<Profile> {
  if (!db) throw new Error('Firestore 尚未設定。');
  const ref = doc(db, 'users', user.uid);
  const snapshot = await getDoc(ref);
  recordUsage(1, 0);
  if (snapshot.exists()) return profileFromData(snapshot.data(), user);

  const profile: Profile = {
    displayName: localProfile?.displayName?.trim() || user.displayName || 'Candidate',
    leaderboardOptIn: localProfile?.leaderboardOptIn ?? false,
    photoURL: user.photoURL || undefined,
    email: user.email || undefined,
  };
  await setDoc(ref, {
    displayName: profile.displayName,
    leaderboardOptIn: profile.leaderboardOptIn,
    photoURL: profile.photoURL || '',
    email: profile.email || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  recordUsage(0, 1);
  return profile;
}

export async function fetchCloudSnapshot(uid: string, profile: Profile): Promise<CloudSnapshot> {
  if (!db) throw new Error('Firestore 尚未設定。');
  const tasksQuery = query(collection(db, 'users', uid, 'tasks'), orderBy('updatedAt', 'desc'), limit(500));
  const eventsQuery = query(collection(db, 'users', uid, 'events'), orderBy('start', 'asc'), limit(500));
  const checkinsQuery = query(
    collection(db, 'users', uid, 'checkins'),
    where('date', '>=', addDays(todayISO(), -370)),
    limit(400),
  );
  const reflectionsQuery = query(collection(db, 'users', uid, 'reflections'), orderBy('date', 'desc'), limit(120));
  const timerQuery = query(collection(db, 'users', uid, 'timerSessions'), orderBy('startedAt', 'desc'), limit(500));
  const syncedQuery = query(collection(db, 'userCalendarEvents'), where('uid', '==', uid), limit(1000));
  const [taskSnap, eventSnap, syncedSnap, checkinSnap, reflectionSnap, timerSnap, statsSnap, settingsSnap] = await Promise.all([
    getDocs(tasksQuery),
    getDocs(eventsQuery),
    // New module-1 collection is additive; an unpublished rule must not block
    // the existing dashboard.
    getDocs(syncedQuery).catch(() => null),
    getDocs(checkinsQuery),
    getDocs(reflectionsQuery),
    getDocs(timerQuery).catch(() => null),
    getDoc(doc(db, 'users', uid, 'meta', 'stats')),
    getDoc(doc(db, 'users', uid, 'meta', 'settings')),
  ]);
  recordUsage(
    1 + taskSnap.size + eventSnap.size + (syncedSnap?.size ?? 0) + checkinSnap.size + reflectionSnap.size + (timerSnap?.size ?? 0) + 2,
    0,
  );

  const tasks = taskSnap.docs.map((item) => taskFromData(item.id, item.data()));
  const events = eventSnap.docs.map((item) => eventFromData(item.id, item.data()));
  const syncedEvents = (syncedSnap?.docs ?? [])
    .map((item) => {
      const event = eventFromData(item.id, item.data());
      return {
        ...event,
        id: item.id.startsWith(`${uid}__`) ? item.id.slice(uid.length + 2) : event.id,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  const timerSessions = (timerSnap?.docs ?? []).map((item) => timerSessionFromData(item.id, item.data()));
  const checkins: Record<string, Checkin> = {};
  const orderedCheckins = checkinSnap.docs.slice().sort((a, b) => String(b.data().date || b.id).localeCompare(String(a.data().date || a.id)));
  for (const item of orderedCheckins) {
    const data = item.data();
    const date = asString(data.date, item.id);
    checkins[date] = {
      date,
      completedTaskCount: asNumber(data.completedTaskCount, 1),
      createdAt: timestampToISO(data.createdAt) || new Date().toISOString(),
      source: data.source === 'cloud' ? 'cloud' : data.source === 'worker' ? 'worker' : 'local',
    };
  }
  const reflections: Record<string, Reflection> = {};
  for (const item of reflectionSnap.docs) {
    const data = item.data();
    reflections[item.id] = {
      date: asString(data.date, item.id),
      text: asString(data.text),
      updatedAt: timestampToISO(data.updatedAt) || new Date().toISOString(),
    };
  }
  const statsData = statsSnap.exists() ? statsSnap.data() : undefined;

  const settingsData = settingsSnap.exists() ? settingsSnap.data() : undefined;
  return {
    profile,
    tasks,
    events,
    syncedEvents,
    checkins,
    reflections,
    timerSessions,
    settings: settingsData ? (settingsData as Settings) : undefined,
    stats: {
      currentStreak: asNumber(statsData?.currentStreak, 0),
      longestStreak: asNumber(statsData?.longestStreak, 0),
      totalDays: asNumber(statsData?.totalDays, 0),
      lastCheckinDate: asString(statsData?.lastCheckinDate) || undefined,
    } as Stats,
  };
}

export async function saveTask(uid: string, task: Task): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'users', uid, 'tasks', task.id), taskToData(task));
  recordUsage(0, 1);
}

export async function removeTask(uid: string, taskId: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await deleteDoc(doc(db, 'users', uid, 'tasks', taskId));
  recordUsage(0, 1);
}

export async function saveTimerSession(uid: string, session: TimerSession): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'users', uid, 'timerSessions', session.id), timerSessionToData(session));
  recordUsage(0, 1);
}

export async function removeTimerSession(uid: string, sessionId: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await deleteDoc(doc(db, 'users', uid, 'timerSessions', sessionId));
  recordUsage(0, 1);
}

function activeTimerFromData(data: DocumentData | undefined): ActiveTimerState | null {
  if (!data) return null;
  const startedAt = data.startedAt instanceof Timestamp ? data.startedAt.toDate().getTime() : 0;
  const runningSinceMs = data.runningSince instanceof Timestamp ? data.runningSince.toDate().getTime() : null;
  if (!startedAt) return null;
  return {
    mode: data.mode === 'stopwatch' ? 'stopwatch' : 'countdown',
    subjectId: asString(data.subjectId),
    subjectName: asString(data.subjectName, '未命名科目'),
    paper: asString(data.paper, '自訂'),
    notes: asString(data.notes),
    plannedSeconds: Math.max(0, Math.round(asNumber(data.plannedSeconds, 0))),
    referenceSeconds: Math.max(0, Math.round(asNumber(data.referenceSeconds, 3600))),
    startedAtMs: startedAt,
    runningSinceMs,
    accumulatedMs: Math.max(0, Math.round(asNumber(data.accumulatedMs, 0))),
    status: runningSinceMs === null ? 'paused' : 'running',
  };
}

export async function fetchCloudActiveTimer(uid: string): Promise<ActiveTimerState | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, 'users', uid, 'timerState', 'current'));
  recordUsage(1, 0);
  return snapshot.exists() ? activeTimerFromData(snapshot.data()) : null;
}

async function writeCloudActiveTimer(
  uid: string,
  state: ActiveTimerState,
  freshStart: boolean,
): Promise<{ state: ActiveTimerState; offsetMs: number }> {
  if (!db) throw new Error('Firestore 尚未設定。');
  const before = Date.now();
  await setDoc(doc(db, 'users', uid, 'timerState', 'current'), {
    mode: state.mode,
    subjectId: state.subjectId,
    subjectName: state.subjectName,
    paper: state.paper,
    notes: state.notes,
    plannedSeconds: state.plannedSeconds,
    referenceSeconds: state.referenceSeconds,
    startedAt: freshStart ? serverTimestamp() : Timestamp.fromMillis(state.startedAtMs),
    runningSince: state.runningSinceMs !== null ? serverTimestamp() : null,
    accumulatedMs: state.accumulatedMs,
    status: state.status,
    updatedAt: serverTimestamp(),
  });
  const snapshot = await getDoc(doc(db, 'users', uid, 'timerState', 'current'));
  const after = Date.now();
  recordUsage(0, 1);
  const remote = activeTimerFromData(snapshot.data());
  if (!remote) return { state, offsetMs: 0 };
  const offsetMs = remote.runningSinceMs !== null
    ? Math.round(remote.runningSinceMs - (before + after) / 2)
    : 0;
  return { state: remote, offsetMs };
}

export async function startCloudActiveTimer(
  uid: string,
  state: ActiveTimerState,
): Promise<{ state: ActiveTimerState; offsetMs: number }> {
  return writeCloudActiveTimer(uid, state, true);
}

export async function saveCloudActiveTimer(
  uid: string,
  state: ActiveTimerState,
): Promise<{ state: ActiveTimerState; offsetMs: number }> {
  return writeCloudActiveTimer(uid, state, false);
}

export async function clearCloudActiveTimer(uid: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, 'users', uid, 'timerState', 'current'));
  recordUsage(0, 1);
}

export async function saveEvent(uid: string, event: CalendarEvent): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'users', uid, 'events', event.id), eventToData(event));
  recordUsage(0, 1);
}

export async function removeEvent(uid: string, eventId: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await deleteDoc(doc(db, 'users', uid, 'events', eventId));
  recordUsage(0, 1);
}

export async function saveSyncedEvent(uid: string, event: CalendarEvent): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  if (!uid || event.uid !== uid) throw new Error('同步事件不屬於目前用戶。');
  await setDoc(doc(db, 'userCalendarEvents', `${uid}__${event.id}`), eventToData(event));
  recordUsage(0, 1);
}

export async function removeSyncedEvent(uid: string, eventId: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  if (!uid) throw new Error('請先登入。');
  await deleteDoc(doc(db, 'userCalendarEvents', `${uid}__${eventId}`));
  recordUsage(0, 1);
}

export async function fetchCalendarSyncConfig(uid: string): Promise<CalendarSyncConfig | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, 'calendarSyncConfig', uid));
  recordUsage(1, 0);
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    googleConnected: data.googleConnected === true,
    googleCalendarId: asString(data.googleCalendarId, 'primary') || 'primary',
    lastSyncAt: asString(data.lastSyncAt) || undefined,
    lastError: asString(data.lastError) || undefined,
    icalUrls: Array.isArray(data.icalUrls)
      ? data.icalUrls.filter((item): item is string => typeof item === 'string')
      : [],
    icalProxyUrl: asString(data.icalProxyUrl) || undefined,
    updatedAt: timestampToISO(data.updatedAt),
  };
}

export async function saveCalendarSyncConfig(uid: string, config: CalendarSyncConfig): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'calendarSyncConfig', uid), {
    googleConnected: config.googleConnected,
    googleCalendarId: config.googleCalendarId || 'primary',
    lastSyncAt: config.lastSyncAt || '',
    lastError: config.lastError || '',
    icalUrls: config.icalUrls.slice(0, 10),
    icalProxyUrl: config.icalProxyUrl || '',
    updatedAt: serverTimestamp(),
  });
  recordUsage(0, 1);
}

export async function fetchUserPreferences(uid: string): Promise<ThemePreference | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, 'userPreferences', uid));
  recordUsage(1, 0);
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const appearance = data.theme === 'dark' ? 'dark' : 'light';
  return {
    mode: data.themeMode === 'system' || data.themeMode === 'train' ? data.themeMode : 'octavarium',
    appearance,
    texture: data.texture !== false,
    categoryColors: normalizeCategoryColors(data.categoryColors, appearance),
  };
}

export async function saveUserPreferences(uid: string, preference: ThemePreference): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'userPreferences', uid), {
    themeMode: preference.mode,
    theme: preference.appearance,
    texture: preference.texture,
    categoryColors: preference.categoryColors,
    updatedAt: serverTimestamp(),
  });
  recordUsage(0, 1);
}

export async function saveSettings(uid: string, settings: Settings): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'users', uid, 'meta', 'settings'), {
    ...settings,
    updatedAt: serverTimestamp(),
  });
  recordUsage(0, 1);
}

export async function saveReflection(uid: string, reflection: Reflection): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'users', uid, 'reflections', reflection.date), {
    date: reflection.date,
    text: reflection.text,
    updatedAt: serverTimestamp(),
  });
  recordUsage(0, 1);
}

export async function saveProfile(uid: string, profile: Profile): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await updateDoc(doc(db, 'users', uid), {
    displayName: profile.displayName.trim().slice(0, 40) || 'Candidate',
    leaderboardOptIn: profile.leaderboardOptIn,
    updatedAt: serverTimestamp(),
  });
  recordUsage(0, 1);
}

export async function migrateLocalData(uid: string, data: AppData): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  const writes = [
    ...data.tasks.map((task) => ({ path: `users/${uid}/tasks/${task.id}`, value: taskToData(task) })),
    ...data.events.map((event) => ({ path: `users/${uid}/events/${event.id}`, value: eventToData(event) })),
    {
      path: `users/${uid}/meta/settings`,
      value: { ...data.settings, updatedAt: serverTimestamp() },
    },
    ...Object.values(data.reflections).map((reflection) => ({
      path: `users/${uid}/reflections/${reflection.date}`,
      value: { date: reflection.date, text: reflection.text, updatedAt: serverTimestamp() },
    })),
    ...data.timerSessions.map((session) => ({
      path: `users/${uid}/timerSessions/${session.id}`,
      value: timerSessionToData(session),
    })),
  ];
  for (let index = 0; index < writes.length; index += 450) {
    const batch = writeBatch(db);
    for (const write of writes.slice(index, index + 450)) {
      batch.set(doc(db, write.path), write.value);
    }
    await batch.commit();
    recordUsage(0, Math.min(450, writes.length - index));
  }
}

/**
 * The leaderboard is polled, not listened to.
 *
 * A persistent onSnapshot listener keeps a Firestore stream open (and keeps a
 * read quota reserved) while the tab is open. A 60-second one-shot query is
 * enough for a gentle streak board and keeps Spark usage predictable.
 */
export const LEADERBOARD_POLL_MS = 60_000;
export const LEADERBOARD_PAGE_SIZE = 100;

export async function fetchLeaderboardOnce(): Promise<LeaderboardEntry[]> {
  if (!db || !firebaseConfigured) return [];
  const leaderboardQuery = query(
    collection(db, 'leaderboard'),
    where('visible', '==', true),
    limit(LEADERBOARD_PAGE_SIZE),
  );
  const snapshot = await getDocs(leaderboardQuery);
  recordUsage(snapshot.size, 0);
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      uid: item.id,
      displayName: asString(data.displayName, 'Candidate'),
      currentStreak: asNumber(data.currentStreak, 0),
      totalDays: asNumber(data.totalDays, 0),
      weeklySeconds: asNumber(data.weeklySeconds, 0),
      weekKey: asString(data.weekKey) || undefined,
      visible: true,
      updatedAt: timestampToISO(data.updatedAt),
    };
  });
}

export async function saveTasksBulk(uid: string, tasks: Task[]): Promise<void> {
  if (!db || tasks.length === 0) return;
  for (let index = 0; index < tasks.length; index += 450) {
    const batch = writeBatch(db);
    for (const task of tasks.slice(index, index + 450)) {
      batch.set(doc(db, 'users', uid, 'tasks', task.id), taskToData(task));
    }
    await batch.commit();
    recordUsage(0, Math.min(450, tasks.length - index));
  }
}

export async function saveEventsBulk(uid: string, events: CalendarEvent[]): Promise<void> {
  if (!db || events.length === 0) return;
  for (let index = 0; index < events.length; index += 450) {
    const batch = writeBatch(db);
    for (const event of events.slice(index, index + 450)) {
      batch.set(doc(db, 'users', uid, 'events', event.id), eventToData(event));
    }
    await batch.commit();
    recordUsage(0, Math.min(450, events.length - index));
  }
}
