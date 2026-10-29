import type { DiagramStep, Flow, StepKind } from "../types.js";
import { analyzeHops } from "./hops.js";
import type { HostHop } from "./hops.js";
import { summarizeFlowMetrics } from "./metrics-summary.js";
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
  | "fcp"
  | "lcp"
  | "cls"
  | "inp"
  | "dcl"
  | "onLoad"
  | "requests"
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

export interface HopPair {
  host: string;
  a?: HostHop;
  b?: HostHop;
}

export interface FlowComparison {
  pairs: StepPair[];
  metrics: MetricDelta[];
  hops: HopPair[];
}

export interface StepMetricDelta {
  label: string;
  a?: string;
  b?: string;
  delta: number | null;
  unit: "ms" | "";
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

interface MetricSpec {
  key: ComparedMetric;
  label: string;
  value: (page: PageMetricsSummary) => number | null | undefined;
  higherIsBetter?: boolean;
}

// Same rows, labels and order as the metrics summary.
const METRICS: MetricSpec[] = [
  { key: "ttfb", label: "TTFB", value: (p) => p.ttfb },
  { key: "fcp", label: "FCP", value: (p) => p.fcp },
  { key: "lcp", label: "LCP", value: (p) => p.lcp },
  { key: "cls", label: "CLS", value: (p) => p.cls },
  { key: "inp", label: "INP", value: (p) => p.inp },
  { key: "dcl", label: "DCL", value: (p) => p.dcl },
  { key: "onLoad", label: "onLoad", value: (p) => p.onLoad },
  { key: "requests", label: "Requests", value: (p) => p.requests },
  { key: "bytes", label: "Transfer", value: (p) => p.transferBytes },
  { key: "cdnHitRatio", label: "CDN hit ratio", value: (p) => p.cdnHitRatio, higherIsBetter: true },
  {
    key: "browserCacheHitRatio",
    label: "Browser cache hit ratio",
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
  return METRICS.map(({ key, label, value, higherIsBetter }) => {
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

function compareHops(a: Flow, b: Flow): HopPair[] {
  const pairs = new Map<string, HopPair>();
  for (const hop of firstPageHops(a)) pairs.set(hop.host, { host: hop.host, a: hop });
  for (const hop of firstPageHops(b)) {
    const pair = pairs.get(hop.host);
    if (pair) pair.b = hop;
    else pairs.set(hop.host, { host: hop.host, b: hop });
  }
  return [...pairs.values()];
}

/**
 * Compares the first page of two flows, A the baseline and B the candidate (for instance a
 * first view and a repeat view): their steps paired by kind, the metrics summary of each
 * with B − A deltas, and their hosts joined by name.
 */
export function compareFlows(a: Flow, b: Flow): FlowComparison {
  return { pairs: pairSteps(a, b), metrics: compareMetrics(a, b), hops: compareHops(a, b) };
}

const NUMERIC_VALUE = /^(-?\d+(?:\.\d+)?)(ms)?$/;

function parseMetric(value: string | undefined): { value: number; unit: "ms" | "" } | null {
  const match = value === undefined ? null : NUMERIC_VALUE.exec(value);
  return match ? { value: Number(match[1]), unit: match[2] === "ms" ? "ms" : "" } : null;
}

// Every step metric is better lower (time, files, requests) but the browser-cache hits.
const HIGHER_IS_BETTER = new Set(["From cache"]);

/** The metrics of two steps of the same kind joined by label, A's order first, with B − A. */
export function compareStepMetrics(a?: DiagramStep, b?: DiagramStep): StepMetricDelta[] {
  const labels = [...new Set([...(a?.metrics ?? []), ...(b?.metrics ?? [])].map((m) => m.label))];
  return labels.map((label) => {
    const valueA = a?.metrics.find((m) => m.label === label)?.value;
    const valueB = b?.metrics.find((m) => m.label === label)?.value;
    const parsedA = parseMetric(valueA);
    const parsedB = parseMetric(valueB);
    const delta =
      parsedA && parsedB && parsedA.unit === parsedB.unit ? parsedB.value - parsedA.value : null;
    return {
      label,
      ...(valueA !== undefined ? { a: valueA } : {}),
      ...(valueB !== undefined ? { b: valueB } : {}),
      delta,
      unit: (parsedA ?? parsedB)?.unit ?? "",
      rating: rateDelta(delta, HIGHER_IS_BETTER.has(label)),
    };
  });
}
