import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const THEME_COLORS: Record<Theme, string> = {
  light: '#F4F7FB',
  dark: '#000000',
};

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  const [hasUserPreference, setHasUserPreference] = useState(
    () => document.documentElement.dataset.themePreference === 'user',
  );
  const toggleTheme = useCallback(() => {
    setHasUserPreference(true);
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = (event: MediaQueryListEvent) => {
      if (!hasUserPreference) {
        setTheme(event.matches ? 'dark' : 'light');
      }
    };

    colorScheme.addEventListener('change', syncSystemTheme);
    return () => colorScheme.removeEventListener('change', syncSystemTheme);
  }, [hasUserPreference]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.dataset.themePreference = hasUserPreference ? 'user' : 'system';
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLORS[theme]);

    if (hasUserPreference) {
      try {
        localStorage.setItem('theme', theme);
      } catch (error) {
        console.error('Unable to persist the WatchTube theme preference.', error);
      }
    }
  }, [hasUserPreference, theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
