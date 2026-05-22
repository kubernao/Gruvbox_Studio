/**
 * Theme color definitions
 * Uses Gruvbox color palette as the foundation
 * WCAG AA compliant contrast ratios for accessibility
 */

export interface ThemeColors {
  // Primary backgrounds
  bg: string;
  bgSecondary: string;
  bgTertiary: string;

  // Text colors
  text: string;
  textSecondary: string;
  textTertiary: string;

  // Accent colors
  accent: string;
  accentHover: string;

  // Editor/File specific
  editorBg: string;
  editorBorder: string;
  sidebarBg: string;
  sidebarBorder: string;

  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // Subtle elements
  divider: string;
  shadow: string;
}

export const LIGHT_THEME: ThemeColors = {
  bg: 'var(--bg-primary)',
  bgSecondary: 'var(--bg-secondary)',
  bgTertiary: 'var(--bg-elevated)',

  text: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textTertiary: 'var(--text-muted)',

  accent: 'var(--accent-primary)',
  accentHover: 'var(--accent-primary-hover)',

  editorBg: 'var(--bg-primary)',
  editorBorder: 'var(--border-default)',
  sidebarBg: 'var(--bg-sidebar)',
  sidebarBorder: 'var(--border-sidebar)',

  success: 'var(--accent-success)',
  warning: 'var(--accent-warning)',
  error: 'var(--accent-danger)',
  info: 'var(--accent-info)',

  divider: 'var(--border-subtle)',
  shadow: 'var(--shadow-sm)',
};

export const DARK_THEME: ThemeColors = {
  bg: 'var(--bg-primary)',
  bgSecondary: 'var(--bg-secondary)',
  bgTertiary: 'var(--bg-elevated)',

  text: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textTertiary: 'var(--text-muted)',

  accent: 'var(--accent-primary)',
  accentHover: 'var(--accent-primary-hover)',

  editorBg: 'var(--bg-primary)',
  editorBorder: 'var(--border-default)',
  sidebarBg: 'var(--bg-sidebar)',
  sidebarBorder: 'var(--border-sidebar)',

  success: 'var(--accent-success)',
  warning: 'var(--accent-warning)',
  error: 'var(--accent-danger)',
  info: 'var(--accent-info)',

  divider: 'var(--border-subtle)',
  shadow: 'var(--shadow-sm)',
};

export type ThemeName = 'light' | 'dark';

export const THEMES: Record<ThemeName, ThemeColors> = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
};
