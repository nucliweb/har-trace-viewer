import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { parseTraceFile } from "../src/parsers/trace-parser-node.js";
import { attributeLcp, lcpRecommendations } from "../src/analysis/lcp.js";
import type {
  HarEntry,
  LcpAttribution,
  ParsedHar,
  ParsedTrace,
  TraceLcpCandidate,
} from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootFixture = (name: string) => join(__dirname, "../../../fixtures", name);
const readHar = (name: string) => parseHarJson(readFileSync(rootFixture(name), "utf8"));

const LCP_IMAGE =
  "https://res.cloudinary.com/nucliweb/image/upload/c_scale,f_auto,q_auto,w_1200/v1685735993/webperf-snippets/DevTools-Snippets.png";
const DOCUMENT = "https://webperf-snippets.nucliweb.net/";

const sumOfPhases = ({ phases }: LcpAttribution) =>
  phases.ttfb + phases.resourceLoadDelay + phases.resourceLoadDuration + phases.elementRenderDelay;

describe("attributeLcp — the disable-cache run", () => {
  const har = readHar("webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har");
  const trace = parseTraceJson(
    readFileSync(join(__dirname, "fixtures/webperf-snippets-render.trace.fixture.json"), "utf8")
  );
  const lcp = attributeLcp(har, trace)!;

  it("names the LCP element: the image node", () => {
    expect(lcp.lcpMs).toBeCloseTo(181.49, 2);
    expect(lcp.element).toEqual({ nodeId: 285, tagName: "IMG", type: "image", loading: "eager" });
  });

  it("names the LCP resource with its request timeline, size, priority and initiator", () => {
    expect(lcp.resource).toMatchObject({
      url: LCP_IMAGE,
      transferSize: 68681,
      priority: "High",
      fetchPriorityHint: "high",
      preloaded: false,
      fromCache: false,
      initiator: { type: "parser", url: DOCUMENT, lineNumber: 15 },
    });
    const resource = lcp.resource!;
    expect(resource.discoveredAtMs).toBeCloseTo(59.0, 1);
    expect(resource.requestedAtMs).toBeCloseTo(66.0, 1);
    expect(resource.respondedAtMs!).toBeCloseTo(94.0, 1);
    expect(resource.loadedAtMs).toBeCloseTo(121.8, 1);
  });

  it("breaks LCP into TTFB, load delay, load duration and render delay", () => {
    expect(lcp.phases.ttfb).toBeCloseTo(42.92, 1);
    expect(lcp.phases.resourceLoadDelay).toBeCloseTo(16.08, 1);
    expect(lcp.phases.resourceLoadDuration).toBeCloseTo(62.8, 1);
    expect(lcp.phases.elementRenderDelay).toBeCloseTo(59.69, 1);
    expect(sumOfPhases(lcp)).toBeCloseTo(lcp.lcpMs, 6);
    expect(lcp.notes).toEqual([]);
  });

  it("finds nothing to fix: a good LCP whose phases are balanced", () => {
    expect(lcpRecommendations(har, lcp)).toEqual([
      expect.objectContaining({ label: "LCP is good", severity: "good" }),
    ]);
  });
});

describe("attributeLcp — the cached run", async () => {
  const har = readHar("webperf-snippets.nucliweb.net_Cache-20260519T123746.har");
  const trace = await parseTraceFile(
    rootFixture("WebPerf-Snippets-Cache_Trace-20260519T123746.json.gz")
  );
  const lcp = attributeLcp(har, trace)!;

  it("attributes LCP to the image served from the disk cache", () => {
    expect(lcp.lcpMs).toBeCloseTo(215.4, 1);
    expect(lcp.resource).toMatchObject({ url: LCP_IMAGE, fromCache: true, transferSize: 0 });
    expect(lcp.notes).toContain("resource-from-cache");
    expect(sumOfPhases(lcp)).toBeCloseTo(lcp.lcpMs, 6);
  });
});

// ── Synthetic pages ──────────────────────────────────────────────────────────────

const HERO = "https://cdn.example.com/hero.jpg";

function traceWith(
  lcpMs: number,
  candidate: Omit<TraceLcpCandidate, "timeMs">,
  extra: Partial<ParsedTrace> = {}
): ParsedTrace {
  return {
    navigationStart: 0,
    navigationId: null,
    url: null,
    fcp: 500,
    lcp: lcpMs,
    cls: null,
    inp: null,
    lcpCandidate: { timeMs: lcpMs, ...candidate },
    firstInputMs: null,
    requests: [],
    ...extra,
  };
}

const hero = (overrides: Partial<HarEntry> = {}) =>
  makeEntry({
    url: HERO,
    startTime: 1500,
    duration: 400,
    mimeType: "image/jpeg",
    resourceType: "image",
    priority: "Low",
    transferSize: 120_000,
    initiator: { type: "script", url: "https://example.com/app.js" },
    ...overrides,
  });

const labels = (har: ParsedHar, lcp: LcpAttribution) =>
  lcpRecommendations(har, lcp).map((r) => r.label);

