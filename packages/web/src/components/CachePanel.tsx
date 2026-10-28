import type { CacheReport, CdnCacheStatus } from "@htv/core";
import styles from "./CachePanel.module.css";

interface Props {
  report: CacheReport;
  pageLabel: string;
  onClose: () => void;
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
const MONTH = 2_592_000; // 30 days
const YEAR = 31_536_000; // 365 days

function formatDuration(seconds: number): string {
  if (seconds < MINUTE) return `${seconds}s`;
  if (seconds < HOUR) {
    const m = Math.floor(seconds / MINUTE);
    const s = seconds % MINUTE;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (seconds < DAY) {
    const h = Math.floor(seconds / HOUR);
    const m = Math.floor((seconds % HOUR) / MINUTE);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds < MONTH) {
    const d = Math.floor(seconds / DAY);
    const h = Math.floor((seconds % DAY) / HOUR);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (seconds < YEAR) {
    const mo = Math.floor(seconds / MONTH);
    const d = Math.floor((seconds % MONTH) / DAY);
    return d > 0 ? `${mo}mo ${d}d` : `${mo}mo`;
  }
  const y = Math.floor(seconds / YEAR);
  const mo = Math.floor((seconds % YEAR) / MONTH);
  return mo > 0 ? `${y}y ${mo}mo` : `${y}y`;
}

function formatAge(seconds: number): string {
  return formatDuration(seconds);
}

function formatMaxAge(seconds: number): string {
  if (seconds === 0) return "0 (no browser cache)";
  return formatDuration(seconds);
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function CdnStatusBadge({ status }: { status: CdnCacheStatus }) {
  const label = status === "unknown" ? "—" : status.toUpperCase();
  return <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>{label}</span>;
}

function SeverityIcon({ severity }: { severity: "good" | "info" | "warning" | "critical" }) {
  switch (severity) {
    case "good":
      return <span className={`${styles.sevIcon} ${styles.sevGood}`}>✓</span>;
    case "info":
      return <span className={`${styles.sevIcon} ${styles.sevInfo}`}>ℹ</span>;
    case "warning":
      return <span className={`${styles.sevIcon} ${styles.sevWarn}`}>⚠</span>;
    case "critical":
      return <span className={`${styles.sevIcon} ${styles.sevCrit}`}>✕</span>;
  }
}

export function CachePanel({ report, pageLabel, onClose }: Props) {
  const { document: doc, ownResources, browser, recommendations } = report;

  const docCacheControl = Object.entries({
    immutable: doc.immutable,
    "must-revalidate": doc.mustRevalidate,
    "no-store": doc.noStore,
  })
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.headerTitle}>Cache Analysis</span>
          <h2 className={styles.pageLabel}>{pageLabel}</h2>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close cache analysis">
          ✕
        </button>
      </div>

      {/* Scrollable region must be keyboard focusable (WCAG 2.1.1, axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label="Cache analysis details" tabIndex={0}>
        {/* Document */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Document</div>
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>CDN Cache</span>
              <CdnStatusBadge status={doc.cdnStatus} />
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>max-age</span>
              <span className={styles.rowValue}>
                {doc.maxAge !== null ? formatMaxAge(doc.maxAge) : "—"}
              </span>
            </div>
            {docCacheControl && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>Directives</span>
                <span className={`${styles.rowValue} ${styles.mono}`}>{docCacheControl}</span>
              </div>
            )}
            <div className={styles.row}>
              <span className={styles.rowLabel}>CDN Age</span>
              <span
                className={styles.rowValue}
                title={doc.age !== null ? `${doc.age}s` : undefined}
              >
                {doc.age !== null ? formatAge(doc.age) : "—"}
              </span>
            </div>
          </div>
        </section>

        {/* Own resources */}
        {ownResources.total > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              Static Assets <span className={styles.sectionCount}>{ownResources.total}</span>
            </div>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>CDN hits</span>
                <span className={styles.rowValue}>
                  {ownResources.cdnHits}/{ownResources.total}
                  <span className={styles.pct}> {pct(ownResources.cdnHitRatio)}</span>
                </span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Immutable</span>
                <span className={styles.rowValue}>
                  {ownResources.immutableCount}/{ownResources.total}
                  <span className={styles.pct}> {pct(ownResources.immutableRatio)}</span>
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Browser cache */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Browser Cache</div>
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Hit ratio</span>
              <span className={styles.rowValue}>
                {pct(browser.hitRatio)}
                <span className={styles.pct}>
                  {" "}
                  ({browser.fromDisk + browser.fromMemory}/{browser.total})
                </span>
              </span>
            </div>
            {(browser.fromDisk > 0 || browser.fromMemory > 0) && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>From disk</span>
                <span className={styles.rowValue}>{browser.fromDisk}</span>
              </div>
            )}
            {browser.fromMemory > 0 && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>From memory</span>
                <span className={styles.rowValue}>{browser.fromMemory}</span>
              </div>
            )}
          </div>
        </section>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>Recommendations</div>
            <div className={styles.recs}>
              {recommendations.map((rec, i) => (
                <div key={i} className={`${styles.rec} ${styles[`rec_${rec.severity}`]}`}>
                  <SeverityIcon severity={rec.severity} />
                  <div className={styles.recContent}>
                    <div className={styles.recLabel}>{rec.label}</div>
                    <div className={styles.recDesc}>{rec.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
