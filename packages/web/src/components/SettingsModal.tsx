import { useId } from "react";
import type { Theme } from "../hooks/useTheme.js";
import { useMessages } from "../i18n/context.js";
import { LOCALES } from "../i18n/useLocale.js";
import type { Locale } from "../i18n/useLocale.js";
import { Modal } from "./Modal.js";
import styles from "./SettingsModal.module.css";

interface Props {
  // The persisted theme; null follows the system preference.
  themeChoice: Theme | null;
  onThemeChoice: (choice: Theme | null) => void;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  // The builder offers "+ Add page": a flow from several HAR files.
  journeys: boolean;
  onJourneys: (on: boolean) => void;
  onShowHelp: () => void;
  onClose: () => void;
}

const THEMES: { label: "light" | "dark" | "system"; value: Theme | null }[] = [
  { label: "light", value: "light" },
  { label: "dark", value: "dark" },
  { label: "system", value: null },
];

// Each language in its own: whoever cannot read the active one still finds theirs.
const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", es: "Español", ca: "Català" };

export function SettingsModal({
  themeChoice,
  onThemeChoice,
  locale,
  onLocale,
  journeys,
  onJourneys,
  onShowHelp,
  onClose,
}: Props) {
  const t = useMessages().settings;
  const themeName = useId();
  const languageName = useId();
  const journeysHint = useId();
  return (
    <Modal title={t.title} onClose={onClose}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.sectionTitle}>{t.theme}</legend>
        <div className={styles.options}>
          {THEMES.map(({ label, value }) => (
            <label key={label} className={styles.option}>
              <input
                type="radio"
                name={themeName}
                checked={themeChoice === value}
                onChange={() => onThemeChoice(value)}
              />
              {t[label]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend className={styles.sectionTitle}>{t.language}</legend>
        <div className={styles.options}>
          {LOCALES.map((value) => (
            <label key={value} className={styles.option}>
              <input
                type="radio"
                name={languageName}
                checked={locale === value}
                onChange={() => onLocale(value)}
              />
              <span lang={value}>{LANGUAGE_NAMES[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend className={styles.sectionTitle}>{t.builder}</legend>
        <div className={styles.options}>
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={journeys}
              onChange={(event) => onJourneys(event.target.checked)}
              aria-describedby={journeysHint}
            />
            {t.journeys}
          </label>
        </div>
        <p id={journeysHint} className={styles.hint}>
          {t.journeysHint}
        </p>
      </fieldset>
      <button type="button" className={styles.linkButton} onClick={onShowHelp}>
        {t.showHelp}
      </button>
    </Modal>
  );
}
