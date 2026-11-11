import { useId } from "react";
import { browserCacheHitCount, fileName, formatBytes, pct } from "@htv/core";
import type {
  CacheReport,
  CdnCacheStatus,
  NetworkReport,
  Recommendation,
  RecommendationResource,
} from "@htv/core";
import { useCoreLang, useMessages } from "../i18n/context.js";
import styles from "./CachePanel.module.css";

interface Props {
  report: CacheReport;
  // Absent in flows generated before the network report existed: its section is left out.
  network?: NetworkReport;
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

/** The resources a recommendation names, collapsed behind their count and total size. */
function RecResources({ resources }: { resources: RecommendationResource[] }) {
  const t = useMessages().cache;
  const lang = useCoreLang();
  const total = resources.reduce((sum, r) => sum + r.transferSize, 0);
  return (
    <details className={styles.recResources}>
      <summary className={styles.recResourcesSummary}>
        {t.resources(resources.length)} · {formatBytes(total)}
      </summary>
      <ul className={styles.recResourceList}>
        {resources.map((r, i) => (
          <li key={i} className={styles.recResource}>
            <span className={styles.recResourceName} title={r.url}>
              {fileName(r.url)}
            </span>
            <span className={styles.recResourceSize}>{formatBytes(r.transferSize)}</span>
            <span className={styles.recResourceCc} lang={lang}>
              {r.detail ?? r.cacheControl}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function RecommendationList({ recommendations }: { recommendations: Recommendation[] }) {
  const lang = useCoreLang();
  return (
    <div className={styles.recs}>
      {recommendations.map((rec, i) => (
        <div key={i} className={`${styles.rec} ${styles[`rec_${rec.severity}`]}`}>
          <SeverityIcon severity={rec.severity} />
          <div className={styles.recContent}>
            <div className={styles.recLabel} lang={lang}>
              {rec.label}
            </div>
            <div className={styles.recDesc} lang={lang}>
              {rec.description}
            </div>
            {rec.resources && rec.resources.length > 0 && (
              <RecResources resources={rec.resources} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CachePanel({ report, network, pageLabel, onClose }: Props) {
  const t = useMessages().cache;
  const networkTitleId = useId();
  const { document: doc, ownResources, browser, recommendations } = report;
  // Browser-cache hits never reach the CDN: the ratio covers the own network requests.
  const cdnJudged = ownResources.network ?? ownResources.total;
  const inferred = browser.inferred ?? 0;
  const revalidated = browser.revalidated ?? 0;

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
        <h2 className={styles.headerText}>
          <span className={styles.headerTitle}>{t.title}</span>{" "}
          <span className={styles.pageLabel}>{pageLabel}</span>
        </h2>
        <button className={styles.closeBtn} onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </div>

      {/* Scrollable region must be keyboard focusable (WCAG 2.1.1, axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label={t.details} tabIndex={0}>
        {/* Document */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>{t.document}</div>
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>{t.cdnCache}</span>
              <CdnStatusBadge status={doc.cdnStatus} />
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>max-age</span>
              <span className={styles.rowValue}>
                {doc.maxAge === null
                  ? "—"
                  : doc.maxAge === 0
                    ? t.noBrowserCache
                    : formatDuration(doc.maxAge)}
              </span>
            </div>
            {docCacheControl && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t.directives}</span>
                <span className={`${styles.rowValue} ${styles.mono}`}>{docCacheControl}</span>
              </div>
            )}
            <div className={styles.row}>
              <span className={styles.rowLabel}>{t.cdnAge}</span>
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
              {t.staticAssets} <span className={styles.sectionCount}>{ownResources.total}</span>
            </div>
            <div className={styles.rows}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t.cdnHits}</span>
                <span className={styles.rowValue}>
                  {cdnJudged > 0 ? (
                    <>
                      {ownResources.cdnHits}/{cdnJudged}
                      <span className={styles.pct}> {pct(ownResources.cdnHitRatio)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t.immutable}</span>
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
          <div className={styles.sectionTitle}>{t.browserCache}</div>
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>{t.hitRatio}</span>
              <span className={styles.rowValue}>
                {pct(browser.hitRatio)}
                <span className={styles.pct}>
                  {" "}
                  ({browserCacheHitCount(browser)}/{browser.total})
                </span>
              </span>
            </div>
            {(browser.fromDisk > 0 || browser.fromMemory > 0) && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t.fromDisk}</span>
                <span className={styles.rowValue}>{browser.fromDisk}</span>
              </div>
            )}
            {browser.fromMemory > 0 && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t.fromMemory}</span>
                <span className={styles.rowValue}>{browser.fromMemory}</span>
              </div>
            )}
            {(browser.fromUnknownStore ?? 0) > 0 && (
              <div className={styles.row} title={t.storeNotRecordedTitle}>
                <span className={styles.rowLabel}>{t.storeNotRecorded}</span>
                <span className={styles.rowValue}>{browser.fromUnknownStore}</span>
              </div>
            )}
            {inferred > 0 && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t.inferred}</span>
                <span className={styles.rowValue}>{inferred}</span>
              </div>
            )}
            {revalidated > 0 && (
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t.revalidated}</span>
                <span className={styles.rowValue}>{revalidated}</span>
              </div>
            )}
          </div>
        </section>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>{t.recommendations}</div>
            <RecommendationList recommendations={recommendations} />
          </section>
        )}

        {/* Network: duplicate requests, redirects, failed responses, mixed content */}
        {network && (
          <section className={styles.section} aria-labelledby={networkTitleId}>
            <div className={styles.sectionTitle} id={networkTitleId}>
              {t.network}
            </div>
            {network.recommendations.length > 0 ? (
              <RecommendationList recommendations={network.recommendations} />
            ) : (
              <p className={styles.recDesc}>{t.networkClean}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
