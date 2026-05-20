import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";
import type { HarEntry, ParsedHar } from "../src/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const harPath = join(__dirname, "fixtures/webperf-snippets.har.fixture.json");
const tracePath = join(__dirname, "fixtures/webperf-snippets.trace.fixture.json");

function loadHar() {
  return parseHarJson(readFileSync(harPath, "utf8"));
}

function loadTrace() {
  return parseTraceJson(readFileSync(tracePath, "utf8"));
}

describe("generateFlow — single page without trace", () => {
  it("produces 7 steps (DNS, Request, TTFB, Critical, Secondary, 3rdParty, onLoad)", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);

    expect(flow.steps).toHaveLength(7);
  });

  it("step 1 is DNS with browser-only active nodes", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const step = flow.steps[0];

    expect(step.title).toContain("DNS");
    expect(step.activeNodes).toEqual(["browser"]);
    expect(step.activePaths).toEqual([]);
  });

  it("step 3 is TTFB with badge and metric", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const ttfbStep = flow.steps[2];

    expect(ttfbStep.title).toContain("TTFB");
    expect(ttfbStep.badge?.type).toBe("ttfb");
    expect(ttfbStep.metrics.find((m) => m.label === "TTFB")?.value).toBe("49ms");
  });

  it("step 7 is onLoad with badge and metrics", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const last = flow.steps.at(-1)!;

    expect(last.title).toContain("loaded");
    expect(last.badge?.type).toBe("onload");
    expect(last.metrics.find((m) => m.label === "onLoad")?.value).toBe("480ms");
  });

  it("3rd-party step lists domains and request count", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const thirdStep = flow.steps.find((s) => s.title.includes("Third"))!;

    expect(thirdStep).toBeDefined();
    const domains = thirdStep.metrics.find((m) => m.label === "Domains")!;
    const requests = thirdStep.metrics.find((m) => m.label === "Requests")!;
    expect(Number(domains.value)).toBeGreaterThan(0);
    expect(Number(requests.value)).toBeGreaterThan(0);
  });

  it("topology: no CDN — browser-origin path, edge not present", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);

    const edge = flow.nodes.find((n) => n.id === "edge")!;
    expect(edge.present).toBe(false);

    const origin = flow.nodes.find((n) => n.id === "origin")!;
    expect(origin.present).toBe(true);

    const paths = flow.paths.map((p) => p.id);
    expect(paths).toContain("browser-origin");
    expect(paths).not.toContain("browser-edge");
  });

  it("step 2 (request in flight) has pathDirections marking browser-origin as request", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const requestStep = flow.steps[1];

    expect(requestStep.title).toContain("request");
    expect(requestStep.pathDirections?.["browser-origin"]).toBe("request");
  });

  it("step 3 (TTFB) has pathDirections marking browser-origin as response", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const ttfbStep = flow.steps[2];

    expect(ttfbStep.title).toContain("TTFB");
    expect(ttfbStep.pathDirections?.["browser-origin"]).toBe("response");
  });
});

describe("generateFlow — single page with trace", () => {
  it("produces 9 steps (adds FCP and LCP steps)", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);

    expect(flow.steps).toHaveLength(9);
  });

  it("FCP step has badge and correct value", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);
    const fcpStep = flow.steps.find((s) => s.title.includes("Contentful Paint") && s.badge?.type === "fcp")!;

    expect(fcpStep).toBeDefined();
    expect(fcpStep.badge?.value).toBe("182ms");
  });

  it("LCP step has badge and correct value", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);
    const lcpStep = flow.steps.find((s) => s.badge?.type === "lcp")!;

    expect(lcpStep).toBeDefined();
    expect(lcpStep.badge?.value).toBe("182ms");
  });

  it("FCP step appears after Critical resources and before Secondary resources", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);
    const titles = flow.steps.map((s) => s.title);
    const criticalIdx = titles.findIndex((t) => t.includes("Critical"));
    const fcpIdx = titles.findIndex((t) => t.includes("First Contentful"));
    const secondaryIdx = titles.findIndex((t) => t.includes("Secondary"));

    expect(criticalIdx).toBeLessThan(fcpIdx);
    expect(fcpIdx).toBeLessThan(secondaryIdx);
  });
});

