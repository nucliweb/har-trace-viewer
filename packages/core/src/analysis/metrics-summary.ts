import type { CacheReport, Flow } from "../types.js";
import { browserCacheHits, networkRequests } from "./network-requests.js";

export type MetricRating = "good" | "needs-improvement" | "poor" | "none";

// TTFB counts from the navigation start (redirects, connection, request and server wait), as
// the web.dev thresholds do; the server wait is the HAR `wait` of the document alone.
export const TTFB_LABEL = "TTFB (from navigation)";
export const SERVER_WAIT_LABEL = "Server wait";

export interface PageMetricsSummary {
  name: string;
  /** Ms from the navigation start to the document's first byte: the TTFB step's timestamp. */
  ttfb: number;
  /** Ms the document's server took to answer once the request was sent (HAR `wait`). */
  serverWait: number;
  /**
   * Milliseconds from the trace, else the paint times the HAR's recorder measured
   * (WebPageTest); null without either or when never painted.
   */
  fcp: number | null;
  lcp: number | null;
  /** DOMContentLoaded and load event times in ms; null when the event never fired. */
  dcl: number | null;
  onLoad: number | null;
  /** Requests that reached the network, the document and 304 revalidations included. */
  requests: number;
  /** Resources the browser cache served, WebPageTest inferred hits included. */
  cacheHits: number;
  transferBytes: number;
  /** Over the own resources that reached the network; null when none did. */
  cdnHitRatio: number | null;
  browserCacheHitRatio: number;
  /** Layout shift score and interaction latency in ms; null without a trace or matching events. */
  cls?: number | null;
  inp?: number | null;
}

export type RatedMetric = "ttfb" | "fcp" | "lcp" | "cls" | "inp" | (string & {});

// [good upper bound, poor lower bound] (ms; CLS is unitless), per web.dev Core Web Vitals.
export const METRIC_THRESHOLDS: Record<string, readonly [number, number]> = {
  ttfb: [800, 1800],
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
};

/** Rates a metric value. Metrics without official thresholds (onLoad, DCL) and missing values rate "none". */
export function rateMetric(metric: RatedMetric, value: number | null | undefined): MetricRating {
  const limits = METRIC_THRESHOLDS[metric];
  if (!limits || value === null || value === undefined) return "none";
  if (value <= limits[0]) return "good";
  if (value <= limits[1]) return "needs-improvement";
  return "poor";
}

function cdnHitRatio(own: CacheReport["ownResources"] | undefined): number | null {
  if (!own) return 0;
  return (own.network ?? own.total) > 0 ? own.cdnHitRatio : null;
}

/** One summary per page, reading the same numbers the step badges are built from. */
export function summarizeFlowMetrics(flow: Flow): PageMetricsSummary[] {
  return flow.pages.map((page, i) => {
    const { har, trace } = page;
    const report = flow.pageAnalyses[i]?.cacheReport;
    const ttfbStep = flow.steps.find((s) => s.pageIndex === i && s.kind === "ttfb");
    return {
      name: page.name,
      // Flows older than step timestamps only carry the server wait.
      ttfb: ttfbStep?.timestamp ?? har.documentEntry.ttfb,
      serverWait: har.documentEntry.ttfb,
      fcp: trace?.fcp ?? har.pages[0]?.fcp ?? null,
      lcp: trace?.lcp ?? har.pages[0]?.lcp ?? null,
      cls: trace?.cls ?? null,
      inp: trace?.inp ?? null,
      dcl: har.pages[0]?.onContentLoad ?? null,
      onLoad: har.pages[0]?.onLoad ?? null,
      requests: networkRequests(har).length,
      cacheHits: browserCacheHits(har),
      transferBytes: har.entries.reduce((sum, e) => sum + e.transferSize, 0),
      cdnHitRatio: cdnHitRatio(report?.ownResources),
      browserCacheHitRatio: report?.browser.hitRatio ?? 0,
    };
  });
}
