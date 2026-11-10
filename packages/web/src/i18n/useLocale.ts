import { useCallback, useEffect, useState } from "react";
import { ca } from "./ca.js";
import { en } from "./en.js";
import type { Messages } from "./en.js";
import { es } from "./es.js";

export const LOCALES = ["en", "es", "ca"] as const;
export type Locale = (typeof LOCALES)[number];

const MESSAGES: Record<Locale, Messages> = { en, es, ca };

export const LOCALE_STORAGE_KEY = "htv-locale";

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

function readStoredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage is unavailable (private mode, blocked site data): the choice lasts for this page only.
  }
}

/** The first browser language the interface speaks, by its primary subtag (es-MX speaks es). */
function browserLocale(): Locale {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return "en";
}

interface LocaleState {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
  cycleLocale: () => void;
}

/**
 * The interface language: the persisted choice when there is one, otherwise the first browser
 * language it speaks, else English. The active language is written to `lang` on <html>.
 */
export function useLocale(): LocaleState {
  const [locale, setState] = useState<Locale>(() => readStoredLocale() ?? browserLocale());

  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next);
    setState(next);
  }, []);
  const cycleLocale = useCallback(
    () => setLocale(LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]),
    [locale, setLocale]
  );

  return { locale, t: MESSAGES[locale], setLocale, cycleLocale };
}
