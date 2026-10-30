import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";
import {
  COMPARED_METRICS,
  compareFlows,
  compareStepMetrics,
  stepAtPair,
} from "../src/analysis/compare.js";
import {
  criticalCss,
  makeEntry,
  makeHar,
  makeTrace,
  secondaryImage,
  thirdPartyScript,
} from "./helpers/synthetic-har.js";
import type { DiagramStep, Flow, StepKind } from "../src/types.js";

const dir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

// First view: every resource from the network, a third party and a slow load.
function firstView(): Flow {
  const har = makeHar(
    [criticalCss(100), secondaryImage(200), secondaryImage(250), thirdPartyScript(300)],
    { onContentLoad: 300, onLoad: 500 }
  );
  return generateFlow([{ name: "First view", har, trace: makeTrace(150, 400) }]);
}

// Repeat view: fewer requests, served from the browser cache, and an earlier load.
function repeatView(): Flow {
  const har = makeHar(
    [
      { ...criticalCss(100), fromCache: "disk" as const },
      { ...secondaryImage(200), fromCache: "memory" as const },
    ],
    { onContentLoad: 150, onLoad: 200 }
  );
  return generateFlow([{ name: "Repeat view", har, trace: makeTrace(110, 250) }]);
}

const kindsOf = (pairs: { kind: StepKind }[]) => pairs.map((p) => p.kind);

describe("compareFlows — steps", () => {
  it("pairs the steps of both flows by kind in chronological order", () => {
    const { pairs } = compareFlows(firstView(), repeatView());

    expect(kindsOf(pairs)).toEqual([
      "connection",
      "request",
      "ttfb",
      "critical",
      "fcp",
      "secondary",
      "third-party",
      "lcp",
      "loaded",
    ]);
    expect(pairs.find((p) => p.kind === "third-party")).toEqual({ kind: "third-party", a: 6 });
    expect(pairs.find((p) => p.kind === "lcp")).toEqual({ kind: "lcp", a: 7, b: 6 });
  });

  it("points every index at a step of the right kind on page 0", () => {
    const a = firstView();
    const b = repeatView();
    for (const pair of compareFlows(a, b).pairs) {
      if (pair.a !== undefined)
        expect(a.steps[pair.a]).toMatchObject({ kind: pair.kind, pageIndex: 0 });
      if (pair.b !== undefined)
        expect(b.steps[pair.b]).toMatchObject({ kind: pair.kind, pageIndex: 0 });
    }
  });

  it("only compares the first page of each flow", () => {
    const two = generateFlow([
      { name: "Home", har: makeHar([criticalCss(100)]) },
      { name: "Docs", har: makeHar([criticalCss(100)]) },
    ]);

    const { pairs } = compareFlows(two, repeatView());

    expect(kindsOf(pairs)).not.toContain("transition");
    expect(Math.max(...pairs.map((p) => p.a ?? -1))).toBeLessThan(
      two.steps.findIndex((s) => s.pageIndex === 1)
    );
  });

  it("interleaves kinds that only one side has by their timestamps", () => {
    // A has no trace (no paints) but a third party at 300 ms; B paints at 150 and 400 ms.
    const a = generateFlow([
      { name: "A", har: makeHar([criticalCss(100), secondaryImage(200), thirdPartyScript(300)]) },
    ]);
    const b = generateFlow([
      {
        name: "B",
        har: makeHar([criticalCss(100), secondaryImage(200)]),
        trace: makeTrace(150, 400),
      },
    ]);

    const { pairs } = compareFlows(a, b);

    expect(kindsOf(pairs)).toEqual([
      "connection",
      "request",
      "ttfb",
      "critical",
      "fcp",
      "secondary",
      "third-party",
      "lcp",
      "loaded",
    ]);
    expect(pairs.find((p) => p.kind === "fcp")).toEqual({ kind: "fcp", b: 4 });
  });

  it("follows A's order when the two flows disagree, keeping one pair per kind", () => {
    // LCP comes after the secondary resources in A and before them in B.
    const a = generateFlow([
      {
        name: "A",
        har: makeHar([criticalCss(100), secondaryImage(200)]),
        trace: makeTrace(150, 400),
      },
    ]);
    const b = generateFlow([
      {
        name: "B",
        har: makeHar([criticalCss(100), secondaryImage(200)]),
        trace: makeTrace(120, 160),
      },
    ]);

    const { pairs } = compareFlows(a, b);

    expect(kindsOf(pairs)).toEqual(a.steps.map((s) => s.kind));
    expect(new Set(kindsOf(pairs)).size).toBe(pairs.length);
    expect(pairs.every((p) => p.a !== undefined && p.b !== undefined)).toBe(true);
  });
});

