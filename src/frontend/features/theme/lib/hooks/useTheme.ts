import { useContext } from 'react';
import { ThemeContext } from '../context/ThemeContext';
import { ThemeName } from '../themes/colors';

interface UseThemeReturn {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  isDark: boolean;
  isLight: boolean;
}

/**
 * Hook to access theme functionality in any component
 * Must be used within a ThemeProvider
 * @throws Error if used outside of ThemeProvider
 */
export const useTheme = (): UseThemeReturn => {
  const context = useContext(ThemeContext);

  if (context === undefined) {
    throw new Error(
      'useTheme must be used within a ThemeProvider. ' +
        'Make sure your component tree is wrapped with <ThemeProvider>'
    );
  }

  return {
    ...context,
    isDark: context.theme === 'dark',
    isLight: context.theme === 'light',
  };
};
