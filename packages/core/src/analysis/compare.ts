import type { DiagramStep, Flow, Metric, StepKind } from "../types.js";
import { analyzeHops } from "./hops.js";
import type { HostHop } from "./hops.js";
import type { DeltaUnit } from "../utils/format.js";
import { getHostname } from "../utils/domain.js";
import { networkRequests } from "./network-requests.js";
import { SERVER_WAIT_LABEL, TTFB_LABEL, summarizeFlowMetrics } from "./metrics-summary.js";
import type { PageMetricsSummary } from "./metrics-summary.js";

/** One position of a comparison: the step of each flow showing `kind`, when it has one. */
export interface StepPair {
  kind: StepKind;
  /** Index into the steps of flow A or B; absent when that flow has no step of this kind. */
  a?: number;
  b?: number;
}

/** "better" and "worse" read B against A: lower is better, except for cache hit ratios. */
export type DeltaRating = "better" | "worse" | "same" | "none";

export type ComparedMetric =
  | "ttfb"
  | "serverWait"
  | "fcp"
  | "lcp"
  | "cls"
  | "inp"
  | "dcl"
  | "onLoad"
  | "requests"
  | "cacheHits"
  | "bytes"
  | "cdnHitRatio"
  | "browserCacheHitRatio";

export interface MetricDelta {
  key: ComparedMetric;
  label: string;
  a: number | null;
  b: number | null;
  /** b − a; null when either side lacks the value. */
  delta: number | null;
  /** delta as a percentage of a; null without a delta or when a is 0. */
  deltaPct: number | null;
  rating: DeltaRating;
}

/** TTFB of a host over the requests both flows made to the same URL, the k-th with the k-th. */
export interface SameUrlTtfb {
  /** Requests paired. */
  count: number;
  avgTtfbA: number;
  avgTtfbB: number;
  /** avgTtfbB − avgTtfbA. */
  delta: number;
}

export interface HopPair {
  host: string;
  a?: HostHop;
  b?: HostHop;
  /** Absent when the flows share no URL on the host. */
  sameUrls?: SameUrlTtfb;
}

/** Something that changes how a delta reads, with the metrics (or the hosts table) it touches. */
export interface ComparisonCaveat {
  id: "request-mix" | "inferred-cache-hits";
  affects: (ComparedMetric | "hosts")[];
  text: string;
}

export interface FlowComparison {
  pairs: StepPair[];
  metrics: MetricDelta[];
  hops: HopPair[];
  caveats: ComparisonCaveat[];
}

export interface StepMetricDelta {
  label: string;
  a?: string;
  b?: string;
  delta: number | null;
  // The unit of the delta; "" for a plain number read from a stored flow without units.
  unit: DeltaUnit | "";
  rating: DeltaRating;
}

type Side = "a" | "b";

interface IndexedStep {
  index: number;
  step: DiagramStep;
}

const firstPageSteps = (flow: Flow): IndexedStep[] =>
  flow.steps.map((step, index) => ({ index, step })).filter(({ step }) => step.pageIndex === 0);

const timestampOf = ({ step }: IndexedStep) => step.timestamp ?? Number.POSITIVE_INFINITY;

/**
 * Merges the first-page steps of both flows into one sequence of pairs, one per kind. Each
 * flow's steps stay in their own (chronological) order; a kind only one flow has goes where
 * that flow has it, and two such kinds meeting are ordered by timestamp. When the flows
 * order two shared kinds differently, A's order wins and B's step comes forward.
 */
function pairSteps(a: Flow, b: Flow): StepPair[] {
  const listA = firstPageSteps(a);
  const listB = firstPageSteps(b);
  const remainingA = new Map(listA.map((s) => [s.step.kind, s]));
  const remainingB = new Map(listB.map((s) => [s.step.kind, s]));
  const pairs: StepPair[] = [];
  let i = 0;
  let j = 0;

  const take = (kind: StepKind) => {
    const fromA = remainingA.get(kind);
    const fromB = remainingB.get(kind);
    remainingA.delete(kind);
    remainingB.delete(kind);
    pairs.push({
      kind,
      ...(fromA ? { a: fromA.index } : {}),
      ...(fromB ? { b: fromB.index } : {}),
    });
  };

  for (;;) {
    while (i < listA.length && !remainingA.has(listA[i].step.kind)) i++;
    while (j < listB.length && !remainingB.has(listB[j].step.kind)) j++;
    const headA = listA[i];
    const headB = listB[j];
    if (!headA && !headB) return pairs;

    const onlyA = headA !== undefined && !remainingB.has(headA.step.kind);
    const onlyB = headB !== undefined && !remainingA.has(headB.step.kind);
    if (onlyA && onlyB) {
      take(timestampOf(headB) < timestampOf(headA) ? headB.step.kind : headA.step.kind);
    } else if (onlyB || !headA) {
      take(headB.step.kind);
    } else {
      take(headA.step.kind);
    }
  }
}

/**
 * The step a side shows at a pair: its own step of that kind, else the step it showed last
 * (`current` false), else its first step.
 */
