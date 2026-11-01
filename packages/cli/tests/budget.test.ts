import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  collectFindings,
  generateFlow,
  parseHarJson,
  parseTraceJson,
  summarizeFlowMetrics,
} from "@htv/core";
import {
  BUDGET_METRICS,
  budgetValues,
  evaluateBudgets,
  failingFindings,
  formatChecks,
  parseBudgets,
  parseFailOn,
  runChecks,
} from "../src/budget";
import type { PageBudgetValues } from "../src/budget";

const FIXTURES = resolve(__dirname, "..", "..", "core", "tests", "fixtures");
const har = () =>
  parseHarJson(readFileSync(join(FIXTURES, "webperf-snippets.har.fixture.json"), "utf8"));
const trace = () =>
  parseTraceJson(readFileSync(join(FIXTURES, "webperf-snippets.trace.fixture.json"), "utf8"));

describe("parseBudgets", () => {
  it("parses a comma-separated list of metric=value pairs", () => {
    expect(parseBudgets("lcp=2500,requests=80")).toEqual([
      { metric: "lcp", limit: 2500 },
      { metric: "requests", limit: 80 },
    ]);
  });

  it("reads times in ms, with or without the ms suffix, and in seconds", () => {
    expect(parseBudgets("ttfb=800,fcp=1800ms,lcp=2.5s,onload=3S")).toEqual([
      { metric: "ttfb", limit: 800 },
      { metric: "fcp", limit: 1800 },
      { metric: "lcp", limit: 2500 },
      { metric: "onload", limit: 3000 },
    ]);
  });

  it("reads transfer sizes in bytes or decimal kB, MB and GB, as the report shows them", () => {
    expect(parseBudgets("transfer=2048,transfer=500kb,transfer=1.5MB,transfer=1gb")).toEqual([
      { metric: "transfer", limit: 2048 },
      { metric: "transfer", limit: 500_000 },
      { metric: "transfer", limit: 1_500_000 },
      { metric: "transfer", limit: 1_000_000_000 },
    ]);
  });

  it("reads ratios as a fraction or a percentage", () => {
    expect(parseBudgets("cdn-hit-ratio=0.9,cache-hit-ratio=75%")).toEqual([
      { metric: "cdn-hit-ratio", limit: 0.9 },
      { metric: "cache-hit-ratio", limit: 0.75 },
    ]);
  });

  it("reads CLS as a unitless score, and the remaining metrics", () => {
    expect(parseBudgets("cls=0.1, inp=200ms, server-wait=600, dcl=1.2s")).toEqual([
      { metric: "cls", limit: 0.1 },
      { metric: "inp", limit: 200 },
      { metric: "server-wait", limit: 600 },
      { metric: "dcl", limit: 1200 },
    ]);
  });

  it("rejects an unknown metric, listing the valid ones", () => {
    expect(() => parseBudgets("speed=100")).toThrow(/Unknown --budget metric "speed"/);
    expect(() => parseBudgets("speed=100")).toThrow(BUDGET_METRICS.join(", "));
  });

  it("rejects a value that does not fit its metric", () => {
    expect(() => parseBudgets("lcp=fast")).toThrow(/Invalid --budget value "fast" for lcp/);
    expect(() => parseBudgets("lcp=2.5mb")).toThrow(/for lcp/);
    expect(() => parseBudgets("transfer=10ms")).toThrow(/for transfer/);
    expect(() => parseBudgets("requests=1.5")).toThrow(/for requests/);
    expect(() => parseBudgets("cdn-hit-ratio=1.5")).toThrow(/for cdn-hit-ratio/);
    expect(() => parseBudgets("cache-hit-ratio=120%")).toThrow(/for cache-hit-ratio/);
    expect(() => parseBudgets("cls=-1")).toThrow(/for cls/);
  });

  it("rejects a pair without a value", () => {
    expect(() => parseBudgets("lcp")).toThrow(/Invalid --budget "lcp"/);
    expect(() => parseBudgets("lcp=")).toThrow(/Invalid --budget value "" for lcp/);
  });
});

describe("parseFailOn", () => {
  it("accepts critical and warning", () => {
    expect(parseFailOn("critical")).toBe("critical");
    expect(parseFailOn("warning")).toBe("warning");
  });

  it("rejects any other severity, listing the valid ones", () => {
    expect(() => parseFailOn("info")).toThrow(
      'Invalid --fail-on "info". Valid values: critical, warning.'
    );
  });
});

