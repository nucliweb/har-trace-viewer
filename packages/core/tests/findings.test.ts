import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { collectFindings, findingsDocument } from "../src/analysis/findings.js";
import type { Finding, Flow, PageAnalysis, Recommendation } from "../src/types.js";
import { makeEntry, makeHar, makeTrace } from "./helpers/synthetic-har.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name: string) => readFileSync(join(root, "tests/fixtures", name), "utf8");
const schema = JSON.parse(readFileSync(join(root, "schema/findings.schema.json"), "utf8"));

const byId = (findings: Finding[], id: string) => findings.find((f) => f.id === id);

// A page with a 404, a script fetched twice and a versioned bundle that forbids caching.
function brokenFlow(): Flow {
  const har = makeHar([
    makeEntry({ url: "https://example.com/missing.js", status: 404, transferSize: 450 }),
    makeEntry({ url: "https://example.com/app.js", startTime: 120, transferSize: 9_000 }),
    makeEntry({ url: "https://example.com/app.js", startTime: 240, transferSize: 9_000 }),
    makeEntry({
      url: "https://example.com/app/chunk-47TTPNLV.js",
      startTime: 150,
      transferSize: 20_000,
      responseHeaders: { "cache-control": "no-cache, no-store" },
    }),
  ]);
  return generateFlow([{ name: "Broken", har }]);
}

// Adds a report of another kind to the first page, as other analyses do.
function withReport(flow: Flow, key: string, recommendations: Recommendation[]): Flow {
  const analysis = { ...flow.pageAnalyses[0], [key]: { recommendations } } as PageAnalysis;
  return { ...flow, pageAnalyses: [analysis, ...flow.pageAnalyses.slice(1)] };
}

const goodTrace = () => makeTrace(900, 1_200, { cls: 0.01, inp: 80 });

