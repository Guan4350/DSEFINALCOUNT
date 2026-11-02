import type { Theme, ThemeMode, ThemePreference } from '../types';

export type { Theme, ThemeMode, ThemePreference };

const LEGACY_KEY = 'dse-candidate:theme';
const PREF_KEY = 'dse-candidate:theme-preference:v2';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  mode: 'octavarium',
  appearance: 'light',
  texture: true,
};

export function getSystemAppearance(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference, systemAppearance = getSystemAppearance()): Theme {
  return preference.mode === 'system' ? systemAppearance : preference.appearance;
}

export function resolveSkin(preference: ThemePreference): 'octavarium' | 'train' {
  return preference.mode === 'train' ? 'train' : 'octavarium';
}

export function normalizeThemePreference(input: unknown): ThemePreference {
  if (!input || typeof input !== 'object') return { ...DEFAULT_THEME_PREFERENCE };
  const value = input as Partial<ThemePreference>;
  const mode: ThemeMode = value.mode === 'system' || value.mode === 'train' ? value.mode : 'octavarium';
  const appearance: Theme = value.appearance === 'dark' ? 'dark' : 'light';
  return { mode, appearance, texture: value.texture !== false };
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_THEME_PREFERENCE };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return normalizeThemePreference(JSON.parse(raw));
  } catch {
    // Fall through to the legacy key.
  }
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    return {
      ...DEFAULT_THEME_PREFERENCE,
      appearance: legacy === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return { ...DEFAULT_THEME_PREFERENCE };
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(preference));
    localStorage.setItem(LEGACY_KEY, preference.appearance);
  } catch {
    // Preferences never block the app.
  }
}

export function applyThemePreference(preference: ThemePreference): Theme {
  const theme = resolveTheme(preference);
  const skin = resolveSkin(preference);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.skin = skin;
    root.dataset.texture = preference.texture ? 'on' : 'off';
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        'content',
        skin === 'train'
          ? theme === 'dark' ? '#121212' : '#f4f4f4'
          : theme === 'dark' ? '#1C242C' : '#f7fbf9',
      );
    }
  }
  saveThemePreference(preference);
  return theme;
}

export function watchSystemAppearance(callback: (theme: Theme) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => callback(media.matches ? 'dark' : 'light');
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}

/** Legacy aliases used by old callers; new code should prefer preference APIs. */
export function getStoredTheme(): Theme {
  return getStoredThemePreference().appearance;
}

export function applyTheme(theme: Theme): void {
  applyThemePreference({ ...getStoredThemePreference(), appearance: theme });
}

export function initializeTheme(): Theme {
  return applyThemePreference(getStoredThemePreference());
}