describe("stepAtPair", () => {
  it("shows a side's own step when it has the pair's kind", () => {
    const { pairs } = compareFlows(firstView(), repeatView());
    const lcp = pairs.findIndex((p) => p.kind === "lcp");

    expect(stepAtPair(pairs, lcp, "a")).toEqual({ index: 7, current: true });
    expect(stepAtPair(pairs, lcp, "b")).toEqual({ index: 6, current: true });
  });

  it("keeps the previous step of the side that lacks the kind", () => {
    const { pairs } = compareFlows(firstView(), repeatView());
    const thirdParty = pairs.findIndex((p) => p.kind === "third-party");

    expect(stepAtPair(pairs, thirdParty, "b")).toEqual({
      index: pairs[thirdParty - 1].b,
      current: false,
    });
  });

  it("falls back to the side's first step when nothing precedes the pair", () => {
    const pairs = [
      { kind: "connection" as const, a: 0 },
      { kind: "request" as const, a: 1, b: 0 },
    ];

    expect(stepAtPair(pairs, 0, "b")).toEqual({ index: 0, current: false });
    expect(stepAtPair([{ kind: "connection", a: 0 }], 0, "b")).toEqual({
      index: 0,
      current: false,
    });
  });
});

describe("compareFlows — metrics", () => {
  const row = (label: string) =>
    compareFlows(firstView(), repeatView()).metrics.find((m) => m.label === label)!;

  it("lists the summary metrics in the metrics summary order", () => {
    const { metrics } = compareFlows(firstView(), repeatView());

    expect(metrics.map((m) => m.label)).toEqual([
      "TTFB",
      "FCP",
      "LCP",
      "CLS",
      "INP",
      "DCL",
      "onLoad",
      "Requests",
      "Transfer",
      "CDN hit ratio",
      "Browser cache hit ratio",
    ]);
  });

  it("reports B minus A, its percentage of A and a lower-is-better rating", () => {
    expect(row("onLoad")).toMatchObject({
      key: "onLoad",
      a: 500,
      b: 200,
      delta: -300,
      deltaPct: -60,
      rating: "better",
    });
    expect(row("Requests")).toMatchObject({ a: 5, b: 3, delta: -2, rating: "better" });
    expect(row("TTFB")).toMatchObject({ delta: 0, deltaPct: 0, rating: "same" });
    expect(row("LCP")).toMatchObject({ a: 400, b: 250, rating: "better" });
  });

  it("rates a higher cache hit ratio as better", () => {
    expect(row("Browser cache hit ratio")).toMatchObject({
      a: 0,
      b: 1,
      delta: 1,
      deltaPct: null,
      rating: "better",
    });
  });

  it("rates a slower B as worse", () => {
    const { metrics } = compareFlows(repeatView(), firstView());

    expect(metrics.find((m) => m.label === "onLoad")).toMatchObject({
      delta: 300,
      rating: "worse",
    });
    expect(metrics.find((m) => m.label === "Browser cache hit ratio")).toMatchObject({
      rating: "worse",
    });
  });

  it("has no delta and no rating when a side lacks the value", () => {
    expect(row("INP")).toMatchObject({
      a: null,
      b: null,
      delta: null,
      deltaPct: null,
      rating: "none",
    });
  });
});

