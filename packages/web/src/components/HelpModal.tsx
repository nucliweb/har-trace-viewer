import { SHORTCUT_GROUPS } from "../lib/shortcuts.js";
import { Modal } from "./Modal.js";
import styles from "./SettingsModal.module.css";

const REPOSITORY = "https://github.com/nucliweb/har-trace-viewer";
const PACKAGE = "https://www.npmjs.com/package/har-trace-viewer";

/** The keyboard shortcuts of the app and what htv is. */
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className={styles.section} aria-label={group.title}>
          <h3 className={styles.sectionTitle}>{group.title}</h3>
          <dl className={styles.shortcuts}>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.action} className={styles.shortcut}>
                <dt>
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className={styles.key}>
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd>{shortcut.action}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section className={styles.section} aria-label="About">
        <h3 className={styles.sectionTitle}>About</h3>
        <p className={styles.about}>
          HAR Trace Viewer <span className={styles.version}>v{__HTV_VERSION__}</span> shows how a
          page load travels through the CDN, the origin and third parties, from a HAR file and a
          Chrome trace, with cache, network and Core Web Vitals findings. Your files stay in this
          browser.
        </p>
        <p className={styles.links}>
          <a href={REPOSITORY} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          <a href={PACKAGE} target="_blank" rel="noreferrer">
            CLI on npm
          </a>
        </p>
      </section>
    </Modal>
  );
}
