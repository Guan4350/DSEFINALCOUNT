import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import type { Checkin, Stats } from '../types';
import type { SystemExamEvent } from '../data/dse2025';
import type { OfficialTimetable } from './systemExams';
import { db } from './firebase';
import { addDays } from './date';
import { recordUsage } from './usage';

/**
 * Public leaderboard metric writes are metered by a rolling one-hour budget
 * stored on the leaderboard document itself. `firestore.rules` validates that
 * `writes` only ever increments by one inside the window, or resets to one when
 * the window has expired, so a client cannot reset the counter early.
 */
const LEADERBOARD_WRITE_LIMIT = 20;
const LEADERBOARD_WINDOW_MS = 60 * 60 * 1000;

function stamp(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return typeof value === 'string' ? value : undefined;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface LeaderboardQuota {
  writes: number;
  windowStart: Timestamp | ReturnType<typeof serverTimestamp>;
}

function leaderboardQuota(
  existing: DocumentData | undefined,
  values: { displayName: string; currentStreak: number; totalDays: number },
): LeaderboardQuota {
  if (!existing) {
    return { writes: 1, windowStart: serverTimestamp() };
  }

  const metered =
    stringValue(existing.displayName) !== values.displayName ||
    numberValue(existing.currentStreak, 0) !== values.currentStreak ||
    numberValue(existing.totalDays, 0) !== values.totalDays;

  // Toggling visibility is a privacy action and must never wait for a quota.
  if (!metered) {
    return {
      writes: numberValue(existing.writes, 0),
      windowStart: existing.windowStart as Timestamp,
    };
  }

  const start = existing.windowStart instanceof Timestamp ? existing.windowStart : null;
  const writes = numberValue(existing.writes, 0);
  const withinWindow = start !== null && Date.now() < start.toMillis() + LEADERBOARD_WINDOW_MS;

  if (withinWindow && writes >= LEADERBOARD_WRITE_LIMIT) {
    throw new Error('排行榜更新太頻繁，請一小時後再試。');
  }

  return withinWindow && start
    ? { writes: writes + 1, windowStart: start }
    : { writes: 1, windowStart: serverTimestamp() };
}

export async function isAdminUser(uid: string): Promise<boolean> {
  if (!db) return false;
  const snapshot = await getDoc(doc(db, 'admins', uid));
  recordUsage(1, 0);
  return snapshot.exists() && snapshot.data().active === true;
}

export async function fetchOfficialTimetable(year: number): Promise<OfficialTimetable | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, 'systemExams', String(year)));
  recordUsage(1, 0);
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const events = Array.isArray(data.events) ? (data.events as SystemExamEvent[]) : [];
  if (!events.length) return null;
  return {
    year,
    source: 'official',
    label: stringValue(data.label, `${year} HKEAA 官方時間表`),
    events,
    updatedAt: stamp(data.updatedAt),
  };
}

export async function saveOfficialTimetable(year: number, events: SystemExamEvent[]): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'systemExams', String(year)), {
    year,
    source: 'official',
    label: `${year} HKEAA 官方時間表`,
    events,
    updatedAt: serverTimestamp(),
  });
  recordUsage(0, 1);
}

export async function recordCloudCheckin(
  user: User,
  input: {
    date: string;
    taskId: string;
    completedTaskCount: number;
  },
): Promise<{ checkin: Checkin; stats: Stats }> {
  if (!db) throw new Error('Firestore 尚未設定。');
  const checkinRef = doc(db, 'users', user.uid, 'checkins', input.date);
  const statsRef = doc(db, 'users', user.uid, 'meta', 'stats');
  const taskRef = doc(db, 'users', user.uid, 'tasks', input.taskId);

  const result = await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(checkinRef);
    const statsSnapshot = await transaction.get(statsRef);
    if (existing.exists()) {
      const data = existing.data();
      const statsData = statsSnapshot.exists() ? statsSnapshot.data() : {};
      return {
        checkin: {
          date: input.date,
          completedTaskCount: numberValue(data.completedTaskCount, 1),
          taskId: stringValue(data.taskId) || undefined,
          createdAt: stamp(data.createdAt) || new Date().toISOString(),
          source: 'cloud' as const,
        },
        stats: {
          currentStreak: numberValue(statsData.currentStreak, 0),
          longestStreak: numberValue(statsData.longestStreak, 0),
          totalDays: numberValue(statsData.totalDays, 0),
          lastCheckinDate: stringValue(statsData.lastCheckinDate) || undefined,
        },
      };
    }

    const taskSnapshot = await transaction.get(taskRef);
    if (!taskSnapshot.exists()) throw new Error('找不到用於打卡的任務。');
    const task = taskSnapshot.data();
    if (task.completed !== true || task.completedDate !== input.date) {
      throw new Error('打卡任務尚未完成，或完成日期不符。');
    }

    const statsData = statsSnapshot.exists() ? statsSnapshot.data() : {};
    const lastDate = stringValue(statsData.lastCheckinDate);
    const previousStreak = numberValue(statsData.currentStreak, 0);
    const currentStreak = !lastDate
      ? 1
      : lastDate === addDays(input.date, -1)
        ? previousStreak + 1
        : 1;
    const totalDays = numberValue(statsData.totalDays, 0) + 1;
    const longestStreak = Math.max(numberValue(statsData.longestStreak, 0), currentStreak);

    transaction.set(checkinRef, {
      date: input.date,
      completedTaskCount: Math.max(1, input.completedTaskCount),
      taskId: input.taskId,
      createdAt: serverTimestamp(),
      source: 'cloud',
    });
    transaction.set(statsRef, {
      currentStreak,
      longestStreak,
      totalDays,
      lastCheckinDate: input.date,
      updatedAt: serverTimestamp(),
    });
    return {
      checkin: {
        date: input.date,
        completedTaskCount: Math.max(1, input.completedTaskCount),
        taskId: input.taskId,
        createdAt: new Date().toISOString(),
        source: 'cloud' as const,
      },
      stats: {
        currentStreak,
        longestStreak,
        totalDays,
        lastCheckinDate: input.date,
      },
    };
  });
  recordUsage(3, 2);
  return result;
}

/**
 * Mirrors `leaderboardQuota` on the client. The transaction reads the current
 * board document so two quick syncs cannot both spend the same quota slot.
 * Check-in and import call this once, outside their own transaction, so a
 * quota rejection can never roll back a saved check-in.
 */
export async function syncLeaderboardDoc(user: User, displayName: string, optIn: boolean): Promise<void> {
  if (!db) return;
  const boardRef = doc(db, 'leaderboard', user.uid);
  const statsRef = doc(db, 'users', user.uid, 'meta', 'stats');
  const name = displayName.trim().slice(0, 40) || 'Candidate';

  await runTransaction(db, async (transaction) => {
    const boardSnapshot = await transaction.get(boardRef);
    const statsSnapshot = await transaction.get(statsRef);
    const stats = statsSnapshot.exists() ? statsSnapshot.data() : {};
    const currentStreak = numberValue(stats.currentStreak, 0);
    const totalDays = numberValue(stats.totalDays, 0);
    const quota = leaderboardQuota(
      boardSnapshot.exists() ? boardSnapshot.data() : undefined,
      { displayName: name, currentStreak, totalDays },
    );

    transaction.set(boardRef, {
      uid: user.uid,
      displayName: name,
      currentStreak,
      totalDays,
      visible: optIn,
      ...quota,
      updatedAt: serverTimestamp(),
    });
  });
  recordUsage(2, 1);
}

