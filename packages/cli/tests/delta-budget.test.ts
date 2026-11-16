import { describe, expect, it } from "vitest";
import { evaluateDeltas, parseBudgets } from "../src/budget";
import type { PageBudgetValues } from "../src/budget";

const page = (name: string, values: Partial<PageBudgetValues["values"]>): PageBudgetValues => ({
  page: name,
  values: {
    ttfb: null,
    "server-wait": null,
    fcp: null,
    lcp: null,
    dcl: null,
    onload: null,
    cls: null,
    inp: null,
    tbt: null,
    requests: 0,
    transfer: 0,
    "cdn-hit-ratio": null,
    "cache-hit-ratio": null,
    ...values,
  },
});

describe("parseBudgets: delta budgets", () => {
  it("reads an absolute delta in the unit of the metric, with = or <=", () => {
    expect(parseBudgets("delta:lcp<=200,delta:transfer=50kb")).toEqual([
      { metric: "lcp", limit: 200, delta: "absolute" },
      { metric: "transfer", limit: 50_000, delta: "absolute" },
    ]);
  });

  it("reads a percentage as relative to A for every metric but the ratios", () => {
    expect(parseBudgets("delta:transfer<=10%,delta:requests=2.5%")).toEqual([
      { metric: "transfer", limit: 10, delta: "percent" },
      { metric: "requests", limit: 2.5, delta: "percent" },
    ]);
  });

  it("reads a ratio delta as points of the ratio", () => {
    expect(parseBudgets("delta:cdn-hit-ratio<=5%")).toEqual([
      { metric: "cdn-hit-ratio", limit: 0.05, delta: "absolute" },
    ]);
  });

  it("mixes plain and delta budgets in one list", () => {
    expect(parseBudgets("lcp=2500,delta:lcp<=10%")).toEqual([
      { metric: "lcp", limit: 2500 },
      { metric: "lcp", limit: 10, delta: "percent" },
    ]);
  });

  it("rejects <= on a plain budget and a bad delta value", () => {
    expect(() => parseBudgets("lcp<=2500")).toThrow(/Unknown --budget metric "lcp<"/);
    expect(() => parseBudgets("delta:lcp<=fast")).toThrow(/Invalid --budget value "fast"/);
    expect(() => parseBudgets("delta:speed<=1")).toThrow(/Unknown --budget metric "speed"/);
  });
});

describe("evaluateDeltas", () => {
  const a = [page("Home", { lcp: 1000, transfer: 1000, requests: 0, "cdn-hit-ratio": 0.9 })];
  const run = (spec: string, b: PageBudgetValues[], strict = false) =>
    evaluateDeltas(a, b, parseBudgets(spec), { strict });

  it("passes when B is no worse than the limit above A, fails above it", () => {
    const b = [page("Home", { lcp: 1150, transfer: 1000 })];
    const [ok] = run("delta:lcp<=200", b);
    expect(ok).toMatchObject({ passed: true, actual: 150, baseline: 1000, candidate: 1150 });
    const [bad] = run("delta:lcp<=100", b);
    expect(bad).toMatchObject({ passed: false, actual: 150 });
    expect(bad.page).toBe("A: Home vs B: Home");
  });

  it("passes any improvement, which is a negative delta", () => {
    const [r] = run("delta:lcp<=0", [page("Home", { lcp: 800 })]);
    expect(r).toMatchObject({ passed: true, actual: -200 });
  });

  it("measures a percentage against A", () => {
    const [r] = run("delta:transfer<=10%", [page("Home", { transfer: 1150, lcp: 1 })]);
    expect(r).toMatchObject({ passed: false, actual: 15, mode: "delta-percent" });
  });

  it("treats a ratio dropping as the worse direction", () => {
    const [r] = run("delta:cdn-hit-ratio<=5%", [page("Home", { "cdn-hit-ratio": 0.8 })]);
    expect(r.passed).toBe(false);
    expect(r.actual).toBeCloseTo(0.1);
  });

  it("skips a metric either side lacks, and fails it under strict", () => {
    const b = [page("Home", { lcp: null })];
    expect(run("delta:lcp<=100", b)[0]).toMatchObject({ passed: true, actual: null });
    expect(run("delta:lcp<=100", b, true)[0]).toMatchObject({ passed: false, actual: null });
  });

  it("fails a percentage of an A of zero that grew, and passes one that did not", () => {
    expect(run("delta:requests<=10%", [page("Home", { requests: 3 })])[0].passed).toBe(false);
    expect(run("delta:requests<=10%", [page("Home", { requests: 0 })])[0].passed).toBe(true);
  });

  it("pairs pages by position and ignores the unpaired ones", () => {
    const two = [page("P1", { lcp: 1 }), page("P2", { lcp: 1 })];
    const budgets = parseBudgets("delta:lcp<=1");
    expect(evaluateDeltas(two, [page("Q1", { lcp: 1 })], budgets, { strict: false })).toHaveLength(
      1
    );
  });
});
