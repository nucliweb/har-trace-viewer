import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { parseTraceFile } from "../src/parsers/trace-parser-node.js";
import {
  analyzeRenderBlocking,
  renderBlockingRecommendations,
} from "../src/analysis/critical-path.js";
import type { HarEntry, ParsedHar, ParsedTrace, TraceRequest } from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootFixture = (name: string) => join(__dirname, "../../../fixtures", name);
const readHar = (name: string) => parseHarJson(readFileSync(rootFixture(name), "utf8"));

const DOCUMENT = "https://webperf-snippets.nucliweb.net/";
const CSS_A = "https://webperf-snippets.nucliweb.net/_next/static/css/4f18b1ac3f22924b.css";
const CSS_B = "https://webperf-snippets.nucliweb.net/_next/static/css/445c4173ffc2bf04.css";

describe("analyzeRenderBlocking — the disable-cache run", () => {
  const har = readHar("webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har");
  const trace = parseTraceJson(
    readFileSync(join(__dirname, "fixtures/webperf-snippets-render.trace.fixture.json"), "utf8")
  );
  const report = analyzeRenderBlocking(har, trace);

  it("lists the two stylesheets the trace marks as render-blocking, deferred scripts aside", () => {
    expect(report.source).toBe("trace");
    expect(report.fcpMs).toBeCloseTo(181.49, 2);
    expect(report.resources.map((r) => r.url)).toEqual([CSS_A, CSS_B]);
    expect(report.resources[0]).toMatchObject({
      resourceType: "stylesheet",
      status: "blocking",
      thirdParty: false,
    });
    expect(report.resources[0].startMs).toBeCloseTo(65.4, 1);
    expect(report.resources[0].endMs).toBeCloseTo(116.9, 1);
    expect(report.totalBytes).toBe(report.resources.reduce((sum, r) => sum + r.transferSize, 0));
    expect(report.totalBytes).toBeGreaterThan(0);
  });

  it("measures how long they held the first paint after the document arrived", () => {
    expect(report.documentEndMs).toBeCloseTo(55.57, 1);
    expect(report.heldMs).toBeCloseTo(116.9 - 55.57, 1);
  });

  it("builds the document → stylesheet chains, longest first", () => {
    expect(report.chains.map((c) => c.requests.map((r) => r.url))).toEqual([
      [DOCUMENT, CSS_A],
      [DOCUMENT, CSS_B],
    ]);
    expect(report.chains[0].depth).toBe(2);
    expect(report.chains[0].durationMs).toBeCloseTo(116.9 - 4.28, 1);
  });

  it("reports the second stylesheet as blocking FCP, at info level for a good FCP", () => {
    const recs = renderBlockingRecommendations(report);

    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      label: "Render-blocking resources delay FCP",
      severity: "info",
    });
    expect(recs[0].resources!.map((r) => r.url)).toEqual([CSS_A, CSS_B]);
  });
});

describe("analyzeRenderBlocking — the cached run", async () => {
  const har = readHar("webperf-snippets.nucliweb.net_Cache-20260519T123746.har");
  const trace = await parseTraceFile(
    rootFixture("WebPerf-Snippets-Cache_Trace-20260519T123746.json.gz")
  );
  const report = analyzeRenderBlocking(har, trace);

  it("still lists both stylesheets, served from the disk cache with no bytes", () => {
    expect(report.resources.map((r) => r.url)).toEqual([CSS_A, CSS_B]);
    expect(report.totalBytes).toBe(0);
    expect(report.heldMs).toBeCloseTo(87.9 - 56.0, 0);
  });
});

// ── Synthetic pages ──────────────────────────────────────────────────────────────

const PAGE = "https://example.com/";
const parser = (url = PAGE) => ({ type: "parser", url });

const css = (overrides: Partial<HarEntry> = {}) =>
  makeEntry({
    url: "https://example.com/style.css",
    startTime: 100,
    duration: 200,
    initiator: parser(),
    ...overrides,
  });
