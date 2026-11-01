import { formatBytes, summarizeFlowMetrics } from "@htv/core";
import type { CacheRecommendation, Flow, PageAnalysis } from "@htv/core";

/** The metrics a --budget can limit. */
export const BUDGET_METRICS = [
  "ttfb",
  "server-wait",
  "fcp",
  "lcp",
  "dcl",
  "onload",
  "cls",
  "inp",
  "requests",
  "transfer",
  "cdn-hit-ratio",
  "cache-hit-ratio",
] as const;

export type BudgetMetric = (typeof BUDGET_METRICS)[number];

type BudgetUnit = "ms" | "score" | "count" | "bytes" | "ratio";

const UNITS: Record<BudgetMetric, BudgetUnit> = {
  ttfb: "ms",
  "server-wait": "ms",
  fcp: "ms",
  lcp: "ms",
  dcl: "ms",
  onload: "ms",
  inp: "ms",
  cls: "score",
  requests: "count",
  transfer: "bytes",
  "cdn-hit-ratio": "ratio",
  "cache-hit-ratio": "ratio",
};

/** Hit ratios are minimums: a page passes at or above them. Every other limit is a maximum. */
const isMinimum = (metric: BudgetMetric) => UNITS[metric] === "ratio";

export interface Budget {
  metric: BudgetMetric;
  /** In the metric's base unit: ms, bytes, a count, a unitless score or a 0–1 ratio. */
  limit: number;
}

const NUMBER = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const BYTE_FACTORS: Record<string, number> = { "": 1, b: 1, kb: 1e3, mb: 1e6, gb: 1e9 };

/** Reads a value in the unit of its metric; null when it does not fit it. */
function parseValue(unit: BudgetUnit, raw: string): number | null {
  const text = raw.trim().toLowerCase();
  const match = (suffixes: string) => text.match(new RegExp(`^${NUMBER}(${suffixes})?$`));
  switch (unit) {
    case "ms": {
      const m = match("ms|s");
      return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : null;
    }
    case "bytes": {
      const m = match("b|kb|mb|gb");
      return m ? Math.round(Number(m[1]) * BYTE_FACTORS[m[2] ?? ""]) : null;
    }
    case "count": {
      const m = text.match(/^\d+$/);
      return m ? Number(text) : null;
    }
    case "score": {
      const m = match("");
      return m ? Number(m[1]) : null;
    }
    case "ratio": {
      const m = match("%");
      if (!m) return null;
      const ratio = m[2] ? Number(m[1]) / 100 : Number(m[1]);
      return ratio <= 1 ? ratio : null;
    }
  }
}

const VALUE_HINTS: Record<BudgetUnit, string> = {
  ms: "milliseconds such as 2500, 2500ms or 2.5s",
  bytes: "bytes such as 500000, 500kb or 1.5mb",
  count: "a whole number",
  score: "a number such as 0.1",
  ratio: "a ratio such as 0.9 or 90%",
};

const isBudgetMetric = (name: string): name is BudgetMetric =>
  (BUDGET_METRICS as readonly string[]).includes(name);

/** Parses one --budget value: `<metric>=<value>[,<metric>=<value>...]`. */
export function parseBudgets(value: string): Budget[] {
  return value.split(",").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new Error(`Invalid --budget "${pair.trim()}": expected <metric>=<value>.`);
    }
    const metric = pair.slice(0, eq).trim().toLowerCase();
    const raw = pair.slice(eq + 1).trim();
    if (!isBudgetMetric(metric)) {
      throw new Error(
        `Unknown --budget metric "${metric}". Valid metrics: ${BUDGET_METRICS.join(", ")}.`
      );
    }
    const limit = parseValue(UNITS[metric], raw);
    if (limit === null) {
      throw new Error(
        `Invalid --budget value "${raw}" for ${metric}: expected ${VALUE_HINTS[UNITS[metric]]}.`
      );
    }
    return { metric, limit };
  });
}

export type Severity = CacheRecommendation["severity"];
export type FailOnSeverity = Extract<Severity, "critical" | "warning">;

const FAIL_ON: readonly FailOnSeverity[] = ["critical", "warning"];
const SEVERITY_RANK: Record<Severity, number> = { good: 0, info: 1, warning: 2, critical: 3 };

export function parseFailOn(value: string | undefined): FailOnSeverity {
  if (FAIL_ON.includes(value as FailOnSeverity)) return value as FailOnSeverity;
  throw new Error(`Invalid --fail-on "${value ?? ""}". Valid values: ${FAIL_ON.join(", ")}.`);
}

/** Every budget metric of one page; null when the recording cannot provide it (LCP without a trace). */
export interface PageBudgetValues {
  page: string;
  values: Record<BudgetMetric, number | null>;
}

/**
 * The budget metrics of each page of a flow, read from its metrics summary: TTFB from the
 * navigation start, requests that reached the network, and a null CDN hit ratio when no own
 * resource reached the network.
 */
export function budgetValues(flow: Flow): PageBudgetValues[] {
  return summarizeFlowMetrics(flow).map((s) => ({
    page: s.name,
    values: {
      ttfb: s.ttfb,
      "server-wait": s.serverWait,
      fcp: s.fcp,
      lcp: s.lcp,
      dcl: s.dcl,
      onload: s.onLoad,
      cls: s.cls ?? null,
      inp: s.inp ?? null,
      requests: s.requests,
      transfer: s.transferBytes,
      "cdn-hit-ratio": s.cdnHitRatio,
      "cache-hit-ratio": s.browserCacheHitRatio,
    },
  }));
}

export interface BudgetResult {
  page: string;
  metric: BudgetMetric;
  limit: number;
  actual: number | null;
  passed: boolean;
}

