import {
  SCRIPT_PARTY_LABEL,
  SERVER_WAIT_LABEL,
  TTFB_LABEL,
  formatBytes,
  formatMs,
  pct,
  rateMetric,
  shortUrl,
  summarizeFlowMetrics,
} from "@htv/core";
import type { Flow, MainThreadReport, MetricRating, PageMetricsSummary } from "@htv/core";
import { useMemo } from "react";
import { useCoreLang, useMessages } from "../i18n/context.js";
import type { Messages } from "../i18n/en.js";
import styles from "./MetricsSummary.module.css";

interface Props {
  flow: Flow;
  onClose: () => void;
}

const formatCls = (value: number | null | undefined, na: string) =>
  value === null || value === undefined ? na : value.toFixed(3);

interface Row {
  label: string;
  /** The label comes from @htv/core, in English whatever the interface language. */
  core?: boolean;
  /** Metric key for rating; omitted rows render neutral. */
  metric?: string;
  value: (page: PageMetricsSummary) => number | null | undefined;
  format: (page: PageMetricsSummary) => string;
}

// Metric names stay as @htv/core and the exports write them; the plain words follow the language.
const rows = (t: Messages["metrics"]): Row[] => [
  {
    label: TTFB_LABEL,
    core: true,
    metric: "ttfb",
    value: (p) => p.ttfb,
    format: (p) => formatMs(p.ttfb),
  },
  {
    label: SERVER_WAIT_LABEL,
    core: true,
    value: (p) => p.serverWait,
    format: (p) => formatMs(p.serverWait),
  },
  { label: "FCP", metric: "fcp", value: (p) => p.fcp, format: (p) => formatMs(p.fcp) },
  { label: "LCP", metric: "lcp", value: (p) => p.lcp, format: (p) => formatMs(p.lcp) },
  { label: "CLS", metric: "cls", value: (p) => p.cls, format: (p) => formatCls(p.cls, t.na) },
  { label: "INP", metric: "inp", value: (p) => p.inp, format: (p) => formatMs(p.inp) },
  { label: "TBT", metric: "tbt", value: (p) => p.tbt, format: (p) => formatMs(p.tbt) },
  { label: "DCL", value: (p) => p.dcl, format: (p) => formatMs(p.dcl) },
  { label: "onLoad", value: (p) => p.onLoad, format: (p) => formatMs(p.onLoad) },
  { label: t.requests, value: (p) => p.requests, format: (p) => String(p.requests) },
  { label: t.cacheHits, value: (p) => p.cacheHits, format: (p) => String(p.cacheHits) },
  { label: t.transfer, value: (p) => p.transferBytes, format: (p) => formatBytes(p.transferBytes) },
  {
    label: t.cdnHitRatio,
    value: (p) => p.cdnHitRatio,
    format: (p) => (p.cdnHitRatio === null ? t.na : pct(p.cdnHitRatio)),
  },
  {
    label: t.browserHitRatio,
    value: (p) => p.browserCacheHitRatio,
    format: (p) => pct(p.browserCacheHitRatio),
  },
];

export const RATING_CLASS: Record<MetricRating, string> = {
  good: styles.good,
  "needs-improvement": styles.warn,
  poor: styles.poor,
  none: "",
};

const TOP_SCRIPTS = 8;

/** The main thread of one page: its busy time, the TBT window and the scripts that took the time. */
function MainThreadSection({ report, label }: { report: MainThreadReport; label: string }) {
  const t = useMessages().metrics;
  const lang = useCoreLang();
  const categories = (Object.entries(report.byCategory) as [string, number][])
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, ms]) => `${category} ${formatMs(ms)}`)
    .join(" · ");
  const window =
    report.tbtMs === null
      ? t.tbtNoFcp
      : t.tbtWindow(formatMs(report.tbtMs), report.tbtEndedBy === "interaction");
  return (
    <>
      <h3 className={styles.sectionTitle}>{t.mainThread(label)}</h3>
      <p className={styles.sectionNote}>
        {t.busy(formatMs(report.busyMs), categories, window, report.longTasks.length)}
      </p>
      {report.scripts.length > 0 && (
        <table className={styles.table}>
          <caption className={styles.caption}>{t.scriptsCaption(label)}</caption>
          <thead>
            <tr>
              <th scope="col">{t.script}</th>
              <th scope="col">{t.party}</th>
              <th scope="col">{t.entity}</th>
              <th scope="col">{t.time}</th>
              <th scope="col" title={t.blockingTitle}>
                {t.blocking}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.scripts.slice(0, TOP_SCRIPTS).map((s) => (
              <tr key={s.url}>
                <th scope="row" title={s.url}>
                  {shortUrl(s.url)}
                </th>
                <td lang={lang}>{SCRIPT_PARTY_LABEL[s.party]}</td>
                <td>{s.entity}</td>
                <td className={styles.num}>{formatMs(s.ms)}</td>
                <td className={styles.num}>{formatMs(s.blockingMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function MetricsSummary({ flow, onClose }: Props) {
  const messages = useMessages();
  const t = messages.metrics;
  const pageLabel = messages.diagram.pageLabel;
  const lang = useCoreLang();
  const pages = useMemo(() => summarizeFlowMetrics(flow), [flow]);
  const mainThreads = flow.pageAnalyses.flatMap((analysis, i) =>
    analysis.mainThreadReport
      ? [{ report: analysis.mainThreadReport, label: pageLabel(i + 1, pages[i].name) }]
      : []
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t.title}</h2>
        <button className={styles.closeBtn} onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </div>
      {/* Scrollable region must be keyboard focusable (axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label={t.details} tabIndex={0}>
        <table className={styles.table}>
          <caption className={styles.caption}>{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.metric}</th>
              {pages.map((p, i) => (
                <th scope="col" key={i}>
                  {pageLabel(i + 1, p.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows(t).map((row) => (
              <tr key={row.label}>
                <th scope="row" lang={row.core ? lang : undefined}>
                  {row.label}
                </th>
                {pages.map((p, i) => {
                  const rating = row.metric ? rateMetric(row.metric, row.value(p)) : "none";
                  return (
                    <td key={i} className={RATING_CLASS[rating]} data-rating={rating}>
                      {row.format(p)}
                      {rating !== "none" && (
                        <span className={styles.srOnly}>{` (${t.rating[rating]})`}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {mainThreads.map(({ report, label }) => (
          <MainThreadSection key={label} report={report} label={label} />
        ))}
      </div>
    </div>
  );
}
