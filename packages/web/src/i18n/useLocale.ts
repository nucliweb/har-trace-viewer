import { useCallback, useEffect, useState } from "react";
import { en } from "./en.js";
import type { Messages } from "./en.js";

export const LOCALES = ["en", "es", "ca"] as const;
export type Locale = (typeof LOCALES)[number];

// English is the fallback, part of the app; the public site fetches the others when chosen.
const LOADERS: Record<Exclude<Locale, "en">, () => Promise<Messages>> = {
  es: () => import("./es.js").then((module) => module.es),
  ca: () => import("./ca.js").then((module) => module.ca),
};
const loaded: Partial<Record<Locale, Messages>> = { en };
const loading = new Map<Locale, Promise<Messages>>();

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
  /** The chosen language. */
  locale: Locale;
  /** The texts on screen: the chosen language's once it has loaded. */
  t: Messages;
  setLocale: (locale: Locale) => void;
  cycleLocale: () => void;
}

/** The persisted choice when there is one, otherwise the first browser language it speaks. */
export function initialLocale(): Locale {
  return readStoredLocale() ?? browserLocale();
}

/** The texts of a language, loaded once: English ships with the app, the others on demand. */
export function loadMessages(locale: Locale): Promise<Messages> {
  const ready = loaded[locale];
  if (ready) return Promise.resolve(ready);
  let pending = loading.get(locale);
  if (!pending) {
    pending = LOADERS[locale as Exclude<Locale, "en">]().then(
      (messages) => (loaded[locale] = messages),
      (error: unknown) => {
        loading.delete(locale);
        throw error;
      }
    );
    loading.set(locale, pending);
  }
  return pending;
}

/**
 * The interface language: the persisted choice when there is one, otherwise the first browser
 * language it speaks, else English. `locale` is the choice; `t` and `lang` on <html> follow the
 * language on screen, which stays until the chosen one has loaded (or for good, if it fails to).
 */
export function useLocale(): LocaleState {
  const [locale, setChoice] = useState(initialLocale);
  const [fallback, setFallback] = useState<Locale>("en");
  const shown = loaded[locale] ? locale : fallback;

  useEffect(() => {
    if (loaded[locale]) return;
    // A language that loads after a newer choice is not shown.
    let current = true;
    loadMessages(locale).then(
      () => {
        if (current) setFallback(locale);
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [locale]);

  useEffect(() => {
    document.documentElement.setAttribute("lang", shown);
  }, [shown]);

  const setLocale = useCallback(
    (next: Locale) => {
      writeStoredLocale(next);
      setFallback(shown);
      setChoice(next);
    },
    [shown]
  );
  const cycleLocale = useCallback(
    () => setLocale(LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]),
    [locale, setLocale]
  );

  return { locale, t: loaded[shown] ?? en, setLocale, cycleLocale };
}
