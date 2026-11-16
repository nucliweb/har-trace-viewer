import type { FindingMetric, FindingSeverity, ResourceType } from "../types.js";

// How every interface presents what core finds. A module of its own, with no other imports:
// a lazy view of the web app that needs only these rules does not pull in the analysis.

/** Display order of the resource types: render-critical first, then images, runtime requests, the rest. */
export const RESOURCE_TYPE_ORDER: readonly ResourceType[] = [
  "document",
  "stylesheet",
  "script",
  "font",
  "image",
  "fetch",
  "other",
];

/** The severities of a finding, from the most severe to the least: the order findings come in. */
export const FINDING_SEVERITIES: readonly FindingSeverity[] = [
  "critical",
  "warning",
  "info",
  "good",
];

/** Evidence rows a finding shows before its evidence is expanded; the rest are counted. */
export const FINDING_EVIDENCE_PREVIEW = 3;

const VITALS: ReadonlySet<FindingMetric> = new Set(["ttfb", "fcp", "lcp", "cls", "inp"]);

/** The metric a finding affects, as a label: "LCP", "transfer"; null for none. */
export function findingMetricLabel(metric: FindingMetric): string | null {
  if (metric === "none") return null;
  return VITALS.has(metric) ? metric.toUpperCase() : metric;
}