describe("compareFlows — TTFB of the URLs both flows requested", () => {
  const at = (url: string, ttfb: number, extra: Partial<ReturnType<typeof makeEntry>> = {}) =>
    makeEntry({ url: `https://static.site.net/${url}`, ttfb, ...extra });
  const hostPair = (a: ReturnType<typeof makeEntry>[], b: ReturnType<typeof makeEntry>[]) =>
    compareFlows(
      generateFlow([{ name: "A", har: makeHar(a) }]),
      generateFlow([{ name: "B", har: makeHar(b) }])
    ).hops.find((h) => h.host === "static.site.net")!;

  it("averages the TTFB of each side over the URLs both requested only", () => {
    const pair = hostPair(
      [at("x.js", 100), at("y.js", 200), at("cached-in-b.js", 30)],
      [at("x.js", 150), at("y.js", 250), at("new-in-b.js", 900)]
    );

    expect(pair.sameUrls).toEqual({ count: 2, avgTtfbA: 150, avgTtfbB: 200, delta: 50 });
  });

  it("pairs a repeated URL occurrence by occurrence", () => {
    const pair = hostPair(
      [at("beacon", 100), at("beacon", 300), at("beacon", 500)],
      [at("beacon", 200), at("beacon", 400)]
    );

    expect(pair.sameUrls).toEqual({ count: 2, avgTtfbA: 200, avgTtfbB: 300, delta: 100 });
  });

  it("leaves browser-cache hits out, since they never reached the host", () => {
    const pair = hostPair(
      [at("x.js", 100), at("y.js", 100)],
      [at("x.js", 120), at("y.js", 0, { fromCache: "disk" })]
    );

    expect(pair.sameUrls).toEqual({ count: 1, avgTtfbA: 100, avgTtfbB: 120, delta: 20 });
  });

  it("has no same-URL TTFB when the flows share no URL on the host", () => {
    expect(hostPair([at("a.js", 100)], [at("b.js", 100)]).sameUrls).toBeUndefined();
  });
});

describe("compareFlows — hops", () => {
  it("joins the hosts of both flows, A's busiest first and B-only hosts last", () => {
    const b = generateFlow([
      {
        name: "B",
        har: makeHar([makeEntry({ url: "https://static.other.net/x.css" })]),
      },
    ]);

    const { hops } = compareFlows(firstView(), b);

    expect(hops.map((h) => h.host)).toEqual(["example.com", "cdn.third.com", "static.other.net"]);
    expect(hops[0].a?.requests).toBe(4);
    expect(hops[0].b?.requests).toBe(1);
    expect(hops[1].b).toBeUndefined();
    expect(hops[2].a).toBeUndefined();
  });
});

describe("compareFlows — the Chrome fixture against itself", () => {
  const load = () =>
    generateFlow([
      {
        name: "Home",
        har: parseHarJson(readFileSync(join(dir, "webperf-snippets.har.fixture.json"), "utf8")),
        trace: parseTraceJson(
          readFileSync(join(dir, "webperf-snippets.trace.fixture.json"), "utf8")
        ),
      },
    ]);

  it("pairs every step with itself and reports no change", () => {
    const flow = load();
    const comparison = compareFlows(flow, load());

    expect(comparison.pairs.map((p) => [p.a, p.b])).toEqual(flow.steps.map((_, i) => [i, i]));
    for (const metric of comparison.metrics) {
      if (metric.a === null) {
        expect(metric.rating).toBe("none");
        continue;
      }
      expect(metric.delta).toBe(0);
      expect(metric.rating).toBe("same");
    }
    expect(comparison.metrics.filter((m) => m.rating === "same").length).toBeGreaterThan(5);
    for (const hop of comparison.hops) expect(hop.b?.requests).toBe(hop.a?.requests);
  });
});

