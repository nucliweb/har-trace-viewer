import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarPagesJson } from "../src/parsers/har-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { summarizeFlowMetrics } from "../src/analysis/metrics-summary.js";
import type { PageMetricsSummary } from "../src/analysis/metrics-summary.js";
import {
  groupRuns,
  parseRunId,
  parseRunMetric,
  pickMedianRun,
  runSpread,
} from "../src/analysis/runs.js";

const dir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

function metrics(overrides: Partial<PageMetricsSummary> = {}): PageMetricsSummary {
  return {
    name: "Page",
    ttfb: 500,
    serverWait: 300,
    fcp: null,
    lcp: null,
    dcl: 1_000,
    onLoad: 2_000,
    requests: 10,
    cacheHits: 0,
    transferBytes: 100_000,
    cdnHitRatio: null,
    browserCacheHitRatio: 0,
    ...overrides,
  };
}

const page = (id: string, overrides: Partial<PageMetricsSummary> = {}) => ({
  id,
  metrics: metrics(overrides),
});

describe("parseRunId", () => {
  it("reads the run, view and step of a WebPageTest page id", () => {
    expect(parseRunId("page_3_0_1")).toEqual({ run: 3, view: "first", step: 1 });
    expect(parseRunId("page_12_1_2")).toEqual({ run: 12, view: "repeat", step: 2 });
  });

  it("gives null for any other page id", () => {
    expect(parseRunId("page_1")).toBeNull();
    expect(parseRunId("page_1_2_1")).toBeNull();
    expect(parseRunId("checkout")).toBeNull();
  });
});

describe("groupRuns", () => {
  it("groups the runs of each view and step, in the order the pages come", () => {
    const groups = groupRuns([
      page("page_1_0_1"),
      page("page_1_1_1"),
      page("page_2_0_1"),
      page("page_2_1_1"),
      page("page_1_0_2"),
    ]);
    expect(groups.map((g) => [g.view, g.step, g.runs.map((r) => r.run)])).toEqual([
      ["first", 1, [1, 2]],
      ["repeat", 1, [1, 2]],
      ["first", 2, [1]],
    ]);
    expect(groups[1].runs[1].page.id).toBe("page_2_1_1");
  });

  it("leaves out pages whose id is not a WebPageTest run", () => {
    expect(groupRuns([page("page_1"), page("home")])).toEqual([]);
  });
});

describe("pickMedianRun", () => {
  const [group] = groupRuns([
    page("page_1_0_1", { lcp: 5_200, fcp: 1_400 }),
    page("page_2_0_1", { lcp: 2_600, fcp: 1_700 }),
    page("page_3_0_1", { lcp: 2_100, fcp: 1_200 }),
  ]);

  it("returns the run whose LCP is the median", () => {
    expect(pickMedianRun(group)).toMatchObject({ run: 2, metric: "lcp" });
    expect(pickMedianRun(group).page.id).toBe("page_2_0_1");
  });

  it("uses the metric it is given", () => {
    expect(pickMedianRun(group, "fcp")).toMatchObject({ run: 1, metric: "fcp" });
  });

  it("takes the lower middle of an even number of runs", () => {
    const [even] = groupRuns([
      page("page_1_0_1", { lcp: 4_000 }),
      page("page_2_0_1", { lcp: 1_000 }),
      page("page_3_0_1", { lcp: 3_000 }),
      page("page_4_0_1", { lcp: 2_000 }),
    ]);
    expect(pickMedianRun(even).run).toBe(4);
  });

  it("falls back to onLoad without an LCP on every run, then to DCL", () => {
    const [noLcp] = groupRuns([
      page("page_1_0_1", { lcp: 1_000, onLoad: 3_000 }),
      page("page_2_0_1", { onLoad: 1_000 }),
      page("page_3_0_1", { onLoad: 2_000 }),
    ]);
    expect(pickMedianRun(noLcp)).toMatchObject({ run: 3, metric: "onLoad" });

    const [noLoad] = groupRuns([
      page("page_1_0_1", { onLoad: null, dcl: 900 }),
      page("page_2_0_1", { onLoad: null, dcl: 700 }),
      page("page_3_0_1", { onLoad: null, dcl: 800 }),
    ]);
    expect(pickMedianRun(noLoad, "fcp")).toMatchObject({ run: 3, metric: "dcl" });
  });

  it("takes the lower-middle run by number when no metric is on every run", () => {
    const [none] = groupRuns([
      page("page_1_0_1", { onLoad: null, dcl: null }),
      page("page_2_0_1", { onLoad: null, dcl: null }),
      page("page_3_0_1", { onLoad: null, dcl: null }),
    ]);
    expect(pickMedianRun(none)).toMatchObject({ run: 2, metric: null });
  });
});