describe("generateFlow — cache classification", () => {
  function makeEntry(overrides: Partial<HarEntry> = {}): HarEntry {
    return {
      url: "https://example.com/style.css",
      startTime: 100,
      duration: 50,
      timing: { dns: 0, connect: 0, ssl: 0, send: 1, wait: 10, receive: 5, blocked: 0 },
      ttfb: 10,
      status: 200,
      mimeType: "text/css",
      resourceType: "stylesheet",
      priority: "VeryHigh",
      responseHeaders: {},
      transferSize: 1024,
      isDocument: false,
      fromCache: false,
      ...overrides,
    };
  }

  function makeHar(entries: HarEntry[]): ParsedHar {
    const docEntry = makeEntry({
      url: "https://example.com/",
      mimeType: "text/html",
      isDocument: true,
      resourceType: "document",
      timing: { dns: 10, connect: 20, ssl: 0, send: 1, wait: 50, receive: 5, blocked: 0 },
      ttfb: 50,
    });
    return {
      pages: [{ id: "p1", title: "Example", onContentLoad: 300, onLoad: 500 }],
      entries: [docEntry, ...entries],
      documentEntry: docEntry,
      preconnectHints: {},
    };
  }

  it("resources from cache appear in cacheResources, not resources", () => {
    const networkCss = makeEntry({ url: "https://example.com/a.css", fromCache: false });
    const cachedCss = makeEntry({ url: "https://example.com/b.css", fromCache: "disk" });
    const har = makeHar([networkCss, cachedCss]);
    const flow = generateFlow([{ name: "Page", har }]);

    const criticalStep = flow.steps.find((s) => s.title.includes("Critical"))!;
    expect(criticalStep.resources?.map((e) => e.url)).toEqual([networkCss.url]);
    expect(criticalStep.cacheResources?.map((e) => e.url)).toEqual([cachedCss.url]);
  });

  it("memory-cached resources go to cacheResources", () => {
    const memoryCss = makeEntry({ url: "https://example.com/c.css", fromCache: "memory" });
    const har = makeHar([memoryCss]);
    const flow = generateFlow([{ name: "Page", har }]);

    const criticalStep = flow.steps.find((s) => s.title.includes("Critical"))!;
    expect(criticalStep.resources).toBeUndefined();
    expect(criticalStep.cacheResources?.length).toBe(1);
    expect(criticalStep.cacheResources?.[0].fromCache).toBe("memory");
  });

  it("when all critical resources are from cache, resources is undefined", () => {
    const cached1 = makeEntry({ url: "https://example.com/a.css", fromCache: "disk" });
    const cached2 = makeEntry({ url: "https://example.com/b.css", fromCache: "disk" });
    const har = makeHar([cached1, cached2]);
    const flow = generateFlow([{ name: "Page", har }]);

    const criticalStep = flow.steps.find((s) => s.title.includes("Critical"))!;
    expect(criticalStep.resources).toBeUndefined();
    expect(criticalStep.cacheResources).toHaveLength(2);
  });

  it("secondary resource cache classification works independently of critical", () => {
    const networkImg = makeEntry({
      url: "https://example.com/hero.jpg",
      resourceType: "image",
      priority: "Low",
      fromCache: false,
    });
    const cachedImg = makeEntry({
      url: "https://example.com/bg.jpg",
      resourceType: "image",
      priority: "Low",
      fromCache: "disk",
    });
    const har = makeHar([networkImg, cachedImg]);
    const flow = generateFlow([{ name: "Page", har }]);

    const secondaryStep = flow.steps.find((s) => s.title.includes("Secondary"))!;
    expect(secondaryStep.resources?.map((e) => e.url)).toEqual([networkImg.url]);
    expect(secondaryStep.cacheResources?.map((e) => e.url)).toEqual([cachedImg.url]);
  });
});