export function stepAtPair(
  pairs: StepPair[],
  pairIndex: number,
  side: Side
): { index: number; current: boolean } {
  const own = pairs[pairIndex]?.[side];
  if (own !== undefined) return { index: own, current: true };
  for (let i = pairIndex - 1; i >= 0; i--) {
    const previous = pairs[i][side];
    if (previous !== undefined) return { index: previous, current: false };
  }
  const first = pairs.find((p) => p[side] !== undefined)?.[side];
  return { index: first ?? 0, current: false };
}

export interface MetricSpec {
  key: ComparedMetric;
  label: string;
  unit: DeltaUnit;
  value: (page: PageMetricsSummary) => number | null | undefined;
  higherIsBetter?: boolean;
}

/** The metrics of a page summary, with their unit: same rows, labels and order as the summary. */
export const COMPARED_METRICS: readonly MetricSpec[] = [
  { key: "ttfb", label: TTFB_LABEL, unit: "ms", value: (p) => p.ttfb },
  { key: "serverWait", label: SERVER_WAIT_LABEL, unit: "ms", value: (p) => p.serverWait },
  { key: "fcp", label: "FCP", unit: "ms", value: (p) => p.fcp },
  { key: "lcp", label: "LCP", unit: "ms", value: (p) => p.lcp },
  { key: "cls", label: "CLS", unit: "score", value: (p) => p.cls },
  { key: "inp", label: "INP", unit: "ms", value: (p) => p.inp },
  { key: "dcl", label: "DCL", unit: "ms", value: (p) => p.dcl },
  { key: "onLoad", label: "onLoad", unit: "ms", value: (p) => p.onLoad },
  { key: "requests", label: "Requests", unit: "count", value: (p) => p.requests },
  {
    key: "cacheHits",
    label: "Browser cache hits",
    unit: "count",
    value: (p) => p.cacheHits,
    higherIsBetter: true,
  },
  { key: "bytes", label: "Transfer", unit: "bytes", value: (p) => p.transferBytes },
  {
    key: "cdnHitRatio",
    label: "CDN hit ratio",
    unit: "ratio",
    value: (p) => p.cdnHitRatio,
    higherIsBetter: true,
  },
  {
    key: "browserCacheHitRatio",
    label: "Browser cache hit ratio",
    unit: "ratio",
    value: (p) => p.browserCacheHitRatio,
    higherIsBetter: true,
  },
];

/** Rates a B − A difference: lower is better unless `higherIsBetter`; no difference is "same". */
export function rateDelta(delta: number | null, higherIsBetter = false): DeltaRating {
  if (delta === null) return "none";
  if (delta === 0) return "same";
  return delta < 0 !== higherIsBetter ? "better" : "worse";
}

function compareMetrics(a: Flow, b: Flow): MetricDelta[] {
  const [pageA] = summarizeFlowMetrics(a);
  const [pageB] = summarizeFlowMetrics(b);
  return COMPARED_METRICS.map(({ key, label, value, higherIsBetter }) => {
    const valueA = value(pageA) ?? null;
    const valueB = value(pageB) ?? null;
    const delta = valueA === null || valueB === null ? null : valueB - valueA;
    return {
      key,
      label,
      a: valueA,
      b: valueB,
      delta,
      deltaPct: delta === null || valueA === 0 ? null : (delta / (valueA as number)) * 100,
      rating: rateDelta(delta, higherIsBetter),
    };
  });
}

const firstPageHops = (flow: Flow): HostHop[] => {
  const { har } = flow.pages[0];
  return analyzeHops(har, har.documentEntry.url);
};

// TTFBs of the first page's network requests by host, then by URL, in request order.
function ttfbsByHostAndUrl(flow: Flow): Map<string, Map<string, number[]>> {
  const byHost = new Map<string, Map<string, number[]>>();
  for (const entry of networkRequests(flow.pages[0].har)) {
    const host = getHostname(entry.url);
    if (host === null) continue;
    const byUrl = byHost.get(host) ?? new Map<string, number[]>();
    byUrl.set(entry.url, [...(byUrl.get(entry.url) ?? []), entry.ttfb]);
    byHost.set(host, byUrl);
  }
  return byHost;
}

function sameUrlTtfb(
  urlsA: Map<string, number[]> | undefined,
  urlsB: Map<string, number[]> | undefined
): SameUrlTtfb | undefined {
  let count = 0;
  let sumA = 0;
  let sumB = 0;
  for (const [url, ttfbsA] of urlsA ?? []) {
    const ttfbsB = urlsB?.get(url) ?? [];
    const paired = Math.min(ttfbsA.length, ttfbsB.length);
    for (let i = 0; i < paired; i++) {
      sumA += ttfbsA[i];
      sumB += ttfbsB[i];
    }
    count += paired;
  }
  if (count === 0) return undefined;
  const avgTtfbA = sumA / count;
  const avgTtfbB = sumB / count;
  return { count, avgTtfbA, avgTtfbB, delta: avgTtfbB - avgTtfbA };
}

