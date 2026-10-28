import type { Flow } from "../types.js";

export type MetricRating = "good" | "needs-improvement" | "poor" | "none";

export interface PageMetricsSummary {
  name: string;
  /** Document entry TTFB in ms. */
  ttfb: number;
  /** Milliseconds from the trace; null without a trace or when never painted. */
  fcp: number | null;
  lcp: number | null;
  /** DOMContentLoaded and load event times in ms; null when the event never fired. */
  dcl: number | null;
  onLoad: number | null;
  requests: number;
  transferBytes: number;
  cdnHitRatio: number;
  browserCacheHitRatio: number;
  /** Layout shift score and interaction latency in ms; null without a trace or matching events. */
  cls?: number | null;
  inp?: number | null;
}

export type RatedMetric = "ttfb" | "fcp" | "lcp" | "cls" | "inp" | (string & {});

// [good upper bound, poor lower bound] (ms; CLS is unitless), per web.dev Core Web Vitals.
const THRESHOLDS: Record<string, readonly [number, number]> = {
  ttfb: [800, 1800],
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
};

/** Rates a metric value. Metrics without official thresholds (onLoad, DCL) and missing values rate "none". */
export function rateMetric(metric: RatedMetric, value: number | null | undefined): MetricRating {
  const limits = THRESHOLDS[metric];
  if (!limits || value === null || value === undefined) return "none";
  if (value <= limits[0]) return "good";
  if (value <= limits[1]) return "needs-improvement";
  return "poor";
}

/** One summary per page, reading the same numbers the step badges are built from. */
export function summarizeFlowMetrics(flow: Flow): PageMetricsSummary[] {
  return flow.pages.map((page, i) => {
    const { har, trace } = page;
    const report = flow.pageAnalyses[i]?.cacheReport;
    return {
      name: page.name,
      ttfb: har.documentEntry.ttfb,
      fcp: trace?.fcp ?? null,
      lcp: trace?.lcp ?? null,
      cls: trace?.cls ?? null,
      inp: trace?.inp ?? null,
      dcl: har.pages[0]?.onContentLoad ?? null,
      onLoad: har.pages[0]?.onLoad ?? null,
      requests: har.entries.length,
      transferBytes: har.entries.reduce((sum, e) => sum + e.transferSize, 0),
      cdnHitRatio: report?.ownResources.cdnHitRatio ?? 0,
      browserCacheHitRatio: report?.browser.hitRatio ?? 0,
    };
  });
}