describe("budgetValues", () => {
  it("reads every budget metric of each page from its metrics summary", () => {
    const flow = generateFlow([
      { name: "Traced", har: har(), trace: trace() },
      { name: "Plain", har: har() },
    ]);
    const [traced, plain] = budgetValues(flow);
    const [summary] = summarizeFlowMetrics(flow);

    expect(traced.page).toBe("Traced");
    expect(traced.values).toEqual({
      ttfb: summary.ttfb,
      "server-wait": summary.serverWait,
      fcp: summary.fcp,
      lcp: summary.lcp,
      dcl: summary.dcl,
      onload: summary.onLoad,
      cls: summary.cls,
      inp: summary.inp,
      requests: summary.requests,
      transfer: summary.transferBytes,
      "cdn-hit-ratio": summary.cdnHitRatio,
      "cache-hit-ratio": summary.browserCacheHitRatio,
    });
    expect(traced.values.lcp).not.toBeNull();
    expect(plain.values.lcp).toBeNull();
  });
});

const page = (name: string, values: Partial<PageBudgetValues["values"]>): PageBudgetValues =>
  ({
    page: name,
    values: { ...Object.fromEntries(BUDGET_METRICS.map((m) => [m, null])), ...values },
  }) as PageBudgetValues;

describe("evaluateBudgets", () => {
  it("passes a metric at or under its limit and fails it above", () => {
    const results = evaluateBudgets(
      [page("Home", { lcp: 2500, transfer: 600_000 })],
      [
        { metric: "lcp", limit: 2500 },
        { metric: "transfer", limit: 500_000 },
      ],
      { strict: false }
    );
    expect(results.map((r) => [r.page, r.metric, r.actual, r.passed])).toEqual([
      ["Home", "lcp", 2500, true],
      ["Home", "transfer", 600_000, false],
    ]);
  });

  it("treats the hit ratios as minimums", () => {
    const results = evaluateBudgets(
      [page("Home", { "cdn-hit-ratio": 0.95, "cache-hit-ratio": 0.5 })],
      [
        { metric: "cdn-hit-ratio", limit: 0.9 },
        { metric: "cache-hit-ratio", limit: 0.9 },
      ],
      { strict: false }
    );
    expect(results.map((r) => r.passed)).toEqual([true, false]);
  });

  it("checks every budget on every page", () => {
    const results = evaluateBudgets(
      [page("A", { requests: 10 }), page("B", { requests: 90 })],
      [{ metric: "requests", limit: 50 }],
      { strict: false }
    );
    expect(results.map((r) => [r.page, r.passed])).toEqual([
      ["A", true],
      ["B", false],
    ]);
  });

  it("passes a metric the page cannot provide, unless strict", () => {
    const budgets = [{ metric: "lcp" as const, limit: 2500 }];
    const [lenient] = evaluateBudgets([page("No trace", {})], budgets, { strict: false });
    const [strict] = evaluateBudgets([page("No trace", {})], budgets, { strict: true });
    expect(lenient).toMatchObject({ actual: null, passed: true });
    expect(strict).toMatchObject({ actual: null, passed: false });
  });
});

const rec = (severity: "good" | "info" | "warning" | "critical", label: string) => ({
  label,
  description: "",
  severity,
});

describe("failingFindings", () => {
  const flow = (recommendations: ReturnType<typeof rec>[]) => {
    const real = generateFlow([{ name: "Home", har: har() }]);
    return {
      ...real,
      pageAnalyses: [
        { ...real.pageAnalyses[0], cacheReport: { ...real.cacheReport, recommendations } },
      ],
    };
  };

  it("fails on findings of the threshold severity or worse", () => {
    const f = flow([rec("critical", "C"), rec("warning", "W"), rec("info", "I"), rec("good", "G")]);
    expect(failingFindings(f, "warning").map((r) => r.title)).toEqual(["C", "W"]);
    expect(failingFindings(f, "critical").map((r) => r.title)).toEqual(["C"]);
  });

  it("names the page, the report and the rule of each failing finding", () => {
    const [failing] = failingFindings(flow([rec("critical", "CDN miss on document")]), "critical");
    expect(failing).toMatchObject({
      page: "Home",
      source: "cache",
      id: "cdn-miss-document",
      severity: "critical",
    });
  });

  it("reads the findings of every report, the network report included", () => {
    const real = generateFlow([{ name: "Home", har: har() }]);
    const withNetwork = {
      ...real,
      pageAnalyses: [
        {
          ...real.pageAnalyses[0],
          cacheReport: { ...real.cacheReport, recommendations: [] },
          networkReport: {
            ...real.pageAnalyses[0].networkReport!,
            recommendations: [rec("warning", "Duplicates")],
          },
        },
      ],
    };
    expect(failingFindings(withNetwork, "warning").map((r) => r.source)).toContain("network");
  });

  it("fails on a Core Web Vital rated poor at critical", () => {
    const slow = generateFlow([
      {
        name: "Slow",
        har: har(),
        trace: { ...trace(), lcp: 6_000 },
      },
    ]);
    expect(failingFindings(slow, "critical")).toContainEqual(
      expect.objectContaining({ source: "metrics", id: "slow-lcp" })
    );
  });
});