describe("compareStepMetrics", () => {
  const step = (metrics: DiagramStep["metrics"]) => ({ metrics }) as DiagramStep;

  it("joins both sides' metrics by label with a numeric delta", () => {
    const rows = compareStepMetrics(
      step([
        { label: "TTFB", value: "120ms" },
        { label: "Resources", value: "12" },
      ]),
      step([
        { label: "TTFB", value: "80ms" },
        { label: "Resources", value: "4" },
        { label: "From cache", value: "8" },
      ])
    );

    expect(rows).toEqual([
      { label: "TTFB", a: "120ms", b: "80ms", delta: -40, unit: "ms", rating: "better" },
      { label: "Resources", a: "12", b: "4", delta: -8, unit: "", rating: "better" },
      { label: "From cache", b: "8", delta: null, unit: "", rating: "none" },
    ]);
  });

  it("rates more cache hits as better and equal values as the same", () => {
    const rows = compareStepMetrics(
      step([
        { label: "From cache", value: "2" },
        { label: "CLS", value: "0.010" },
      ]),
      step([
        { label: "From cache", value: "5" },
        { label: "CLS", value: "0.010" },
      ])
    );

    expect(rows[0]).toMatchObject({ delta: 3, rating: "better" });
    expect(rows[1]).toMatchObject({ delta: 0, rating: "same" });
  });

  it("has no delta for values that are not numbers or a missing side", () => {
    const rows = compareStepMetrics(step([{ label: "onLoad", value: "n/a" }]), undefined);

    expect(rows).toEqual([{ label: "onLoad", a: "n/a", delta: null, unit: "", rating: "none" }]);
    expect(compareStepMetrics(undefined, undefined)).toEqual([]);
  });
});

describe("compareFlows — caveats", () => {
  it("warns that ratios and host averages cover other resources when the network requests differ", () => {
    const { caveats } = compareFlows(firstView(), repeatView());

    expect(caveats).toEqual([
      {
        id: "request-mix",
        affects: ["cdnHitRatio", "hosts"],
        text: "B made 4 fewer network requests than A (5 → 1): the CDN hit ratio and the host averages are computed over different resources, so they can move without any change on the CDN or the servers. The host TTFB Δ compares only the URLs both flows requested.",
      },
    ]);
  });

  it("has no caveats when both flows request about the same", () => {
    const a = generateFlow([{ name: "A", har: makeHar([criticalCss(100), secondaryImage(200)]) }]);
    const b = generateFlow([{ name: "B", har: makeHar([criticalCss(100), secondaryImage(220)]) }]);

    expect(compareFlows(a, b).caveats).toEqual([]);
  });

  it("says which flow's browser-cache hits are inferred from WebPageTest", () => {
    const har = {
      ...makeHar([criticalCss(100)]),
      inferredCacheHits: [
        {
          url: "https://example.com/a.js",
          resourceType: "script" as const,
          transferSize: 900,
          lifetime: 600,
        },
      ],
    };
    const b = generateFlow([{ name: "Repeat view", har }]);
    const a = generateFlow([{ name: "First view", har: makeHar([criticalCss(100)]) }]);

    expect(compareFlows(a, b).caveats).toEqual([
      {
        id: "inferred-cache-hits",
        affects: ["browserCacheHitRatio"],
        text: "B: 1 browser-cache hit is inferred from the WebPageTest first view of the same run, since WebPageTest leaves cache hits out of repeat views.",
      },
    ]);
  });
});

describe("COMPARED_METRICS", () => {
  it("gives each compared metric its unit, in the order of the deltas", () => {
    expect(COMPARED_METRICS.map((m) => [m.key, m.unit])).toEqual([
      ["ttfb", "ms"],
      ["fcp", "ms"],
      ["lcp", "ms"],
      ["cls", "score"],
      ["inp", "ms"],
      ["dcl", "ms"],
      ["onLoad", "ms"],
      ["requests", "count"],
      ["bytes", "bytes"],
      ["cdnHitRatio", "ratio"],
      ["browserCacheHitRatio", "ratio"],
    ]);
  });
});
