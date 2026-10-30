import type { UsageSnapshot } from '../types';
import { todayISO } from './date';

const KEY = 'dse-candidate:usage:v1';
export const SPARK_READ_LIMIT = 50_000;
export const SPARK_WRITE_LIMIT = 20_000;
export const USAGE_EVENT = 'dse:usage';

function empty(): UsageSnapshot {
  return { date: todayISO(), reads: 0, writes: 0 };
}

export function getUsage(): UsageSnapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as UsageSnapshot;
    if (parsed.date !== todayISO()) return empty();
    return {
      date: parsed.date,
      reads: Number.isFinite(parsed.reads) ? parsed.reads : 0,
      writes: Number.isFinite(parsed.writes) ? parsed.writes : 0,
    };
  } catch {
    return empty();
  }
}

function persist(snapshot: UsageSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent<UsageSnapshot>(USAGE_EVENT, { detail: snapshot }));
  } catch {
    // Usage telemetry is best-effort; never break the app because of it.
  }
}

export function recordUsage(reads = 0, writes = 0): UsageSnapshot {
  const current = getUsage();
  const next: UsageSnapshot = {
    date: current.date,
    reads: current.reads + Math.max(0, reads),
    writes: current.writes + Math.max(0, writes),
  };
  persist(next);
  return next;
}

export function resetUsage(): void {
  persist(empty());
}

export function usagePercent(value: number, limit: number): number {
  return Math.min(100, Math.round((value / Math.max(1, limit)) * 100));
}
