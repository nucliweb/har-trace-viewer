import {
  SERVER_WAIT_LABEL,
  TTFB_LABEL,
  formatBytes,
  formatMs,
  rateMetric,
  summarizeFlowMetrics,
} from "@htv/core";
import type { Flow, MetricRating, PageMetricsSummary } from "@htv/core";
import { useMemo } from "react";
import styles from "./MetricsSummary.module.css";

interface Props {
  flow: Flow;
  onClose: () => void;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const formatCls = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : value.toFixed(3);

interface Row {
  label: string;
  /** Metric key for rating; omitted rows render neutral. */
  metric?: string;
  value: (page: PageMetricsSummary) => number | null | undefined;
  format: (page: PageMetricsSummary) => string;
}

const ROWS: Row[] = [
  { label: TTFB_LABEL, metric: "ttfb", value: (p) => p.ttfb, format: (p) => formatMs(p.ttfb) },
  {
    label: SERVER_WAIT_LABEL,
    value: (p) => p.serverWait,
    format: (p) => formatMs(p.serverWait),
  },
  { label: "FCP", metric: "fcp", value: (p) => p.fcp, format: (p) => formatMs(p.fcp) },
  { label: "LCP", metric: "lcp", value: (p) => p.lcp, format: (p) => formatMs(p.lcp) },
  { label: "CLS", metric: "cls", value: (p) => p.cls, format: (p) => formatCls(p.cls) },
  { label: "INP", metric: "inp", value: (p) => p.inp, format: (p) => formatMs(p.inp) },
  { label: "DCL", value: (p) => p.dcl, format: (p) => formatMs(p.dcl) },
  { label: "onLoad", value: (p) => p.onLoad, format: (p) => formatMs(p.onLoad) },
  { label: "Requests", value: (p) => p.requests, format: (p) => String(p.requests) },
  { label: "Browser cache hits", value: (p) => p.cacheHits, format: (p) => String(p.cacheHits) },
  { label: "Transfer", value: (p) => p.transferBytes, format: (p) => formatBytes(p.transferBytes) },
  {
    label: "CDN hit ratio",
    value: (p) => p.cdnHitRatio,
    format: (p) => (p.cdnHitRatio === null ? "n/a" : pct(p.cdnHitRatio)),
  },
  {
    label: "Browser cache hit ratio",
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
export const RATING_TEXT: Record<MetricRating, string> = {
  good: "good",
  "needs-improvement": "needs improvement",
  poor: "poor",
  none: "",
};

export function MetricsSummary({ flow, onClose }: Props) {
  const pages = useMemo(() => summarizeFlowMetrics(flow), [flow]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Metrics summary</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close metrics summary">
          ✕
        </button>
      </div>
      {/* Scrollable region must be keyboard focusable (axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label="Metrics comparison" tabIndex={0}>
        <table className={styles.table}>
          <caption className={styles.caption}>Metrics per page</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              {pages.map((p, i) => (
                <th scope="col" key={i}>
                  {`Page ${i + 1} · ${p.name}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {pages.map((p, i) => {
                  const rating = row.metric ? rateMetric(row.metric, row.value(p)) : "none";
                  return (
                    <td key={i} className={RATING_CLASS[rating]} data-rating={rating}>
                      {row.format(p)}
                      {rating !== "none" && (
                        <span className={styles.srOnly}>{` (${RATING_TEXT[rating]})`}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