describe("generateFlow — node resourceStats", () => {
  function makeEntry(overrides: Partial<HarEntry> = {}): HarEntry {
    return {
      url: "https://example.com/style.css",
      startTime: 100,
      duration: 50,
      timing: { dns: 0, connect: 0, ssl: 0, send: 1, wait: 10, receive: 5, blocked: 0 },
      ttfb: 10,
      status: 200,
      mimeType: "text/css",
      resourceType: "stylesheet",
      priority: "VeryHigh",
      responseHeaders: {},
      transferSize: 1024,
      isDocument: false,
      fromCache: false,
      ...overrides,
    };
  }

  function makeHar(entries: HarEntry[], docHeaders: Record<string, string> = {}): ParsedHar {
    const docEntry = makeEntry({
      url: "https://example.com/",
      mimeType: "text/html",
      isDocument: true,
      resourceType: "document",
      timing: { dns: 10, connect: 20, ssl: 0, send: 1, wait: 50, receive: 5, blocked: 0 },
      ttfb: 50,
      responseHeaders: docHeaders,
    });
    return {
      pages: [{ id: "p1", title: "Example", onContentLoad: 300, onLoad: 500 }],
      entries: [docEntry, ...entries],
      documentEntry: docEntry,
      preconnectHints: {},
    };
  }

  it("browser node gets resourceStats when browser cache hits exist", () => {
    const cached = makeEntry({ fromCache: "disk" });
    const network = makeEntry({ url: "https://example.com/b.css", fromCache: false });
    const flow = generateFlow([{ name: "Page", har: makeHar([cached, network]) }]);

    const browser = flow.nodes.find((n) => n.id === "browser")!;
    expect(browser.resourceStats?.count).toBe(1);
    expect(browser.resourceStats?.avgMs).toBeUndefined();
  });

  it("browser node has no resourceStats when no cache hits", () => {
    const network = makeEntry({ fromCache: false });
    const flow = generateFlow([{ name: "Page", har: makeHar([network]) }]);

    const browser = flow.nodes.find((n) => n.id === "browser")!;
    expect(browser.resourceStats).toBeUndefined();
  });

  it("edge node gets CDN hit stats when CDN is present", () => {
    const cdnHit = makeEntry({
      url: "https://example.com/app.js",
      duration: 40,
      fromCache: false,
      responseHeaders: { "cf-cache-status": "HIT" },
    });
    const cdnMiss = makeEntry({
      url: "https://example.com/api.js",
      duration: 200,
      fromCache: false,
      responseHeaders: { "cf-cache-status": "MISS" },
    });
    const cfDocHeaders = { "cf-ray": "abc123-LHR" };
    const flow = generateFlow([{ name: "Page", har: makeHar([cdnHit, cdnMiss], cfDocHeaders) }]);

    const edge = flow.nodes.find((n) => n.id === "edge")!;
    expect(edge.present).toBe(true);
    expect(edge.resourceStats?.count).toBe(1);
    expect(edge.resourceStats?.avgMs).toBe(40);
    expect(edge.resourceStats?.label).toBe("CDN hit");
  });

  it("origin node gets CDN miss label when CDN is present", () => {
    const cdnMiss = makeEntry({
      url: "https://example.com/api.js",
      duration: 200,
      fromCache: false,
      responseHeaders: { "cf-cache-status": "MISS" },
    });
    const cfDocHeaders = { "cf-ray": "abc123-LHR" };
    const flow = generateFlow([{ name: "Page", har: makeHar([cdnMiss], cfDocHeaders) }]);

    const origin = flow.nodes.find((n) => n.id === "origin")!;
    expect(origin.resourceStats?.count).toBe(1);
    expect(origin.resourceStats?.avgMs).toBe(200);
    expect(origin.resourceStats?.label).toBe("CDN miss");
  });

  it("origin node has no label when no CDN", () => {
    const req1 = makeEntry({ url: "https://example.com/a.css", duration: 100, fromCache: false });
    const req2 = makeEntry({ url: "https://example.com/b.js", duration: 200, fromCache: false });
    const flow = generateFlow([{ name: "Page", har: makeHar([req1, req2]) }]);

    const origin = flow.nodes.find((n) => n.id === "origin")!;
    expect(origin.resourceStats?.count).toBe(2);
    expect(origin.resourceStats?.avgMs).toBe(150);
    expect(origin.resourceStats?.label).toBeUndefined();
  });

  it("third-parties node gets resourceStats for external network requests", () => {
    const ownEntry = makeEntry({ url: "https://example.com/a.css", fromCache: false });
    const thirdParty = makeEntry({
      url: "https://cdn.analytics.com/script.js",
      duration: 120,
      fromCache: false,
    });
    const flow = generateFlow([{ name: "Page", har: makeHar([ownEntry, thirdParty]) }]);

    const thirdParties = flow.nodes.find((n) => n.id === "third-parties")!;
    expect(thirdParties.resourceStats?.count).toBe(1);
    expect(thirdParties.resourceStats?.avgMs).toBe(120);
  });
});

describe("generateFlow — two pages", () => {
  it("inserts a transition step between pages", () => {
    const har = loadHar();
    const flow = generateFlow([
      { name: "Home", har },
      { name: "Login", har },
    ]);

    const transitionStep = flow.steps.find((s) => s.title.includes("→"));
    expect(transitionStep).toBeDefined();
    expect(transitionStep!.title).toContain("Login");
  });

  it("total steps = 2 pages × 7 + 1 transition = 15", () => {
    const har = loadHar();
    const flow = generateFlow([
      { name: "Home", har },
      { name: "Login", har },
    ]);

    expect(flow.steps).toHaveLength(15);
  });
});