describe("attributeLcp — synthetic pages", () => {
  it("times the resource from the HAR when the trace has no request for it", () => {
    const lcp = attributeLcp(makeHar([hero()]), traceWith(3000, { type: "image", url: HERO }))!;

    // The HAR document: first byte after dns 10 + connect 20 + send 1 + wait 50.
    expect(lcp.phases.ttfb).toBe(81);
    expect(lcp.resource).toMatchObject({
      discoveredAtMs: 1500,
      loadedAtMs: 1900,
      transferSize: 120_000,
      priority: "Low",
      fetchPriorityHint: null,
    });
    expect(lcp.phases).toEqual({
      ttfb: 81,
      resourceLoadDelay: 1419,
      resourceLoadDuration: 400,
      elementRenderDelay: 1100,
    });
    expect(lcp.notes).toContain("har-timings");
  });

  it("flags an image discovered late by a script, without preload or fetchpriority", () => {
    const har = makeHar([hero()]);
    const lcp = attributeLcp(har, traceWith(3000, { type: "image", url: HERO }))!;
    const recs = lcpRecommendations(har, lcp);

    const late = recs.find((r) => r.label === "LCP image discovered late")!;
    expect(late.severity).toBe("warning");
    expect(late.description).toMatch(/fetchpriority="high"/);
    expect(late.description).toMatch(/preload/);
    expect(late.resources).toEqual([{ url: HERO, transferSize: 120_000 }]);
    expect(labels(har, lcp)).toContain("LCP resource not preloaded and discovered by script/CSS");
    expect(labels(har, lcp)).not.toContain("LCP is good");
  });

  it("does not ask for fetchpriority or preload when the image already has them", () => {
    const har = makeHar([
      hero({ priority: "High", initiator: { type: "parser", url: "https://example.com/" } }),
    ]);
    har.documentEntry.responseHeaders = { link: `<${HERO}>; rel=preload; as=image` };
    const trace = traceWith(
      3000,
      { type: "image", url: HERO },
      {
        requests: [{ url: HERO, sentAtMs: 1500, fetchPriorityHint: "high", resourceType: "Image" }],
      }
    );
    const lcp = attributeLcp(har, trace)!;

    expect(lcp.resource).toMatchObject({ preloaded: true, fetchPriorityHint: "high" });
    const late = lcpRecommendations(har, lcp).find((r) => r.label === "LCP image discovered late")!;
    expect(late.description).not.toMatch(/fetchpriority="high"/);
    expect(late.description).not.toMatch(/<link rel=preload/);
    expect(labels(har, lcp)).not.toContain(
      "LCP resource not preloaded and discovered by script/CSS"
    );
  });

  it("flags an image a stylesheet discovered as not preloaded", () => {
    const har = makeHar([
      hero({ initiator: { type: "parser", url: "https://example.com/style.css" }, startTime: 200 }),
    ]);
    const lcp = attributeLcp(har, traceWith(1200, { type: "image", url: HERO }))!;

    expect(labels(har, lcp)).toContain("LCP resource not preloaded and discovered by script/CSS");
  });

  it("flags a lazy-loaded LCP image", () => {
    const har = makeHar([hero({ initiator: { type: "parser", url: "https://example.com/" } })]);
    const lcp = attributeLcp(
      har,
      traceWith(4500, { type: "image", url: HERO, loadingAttr: "lazy" })
    )!;
    const lazy = lcpRecommendations(har, lcp).find((r) => r.label === "LCP image is lazy-loaded")!;

    expect(lazy.severity).toBe("critical");
    expect(lazy.description).toMatch(/loading="lazy"/);
  });

  it("flags the render delay of a text element painted long after the first byte", () => {
    const har = makeHar([]);
    const lcp = attributeLcp(
      har,
      traceWith(2800, { type: "text", nodeId: 7, nodeName: "H1 class='title'" })
    )!;

    expect(lcp.element).toEqual({ nodeId: 7, tagName: "H1", type: "text" });
    expect(lcp.resource).toBeNull();
    expect(lcp.phases).toEqual({
      ttfb: 81,
      resourceLoadDelay: 0,
      resourceLoadDuration: 0,
      elementRenderDelay: 2719,
    });
    expect(lcp.notes).toContain("text-element");
    const delay = lcpRecommendations(har, lcp).find((r) => r.label === "LCP element render delay")!;
    expect(delay.severity).toBe("warning");
  });

  it("notes an image the trace does not name, and one neither the trace nor the HAR requested", () => {
    const unnamed = attributeLcp(makeHar([]), traceWith(900, { type: "image" }))!;
    expect(unnamed.notes).toContain("image-url-unknown");
    expect(unnamed.resource).toBeNull();

    const missing = attributeLcp(makeHar([]), traceWith(900, { type: "image", url: HERO }))!;
    expect(missing.notes).toContain("resource-not-found");
    expect(missing.resource).toBeNull();
  });

  it("times the load phases with the candidate's own image timings when the request is unknown", () => {
    const lcp = attributeLcp(
      makeHar([]),
      traceWith(900, { type: "image", imageLoadStartMs: 300, imageLoadEndMs: 700 })
    )!;

    expect(lcp.phases).toEqual({
      ttfb: 81,
      resourceLoadDelay: 219,
      resourceLoadDuration: 400,
      elementRenderDelay: 200,
    });
  });

  it("does not blame the render delay of an image whose load it cannot time", () => {
    const har = makeHar([]);
    const lcp = attributeLcp(har, traceWith(3000, { type: "image" }))!;

    expect(lcp.notes).toEqual(["image-url-unknown", "load-phases-unknown"]);
    expect(lcpRecommendations(har, lcp)).toEqual([]);
  });

  it("notes that LCP stopped at the first interaction", () => {
    const lcp = attributeLcp(
      makeHar([hero()]),
      traceWith(3000, { type: "image", url: HERO }, { firstInputMs: 3500 })
    )!;

    expect(lcp.notes).toContain("stopped-at-first-input");
  });

  it("returns null without a trace, an LCP or the candidate behind it", () => {
    const har = makeHar([]);
    expect(attributeLcp(har, undefined)).toBeNull();
    expect(
      attributeLcp(har, { ...traceWith(900, { type: "text" }), lcp: null, lcpCandidate: null })
    ).toBeNull();
    // Flows parsed before the candidate was kept.
    const oldTrace = traceWith(900, { type: "text" });
    delete oldTrace.lcpCandidate;
    expect(attributeLcp(har, oldTrace)).toBeNull();
  });
});