describe("collectFindings — the reports' recommendations", () => {
  const findings = collectFindings(brokenFlow());

  it("turns every recommendation of every report into a finding with a stable rule id", () => {
    const ids = findings.map((f) => f.id);
    expect(ids).toContain("client-errors");
    expect(ids).toContain("duplicate-requests");
    expect(ids).toContain("versioned-assets-not-cached");
  });

  it("names the report each finding comes from and the page it belongs to", () => {
    expect(byId(findings, "client-errors")).toMatchObject({
      source: "network",
      page: { index: 0, name: "Broken" },
    });
    expect(byId(findings, "versioned-assets-not-cached")?.source).toBe("cache");
  });

  it("keeps the label as the title and the severity of the recommendation", () => {
    expect(byId(findings, "client-errors")).toMatchObject({
      title: "1 request failed (4xx)",
      severity: "warning",
      metric: "requests",
      confidence: "high",
    });
  });

  it("splits the description into a one-sentence summary and what to do", () => {
    const duplicates = byId(findings, "duplicate-requests")!;
    expect(duplicates.summary).toBe(
      "The page fetched this URL over the network more than once, downloading 9.0 KB again."
    );
    expect(duplicates.recommendation).toMatch(/^A <link rel=preload> or prefetch/);
    expect(duplicates.recommendation).toMatch(/let the response be cached\.$/);
  });

  it("adds the numbers of the evidence to a summary that has none", () => {
    expect(byId(findings, "client-errors")!.summary).toMatch(/\(1 resource, 450 B\)\.$/);
  });

  it("lists the resources a recommendation names as evidence", () => {
    expect(byId(findings, "duplicate-requests")!.evidence).toEqual([
      { url: "https://example.com/app.js", bytes: 9_000, detail: "fetched 2×" },
    ]);
    expect(byId(findings, "versioned-assets-not-cached")!.evidence).toEqual([
      {
        url: "https://example.com/app/chunk-47TTPNLV.js",
        bytes: 20_000,
        detail: "no-cache, no-store",
      },
    ]);
  });

  it("reads the time a redirect cost from its detail", () => {
    const har = makeHar([
      makeEntry({
        url: "https://example.com/old.css",
        status: 301,
        redirectURL: "https://example.com/new.css",
        transferSize: 300,
      }),
      makeEntry({ url: "https://example.com/new.css", startTime: 220 }),
    ]);
    const redirect = byId(
      collectFindings(generateFlow([{ name: "R", har }])),
      "resource-redirects"
    );
    expect(redirect?.evidence[0]).toMatchObject({ url: "https://example.com/old.css", ms: 120 });
  });

  it("keeps the rule id when the count in a label changes", () => {
    const flow = withReport(brokenFlow(), "networkReport", [
      { label: "3 requests failed (4xx)", description: "Nope.", severity: "warning" },
      { label: "2 server errors (5xx)", description: "Down.", severity: "critical" },
      { label: "1 insecure request on an HTTPS page", description: "Hm.", severity: "warning" },
      { label: "The document is behind 2 redirects", description: "Slow.", severity: "critical" },
      { label: "4 resource redirects", description: "Hops.", severity: "warning" },
    ]);
    const ids = collectFindings(flow)
      .filter((f) => f.source === "network")
      .map((f) => f.id);
    expect(ids.sort()).toEqual(
      [
        "client-errors",
        "server-errors",
        "mixed-content",
        "document-redirects",
        "resource-redirects",
      ].sort()
    );
  });

  it("gives the render, compression and connections rules stable ids, metrics and confidence", () => {
    const expected: [string, string, string, string, string][] = [
      // report key, label, id, metric, confidence
      ["renderReport", "LCP image is lazy-loaded", "lcp-image-lazy-loaded", "lcp", "high"],
      ["renderReport", "LCP image discovered late", "lcp-image-discovered-late", "lcp", "high"],
      [
        "renderReport",
        "LCP resource not preloaded and discovered by script/CSS",
        "lcp-resource-not-preloaded",
        "lcp",
        "high",
      ],
      ["renderReport", "LCP element render delay", "lcp-render-delay", "lcp", "medium"],
      ["renderReport", "LCP is good", "lcp-good", "lcp", "high"],
      [
        "renderReport",
        "Render-blocking resources delay FCP",
        "render-blocking-resources",
        "fcp",
        "high",
      ],
      [
        "renderReport",
        "Third-party script blocks rendering",
        "third-party-render-blocking",
        "fcp",
        "high",
      ],
      ["renderReport", "Long critical request chain", "long-critical-chain", "fcp", "medium"],
      [
        "renderReport",
        "Render-blocking resources are minimal",
        "render-blocking-minimal",
        "fcp",
        "high",
      ],
      [
        "compressionReport",
        "Text responses served uncompressed",
        "uncompressed-text",
        "transfer",
        "high",
      ],
      [
        "compressionReport",
        "Brotli would shrink gzip responses",
        "gzip-only-text",
        "transfer",
        "medium",
      ],
      ["compressionReport", "Legacy image formats", "legacy-image-formats", "transfer", "medium"],
      ["compressionReport", "Images double-encoded", "images-double-encoded", "transfer", "high"],
      [
        "compressionReport",
        "Text compressed with Brotli or Zstandard, images in modern formats",
        "compression-good",
        "transfer",
        "high",
      ],
      ["connectionsReport", "Hosts still on HTTP/1.1", "http1-hosts", "none", "high"],
      [
        "connectionsReport",
        "Several connections to the same host",
        "several-connections-per-host",
        "none",
        "high",
      ],
      [
        "connectionsReport",
        "Cookies sent to static hosts",
        "cookies-to-static-hosts",
        "transfer",
        "high",
      ],
      [
        "connectionsReport",
        "HTTP/3 advertised but not used",
        "http3-advertised-not-used",
        "none",
        "medium",
      ],
      [
        "connectionsReport",
        "Every busy host on one HTTP/2 or HTTP/3 connection",
        "connections-good",
        "none",
        "high",
      ],
    ];
    for (const [report, label, id, metric, confidence] of expected) {
      const flow = withReport(brokenFlow(), report, [
        { label, description: "x.", severity: "info" },
      ]);
      expect(byId(collectFindings(flow), id), label).toMatchObject({ metric, confidence });
    }
  });

  it("picks up the recommendations of any other report, with a slug of the label as id", () => {
    const flow = withReport(brokenFlow(), "renderReport", [
      {
        label: "3 render-blocking stylesheets",
        description: "They delay the first paint by 420 ms. Inline the critical CSS.",
        severity: "warning",
      },
    ]);
    expect(byId(collectFindings(flow), "render-blocking-stylesheets")).toMatchObject({
      source: "render",
      metric: "fcp",
      confidence: "medium",
      summary: "They delay the first paint by 420 ms.",
      recommendation: "Inline the critical CSS.",
    });
  });

  it("ignores page analysis keys that are not reports with recommendations", () => {
    const flow = withReport(brokenFlow(), "oddReport", "nope" as unknown as Recommendation[]);
    expect(() => collectFindings(flow)).not.toThrow();
  });

  it("reads flows generated before the network report existed", () => {
    const flow = brokenFlow();
    const analysis: PageAnalysis = { ...flow.pageAnalyses[0] };
    delete analysis.networkReport;
    const old = { ...flow, pageAnalyses: [analysis] };
    expect(collectFindings(old).some((f) => f.source === "network")).toBe(false);
  });

  it("names the side of a comparison in the page", () => {
    const [finding] = collectFindings(brokenFlow(), { side: "b" });
    expect(finding.page).toEqual({ index: 0, name: "Broken", side: "b" });
  });
});