const script = (overrides: Partial<HarEntry> = {}) =>
  makeEntry({
    url: "https://example.com/app.js",
    startTime: 100,
    duration: 300,
    mimeType: "application/javascript",
    resourceType: "script",
    priority: "High",
    initiator: parser(),
    ...overrides,
  });
const font = (overrides: Partial<HarEntry> = {}) =>
  makeEntry({
    url: "https://example.com/font.woff2",
    startTime: 320,
    duration: 100,
    mimeType: "font/woff2",
    resourceType: "font",
    priority: "VeryHigh",
    initiator: parser("https://example.com/style.css"),
    ...overrides,
  });

function trace(fcp: number | null, requests: TraceRequest[] = []): ParsedTrace {
  return {
    navigationStart: 0,
    navigationId: null,
    url: null,
    fcp,
    lcp: fcp,
    cls: null,
    inp: null,
    lcpCandidate: null,
    firstInputMs: null,
    requests,
  };
}

const labelsOf = (har: ParsedHar, t?: ParsedTrace) =>
  renderBlockingRecommendations(analyzeRenderBlocking(har, t)).map((r) => r.label);

describe("analyzeRenderBlocking — HAR fallback", () => {
  const har = makeHar([
    css(),
    script(),
    script({ url: "https://example.com/async.js", priority: "Low" }),
    font(),
    makeEntry({ url: "https://example.com/hero.jpg", resourceType: "image", priority: "High" }),
  ]);

  it("infers the blocking stylesheet and synchronous script from initiator, type and priority", () => {
    const report = analyzeRenderBlocking(har, undefined);

    expect(report.source).toBe("har");
    expect(report.fcpMs).toBeNull();
    expect(report.resources.map((r) => [r.url, r.status])).toEqual([
      ["https://example.com/style.css", "inferred"],
      ["https://example.com/app.js", "inferred"],
    ]);
    // The HAR document ends at 50 ms; the script at 400 ms.
    expect(report.documentEndMs).toBe(50);
    expect(report.heldMs).toBe(350);
  });

  it("follows the stylesheet to the font it loads", () => {
    const report = analyzeRenderBlocking(har, undefined);

    expect(report.chains.map((c) => c.requests.map((r) => r.url))).toEqual([
      [PAGE, "https://example.com/style.css", "https://example.com/font.woff2"],
      [PAGE, "https://example.com/app.js"],
    ]);
    expect(report.chains[0]).toMatchObject({ depth: 3, durationMs: 420, transferSize: 3072 });
  });

  it("flags the blocking resources and the long chain, by held time without an FCP", () => {
    const recs = renderBlockingRecommendations(analyzeRenderBlocking(har, undefined));

    expect(recs.map((r) => [r.label, r.severity])).toEqual([
      ["Render-blocking resources delay FCP", "warning"],
      ["Long critical request chain", "info"],
    ]);
    expect(recs[1].resources!.map((r) => r.url)).toEqual(["https://example.com/font.woff2"]);
  });

  it("leaves resources requested after FCP out", () => {
    const report = analyzeRenderBlocking(har, trace(90));

    expect(report.resources).toEqual([]);
  });

  it("has no source, and no recommendation, when the HAR names no initiator", () => {
    const report = analyzeRenderBlocking(
      makeHar([css({ initiator: undefined }), script({ initiator: undefined })]),
      undefined
    );

    expect(report.source).toBe("none");
    expect(renderBlockingRecommendations(report)).toEqual([]);
  });
});

