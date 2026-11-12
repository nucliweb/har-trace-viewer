import { useMessages } from "../i18n/context.js";
import { SHORTCUT_GROUPS } from "../lib/shortcuts.js";
import { Modal } from "./Modal.js";
import styles from "./SettingsModal.module.css";

const REPOSITORY = "https://github.com/nucliweb/har-trace-viewer";
const PACKAGE = "https://www.npmjs.com/package/har-trace-viewer";

/** How to get a diagram from the files, the keyboard shortcuts of the app and what htv is. */
export function HelpModal({ onClose }: { onClose: () => void }) {
  const t = useMessages().help;
  return (
    <Modal title={t.title} onClose={onClose}>
      <section className={styles.section} aria-label={t.start.title}>
        <h3 className={styles.sectionTitle}>{t.start.title}</h3>
        <ol className={styles.steps}>
          {t.start.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className={styles.about}>{t.start.more}</p>
      </section>
      <h3 className={styles.sectionTitle}>{t.shortcuts}</h3>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className={styles.section} aria-label={t.groups[group.title]}>
          <h4 className={styles.groupTitle}>{t.groups[group.title]}</h4>
          <dl className={styles.shortcuts}>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.action} className={styles.shortcut}>
                <dt>
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className={styles.key}>
                      {t.keys[key] ?? key}
                    </kbd>
                  ))}
                </dt>
                <dd>{t.actions[shortcut.action]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section className={styles.section} aria-label={t.about}>
        <h3 className={styles.sectionTitle}>{t.about}</h3>
        <p className={styles.about}>
          HAR Trace Viewer <span className={styles.version}>v{__HTV_VERSION__}</span> {t.aboutText}
        </p>
        <p className={styles.links}>
          <a href={REPOSITORY} target="_blank" rel="noreferrer">
            {t.source}
          </a>
          <a href={PACKAGE} target="_blank" rel="noreferrer">
            {t.cli}
          </a>
        </p>
      </section>
    </Modal>
  );
}
