export type Theme = 'light' | 'dark';

export const THEME_KEY = 'dse-candidate:theme';

export function getStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B1622' : '#ffffff');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Theme persistence is a preference; never fail the app for it.
  }
}

export function initializeTheme(): Theme {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
}