describe("collectFindings — metrics", () => {
  const flowWith = (trace: ReturnType<typeof makeTrace> | undefined) =>
    generateFlow([{ name: "Home", har: makeHar([]), ...(trace ? { trace } : {}) }]);

  it("flags a poor LCP as critical, with the measured value", () => {
    const lcp = byId(collectFindings(flowWith(makeTrace(900, 4_600))), "slow-lcp");
    expect(lcp).toMatchObject({
      severity: "critical",
      metric: "lcp",
      source: "metrics",
      confidence: "high",
      title: "LCP is poor: 4.6 s",
    });
    expect(lcp!.summary).toContain("4.6 s");
    expect(lcp!.summary).toContain("4.0 s");
  });

  it("flags a metric that needs improvement as a warning", () => {
    const findings = collectFindings(flowWith(makeTrace(2_400, 3_000, { cls: 0.15, inp: 300 })));
    expect(byId(findings, "slow-fcp")).toMatchObject({
      severity: "warning",
      title: "FCP needs improvement: 2.4 s",
    });
    expect(byId(findings, "slow-lcp")?.severity).toBe("warning");
    expect(byId(findings, "high-cls")).toMatchObject({ severity: "warning", metric: "cls" });
    expect(byId(findings, "slow-inp")).toMatchObject({ severity: "warning", metric: "inp" });
  });

  it("rates the TTFB from the navigation start, with the server wait in the summary", () => {
    const har = makeHar([]);
    har.documentEntry.timing.wait = 2_000;
    har.documentEntry.ttfb = 2_000;
    const ttfb = byId(collectFindings(generateFlow([{ name: "Slow", har }])), "slow-ttfb");
    expect(ttfb).toMatchObject({ severity: "critical", metric: "ttfb" });
    expect(ttfb!.summary).toContain("server wait 2.0 s");
    expect(ttfb!.evidence).toEqual([{ url: "https://example.com/", ms: 2_031 }]);
  });

  it("adds a single good finding when every measured vital is good", () => {
    const findings = collectFindings(flowWith(goodTrace()));
    const good = findings.filter((f) => f.source === "metrics");
    expect(good).toHaveLength(1);
    expect(good[0]).toMatchObject({ id: "core-web-vitals-good", severity: "good" });
    expect(good[0].summary).toContain("LCP 1.2 s");
  });

  it("adds no good finding when a vital is not good, or without a trace", () => {
    const slow = collectFindings(flowWith(makeTrace(900, 3_000)));
    expect(byId(slow, "core-web-vitals-good")).toBeUndefined();
    expect(byId(collectFindings(flowWith(undefined)), "core-web-vitals-good")).toBeUndefined();
  });
});

