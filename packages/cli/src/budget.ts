import { FINDING_SEVERITIES, collectFindings, formatBytes, summarizeFlowMetrics } from "@htv/core";
import type { Finding, Flow, FindingSeverity } from "@htv/core";

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
  "tbt",
  "requests",
  "transfer",
  "cdn-hit-ratio",
  "cache-hit-ratio",
] as const;

type BudgetMetric = (typeof BUDGET_METRICS)[number];

type BudgetUnit = "ms" | "score" | "count" | "bytes" | "ratio";

const UNITS: Record<BudgetMetric, BudgetUnit> = {
  ttfb: "ms",
  "server-wait": "ms",
  fcp: "ms",
  lcp: "ms",
  dcl: "ms",
  onload: "ms",
  inp: "ms",
  tbt: "ms",
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
  /**
   * Set for a `delta:` budget, which limits how much worse B is than A in a comparison:
   * `absolute` in the metric's base unit, `percent` as a percentage of A (`limit` is then 10 for 10%).
   */
  delta?: "absolute" | "percent";
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

const DELTA_PREFIX = /^delta:/i;

/**
 * Parses one --budget value: `<metric>=<value>[,<metric>=<value>...]`. A pair starting with
 * `delta:` limits how much worse B may be than A in a comparison: `delta:lcp<=200` (the `<=` is
 * optional: `delta:lcp=200`) or `delta:transfer<=10%` for a percentage of A.
 */
export function parseBudgets(value: string): Budget[] {
  return value.split(",").map((pair) => {
    const trimmed = pair.trim();
    const isDelta = DELTA_PREFIX.test(trimmed);
    const body = isDelta ? trimmed.replace(DELTA_PREFIX, "") : trimmed;
    const match = (isDelta ? /^([^=<]*)(?:<=|=)(.*)$/ : /^([^=]*)=(.*)$/).exec(body);
    if (!match) {
      throw new Error(
        `Invalid --budget "${trimmed}": expected ${isDelta ? "delta:<metric><=<value>" : "<metric>=<value>"}.`
      );
    }
    const metric = match[1].trim().toLowerCase();
    const raw = match[2].trim();
    if (!isBudgetMetric(metric)) {
      throw new Error(
        `Unknown --budget metric "${metric}". Valid metrics: ${BUDGET_METRICS.join(", ")}.`
      );
    }
    const invalid = () =>
      new Error(
        `Invalid --budget value "${raw}" for ${metric}: expected ${VALUE_HINTS[UNITS[metric]]}.`
      );
    if (isDelta && UNITS[metric] !== "ratio" && raw.endsWith("%")) {
      const percent = /^(\d+(?:\.\d+)?|\.\d+)%$/.exec(raw);
      if (!percent) throw invalid();
      return { metric, limit: Number(percent[1]), delta: "percent" as const };
    }
    const limit = parseValue(UNITS[metric], raw);
    if (limit === null) throw invalid();
    return { metric, limit, ...(isDelta ? { delta: "absolute" as const } : {}) };
  });
}

export type FailOnSeverity = Extract<FindingSeverity, "critical" | "warning">;

const FAIL_ON: readonly FailOnSeverity[] = ["critical", "warning"];

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
      tbt: s.tbt ?? null,
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
  /** The value, or for a delta budget how much worse B is than A (a percentage for `delta-percent`). */
  actual: number | null;
  passed: boolean;
  /** Absent for a page checked against a limit; the delta modes check B against A. */
  mode?: "delta" | "delta-percent";
  /** The A value of a delta budget. */
  baseline?: number | null;
  /** The B value of a delta budget. */
  candidate?: number | null;
  /** Why a delta budget has no actual value. */
  note?: string;
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
    budgets
      .filter((b) => !b.delta)
      .map(({ metric, limit }) => {
        const actual = values[metric];
        const passed =
          actual === null ? !strict : isMinimum(metric) ? actual >= limit : actual <= limit;
        return { page, metric, limit, actual, passed };
      })
  );
}

/**
 * Checks every `delta:` budget on the pages of A and B, paired by position: B may be worse than A
 * by at most the limit (lower is worse for the hit ratios), and any improvement passes. A metric
 * either side cannot provide passes, or fails when `strict`.
 */
export function evaluateDeltas(
  a: PageBudgetValues[],
  b: PageBudgetValues[],
  budgets: Budget[],
  { strict }: { strict: boolean }
): BudgetResult[] {
  return a.slice(0, b.length).flatMap((pageA, i) =>
    budgets
      .filter((budget) => budget.delta)
      .map(({ metric, limit, delta }): BudgetResult => {
        const baseline = pageA.values[metric];
        const candidate = b[i].values[metric];
        const base = {
          page: `A: ${pageA.page} vs B: ${b[i].page}`,
          metric,
          limit,
          baseline,
          candidate,
          mode: delta === "percent" ? ("delta-percent" as const) : ("delta" as const),
        };
        if (baseline === null || candidate === null) {
          return { ...base, actual: null, passed: !strict, note: "not in both recordings" };
        }
        const worse = isMinimum(metric) ? baseline - candidate : candidate - baseline;
        if (delta !== "percent") return { ...base, actual: worse, passed: worse <= limit };
        if (baseline === 0) {
          return worse <= 0
            ? { ...base, actual: 0, passed: true }
            : {
                ...base,
                actual: null,
                passed: false,
                note: "A is 0, so a percentage is undefined",
              };
        }
        const percent = (worse / baseline) * 100;
        return { ...base, actual: percent, passed: percent <= limit };
      })
  );
}

