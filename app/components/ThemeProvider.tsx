'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

interface Theme {
  id: number;
  name: string;
  background: string;
  foreground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  customCss?: string | null;
}

interface ThemeContextType {
  theme: Theme | null;
  availableThemes: Theme[];
  customTheme: Theme | null;
  isLoading: boolean;
  setTheme: (themeId: number | null) => Promise<void>;
  refreshThemes: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const defaultDarkTheme: Theme = {
  id: -1,
  name: 'Dark',
  background: '#0a0a0a',
  foreground: '#ededed',
  primary: '#3b82f6',
  primaryForeground: '#ffffff',
  secondary: '#1e293b',
  secondaryForeground: '#f1f5f9',
  accent: '#8b5cf6',
  accentForeground: '#ffffff',
  muted: '#1e293b',
  mutedForeground: '#94a3b8',
  border: '#334155',
};

const defaultLightTheme: Theme = {
  id: -2,
  name: 'Light',
  background: '#ffffff',
  foreground: '#0f172a',
  primary: '#1d4ed8',
  primaryForeground: '#ffffff',
  secondary: '#e2e8f0',
  secondaryForeground: '#1e293b',
  accent: '#6d28d9',
  accentForeground: '#ffffff',
  muted: '#f1f5f9',
  mutedForeground: '#475569',
  border: '#cbd5e1',
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty('--background', theme.background);
  root.style.setProperty('--foreground', theme.foreground);
  root.style.setProperty('--primary', theme.primary);
  root.style.setProperty('--primary-foreground', theme.primaryForeground);
  root.style.setProperty('--secondary', theme.secondary);
  root.style.setProperty('--secondary-foreground', theme.secondaryForeground);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-foreground', theme.accentForeground);
  root.style.setProperty('--muted', theme.muted);
  root.style.setProperty('--muted-foreground', theme.mutedForeground);
  root.style.setProperty('--border', theme.border);

  // Handle custom CSS
  let styleElement = document.getElementById('custom-theme-css') as HTMLStyleElement;
  
  if (theme.customCss) {
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'custom-theme-css';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = theme.customCss;
  } else if (styleElement) {
    // Remove custom CSS if theme doesn't have any
    styleElement.remove();
  }

  // Save to localStorage to prevent flash on reload
  try {
    localStorage.setItem('theme', JSON.stringify(theme));
  } catch (e) {
    // localStorage might not be available
  }

  // Dispatch custom event to notify Monaco editor and other components
  window.dispatchEvent(new CustomEvent('themeChanged', { detail: theme }));
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return defaultDarkTheme;
  
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? defaultDarkTheme : defaultLightTheme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [theme, setThemeState] = useState<Theme | null>(null);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>([]);
  const [customTheme, setCustomTheme] = useState<Theme | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch available themes
  const fetchThemes = async () => {
    try {
      const response = await fetch('/api/themes');
      if (response.ok) {
        const data = await response.json();
        setAvailableThemes(data.publicThemes || []);
        setCustomTheme(data.customTheme || null);
      }
    } catch (error) {
      console.error('Error fetching themes:', error);
    }
  };

  // Fetch user's selected theme
  const fetchUserTheme = async () => {
    try {
      const response = await fetch('/api/user/theme');
      if (response.ok) {
        const data = await response.json();
        return data.theme;
      }
    } catch (error) {
      console.error('Error fetching user theme:', error);
    }
    return null;
  };

  // Set theme
  const setTheme = async (themeId: number | null) => {
    if (status !== 'authenticated') return;

    try {
      const response = await fetch('/api/user/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId }),
      });

      if (response.ok) {
        const data = await response.json();
        const newTheme = data.theme || getSystemTheme();
        setThemeState(newTheme);
        applyTheme(newTheme);
      } else {
        const error = await response.json();
        if (error.error?.includes('log out and log back in')) {
          console.error('Session out of sync. User needs to re-authenticate.');
          // Optionally show a toast notification here
        }
        console.error('Failed to set theme:', error);
      }
    } catch (error) {
      console.error('Error setting theme:', error);
    }
  };

  const refreshThemes = async () => {
    await fetchThemes();
  };

  // Initialize theme on mount and when session changes
  useEffect(() => {
    const initializeTheme = async () => {
      setIsLoading(true);
      
      // Fetch available themes
      await fetchThemes();

      if (status === 'authenticated' && session?.user) {
        // User is logged in - fetch their selected theme
        const userTheme = await fetchUserTheme();
        const selectedTheme = userTheme || getSystemTheme();
        setThemeState(selectedTheme);
        applyTheme(selectedTheme);
      } else if (status === 'unauthenticated') {
        // User is not logged in - use system preference
        const systemTheme = getSystemTheme();
        setThemeState(systemTheme);
        applyTheme(systemTheme);
      }

      setIsLoading(false);
    };

    initializeTheme();
  }, [status, session?.user]);

  // Listen for system theme changes when user is not logged in
  useEffect(() => {
    if (status !== 'unauthenticated') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const systemTheme = getSystemTheme();
      setThemeState(systemTheme);
      applyTheme(systemTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [status]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        availableThemes,
        customTheme,
        isLoading,
        setTheme,
        refreshThemes,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