/**
 * Checks every budget on every page. A metric the page cannot provide passes, or fails when
 * `strict` (--budget-strict).
 */
export function evaluateBudgets(
  pages: PageBudgetValues[],
  budgets: Budget[],
  { strict }: { strict: boolean }
): BudgetResult[] {
  return pages.flatMap(({ page, values }) =>
    budgets.map(({ metric, limit }) => {
      const actual = values[metric];
      const passed =
        actual === null ? !strict : isMinimum(metric) ? actual >= limit : actual <= limit;
      return { page, metric, limit, actual, passed };
    })
  );
}

export interface PageRecommendation {
  /** The report the recommendation comes from: "cache" for the cache report, and so on. */
  source: string;
  label: string;
  severity: Severity;
}

/**
 * The recommendations of every report on a page analysis (the cache report, and any other
 * report that carries a `recommendations` list), skipping reports the analysis lacks.
 */
export function pageRecommendations(analysis: PageAnalysis | undefined): PageRecommendation[] {
  if (!analysis) return [];
  return Object.entries(analysis).flatMap(([key, report]) => {
    const list = (report as { recommendations?: unknown } | null)?.recommendations;
    if (!Array.isArray(list)) return [];
    const source = key.replace(/Report$/, "");
    return (list as CacheRecommendation[])
      .filter((r) => r.severity in SEVERITY_RANK)
      .map(({ label, severity }) => ({ source, label, severity }));
  });
}

export interface FailingRecommendation extends PageRecommendation {
  page: string;
}

/** The recommendations of every page at the --fail-on severity or worse. */
export function failingRecommendations(
  flow: Flow,
  failOn: FailOnSeverity
): FailingRecommendation[] {
  return flow.pages.flatMap((page, i) =>
    pageRecommendations(flow.pageAnalyses[i])
      .filter((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[failOn])
      .map((r) => ({ page: page.name, ...r }))
  );
}

export interface CheckOptions {
  budgets: Budget[];
  failOn?: FailOnSeverity;
  strict: boolean;
}

export interface CheckResult {
  budgets: BudgetResult[];
  failOn?: FailOnSeverity;
  recommendations: FailingRecommendation[];
  passed: boolean;
}

/** Runs the budgets and the --fail-on check on every page, both sides of a comparison included. */
export function runChecks(
  { flow, compare }: { flow: Flow; compare?: Flow },
  options: CheckOptions
): CheckResult {
  const sides: [string, Flow][] = compare
    ? [
        ["A: ", flow],
        ["B: ", compare],
      ]
    : [["", flow]];
  const budgets: BudgetResult[] = [];
  const recommendations: FailingRecommendation[] = [];
  for (const [prefix, side] of sides) {
    const pages = budgetValues(side).map((p) => ({ ...p, page: prefix + p.page }));
    budgets.push(...evaluateBudgets(pages, options.budgets, options));
    if (options.failOn) {
      recommendations.push(
        ...failingRecommendations(side, options.failOn).map((r) => ({
          ...r,
          page: prefix + r.page,
        }))
      );
    }
  }
  return {
    budgets,
    ...(options.failOn ? { failOn: options.failOn } : {}),
    recommendations,
    passed: budgets.every((b) => b.passed) && recommendations.length === 0,
  };
}

function formatValue(metric: BudgetMetric, value: number): string {
  switch (UNITS[metric]) {
    case "ms":
      return `${Math.round(value)} ms`;
    case "bytes":
      return formatBytes(value);
    case "ratio":
      return `${(value * 100).toFixed(1)}%`;
    case "score":
      return value.toFixed(3);
    case "count":
      return String(value);
  }
}

/** Left-aligns each column of a table of cells to its widest cell. */
function columns(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>(
    (w, row) => row.map((cell, i) => Math.max(w[i] ?? 0, cell.length)),
    []
  );
  return rows.map((row) =>
    `  ${row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ")}`.trimEnd()
  );
}

const status = (passed: boolean) => (passed ? "pass" : "FAIL");

/** The check result as a short table: one line per budget per page and per failing recommendation. */
export function formatChecks(result: CheckResult): string {
  const lines: string[] = [];
  if (result.budgets.length > 0) {
    lines.push("Budgets:");
    lines.push(
      ...columns(
        result.budgets.map((b) => [
          status(b.passed),
          b.page,
          b.metric,
          b.actual === null ? "n/a" : formatValue(b.metric, b.actual),
          `${isMinimum(b.metric) ? ">=" : "<="} ${formatValue(b.metric, b.limit)}`,
          b.actual === null
            ? `not in this recording${b.passed ? " (--budget-strict fails it)" : ""}`
            : "",
        ])
      )
    );
  }
  if (result.failOn) {
    lines.push(
      `Recommendations at ${result.failOn}${result.failOn === "critical" ? "" : " or worse"}:`
    );
    lines.push(
      ...(result.recommendations.length === 0
        ? [
            `  pass  no ${result.failOn === "critical" ? "critical" : `${result.failOn} or critical`} recommendations`,
          ]
        : columns(
            result.recommendations.map((r) => [
              "FAIL",
              r.page,
              r.severity,
              `${r.source}: ${r.label}`,
            ])
          ))
    );
  }
  const failedBudgets = result.budgets.filter((b) => !b.passed).length;
  const failures = [
    ...(failedBudgets > 0 ? [`${failedBudgets} of ${result.budgets.length} budgets failed`] : []),
    ...(result.recommendations.length > 0
      ? [
          `${result.recommendations.length} recommendation${result.recommendations.length === 1 ? "" : "s"} at ${result.failOn} or worse`,
        ]
      : []),
  ];
  lines.push(
    failures.length === 0 ? "All checks passed." : `Checks failed: ${failures.join("; ")}.`
  );
  return lines.join("\n");
}
