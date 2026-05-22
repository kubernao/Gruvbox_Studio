import { ThemeName } from './colors';

/**
 * Applies the active theme class on <body>.
 * CSS token values are defined in theme stylesheets.
 */
export function applyTheme(themeName: ThemeName): void {
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('dark', themeName === 'dark');
  }
}

/**
 * Gets stored theme preference from localStorage
 * Falls back to 'dark' if not set
 */
export function getStoredTheme(): ThemeName {
  try {
    const stored = localStorage.getItem('gruvbox-theme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch (e) {
    // localStorage may not be available
    console.warn('localStorage not available:', e);
  }
  return 'dark';
}

/**
 * Saves theme preference to localStorage
 */
export function saveTheme(themeName: ThemeName): void {
  try {
    localStorage.setItem('gruvbox-theme', themeName);
  } catch (e) {
    console.warn('Could not save theme preference:', e);
  }
}

/**
 * Detects system preference for color scheme
 */
export function getSystemThemePreference(): ThemeName {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return 'dark';
}
