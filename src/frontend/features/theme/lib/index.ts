/**
 * Barrel export file for theming system
 * Simplifies imports throughout the app
 */

// Context
export { ThemeProvider } from './context/ThemeContext';
export type { } from './context/ThemeContext';

// Hooks
export { useTheme } from './hooks/useTheme';
export type { } from './hooks/useTheme';

// Theme colors and utilities
export { THEMES, LIGHT_THEME, DARK_THEME } from './themes/colors';
export type { ThemeColors } from './themes/colors';
export type { ThemeName } from './themes/colors';
export {
  applyTheme,
  getStoredTheme,
  saveTheme,
  getSystemThemePreference,
} from './themes/utils';

// Components
export { ThemeSwitcher } from './components/ThemeSwitcher/ThemeSwitcher';
