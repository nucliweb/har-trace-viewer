import { useId } from "react";
import type { Theme } from "../hooks/useTheme.js";
import { Modal } from "./Modal.js";
import styles from "./SettingsModal.module.css";

interface Props {
  // The persisted theme; null follows the system preference.
  themeChoice: Theme | null;
  onThemeChoice: (choice: Theme | null) => void;
  onShowHelp: () => void;
  onClose: () => void;
}

const THEMES: { label: string; value: Theme | null }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: null },
];

export function SettingsModal({ themeChoice, onThemeChoice, onShowHelp, onClose }: Props) {
  const name = useId();
  return (
    <Modal title="Settings" onClose={onClose}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.sectionTitle}>Theme</legend>
        <div className={styles.options}>
          {THEMES.map(({ label, value }) => (
            <label key={label} className={styles.option}>
              <input
                type="radio"
                name={name}
                checked={themeChoice === value}
                onChange={() => onThemeChoice(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className={styles.linkButton} onClick={onShowHelp}>
        Keyboard shortcuts and about
      </button>
    </Modal>
  );
}