/** A finding at the --fail-on severity or worse, and the page it belongs to. */
interface FailingFinding extends Pick<Finding, "id" | "title" | "severity" | "source"> {
  page: string;
}

/**
 * The findings of every page at the --fail-on severity or worse: the recommendations of every
 * report on the page analyses, and the Core Web Vitals rated poor (critical) or in need of
 * improvement (warning).
 */
export function failingFindings(flow: Flow, failOn: FailOnSeverity): FailingFinding[] {
  return collectFindings(flow)
    .filter((f) => FINDING_SEVERITIES.indexOf(f.severity) <= FINDING_SEVERITIES.indexOf(failOn))
    .map(({ page, source, id, title, severity }) => ({
      page: page.name,
      source,
      id,
      title,
      severity,
    }));
}

export interface CheckOptions {
  budgets: Budget[];
  failOn?: FailOnSeverity;
  strict: boolean;
}

export interface CheckResult {
  budgets: BudgetResult[];
  failOn?: FailOnSeverity;
  findings: FailingFinding[];
  passed: boolean;
}

/** Runs the budgets and the --fail-on check on every page, both sides of a comparison included. */
export function runChecks(
  { flow, compare }: { flow: Flow; compare?: Flow },
  options: CheckOptions
): CheckResult {
  if (options.budgets.some((b) => b.delta) && !compare) {
    throw new Error(
      "A delta budget compares the two sides: use it with --compare or --compare-with."
    );
  }
  const sides: [string, Flow][] = compare
    ? [
        ["A: ", flow],
        ["B: ", compare],
      ]
    : [["", flow]];
  const budgets: BudgetResult[] = [];
  const findings: FailingFinding[] = [];
  for (const [prefix, side] of sides) {
    const pages = budgetValues(side).map((p) => ({ ...p, page: prefix + p.page }));
    budgets.push(...evaluateBudgets(pages, options.budgets, options));
    if (options.failOn) {
      findings.push(
        ...failingFindings(side, options.failOn).map((f) => ({ ...f, page: prefix + f.page }))
      );
    }
  }
  if (compare) {
    budgets.push(
      ...evaluateDeltas(budgetValues(flow), budgetValues(compare), options.budgets, options)
    );
  }
  return {
    budgets,
    ...(options.failOn ? { failOn: options.failOn } : {}),
    findings,
    passed: budgets.every((b) => b.passed) && findings.length === 0,
  };
}

export function metricUnit(metric: BudgetMetric): BudgetUnit {
  return UNITS[metric];
}

/** The comparison a budget makes: a hit ratio is a minimum, everything else a maximum. */
export function budgetOperator(b: BudgetResult): "<=" | ">=" {
  return !b.mode && isMinimum(b.metric) ? ">=" : "<=";
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

const signed = (text: string, value: number) => `${value < 0 ? "-" : "+"}${text}`;

/** The row of a budget in the text table: status, page, metric, actual, limit and a note. */
export function budgetRow(b: BudgetResult): string[] {
  if (!b.mode) {
    return [
      status(b.passed),
      b.page,
      b.metric,
      b.actual === null ? "n/a" : formatValue(b.metric, b.actual),
      `${isMinimum(b.metric) ? ">=" : "<="} ${formatValue(b.metric, b.limit)}`,
      b.actual === null
        ? `not in this recording${b.passed ? " (--budget-strict fails it)" : ""}`
        : "",
    ];
  }
  const percent = b.mode === "delta-percent";
  const show = (v: number) => (percent ? `${v.toFixed(1)}%` : formatValue(b.metric, v));
  const detail =
    b.baseline != null && b.candidate != null
      ? ` (${formatValue(b.metric, b.baseline)} -> ${formatValue(b.metric, b.candidate)})`
      : "";
  return [
    status(b.passed),
    b.page,
    `delta ${b.metric}`,
    b.actual === null ? "n/a" : signed(show(Math.abs(b.actual)), b.actual) + detail,
    `<= ${signed(show(b.limit), b.limit)}`,
    b.note ? `${b.note}${b.passed ? " (--budget-strict fails it)" : ""}` : "",
  ];
}

/** The check result as a short table: one line per budget per page and per failing finding. */
export function formatChecks(result: CheckResult): string {
  const lines: string[] = [];
  if (result.budgets.length > 0) {
    lines.push("Budgets:");
    lines.push(...columns(result.budgets.map(budgetRow)));
  }
  if (result.failOn) {
    lines.push(`Findings at ${result.failOn}${result.failOn === "critical" ? "" : " or worse"}:`);
    lines.push(
      ...(result.findings.length === 0
        ? [
            `  pass  no ${result.failOn === "critical" ? "critical" : `${result.failOn} or critical`} findings`,
          ]
        : columns(
            result.findings.map((f) => ["FAIL", f.page, f.severity, `${f.source}: ${f.title}`])
          ))
    );
  }
  const failedBudgets = result.budgets.filter((b) => !b.passed).length;
  const failures = [
    ...(failedBudgets > 0 ? [`${failedBudgets} of ${result.budgets.length} budgets failed`] : []),
    ...(result.findings.length > 0
      ? [
          `${result.findings.length} finding${result.findings.length === 1 ? "" : "s"} at ${result.failOn} or worse`,
        ]
      : []),
  ];
  lines.push(
    failures.length === 0 ? "All checks passed." : `Checks failed: ${failures.join("; ")}.`
  );
  return lines.join("\n");
}
