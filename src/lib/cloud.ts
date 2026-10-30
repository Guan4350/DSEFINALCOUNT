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
  Checkin,
  LeaderboardEntry,
  Profile,
  Reflection,
  Settings,
  Stats,
  Task,
} from '../types';
import { addDays, todayISO } from './date';
import { db, firebaseConfigured } from './firebase';
import { recordUsage } from './usage';

export interface CloudSnapshot {
  profile: Profile;
  tasks: Task[];
  events: CalendarEvent[];
  checkins: Record<string, Checkin>;
  reflections: Record<string, Reflection>;
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
  const [taskSnap, eventSnap, checkinSnap, reflectionSnap, statsSnap, settingsSnap] = await Promise.all([
    getDocs(tasksQuery),
    getDocs(eventsQuery),
    getDocs(checkinsQuery),
    getDocs(reflectionsQuery),
    getDoc(doc(db, 'users', uid, 'meta', 'stats')),
    getDoc(doc(db, 'users', uid, 'meta', 'settings')),
  ]);
  recordUsage(
    1 + taskSnap.size + eventSnap.size + checkinSnap.size + reflectionSnap.size + 2,
    0,
  );

  const tasks = taskSnap.docs.map((item) => taskFromData(item.id, item.data()));
  const events = eventSnap.docs.map((item) => eventFromData(item.id, item.data()));
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
    checkins,
    reflections,
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