describe("runChecks", () => {
  const report = () => ({
    flow: generateFlow([{ name: "Cold", har: har(), trace: trace() }]),
    compare: generateFlow([{ name: "Warm", har: har() }]),
  });

  it("checks both sides of a comparison, labelled A and B", () => {
    const result = runChecks(report(), {
      budgets: [{ metric: "requests", limit: 100_000 }],
      strict: false,
    });
    expect(result.budgets.map((r) => r.page)).toEqual(["A: Cold", "B: Warm"]);
    expect(result.passed).toBe(true);
  });

  it("fails when any budget fails", () => {
    const result = runChecks(report(), {
      budgets: [{ metric: "requests", limit: 1 }],
      strict: false,
    });
    expect(result.passed).toBe(false);
  });

  it("fails when a finding reaches --fail-on, and passes without one", () => {
    const { flow } = report();
    const worst = collectFindings(flow).some((f) => f.severity === "critical");
    const result = runChecks({ flow }, { budgets: [], failOn: "critical", strict: false });
    expect(result.passed).toBe(!worst);
  });
});

describe("formatChecks", () => {
  it("prints one line per budget per page with the actual value and the limit", () => {
    const text = formatChecks({
      budgets: [
        { page: "Home", metric: "lcp", limit: 2500, actual: 1834.4, passed: true },
        { page: "Home", metric: "transfer", limit: 500_000, actual: 2_160_000, passed: false },
        { page: "Home", metric: "cdn-hit-ratio", limit: 0.9, actual: 0.875, passed: false },
        { page: "Home", metric: "cls", limit: 0.1, actual: 0.0123, passed: true },
      ],
      findings: [],
      passed: false,
    });
    const lines = text.split("\n");
    expect(lines.find((l) => l.includes("lcp"))).toMatch(
      /pass\s+Home\s+lcp\s+1834 ms\s+<= 2500 ms/
    );
    expect(lines.find((l) => l.includes("transfer"))).toMatch(
      /FAIL\s+Home\s+transfer\s+2\.2 MB\s+<= 500 KB/
    );
    expect(lines.find((l) => l.includes("cdn-hit-ratio"))).toMatch(
      /FAIL\s+Home\s+cdn-hit-ratio\s+87\.5%\s+>= 90\.0%/
    );
    expect(lines.find((l) => l.includes("cls"))).toMatch(/pass\s+Home\s+cls\s+0\.012\s+<= 0\.100/);
    expect(text).toContain("2 of 4 budgets failed");
  });

  it("marks a metric the page cannot provide as n/a with a note", () => {
    const text = formatChecks({
      budgets: [{ page: "Home", metric: "lcp", limit: 2500, actual: null, passed: true }],
      findings: [],
      passed: true,
    });
    expect(text).toMatch(/pass\s+Home\s+lcp\s+n\/a\s+<= 2500 ms\s+not in this recording/);
    expect(text).toContain("All checks passed");
  });

  it("prints one line per failing finding", () => {
    const text = formatChecks({
      budgets: [],
      failOn: "warning",
      findings: [
        {
          page: "Home",
          source: "cache",
          id: "no-cdn-caching",
          severity: "critical",
          title: "No CDN caching",
        },
      ],
      passed: false,
    });
    expect(text).toMatch(/Findings at warning or worse/);
    expect(text).toMatch(/FAIL\s+Home\s+critical\s+cache: No CDN caching/);
    expect(text).toContain("1 finding at warning or worse");
  });

  it("says so when no finding reaches --fail-on", () => {
    const text = formatChecks({
      budgets: [],
      failOn: "critical",
      findings: [],
      passed: true,
    });
    expect(text).toMatch(/pass\s+no critical findings/);
  });
});
