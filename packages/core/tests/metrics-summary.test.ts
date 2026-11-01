import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { rateMetric, summarizeFlowMetrics } from "../src/analysis/metrics-summary.js";
import { formatMs } from "../src/utils/format.js";
import { firefoxEntry, firefoxHar } from "./helpers/firefox-har.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";
import type { Flow } from "../src/types.js";

const dir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const har = () =>
  parseHarJson(readFileSync(join(dir, "webperf-snippets.har.fixture.json"), "utf8"));
const trace = () =>
  parseTraceJson(readFileSync(join(dir, "webperf-snippets.trace.fixture.json"), "utf8"));

function twoPageFlow(): Flow {
  return generateFlow([
    { name: "Chrome", har: har(), trace: trace() },
    { name: "Firefox", har: parseHarJson(JSON.stringify(firefoxHar())) },
  ]);
}

const badgeValue = (flow: Flow, pageIndex: number, type: string) =>
  flow.steps.find((s) => s.pageIndex === pageIndex && s.badge?.type === type)?.badge?.value;
const asBadge = (ms: number | null) => (ms === null ? undefined : formatMs(ms));

describe("summarizeFlowMetrics", () => {
  it("returns one summary per page, in order", () => {
    const summary = summarizeFlowMetrics(twoPageFlow());
    expect(summary.map((p) => p.name)).toEqual(["Chrome", "Firefox"]);
  });

  it("matches the values shown by the step badges", () => {
    const flow = twoPageFlow();
    const summary = summarizeFlowMetrics(flow);
    summary.forEach((page, i) => {
      expect(asBadge(page.ttfb)).toBe(badgeValue(flow, i, "ttfb"));
      expect(asBadge(page.fcp)).toBe(badgeValue(flow, i, "fcp"));
      expect(asBadge(page.lcp)).toBe(badgeValue(flow, i, "lcp"));
      expect(asBadge(page.onLoad)).toBe(badgeValue(flow, i, "onload"));
    });
    expect(summary[0].fcp).not.toBeNull();
    expect(summary[0].lcp).not.toBeNull();
  });

  it("reports null for metrics a page does not have", () => {
    const [, firefox] = summarizeFlowMetrics(twoPageFlow());
    expect(firefox.fcp).toBeNull();
    expect(firefox.lcp).toBeNull();
    expect(firefox.onLoad).toBeNull();
    expect(firefox.dcl).toBe(120);
  });

  it("takes FCP and LCP from the HAR's own paint times without a trace, and from the trace with one", () => {
    const wpt = parseHarJson(JSON.stringify(firefoxHar()));
    wpt.pages[0] = { ...wpt.pages[0], fcp: 1_100, lcp: 2_200 };
    const [fromHar] = summarizeFlowMetrics(generateFlow([{ name: "WPT", har: wpt }]));
    expect(fromHar).toMatchObject({ fcp: 1_100, lcp: 2_200 });

    const withTrace = generateFlow([{ name: "WPT", har: wpt, trace: trace() }]);
    const [fromTrace] = summarizeFlowMetrics(withTrace);
    expect(fromTrace.fcp).toBe(trace().fcp);
    expect(fromTrace.lcp).toBe(trace().lcp);
  });

  it("fills CLS and INP from the trace and leaves them null otherwise", () => {
    const flow = generateFlow([
      { name: "Vitals", har: har(), trace: { ...trace(), cls: 0.17, inp: 250 } },
      { name: "Plain", har: har() },
    ]);
    const [vitals, plain] = summarizeFlowMetrics(flow);
    expect(vitals.cls).toBe(0.17);
    expect(vitals.inp).toBe(250);
    expect(plain.cls).toBeNull();
    expect(plain.inp).toBeNull();
  });

  it("counts requests and sums transfer sizes", () => {
    const flow = twoPageFlow();
    const [chrome] = summarizeFlowMetrics(flow);
    const entries = flow.pages[0].har.entries;
    expect(chrome.requests).toBe(entries.length);
    expect(chrome.transferBytes).toBe(entries.reduce((s, e) => s + e.transferSize, 0));
  });

  it("counts only network entries in transferBytes", () => {
    const raw = firefoxHar();
    raw.log.entries.push(
      firefoxEntry("https://example.com/cached.js", "text/javascript", { _fromCache: "disk" })
    );
    const flow = generateFlow([{ name: "Cached", har: parseHarJson(JSON.stringify(raw)) }]);
    const [page] = summarizeFlowMetrics(flow);
    const network = flow.pages[0].har.entries.filter((e) => !e.fromCache);
    expect(page.transferBytes).toBe(network.reduce((s, e) => s + e.transferSize, 0));
    expect(page.transferBytes).toBe(network.length * 1500);
  });

  it("counts network requests and browser-cache hits apart", () => {
    const raw = firefoxHar();
    raw.log.entries.push(
      firefoxEntry("https://example.com/disk.js", "text/javascript", { _fromCache: "disk" }),
      firefoxEntry("https://example.com/memory.css", "text/css", { _fromCache: "memory" })
    );
    const flow = generateFlow([{ name: "Repeat", har: parseHarJson(JSON.stringify(raw)) }]);
    const [page] = summarizeFlowMetrics(flow);
    expect(page.requests).toBe(5);
    expect(page.cacheHits).toBe(2);
  });

  it("has no CDN hit ratio when the browser cache served every own resource", () => {
    const raw = firefoxHar();
    raw.log.entries = raw.log.entries.map((e, i) => (i === 0 ? e : { ...e, _fromCache: "disk" }));
    const flow = generateFlow([{ name: "Repeat", har: parseHarJson(JSON.stringify(raw)) }]);
    const [page] = summarizeFlowMetrics(flow);
    expect(page.cdnHitRatio).toBeNull();
  });

  it("takes the cache ratios from the cache report", () => {
    const flow = twoPageFlow();
    const summary = summarizeFlowMetrics(flow);
    summary.forEach((page, i) => {
      const report = flow.pageAnalyses[i].cacheReport;
      expect(page.cdnHitRatio).toBe(report.ownResources.cdnHitRatio);
      expect(page.browserCacheHitRatio).toBe(report.browser.hitRatio);
    });
  });
});

