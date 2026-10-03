/**
 * Kriya theme switching (DS §12.3). Dark is the default and the only theme for the
 * platform console and login; the tenant console may opt into light.
 * The preference is a per-viewer convenience: storage can be unavailable (private mode,
 * blocked site data), so every access is guarded and the page still renders dark.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'kriya-theme';

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted; the theme still applies for this page view.
  }
}