describe("runSpread", () => {
  it("gives the min, median, max and p75 of each metric over the runs", () => {
    const [group] = groupRuns([
      page("page_1_0_1", { lcp: 5_200, ttfb: 600 }),
      page("page_2_0_1", { lcp: 2_600, ttfb: 500 }),
      page("page_3_0_1", { lcp: 2_100, ttfb: 400 }),
      page("page_4_0_1", { lcp: 3_000, ttfb: 450 }),
    ]);
    const spread = runSpread(group);
    expect(spread.lcp).toEqual({ min: 2_100, median: 2_600, max: 5_200, p75: 3_000, runs: 4 });
    expect(spread.ttfb).toEqual({ min: 400, median: 450, max: 600, p75: 500, runs: 4 });
    expect(spread.transferBytes).toMatchObject({ min: 100_000, max: 100_000, runs: 4 });
  });

  it("counts only the runs that have the metric and leaves out metrics none has", () => {
    const [group] = groupRuns([
      page("page_1_0_1", { fcp: 1_000 }),
      page("page_2_0_1", { fcp: 1_500 }),
      page("page_3_0_1"),
    ]);
    const spread = runSpread(group);
    expect(spread.fcp).toEqual({ min: 1_000, median: 1_000, max: 1_500, p75: 1_500, runs: 2 });
    expect(spread.lcp).toBeUndefined();
    expect(spread.cdnHitRatio).toBeUndefined();
  });
});

describe("parseRunMetric", () => {
  it("reads the metric names --budget uses", () => {
    expect(parseRunMetric("lcp")).toBe("lcp");
    expect(parseRunMetric("FCP")).toBe("fcp");
    expect(parseRunMetric("onload")).toBe("onLoad");
    expect(parseRunMetric("server-wait")).toBe("serverWait");
    expect(parseRunMetric("transfer")).toBe("transferBytes");
    expect(parseRunMetric("speed-index")).toBeNull();
  });
});

describe("runs of a WebPageTest HAR", () => {
  const pages = parseHarPagesJson(readFileSync(join(dir, "wpt-runs.har.fixture.json"), "utf8"));
  const flow = generateFlow(pages.map((har) => ({ name: har.pages[0].title, har })));
  const runs = summarizeFlowMetrics(flow).map((m, i) => ({ id: pages[i].pages[0].id, metrics: m }));

  it("groups three runs of the first and the repeat view", () => {
    const groups = groupRuns(runs);
    expect(groups.map((g) => [g.view, g.runs.length])).toEqual([
      ["first", 3],
      ["repeat", 3],
    ]);
  });

  it("picks the median run of each view by the LCP WebPageTest measured", () => {
    const [first, repeat] = groupRuns(runs);
    expect(pickMedianRun(first).page.id).toBe("page_2_0_1");
    expect(pickMedianRun(repeat).page.id).toBe("page_3_1_1");
    expect(runSpread(first).lcp).toMatchObject({ min: 2_100, median: 2_600, max: 5_200 });
  });
});