describe("rateMetric", () => {
  it.each([
    ["fcp", 1800, "good"],
    ["fcp", 1801, "needs-improvement"],
    ["fcp", 3000, "needs-improvement"],
    ["fcp", 3001, "poor"],
    ["lcp", 2500, "good"],
    ["lcp", 2501, "needs-improvement"],
    ["lcp", 4000, "needs-improvement"],
    ["lcp", 4001, "poor"],
    ["ttfb", 800, "good"],
    ["ttfb", 801, "needs-improvement"],
    ["ttfb", 1800, "needs-improvement"],
    ["ttfb", 1801, "poor"],
    ["cls", 0.1, "good"],
    ["cls", 0.11, "needs-improvement"],
    ["cls", 0.25, "needs-improvement"],
    ["cls", 0.26, "poor"],
    ["inp", 200, "good"],
    ["inp", 201, "needs-improvement"],
    ["inp", 500, "needs-improvement"],
    ["inp", 501, "poor"],
  ] as const)("rates %s at %d ms as %s", (metric, value, expected) => {
    expect(rateMetric(metric, value)).toBe(expected);
  });

  it("returns none for null and for metrics without thresholds", () => {
    expect(rateMetric("lcp", null)).toBe("none");
    expect(rateMetric("lcp", undefined)).toBe("none");
    expect(rateMetric("onLoad", 99999)).toBe("none");
    expect(rateMetric("dcl", 10)).toBe("none");
  });
});

describe("summarizeFlowMetrics — TTFB", () => {
  it("measures TTFB from the navigation start and keeps the server wait apart", () => {
    // Document: startTime 0 + blocked 0 + dns 10 + connect 20 + send 1 + wait 50.
    const [page] = summarizeFlowMetrics(generateFlow([{ name: "Home", har: makeHar([]) }]));

    expect(page.ttfb).toBe(81);
    expect(page.serverWait).toBe(50);
  });

  it("counts a redirect before the document in the TTFB, not in the server wait", () => {
    const har = makeHar([]);
    const redirect = makeEntry({
      url: "https://example.com/old",
      startTime: 0,
      status: 301,
      mimeType: "",
      resourceType: "other",
    });
    har.documentEntry.startTime = 120;
    har.entries.unshift(redirect);

    const [page] = summarizeFlowMetrics(generateFlow([{ name: "Home", har }]));

    expect(page.ttfb).toBe(201);
    expect(page.serverWait).toBe(50);
  });
});
