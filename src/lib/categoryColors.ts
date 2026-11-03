import type { CSSProperties } from 'react';
import type { CalendarCategory, CategoryColors, EventType, Theme } from '../types';

export const CATEGORY_ORDER: CalendarCategory[] = ['dse', 'mock', 'schoolSba', 'study', 'custom'];

export const CATEGORY_LABEL: Record<CalendarCategory, string> = {
  dse: 'DSE 正式考試',
  mock: 'Mock',
  schoolSba: '校內 / SBA',
  study: '溫書',
  custom: '自訂',
};

/** Light preset — saturated enough for white text on a bar, dark enough to read. */
export const LIGHT_CATEGORY_COLORS: CategoryColors = {
  dse: '#A94442',
  mock: '#B76A35',
  schoolSba: '#8A6410',
  study: '#5F7B52',
  custom: '#5B6B78',
};

/** Dark preset — lighter/desaturated so black text stays readable on dark bars. */
export const DARK_CATEGORY_COLORS: CategoryColors = {
  dse: '#E07A72',
  mock: '#D9A066',
  schoolSba: '#D6C07A',
  study: '#8FB07A',
  custom: '#9AAAB8',
};

export function presetColors(appearance: Theme): CategoryColors {
  return { ...(appearance === 'dark' ? DARK_CATEGORY_COLORS : LIGHT_CATEGORY_COLORS) };
}

export function normalizeCategoryColors(input: unknown, appearance: Theme = 'light'): CategoryColors {
  const fallback = presetColors(appearance);
  if (!input || typeof input !== 'object') return fallback;
  const value = input as Partial<Record<CalendarCategory, unknown>>;
  const out = { ...fallback };
  for (const key of CATEGORY_ORDER) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^#[0-9A-Fa-f]{6}$/.test(candidate)) {
      out[key] = candidate.toUpperCase();
    }
  }
  return out;
}

export function categoryForType(type: EventType): CalendarCategory {
  if (type === 'school' || type === 'sba') return 'schoolSba';
  if (type === 'mock' || type === 'study' || type === 'custom') return type;
  return 'dse';
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastText(hex: string): '#111111' | '#FFFFFF' {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!match) return '#FFFFFF';
  const value = match[1];
  const r = channel(parseInt(value.slice(0, 2), 16));
  const g = channel(parseInt(value.slice(2, 4), 16));
  const b = channel(parseInt(value.slice(4, 6), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#111111' : '#FFFFFF';
}

export interface EventCategoryStyle {
  key: CalendarCategory;
  label: string;
  background: string;
  text: string;
  border: string;
}

export function eventCategoryStyle(colors: CategoryColors, type: EventType): EventCategoryStyle {
  const key = categoryForType(type);
  const background = colors[key] || LIGHT_CATEGORY_COLORS[key];
  return {
    key,
    label: CATEGORY_LABEL[key],
    background,
    text: contrastText(background),
    border: background,
  };
}

export function eventCategoryStyleForColors(colors: CategoryColors, type: EventType): CSSProperties {
  const style = eventCategoryStyle(colors, type);
  return {
    '--event-color': style.background,
    '--event-color-text': style.text,
    background: style.background,
    color: style.text,
    borderColor: style.border,
  } as CSSProperties;
}
