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
  return (
    <section className={styles.guide} aria-labelledby="guide-heading">
      <h3 id="guide-heading" className={styles.guideHeading}>
        Where do the files come from?
      </h3>
      <div className={styles.guideColumns}>
        <div className={styles.guideCard}>
          <h4 className={styles.guideTitle}>HAR file</h4>
          <ol className={styles.guideSteps}>
            <li>Open DevTools and go to the Network panel.</li>
            <li>Tick &ldquo;Preserve log&rdquo; and reload the page.</li>
            <li>Click the download icon, &ldquo;Export HAR (with content)&rdquo;.</li>
          </ol>
        </div>
        <div className={styles.guideCard}>
          <h4 className={styles.guideTitle}>Trace (optional)</h4>
          <ol className={styles.guideSteps}>
            <li>Go to the Performance panel.</li>
            <li>Click &ldquo;Record and reload&rdquo;, then stop the recording.</li>
            <li>Click &ldquo;Save profile&rdquo; to get a .json.gz file.</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