describe("collectFindings — order", () => {
  it("lists critical, warning, info and good, the biggest impact first within each", () => {
    const flow = withReport(
      generateFlow([{ name: "Home", har: makeHar([]), trace: goodTrace() }]),
      "extraReport",
      [
        {
          label: "Small warning",
          description: "x.",
          severity: "warning",
          resources: [{ url: "https://a/", transferSize: 10 }],
        },
        { label: "Info", description: "x.", severity: "info" },
        {
          label: "Big warning",
          description: "x.",
          severity: "warning",
          resources: [{ url: "https://b/", transferSize: 10_000 }],
        },
        {
          label: "Slow warning",
          description: "x.",
          severity: "warning",
          resources: [{ url: "https://c/", transferSize: 1, detail: "301 → https://d/ · 1.5 s" }],
        },
        { label: "Critical", description: "x.", severity: "critical" },
      ]
    );
    // The synthetic document has no Content-Encoding, which the compression report flags:
    // keep only the sources this test is about.
    const titles = collectFindings(flow)
      .filter((f) => f.source === "extra" || f.source === "metrics")
      .map((f) => `${f.severity}:${f.title}`);
    expect(titles).toEqual([
      "critical:Critical",
      "warning:Slow warning",
      "warning:Big warning",
      "warning:Small warning",
      "info:Info",
      expect.stringMatching(/^good:/),
    ]);
  });
});

describe("findingsDocument", () => {
  const meta = { htvVersion: "9.9.9", generatedAt: "2026-11-01T00:00:00.000Z", schema: "s.json" };
  const realFlow = () =>
    generateFlow([
      {
        name: "Home",
        har: parseHarJson(fixture("webperf-snippets.har.fixture.json")),
        trace: parseTraceJson(fixture("webperf-snippets.trace.fixture.json")),
      },
    ]);
  // ISO 8601 timestamps as Date#toISOString writes them; ajv-formats would do the same.
  const validate = new Ajv2020({ allErrors: true })
    .addFormat("date-time", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/)
    .compile(schema);

  it("puts each page's metrics, as numbers, next to its findings", () => {
    const doc = findingsDocument([{ flow: realFlow() }], meta);
    expect(doc).toMatchObject({
      htvVersion: "9.9.9",
      generatedAt: meta.generatedAt,
      schema: "s.json",
    });
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].name).toBe("Home");
    expect(typeof doc.pages[0].metrics.ttfb).toBe("number");
    expect(doc.pages[0].metrics).not.toHaveProperty("name");
    expect(doc.pages[0].findings.length).toBeGreaterThan(0);
  });

  it("rounds times to a tenth of a millisecond and ratios to three decimals", () => {
    const { metrics } = findingsDocument([{ flow: realFlow() }], meta).pages[0];
    const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;
    for (const key of ["ttfb", "serverWait", "fcp", "lcp", "dcl", "onLoad"] as const) {
      expect(decimals(metrics[key] as number), key).toBeLessThanOrEqual(1);
    }
    expect(decimals(metrics.browserCacheHitRatio)).toBeLessThanOrEqual(3);
  });

  it("validates a real flow and a comparison against the JSON schema", () => {
    const single = findingsDocument([{ flow: realFlow() }], meta);
    expect(validate(single), JSON.stringify(validate.errors)).toBe(true);

    const comparison = findingsDocument(
      [
        { flow: realFlow(), side: "a" },
        { flow: brokenFlow(), side: "b" },
      ],
      meta
    );
    expect(comparison.pages.map((p) => p.side)).toEqual(["a", "b"]);
    expect(validate(comparison), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a document whose finding lacks its rule id", () => {
    const doc = JSON.parse(JSON.stringify(findingsDocument([{ flow: brokenFlow() }], meta)));
    delete doc.pages[0].findings[0].id;
    expect(validate(doc)).toBe(false);
  });
});
