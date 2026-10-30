import { useEffect, useState } from 'react';
import type { CalendarEvent } from '../types';
import { HK_TIME_ZONE, pad } from './date';

/** Device clock correction is deliberately small; anything larger is a user error. */
export const MAX_CLOCK_OFFSET_MS = 5 * 60 * 1000;

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  isPast: boolean;
}

/**
 * A one-second tick aligned to the system clock. `Date.now()` remains the
 * source of truth; `offsetMs` only corrects a device clock that the user has
 * compared against an external reference (e.g. time.is / HKEAA).
 */
export function useSecondTick(offsetMs = 0): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);

  useEffect(() => {
    let interval: number | undefined;
    let timeout: number | undefined;
    const tick = () => setNow(Date.now() + offsetMs);
    const delay = 1000 - (Date.now() % 1000);

    timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 1000);
    }, delay);

    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [offsetMs]);

  return now;
}

export function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_CLOCK_OFFSET_MS, Math.min(MAX_CLOCK_OFFSET_MS, Math.round(value)));
}

export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  const totalMs = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, totalMs, isPast: targetMs <= nowMs };
}

/**
 * Exam times are Hong Kong wall-clock times. They are stored as local ISO
 * strings without an offset, so parse them explicitly as UTC+8 rather than
 * letting the viewer's device timezone shift a 08:30 paper.
 */
export function eventStartMs(event: Pick<CalendarEvent, 'start' | 'allDay'>): number {
  const date = event.start.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;
  const raw = event.allDay ? '00:00:00' : event.start.slice(11, 19);
  const [hours = '00', minutes = '00', seconds = '00'] = raw.split(':');
  const time = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
  return Date.parse(`${date}T${time}+08:00`);
}

export function formatCountdown(parts: CountdownParts): string {
  return `${parts.days} 日 ${pad(parts.hours)} 時 ${pad(parts.minutes)} 分 ${pad(parts.seconds)} 秒`;
}

export function hkDateISO(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function formatHKClock(nowMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: HK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(nowMs));
}

/**
 * The user enters the current HKEAA/time.is clock time. Convert it to the
 * nearest absolute instant in Hong Kong and return a bounded device offset.
 * Returns null for an invalid input.
 */
export function offsetFromReference(reference: string, now = new Date()): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(reference.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || '0');
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const date = hkDateISO(now);
  const target = Date.parse(
    `${date}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}+08:00`,
  );
  if (Number.isNaN(target)) return null;

  let diff = target - now.getTime();
  // Midnight rollover: the user is describing "today", so choose the closest
  // occurrence rather than a difference of almost 24 hours.
  if (diff > 12 * 3_600_000) diff -= 24 * 3_600_000;
  if (diff < -12 * 3_600_000) diff += 24 * 3_600_000;
  return clampOffset(diff);
}

export function formatOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000;
  if (Math.abs(seconds) < 0.05) return '0.0 秒';
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)} 秒`;
}