describe("analyzeRenderBlocking — trace statuses", () => {
  const request = (url: string, overrides: Partial<TraceRequest> = {}): TraceRequest => ({
    url,
    resourceType: "Stylesheet",
    priority: "VeryHigh",
    renderBlocking: "blocking",
    initiator: parser(),
    sentAtMs: 90,
    startMs: 100,
    endMs: 300,
    ...overrides,
  });

  it("is good with a single blocking stylesheet", () => {
    const har = makeHar([css()]);
    const recs = renderBlockingRecommendations(
      analyzeRenderBlocking(har, trace(800, [request("https://example.com/style.css")]))
    );

    expect(recs.map((r) => [r.label, r.severity])).toEqual([
      ["Render-blocking resources are minimal", "good"],
    ]);
  });

  it("counts in-body parser-blocking requests only with a high enough priority", () => {
    const report = analyzeRenderBlocking(
      makeHar([]),
      trace(800, [
        request("https://example.com/body.js", {
          resourceType: "Script",
          priority: "Low",
          renderBlocking: "in_body_parser_blocking",
        }),
        request("https://example.com/sync.js", {
          resourceType: "Script",
          priority: "High",
          renderBlocking: "in_body_parser_blocking",
        }),
        request("https://example.com/maybe.css", { renderBlocking: "potentially_blocking" }),
        request("https://example.com/late.css", { sentAtMs: 900 }),
        request("https://example.com/deferred.js", { renderBlocking: "non_blocking" }),
      ])
    );

    expect(report.resources.map((r) => [r.url, r.status, r.resourceType])).toEqual([
      ["https://example.com/sync.js", "in_body_parser_blocking", "script"],
      ["https://example.com/maybe.css", "potentially_blocking", "stylesheet"],
    ]);
  });

  it("leaves fonts out: without font-display they may not block", () => {
    const report = analyzeRenderBlocking(
      makeHar([]),
      trace(800, [request("https://example.com/font.woff2", { resourceType: "Font" })])
    );

    expect(report.resources).toEqual([]);
  });

  it("flags a third-party script that blocks rendering", () => {
    const har = makeHar([css()]);
    const labels = labelsOf(
      har,
      trace(2000, [
        request("https://example.com/style.css"),
        request("https://cdn.thirdparty.net/tag.js", { resourceType: "Script" }),
      ])
    );

    expect(labels).toContain("Third-party script blocks rendering");
    expect(labels).toContain("Render-blocking resources delay FCP");
  });

  it("follows script-injected scripts into a chain and rates its length", () => {
    const har = makeHar([
      script({ startTime: 100, duration: 900 }),
      script({
        url: "https://example.com/chunk.js",
        startTime: 1000,
        duration: 600,
        initiator: { type: "script", url: "https://example.com/app.js" },
      }),
      script({
        url: "https://example.com/late.js",
        startTime: 1600,
        duration: 100,
        initiator: { type: "script", url: "https://example.com/chunk.js" },
      }),
    ]);
    const report = analyzeRenderBlocking(har, trace(1800));

    expect(report.chains[0].requests.map((r) => r.url)).toEqual([
      PAGE,
      "https://example.com/app.js",
      "https://example.com/chunk.js",
      "https://example.com/late.js",
    ]);
    expect(report.chains[0]).toMatchObject({ depth: 4, durationMs: 1700 });
    const long = renderBlockingRecommendations(report).find(
      (r) => r.label === "Long critical request chain"
    )!;
    expect(long.severity).toBe("warning");
  });

  it("rates by FCP and held time together: a slow FCP the blocking barely held is info", () => {
    const blocking = [
      request("https://example.com/a.css", { endMs: 1300 }),
      request("https://example.com/b.css", { endMs: 1300 }),
    ];
    const severityFor = (fcp: number, end: number) =>
      renderBlockingRecommendations(
        analyzeRenderBlocking(
          makeHar([]),
          trace(
            fcp,
            blocking.map((r) => ({ ...r, endMs: end }))
          )
        )
      ).find((r) => r.label === "Render-blocking resources delay FCP")!.severity;

    expect(severityFor(3500, 1300)).toBe("critical");
    expect(severityFor(3500, 120)).toBe("info");
    expect(severityFor(1000, 900)).toBe("info");
    expect(severityFor(2500, 900)).toBe("warning");
  });
});
