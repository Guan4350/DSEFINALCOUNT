import type { TimerMode } from '../types';

export type ActiveTimerStatus = 'running' | 'paused';

/**
 * Local mirror of the active timer. Firestore stores the same fields as server
 * timestamps; this shape keeps millisecond values for the running UI and for
 * Mode A localStorage.
 */
export interface ActiveTimerState {
  mode: TimerMode;
  subjectId: string;
  subjectName: string;
  paper: string;
  notes: string;
  plannedSeconds: number;
  referenceSeconds: number;
  startedAtMs: number;
  runningSinceMs: number | null;
  accumulatedMs: number;
  status: ActiveTimerStatus;
}

const ACTIVE_KEY = 'dse-candidate:active-timer:v1';
const OFFSET_KEY = 'dse-candidate:server-offset:v1';

function activeKey(uid?: string): string {
  return `${ACTIVE_KEY}:${uid || 'local'}`;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function activeTimerElapsedMs(state: ActiveTimerState, nowMs: number): number {
  const running = state.runningSinceMs !== null ? Math.max(0, nowMs - state.runningSinceMs) : 0;
  return Math.max(0, state.accumulatedMs + running);
}

export function normalizeActiveTimer(value: unknown): ActiveTimerState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const mode = raw.mode === 'stopwatch' ? 'stopwatch' : 'countdown';
  const subjectId = typeof raw.subjectId === 'string' ? raw.subjectId : '';
  const startedAtMs = finite(raw.startedAtMs, 0);
  if (!subjectId || !startedAtMs) return null;
  const runningSinceMs = raw.runningSinceMs === null || raw.runningSinceMs === undefined
    ? null
    : finite(raw.runningSinceMs, 0) || null;
  const status: ActiveTimerStatus = runningSinceMs === null ? 'paused' : 'running';
  return {
    mode,
    subjectId,
    subjectName: typeof raw.subjectName === 'string' ? raw.subjectName : '未命名科目',
    paper: typeof raw.paper === 'string' ? raw.paper : '自訂',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    plannedSeconds: Math.max(0, finite(raw.plannedSeconds)),
    referenceSeconds: Math.max(0, finite(raw.referenceSeconds, 3600)),
    startedAtMs,
    runningSinceMs,
    accumulatedMs: Math.max(0, finite(raw.accumulatedMs)),
    status,
  };
}

export function loadActiveTimerLocal(uid?: string): ActiveTimerState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(activeKey(uid));
    return raw ? normalizeActiveTimer(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveActiveTimerLocal(state: ActiveTimerState | null, uid?: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (state) localStorage.setItem(activeKey(uid), JSON.stringify(state));
    else localStorage.removeItem(activeKey(uid));
  } catch {
    // The timer remains in memory if localStorage is full/unavailable.
  }
}

export function getServerOffsetMs(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(value) ? Math.max(-600_000, Math.min(600_000, value)) : 0;
  } catch {
    return 0;
  }
}

export function setServerOffsetMs(value: number): void {
  if (!Number.isFinite(value)) return;
  const clamped = Math.max(-600_000, Math.min(600_000, Math.round(value)));
  try {
    localStorage.setItem(OFFSET_KEY, String(clamped));
  } catch {
    // ignore
  }
}
