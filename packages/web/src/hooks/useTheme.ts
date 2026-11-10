import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Shared with the inline script in index.html, which applies the theme before first paint. */
export const THEME_STORAGE_KEY = "htv-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredChoice(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function writeStoredChoice(theme: Theme | null): void {
  try {
    if (theme) window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    else window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage is unavailable (private mode, blocked site data): the choice lasts for this page only.
  }
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

interface ThemeState {
  theme: Theme;
  // The persisted choice; null follows the system preference.
  choice: Theme | null;
  toggleTheme: () => void;
  setChoice: (choice: Theme | null) => void;
}

/**
 * Resolves the active theme: the persisted choice when there is one, otherwise the system
 * preference (followed live). The resolved value is written to `data-theme` on <html>.
 */
export function useTheme(): ThemeState {
  const [choice, setChoice] = useState<Theme | null>(readStoredChoice);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = choice ?? system;

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const choose = useCallback((next: Theme | null) => {
    writeStoredChoice(next);
    setChoice(next);
  }, []);
  const toggleTheme = useCallback(
    () => choose(theme === "dark" ? "light" : "dark"),
    [choose, theme]
  );

  return { theme, choice, toggleTheme, setChoice: choose };
}
