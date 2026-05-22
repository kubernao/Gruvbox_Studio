import React, {
  createContext,
  ReactNode,
  useLayoutEffect,
  useState,
} from 'react';
import { ThemeName } from '../themes/colors';
import {
  applyTheme,
  getStoredTheme,
  saveTheme,
  getSystemThemePreference,
} from '../themes/utils';

interface ThemeContextType {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

/**
 * Theme context - provides theme state to the entire app
 * Initialized with default 'dark' theme
 */
export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined
);

interface ThemeProviderProps {
  children: ReactNode;
  /**
   * Initial theme to use
   * If not provided, will use stored preference or system preference
   */
  initialTheme?: ThemeName;
}

/**
 * ThemeProvider component
 * Wraps your app to enable theming throughout
 * Manages theme state, persistence, and CSS injection
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  initialTheme,
}) => {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    if (initialTheme) return initialTheme;

    // Try stored preference first
    const stored = getStoredTheme();
    if (stored) return stored;

    // Fall back to system preference
    return getSystemThemePreference();
  });

  /**
   * Apply theme and persist before paint so `body.dark` matches React state.
   */
  useLayoutEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const setTheme = (newTheme: ThemeName) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