function compareHops(a: Flow, b: Flow): HopPair[] {
  const pairs = new Map<string, HopPair>();
  for (const hop of firstPageHops(a)) pairs.set(hop.host, { host: hop.host, a: hop });
  for (const hop of firstPageHops(b)) {
    const pair = pairs.get(hop.host);
    if (pair) pair.b = hop;
    else pairs.set(hop.host, { host: hop.host, b: hop });
  }
  const urlsA = ttfbsByHostAndUrl(a);
  const urlsB = ttfbsByHostAndUrl(b);
  return [...pairs.values()].map((pair) => {
    const sameUrls = sameUrlTtfb(urlsA.get(pair.host), urlsB.get(pair.host));
    return sameUrls ? { ...pair, sameUrls } : pair;
  });
}

// Share of the busier flow's network requests the other flow may lack before ratios and host
// medians stop describing the same resources.
const REQUEST_MIX_THRESHOLD = 0.2;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function compareCaveats(a: Flow, b: Flow): ComparisonCaveat[] {
  const caveats: ComparisonCaveat[] = [];
  // The same count as the "requests" metric.
  const requestsA = networkRequests(a.pages[0].har).length;
  const requestsB = networkRequests(b.pages[0].har).length;
  const difference = requestsB - requestsA;
  if (Math.abs(difference) > REQUEST_MIX_THRESHOLD * Math.max(requestsA, requestsB)) {
    caveats.push({
      id: "request-mix",
      affects: ["cdnHitRatio", "hosts"],
      text: `B made ${Math.abs(difference)} ${difference < 0 ? "fewer" : "more"} network requests than A (${requestsA} → ${requestsB}): the CDN hit ratio and the host medians are computed over different resources, so they can move without any change on the CDN or the servers. The host TTFB Δ compares only the URLs both flows requested.`,
    });
  }
  for (const [side, flow] of [
    ["A", a],
    ["B", b],
  ] as const) {
    const inferred = flow.pages[0].har.inferredCacheHits?.length ?? 0;
    if (inferred === 0) continue;
    caveats.push({
      id: "inferred-cache-hits",
      affects: ["cacheHits", "browserCacheHitRatio"],
      text: `${side}: ${plural(inferred, "browser-cache hit")} ${inferred === 1 ? "is" : "are"} inferred from the WebPageTest first view of the same run, since WebPageTest leaves cache hits out of repeat views.`,
    });
  }
  return caveats;
}

/**
 * Compares the first page of two flows, A the baseline and B the candidate (for instance a
 * first view and a repeat view): their steps paired by kind, the metrics summary of each
 * with B − A deltas, their hosts joined by name, and the caveats that change how the
 * deltas read.
 */
export function compareFlows(a: Flow, b: Flow): FlowComparison {
  return {
    pairs: pairSteps(a, b),
    metrics: compareMetrics(a, b),
    hops: compareHops(a, b),
    caveats: compareCaveats(a, b),
  };
}

// Flows generated before metrics carried raw values only show them: "48ms", "3", "0.012".
const NUMERIC_VALUE = /^(-?\d+(?:\.\d+)?)(ms)?$/;

function parseMetric(value: string | undefined): { value: number; unit: "ms" | "" } | null {
  const match = value === undefined ? null : NUMERIC_VALUE.exec(value);
  return match ? { value: Number(match[1]), unit: match[2] === "ms" ? "ms" : "" } : null;
}

// B − A of two metrics with the same label, from their raw values when every metric present
// has a unit, else from the numbers their values show.
function metricDelta(
  metricA: Metric | undefined,
  metricB: Metric | undefined
): { delta: number | null; unit: DeltaUnit | "" } {
  const present = [metricA, metricB].filter((m) => m !== undefined);
  if (present.every((m) => m.unit !== undefined)) {
    const comparable =
      metricA?.raw !== undefined && metricB?.raw !== undefined && metricA.unit === metricB.unit;
    return {
      delta: comparable ? metricB.raw! - metricA.raw! : null,
      unit: present[0]?.unit ?? "",
    };
  }
  const parsedA = parseMetric(metricA?.value);
  const parsedB = parseMetric(metricB?.value);
  return {
    delta:
      parsedA && parsedB && parsedA.unit === parsedB.unit ? parsedB.value - parsedA.value : null,
    unit: (parsedA ?? parsedB)?.unit ?? "",
  };
}

// Every step metric is better lower (time, files, requests) but the browser-cache hits.
const HIGHER_IS_BETTER = new Set(["From cache"]);

/** The metrics of two steps of the same kind joined by label, A's order first, with B − A. */
export function compareStepMetrics(a?: DiagramStep, b?: DiagramStep): StepMetricDelta[] {
  const labels = [...new Set([...(a?.metrics ?? []), ...(b?.metrics ?? [])].map((m) => m.label))];
  return labels.map((label) => {
    const metricA = a?.metrics.find((m) => m.label === label);
    const metricB = b?.metrics.find((m) => m.label === label);
    const { delta, unit } = metricDelta(metricA, metricB);
    return {
      label,
      ...(metricA !== undefined ? { a: metricA.value } : {}),
      ...(metricB !== undefined ? { b: metricB.value } : {}),
      delta,
      unit,
      rating: rateDelta(delta, HIGHER_IS_BETTER.has(label)),
    };
  });
}
