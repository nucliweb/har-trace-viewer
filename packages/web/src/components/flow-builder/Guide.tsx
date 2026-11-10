import { useMessages } from "../../i18n/context.js";
import styles from "../FlowBuilder.module.css";

/** Mini diagram motif: browser, edge and origin joined by a dashed request path. */
export function DemoGlyph() {
  return (
    <svg className={styles.demoGlyph} viewBox="0 0 72 32" aria-hidden="true" focusable="false">
      <path d="M10 16 H36 M36 16 H62" className={styles.demoGlyphPath} />
      <circle cx="10" cy="16" r="5" className={styles.demoGlyphNode} />
      <circle cx="36" cy="16" r="5" className={styles.demoGlyphNode} />
      <circle cx="62" cy="16" r="5" className={styles.demoGlyphOrigin} />
    </svg>
  );
}

/** Where the HAR and the trace come from, step by step. */
export function Guide() {
  const t = useMessages().builder.guide;
  return (
    <section className={styles.guide} aria-labelledby="guide-heading">
      <h3 id="guide-heading" className={styles.guideHeading}>
        {t.heading}
      </h3>
      <div className={styles.guideColumns}>
        <div className={styles.guideCard}>
          <h4 className={styles.guideTitle}>{t.har}</h4>
          <ol className={styles.guideSteps}>
            {t.harSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <div className={styles.guideCard}>
          <h4 className={styles.guideTitle}>{t.trace}</h4>
          <ol className={styles.guideSteps}>
            {t.traceSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
