import type { PageMetricsSummary } from "./metrics-summary.js";
import type { MetricSpread, RunMetric, RunSpread } from "../types.js";

// A WebPageTest test of several runs records each run and view as its own page, with ids
// shaped page_<run>_<cached>_<step>: cached 0 is the first view and 1 the repeat view.
const RUN_PAGE_ID = /^page_(\d+)_([01])_(\d+)$/;

export type RunView = "first" | "repeat";

export interface RunId {
  run: number;
  view: RunView;
  step: number;
}

/** The run, view and step of a WebPageTest page id; null for any other id. */
export function parseRunId(id: string): RunId | null {
  const match = RUN_PAGE_ID.exec(id);
  if (!match) return null;
  return {
    run: Number(match[1]),
    view: match[2] === "1" ? "repeat" : "first",
    step: Number(match[3]),
  };
}

/** A page of a test, by its HAR page id, with its metrics summary. */
export interface RunPage {
  id: string;
  metrics: PageMetricsSummary;
}

/** The runs of one view and step of a test, in the order their pages came. */
export interface RunGroup<T extends RunPage = RunPage> {
  view: RunView;
  step: number;
  runs: { run: number; page: T }[];
}

/**
 * Groups the pages of a WebPageTest HAR by view (first or repeat) and step, in the order the
 * groups first appear. Pages whose id is not a WebPageTest run are left out.
 */
export function groupRuns<T extends RunPage>(pages: T[]): RunGroup<T>[] {
  const groups: RunGroup<T>[] = [];
  for (const page of pages) {
    const id = parseRunId(page.id);
    if (!id) continue;
    let group = groups.find((g) => g.view === id.view && g.step === id.step);
    if (!group) {
      group = { view: id.view, step: id.step, runs: [] };
      groups.push(group);
    }
    group.runs.push({ run: id.run, page });
  }
  return groups;
}

export const RUN_METRICS: readonly RunMetric[] = [
  "ttfb",
  "serverWait",
  "fcp",
  "lcp",
  "cls",
  "inp",
  "dcl",
  "onLoad",
  "requests",
  "cacheHits",
  "transferBytes",
  "cdnHitRatio",
  "browserCacheHitRatio",
];

// The names a user types for a metric, as --budget takes them.
const RUN_METRIC_NAMES: Record<string, RunMetric> = {
  ttfb: "ttfb",
  "server-wait": "serverWait",
  fcp: "fcp",
  lcp: "lcp",
  cls: "cls",
  inp: "inp",
  dcl: "dcl",
  onload: "onLoad",
  requests: "requests",
  transfer: "transferBytes",
};

export const RUN_METRIC_CHOICES = Object.keys(RUN_METRIC_NAMES);

/** The metric a user names (ttfb, server-wait, fcp, lcp, cls, inp, dcl, onload, requests, transfer); null otherwise. */
export function parseRunMetric(name: string): RunMetric | null {
  return RUN_METRIC_NAMES[name.trim().toLowerCase()] ?? null;
}

const metricValue = (page: RunPage, metric: RunMetric): number | null => {
  const value = page.metrics[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** The nearest-rank percentile of sorted values: always one of them. */
const percentile = (sorted: number[], p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

const lowerMiddle = (count: number) => Math.floor((count - 1) / 2);

export interface MedianRun<T extends RunPage = RunPage> {
  run: number;
  page: T;
  /** The metric the runs were ranked by; null when no metric was on every run. */
  metric: RunMetric | null;
}

/**
 * The run whose metric is the median of the group (the lower middle for an even count). The
 * metric must be on every run: without it, onLoad is used, then DCL; without any of them,
 * the lower-middle run by number.
 */
export function pickMedianRun<T extends RunPage>(
  group: RunGroup<T>,
  metric: RunMetric = "lcp"
): MedianRun<T> {
  const runs = [...group.runs].sort((a, b) => a.run - b.run);
  const candidates = [...new Set<RunMetric>([metric, "onLoad", "dcl"])];
  const used = candidates.find((m) => runs.every((r) => metricValue(r.page, m) !== null));
  if (!used) return { ...runs[lowerMiddle(runs.length)], metric: null };
  // A stable sort: runs with the same value keep their order by number.
  const ranked = [...runs].sort(
    (a, b) => (metricValue(a.page, used) ?? 0) - (metricValue(b.page, used) ?? 0)
  );
  return { ...ranked[lowerMiddle(ranked.length)], metric: used };
}

/** Per metric of the summary, its min, median, max and p75 over the runs that measured it. */
export function runSpread(group: RunGroup): RunSpread {
  const spread: RunSpread = {};
  for (const metric of RUN_METRICS) {
    const values = group.runs
      .map((r) => metricValue(r.page, metric))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    if (values.length === 0) continue;
    const entry: MetricSpread = {
      min: values[0],
      median: percentile(values, 0.5),
      max: values[values.length - 1],
      p75: percentile(values, 0.75),
      runs: values.length,
    };
    spread[metric] = entry;
  }
  return spread;
}
