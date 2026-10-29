import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHar, parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import {
  FLOW_VERSION,
  MAX_THIRD_PARTY_CLUSTERS,
  generateFlow,
  nodeKind,
  normalizeFlow,
  stepKindFromTitle,
} from "../src/steps/step-generator.js";
import { getStepCacheResources, getStepResources } from "../src/steps/step-resources.js";
import { firefoxHar } from "./helpers/firefox-har.js";
import {
  criticalCss,
  makeEntry as makeSyntheticEntry,
  makeHar,
  makeTrace,
  secondaryImage,
  thirdPartyScript,
} from "./helpers/synthetic-har.js";
import type { DiagramStep, Flow, HarEntry, ParsedHar } from "../src/types.js";

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

  it("topology: Vercel edge — browser-edge-origin paths, edge named after the provider and PoP", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);

    const edge = flow.nodes.find((n) => n.id === "edge")!;
    expect(edge.present).toBe(true);
    expect(edge.label).toBe("Vercel Edge");
    expect(edge.subLabel).toBe("Paris");
    expect(edge.region).toBe("europe");

    const origin = flow.nodes.find((n) => n.id === "origin")!;
    expect(origin.present).toBe(true);

    const paths = flow.paths.map((p) => p.id);
    expect(paths).toContain("browser-edge");
    expect(paths).toContain("edge-origin");
    expect(paths).not.toContain("browser-origin");
  });

  it("topology: no CDN headers — browser-origin path, edge not present", () => {
    const har = loadHar();
    har.documentEntry.responseHeaders = { server: "nginx" };
    const flow = generateFlow([{ name: "Home", har }]);

    expect(flow.nodes.find((n) => n.id === "edge")!.present).toBe(false);
    const paths = flow.paths.map((p) => p.id);
    expect(paths).toContain("browser-origin");
    expect(paths).not.toContain("browser-edge");
  });

  it("step 2 (request in flight) has pathDirections marking browser-edge as request", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const requestStep = flow.steps[1];

    expect(requestStep.title).toContain("request");
    expect(requestStep.pathDirections?.["browser-edge"]).toBe("request");
  });

  it("step 3 (TTFB) has pathDirections marking browser-edge as response", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);
    const ttfbStep = flow.steps[2];

    expect(ttfbStep.title).toContain("TTFB");
    expect(ttfbStep.pathDirections?.["browser-edge"]).toBe("response");
  });
});

describe("generateFlow — single page with trace", () => {
  it("produces 9 steps (adds FCP and LCP steps)", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);

    expect(flow.steps).toHaveLength(9);
  });

  it("FCP step has badge and correct value", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);
    const fcpStep = flow.steps.find(
      (s) => s.title.includes("Contentful Paint") && s.badge?.type === "fcp"
    )!;

    expect(fcpStep).toBeDefined();
    expect(fcpStep.badge?.value).toBe("181ms");
  });

  it("LCP step has badge and correct value", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);
    const lcpStep = flow.steps.find((s) => s.badge?.type === "lcp")!;

    expect(lcpStep).toBeDefined();
    expect(lcpStep.badge?.value).toBe("181ms");
  });

  it("FCP and LCP steps appear after every resource group and before Page loaded", () => {
    // Chronology of this fixture: critical, secondary and third-party requests all
    // start at 55-56ms, FCP and LCP paint at 181ms, onLoad fires at 480ms. Steps
    // follow the real timeline, so both paints come after the three groups.
    const flow = generateFlow([{ name: "Home", har: loadHar(), trace: loadTrace() }]);
    const titles = flow.steps.map((s) => s.title);
    const idx = (needle: string) => titles.findIndex((t) => t.includes(needle));

    expect(idx("Critical")).toBeLessThan(idx("Secondary"));
    expect(idx("Secondary")).toBeLessThan(idx("Third-party"));
    expect(idx("Third-party")).toBeLessThan(idx("First Contentful"));
    expect(idx("First Contentful")).toBeLessThan(idx("Largest Contentful"));
    expect(idx("Largest Contentful")).toBeLessThan(idx("Page loaded"));
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
      bodySize: 1024,
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
    expect(getStepResources(flow, criticalStep).map((e) => e.url)).toEqual([networkCss.url]);
    expect(getStepCacheResources(flow, criticalStep).map((e) => e.url)).toEqual([cachedCss.url]);
  });

  it("references the page entries by index instead of copying them", () => {
    const networkCss = makeEntry({ url: "https://example.com/a.css", fromCache: false });
    const cachedCss = makeEntry({ url: "https://example.com/b.css", fromCache: "disk" });
    const har = makeHar([networkCss, cachedCss]);
    const flow = generateFlow([{ name: "Page", har }]);

    const criticalStep = flow.steps.find((s) => s.title.includes("Critical"))!;
    expect(criticalStep.resourceRefs).toEqual([1]);
    expect(criticalStep.cacheResourceRefs).toEqual([2]);
    expect(getStepResources(flow, criticalStep)[0]).toBe(har.entries[1]);
    expect(getStepCacheResources(flow, criticalStep)[0]).toBe(har.entries[2]);
    expect(criticalStep).not.toHaveProperty("resources");
    expect(criticalStep).not.toHaveProperty("cacheResources");
  });

  it("memory-cached resources go to cacheResources", () => {
    const memoryCss = makeEntry({ url: "https://example.com/c.css", fromCache: "memory" });
    const har = makeHar([memoryCss]);
    const flow = generateFlow([{ name: "Page", har }]);

    const criticalStep = flow.steps.find((s) => s.title.includes("Critical"))!;
    expect(criticalStep.resourceRefs).toBeUndefined();
    expect(getStepResources(flow, criticalStep)).toEqual([]);
    expect(criticalStep.cacheResourceRefs).toHaveLength(1);
    expect(getStepCacheResources(flow, criticalStep)[0].fromCache).toBe("memory");
  });

  it("when all critical resources are from cache, resources is undefined", () => {
    const cached1 = makeEntry({ url: "https://example.com/a.css", fromCache: "disk" });
    const cached2 = makeEntry({ url: "https://example.com/b.css", fromCache: "disk" });
    const har = makeHar([cached1, cached2]);
    const flow = generateFlow([{ name: "Page", har }]);

    const criticalStep = flow.steps.find((s) => s.title.includes("Critical"))!;
    expect(criticalStep.resourceRefs).toBeUndefined();
    expect(criticalStep.cacheResourceRefs).toHaveLength(2);
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
    expect(getStepResources(flow, secondaryStep).map((e) => e.url)).toEqual([networkImg.url]);
    expect(getStepCacheResources(flow, secondaryStep).map((e) => e.url)).toEqual([cachedImg.url]);
  });
});

describe("generateFlow — third-party counts", () => {
  it("count hostnames and third-party iframes the same in the step, the node and the overview", () => {
    const iframe = makeSyntheticEntry({
      url: "https://ads.third.com/frame.html",
      mimeType: "text/html",
      resourceType: "document",
      isDocument: true,
      startTime: 120,
    });
    const script = makeSyntheticEntry({
      url: "https://cdn.third.com/tag.js",
      mimeType: "application/javascript",
      resourceType: "script",
      startTime: 110,
    });
    const sibling = makeSyntheticEntry({
      url: "https://pixel.third.com/p.gif",
      mimeType: "image/gif",
      resourceType: "image",
      startTime: 130,
    });
    const flow = generateFlow([{ name: "P", har: makeHar([script, iframe, sibling]) }]);
    const step = flow.steps.find((s) => s.title === "Third-party requests")!;
    const metric = (label: string) => step.metrics.find((m) => m.label === label)?.value;

    expect(metric("Requests")).toBe("3");
    // Three hostnames under one root domain (third.com).
    expect(metric("Domains")).toBe("3");
    expect(flow.nodes.find((n) => n.id === "third-parties")?.resourceStats?.count).toBe(3);
    expect(flow.steps.at(-1)!.resourceRefs).toHaveLength(3);
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
      bodySize: 1024,
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

  it("cache node counts the browser cache hits; the browser node carries no stats", () => {
    const cached = makeEntry({ fromCache: "disk" });
    const network = makeEntry({ url: "https://example.com/b.css", fromCache: false });
    const flow = generateFlow([{ name: "Page", har: makeHar([cached, network]) }]);

    const cache = flow.nodes.find((n) => n.id === "cache")!;
    expect(cache.resourceStats).toEqual({ count: 1, label: "from cache" });
    expect(flow.nodes.find((n) => n.id === "browser")!.resourceStats).toBeUndefined();
  });

  it("cache node has no resourceStats when no cache hits", () => {
    const network = makeEntry({ fromCache: false });
    const flow = generateFlow([{ name: "Page", har: makeHar([network]) }]);

    expect(flow.nodes.find((n) => n.id === "cache")!.resourceStats).toBeUndefined();
    expect(flow.nodes.find((n) => n.id === "browser")!.resourceStats).toBeUndefined();
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

describe("generateFlow — per-page analysis", () => {
  function makeEntry(overrides: Partial<HarEntry> = {}): HarEntry {
    return {
      url: "https://example.com/app.js",
      startTime: 100,
      duration: 50,
      timing: { dns: 0, connect: 0, ssl: 0, send: 1, wait: 10, receive: 5, blocked: 0 },
      ttfb: 10,
      status: 200,
      mimeType: "application/javascript",
      resourceType: "script",
      priority: "Low",
      responseHeaders: {},
      transferSize: 1024,
      bodySize: 1024,
      isDocument: false,
      fromCache: false,
      ...overrides,
    };
  }

  function makeHar(entries: HarEntry[], docHeaders: Record<string, string>): ParsedHar {
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

  // Page 1 is served through Cloudflare (two CDN hits); page 2 straight from origin.
  function cdnThenOriginFlow() {
    const cloudflareHar = makeHar(
      [
        makeEntry({
          url: "https://example.com/a.js",
          responseHeaders: { "cf-cache-status": "HIT" },
        }),
        makeEntry({
          url: "https://example.com/b.js",
          responseHeaders: { "cf-cache-status": "HIT" },
        }),
      ],
      { "cf-ray": "abc123-LHR", server: "cloudflare" }
    );
    const originHar = makeHar([makeEntry({ url: "https://example.com/c.js" })], {});
    return generateFlow([
      { name: "Home", har: cloudflareHar },
      { name: "Checkout", har: originHar },
    ]);
  }

  it("computes one analysis per page", () => {
    const flow = cdnThenOriginFlow();

    expect(flow.pageAnalyses).toHaveLength(2);
  });

  it("detects the CDN edge per page", () => {
    const [home, checkout] = cdnThenOriginFlow().pageAnalyses;

    expect(home.nodes.find((n) => n.id === "edge")?.present).toBe(true);
    expect(home.paths.map((p) => p.id)).toContain("browser-edge");
    expect(checkout.nodes.find((n) => n.id === "edge")?.present).toBe(false);
    expect(checkout.paths.map((p) => p.id)).toContain("browser-origin");
    expect(checkout.paths.map((p) => p.id)).not.toContain("browser-edge");
  });

  it("analyzes the cache per page", () => {
    const [home, checkout] = cdnThenOriginFlow().pageAnalyses;

    expect(home.cacheReport.ownResources.cdnHits).toBe(2);
    expect(checkout.cacheReport.ownResources.cdnHits).toBe(0);
    expect(checkout.cacheReport.ownResources.total).toBe(1);
  });

  it("tags every step with its page; the transition step belongs to the page it leads to", () => {
    const flow = cdnThenOriginFlow();
    const transitionIdx = flow.steps.findIndex((s) => s.title.startsWith("→"));

    expect(transitionIdx).toBeGreaterThan(0);
    flow.steps.forEach((step, i) => expect(step.pageIndex).toBe(i < transitionIdx ? 0 : 1));
  });

  it("steps reference the paths of their own page", () => {
    const flow = cdnThenOriginFlow();
    const requestSteps = flow.steps.filter((s) => s.title === "First request in flight");

    expect(requestSteps.map((s) => s.activePaths)).toEqual([
      ["browser-edge", "edge-origin"],
      ["browser-origin"],
    ]);
    for (const step of flow.steps) {
      const pagePaths = flow.pageAnalyses[step.pageIndex].paths.map((p) => p.id);
      for (const pathId of step.activePaths) expect(pagePaths).toContain(pathId);
    }
  });

  it("keeps the top-level topology and cache report as the first page's", () => {
    const flow = cdnThenOriginFlow();

    expect(flow.nodes).toEqual(flow.pageAnalyses[0].nodes);
    expect(flow.paths).toEqual(flow.pageAnalyses[0].paths);
    expect(flow.cacheReport).toEqual(flow.pageAnalyses[0].cacheReport);
  });

  it("counts third parties per page", () => {
    const withThirdParty = makeHar([makeEntry({ url: "https://cdn.analytics.com/t.js" })], {});
    const withoutThirdParty = makeHar([makeEntry()], {});
    const flow = generateFlow([
      { name: "Home", har: withoutThirdParty },
      { name: "Blog", har: withThirdParty },
    ]);

    const thirdParties = flow.pageAnalyses.map((a) =>
      a.nodes.find((n) => n.id === "third-parties")!
    );
    expect(thirdParties.map((n) => n.present)).toEqual([false, true]);
    expect(thirdParties[1].resourceStats?.count).toBe(1);
  });
});

describe("generateFlow — Firefox-style HAR (no priority, onLoad not fired)", () => {
  function firefoxFlow() {
    return generateFlow([{ name: "Home", har: parseHar(firefoxHar()) }]);
  }

  it("yields critical resources from stylesheets", () => {
    const flow = firefoxFlow();
    const step = flow.steps.find((s) => s.title.includes("Critical"))!;

    expect(getStepResources(flow, step).map((e) => e.resourceType)).toEqual(["stylesheet"]);
  });

  it("yields secondary resources without relying on priority", () => {
    const flow = firefoxFlow();
    const step = flow.steps.find((s) => s.title.includes("Secondary"))!;

    expect(getStepResources(flow, step).length).toBeGreaterThan(0);
    expect(step.metrics.find((m) => m.label === "Resources")?.value).toBe("3");
  });

  it("shows n/a for onLoad and omits the onload badge", () => {
    const last = firefoxFlow().steps.at(-1)!;

    expect(last.metrics.find((m) => m.label === "onLoad")?.value).toBe("n/a");
    expect(last.metrics.find((m) => m.label === "DCL")?.value).toBe("120ms");
    expect(last.badge).toBeUndefined();
    expect(JSON.stringify(last)).not.toContain("-1ms");
  });
});

describe("generateFlow — client region", () => {
  function makeEntry(overrides: Partial<HarEntry> = {}): HarEntry {
    return {
      url: "https://example.com/app.js",
      startTime: 100,
      duration: 50,
      timing: { dns: 0, connect: 0, ssl: 0, send: 1, wait: 10, receive: 5, blocked: 0 },
      ttfb: 10,
      status: 200,
      mimeType: "application/javascript",
      resourceType: "script",
      priority: "Low",
      responseHeaders: {},
      transferSize: 1024,
      bodySize: 1024,
      isDocument: false,
      fromCache: false,
      ...overrides,
    };
  }

  // A HAR whose document connection took 350 ms: slow, but not proof of China routing.
  function slowHar(docHeaders: Record<string, string> = {}): ParsedHar {
    const docEntry = makeEntry({
      url: "https://example.com/",
      mimeType: "text/html",
      isDocument: true,
      resourceType: "document",
      timing: { dns: 10, connect: 350, ssl: 0, send: 1, wait: 50, receive: 5, blocked: 0 },
      ttfb: 50,
      responseHeaders: docHeaders,
    });
    return {
      pages: [{ id: "p1", title: "Example", onContentLoad: 300, onLoad: 500 }],
      entries: [docEntry, makeEntry()],
      documentEntry: docEntry,
      preconnectHints: {},
    };
  }

  const CLOUDFLARE_HEADERS = { "cf-ray": "abc123-LHR" };
  const AKAMAI_HEADERS = { "x-akamai-transformed": "9 - 0 pmb=mRUM,1" };

  it("stamps the flow with the current data-model version", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);

    expect(FLOW_VERSION).toBe(5);
    expect(flow.version).toBe(FLOW_VERSION);
  });

  it("defaults to the default client region with no hint for a fast HAR", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);

    expect(flow.clientRegion).toBe("default");
    expect(flow.hints.suggestedClientRegion).toBeUndefined();
  });

  it("slow HAR without options: no GFW topology, only a suggestion with a reason", () => {
    const flow = generateFlow([{ name: "Home", har: slowHar(CLOUDFLARE_HEADERS) }]);

    expect(flow.clientRegion).toBe("default");
    expect(flow.nodes.map((n) => n.id)).not.toContain("gfw");
    expect(flow.nodes.find((n) => n.id === "browser")?.region).toBe("client");
    expect(flow.paths.map((p) => p.id)).toContain("browser-edge");
    expect(flow.steps.flatMap((s) => s.activeNodes)).not.toContain("gfw");
    expect(flow.hints.suggestedClientRegion?.region).toBe("cn");
    expect(flow.hints.suggestedClientRegion?.reason).toContain("350ms");
  });

  it("slow HAR with clientRegion cn and a CDN: GFW node between browser and edge", () => {
    const flow = generateFlow([{ name: "Home", har: slowHar(CLOUDFLARE_HEADERS) }], {
      clientRegion: "cn",
    });

    expect(flow.clientRegion).toBe("cn");
    expect(flow.nodes.find((n) => n.id === "gfw")?.present).toBe(true);
    expect(flow.nodes.find((n) => n.id === "browser")?.region).toBe("china");
    const paths = flow.paths.map((p) => p.id);
    expect(paths).toEqual(expect.arrayContaining(["browser-gfw", "gfw-edge", "edge-origin"]));
    expect(paths).not.toContain("browser-edge");
    expect(flow.steps[1].activePaths).toEqual(["browser-gfw", "gfw-edge", "edge-origin"]);
  });

  it("clientRegion cn without a CDN routes browser → GFW → origin", () => {
    const flow = generateFlow([{ name: "Home", har: slowHar() }], { clientRegion: "cn" });

    const paths = flow.paths.map((p) => p.id);
    expect(paths).toEqual(expect.arrayContaining(["browser-gfw", "gfw-origin"]));
    expect(paths).not.toContain("browser-origin");
    expect(flow.steps[1].activeNodes).toEqual(["browser", "gfw", "origin"]);
    expect(flow.steps[1].activePaths).toEqual(["browser-gfw", "gfw-origin"]);
    expect(flow.steps[1].pathDirections).toEqual({
      "browser-gfw": "request",
      "gfw-origin": "request",
    });
  });

  it("clientRegion cn applies the Hong Kong / APAC fallbacks to an Akamai edge", () => {
    const cn = generateFlow([{ name: "Home", har: slowHar(AKAMAI_HEADERS) }], {
      clientRegion: "cn",
    });
    const edge = cn.nodes.find((n) => n.id === "edge")!;
    expect(edge.subLabel).toBe("Hong Kong");
    expect(edge.region).toBe("asia-pacific");

    const byDefault = generateFlow([{ name: "Home", har: slowHar(AKAMAI_HEADERS) }]);
    const defaultEdge = byDefault.nodes.find((n) => n.id === "edge")!;
    expect(defaultEdge.subLabel).toBeUndefined();
    expect(defaultEdge.region).toBe("edge");
  });

  it("clientRegion cn applies to every page of a multi-page flow", () => {
    const flow = generateFlow(
      [
        { name: "Home", har: loadHar() },
        { name: "Docs", har: loadHar() },
      ],
      { clientRegion: "cn" }
    );

    const requestSteps = flow.steps.filter((s) => s.title === "First request in flight");
    expect(requestSteps).toHaveLength(2);
    for (const step of requestSteps) expect(step.activeNodes).toContain("gfw");
  });
});

describe("normalizeFlow", () => {
  it("treats a flow without version as version 0 in the default region with no hints", () => {
    const current = generateFlow([{ name: "Home", har: loadHar() }]);
    // Shape of a flow embedded before versioning existed.
    const legacy: Partial<Flow> = { ...current };
    delete legacy.version;
    delete legacy.clientRegion;
    delete legacy.hints;
    delete legacy.pageAnalyses;

    const normalized = normalizeFlow(legacy as Flow);

    expect(normalized.version).toBe(0);
    expect(normalized.clientRegion).toBe("default");
    expect(normalized.hints).toEqual({});
    expect(normalized.nodes).toBe(current.nodes);
  });

  // Shape of a version-1 flow: one shared topology, steps without pageIndex.
  function versionOneFlow(): Flow {
    const har = loadHar();
    const current = generateFlow([
      { name: "Home", har },
      { name: "Docs", har },
      { name: "Blog", har },
    ]);
    const legacy: Partial<Flow> = {
      ...current,
      version: 1,
      steps: current.steps.map((step) => {
        const legacyStep: Partial<DiagramStep> = { ...step };
        delete legacyStep.pageIndex;
        return legacyStep as DiagramStep;
      }),
    };
    delete legacy.pageAnalyses;
    return legacy as Flow;
  }

  it("synthesizes one analysis per page from the top-level fields of a version-1 flow", () => {
    const legacy = versionOneFlow();

    const normalized = normalizeFlow(legacy);

    expect(normalized.version).toBe(1);
    expect(normalized.pageAnalyses).toHaveLength(3);
    for (const analysis of normalized.pageAnalyses) {
      expect(analysis.nodes).toBe(legacy.nodes);
      expect(analysis.paths).toBe(legacy.paths);
      expect(analysis.cacheReport).toBe(legacy.cacheReport);
    }
  });

  it("derives sequential pageIndex values from the transition steps of a version-1 flow", () => {
    const normalized = normalizeFlow(versionOneFlow());

    const transitions = normalized.steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.title.startsWith("→"));
    expect(transitions.map(({ s }) => s.pageIndex)).toEqual([1, 2]);
    normalized.steps.forEach((step, i) => {
      const expected = i < transitions[0].i ? 0 : i < transitions[1].i ? 1 : 2;
      expect(step.pageIndex).toBe(expected);
    });
  });

  it("returns a current flow unchanged", () => {
    const current = generateFlow([{ name: "Home", har: loadHar() }], { clientRegion: "cn" });

    expect(normalizeFlow(current)).toEqual(current);
  });

  it("keeps the single third-parties node of a version-3 flow and gives it no clusters", () => {
    const current = generateFlow([{ name: "Home", har: makeHar([thirdPartyScript(200)]) }]);
    const legacy = JSON.parse(JSON.stringify(current)) as Flow;
    legacy.version = 3;
    for (const analysis of legacy.pageAnalyses) {
      delete (analysis as Partial<typeof analysis>).thirdPartyClusters;
    }

    const normalized = normalizeFlow(legacy);

    expect(normalized.version).toBe(3);
    expect(normalized.pageAnalyses[0].thirdPartyClusters).toEqual([]);
    expect(normalized.pageAnalyses[0].nodes).toEqual(legacy.pageAnalyses[0].nodes);
    expect(
      normalized.pageAnalyses[0].nodes.filter((n) => nodeKind(n.id) === "third-parties")
    ).toEqual([expect.objectContaining({ id: "third-parties" })]);
  });
});

// The two real recordings of the root fixtures: same site, without and with browser cache.
const rootFixtures = join(__dirname, "../../../fixtures");
function loadRootHar(name: "Disable-Cache-20260519T123602" | "Cache-20260519T123746") {
  return parseHarJson(
    readFileSync(join(rootFixtures, `webperf-snippets.nucliweb.net_${name}.har`), "utf8")
  );
}

function recordedTwoPageFlow(): Flow {
  return generateFlow([
    { name: "Disable cache", har: loadRootHar("Disable-Cache-20260519T123602") },
    { name: "Cache", har: loadRootHar("Cache-20260519T123746") },
  ]);
}

describe("step resource references", () => {
  it("resolve every step's references within the entries of its own page", () => {
    const flow = recordedTwoPageFlow();

    let referenced = 0;
    for (const step of flow.steps) {
      const { entries } = flow.pages[step.pageIndex].har;
      const resolved = [...getStepResources(flow, step), ...getStepCacheResources(flow, step)];
      const refs = [...(step.resourceRefs ?? []), ...(step.cacheResourceRefs ?? [])];
      expect(resolved).toEqual(refs.map((ref) => entries[ref]));
      for (const entry of resolved) expect(entries).toContain(entry);
      referenced += refs.length;
    }
    expect(referenced).toBeGreaterThan(0);
    expect(flow.steps.some((s) => (s.cacheResourceRefs?.length ?? 0) > 0)).toBe(true);
  });

  it("Page loaded references every entry of the page but the main document in startTime order", () => {
    const flow = recordedTwoPageFlow();

    flow.pages.forEach((page, pageIndex) => {
      const last = flow.steps.filter((s) => s.pageIndex === pageIndex).at(-1)!;
      const { entries } = page.har;
      const expected = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry !== page.har.documentEntry)
        .sort((a, b) => a.entry.startTime - b.entry.startTime)
        .map(({ index }) => index);

      expect(last.title).toBe("Page loaded");
      expect(expected.length).toBeGreaterThan(0);
      expect(last.resourceRefs).toEqual(expected);
      expect(last.cacheResourceRefs).toBeUndefined();
      expect(getStepResources(flow, last)).not.toContain(page.har.documentEntry);
    });
  });

  it("returns no resources for steps without references", () => {
    const flow = recordedTwoPageFlow();
    const dns = flow.steps[0];

    expect(getStepResources(flow, dns)).toEqual([]);
    expect(getStepCacheResources(flow, dns)).toEqual([]);
  });

  it("survive a JSON round trip: hydrated resources equal the original ones", () => {
    const flow = recordedTwoPageFlow();

    const restored = normalizeFlow(JSON.parse(JSON.stringify(flow)) as Flow);

    expect(restored.steps.map((s) => getStepResources(restored, s))).toEqual(
      flow.steps.map((s) => getStepResources(flow, s))
    );
    expect(restored.steps.map((s) => getStepCacheResources(restored, s))).toEqual(
      flow.steps.map((s) => getStepCacheResources(flow, s))
    );
  });
});

describe("normalizeFlow — version 2 inline resources", () => {
  type InlineStep = DiagramStep & { resources?: HarEntry[]; cacheResources?: HarEntry[] };

  // Shape of a version-2 flow after JSON: steps carry copies of their entries.
  function versionTwoFlow(current: Flow): Flow {
    const legacy = JSON.parse(JSON.stringify(current)) as Flow;
    legacy.version = 2;
    legacy.steps = current.steps.map((step) => {
      const inline: InlineStep = JSON.parse(JSON.stringify(step));
      delete inline.resourceRefs;
      delete inline.cacheResourceRefs;
      const resources = getStepResources(current, step);
      const cacheResources = getStepCacheResources(current, step);
      if (resources.length > 0) inline.resources = JSON.parse(JSON.stringify(resources));
      if (cacheResources.length > 0)
        inline.cacheResources = JSON.parse(JSON.stringify(cacheResources));
      return inline;
    });
    return legacy;
  }

  it("converts inline resources into references to the page entries", () => {
    const current = recordedTwoPageFlow();

    const normalized = normalizeFlow(versionTwoFlow(current));

    expect(normalized.version).toBe(2);
    normalized.steps.forEach((step, i) => {
      expect(step.resourceRefs).toEqual(current.steps[i].resourceRefs);
      expect(step.cacheResourceRefs).toEqual(current.steps[i].cacheResourceRefs);
      expect(step).not.toHaveProperty("resources");
      expect(step).not.toHaveProperty("cacheResources");
    });
    normalized.pages.forEach((page, i) => {
      expect(page.har.entries).toHaveLength(current.pages[i].har.entries.length);
    });
  });

  it("appends an inline resource missing from the page entries and references it", () => {
    const current = generateFlow([{ name: "Home", har: loadHar() }]);
    const legacy = versionTwoFlow(current);
    const critical = legacy.steps.find((s) => s.title.includes("Critical")) as InlineStep;
    const orphan = { ...critical.resources![0], url: "https://example.com/orphan.css" };
    critical.resources!.push(orphan);
    const entryCount = legacy.pages[0].har.entries.length;

    const normalized = normalizeFlow(legacy);

    const { entries } = normalized.pages[0].har;
    expect(entries).toHaveLength(entryCount + 1);
    expect(entries.at(-1)).toEqual(orphan);
    const step = normalized.steps.find((s) => s.title.includes("Critical"))!;
    expect(step.resourceRefs?.at(-1)).toBe(entryCount);
    expect(getStepResources(normalized, step).at(-1)).toEqual(orphan);
    expect(legacy.pages[0].har.entries).toHaveLength(entryCount);
  });

  it("maps repeated url and startTime pairs to distinct entries in order", () => {
    const entry = loadHar().entries[1];
    const twin = { ...entry, duration: entry.duration + 1 };
    const har = loadHar();
    har.entries = [har.documentEntry, entry, twin];
    const legacy = {
      ...generateFlow([{ name: "Home", har }]),
      version: 2,
      steps: [
        {
          pageIndex: 0,
          title: "Critical resources loading",
          description: "",
          activeNodes: [],
          activePaths: [],
          metrics: [],
          resources: [entry, twin],
          // Version-2 steps predate the kind.
        } as Omit<InlineStep, "kind"> as InlineStep,
      ],
    } as Flow;

    const normalized = normalizeFlow(JSON.parse(JSON.stringify(legacy)) as Flow);

    expect(normalized.steps[0].resourceRefs).toEqual([1, 2]);
  });
});

describe("generateFlow — chronological steps", () => {
  const titles = (flow: Flow) => flow.steps.map((s) => s.title);
  const indexOf = (flow: Flow, needle: string) => titles(flow).findIndex((t) => t.includes(needle));

  it("keeps the classic 7-step order without a trace", () => {
    const har = makeHar([criticalCss(100), secondaryImage(200), thirdPartyScript(300)]);
    const flow = generateFlow([{ name: "Home", har }]);

    expect(titles(flow)).toEqual([
      "DNS + initial connection",
      "First request in flight",
      "TTFB — First byte received",
      "Critical resources loading",
      "Secondary resources",
      "Third-party requests",
      "Page loaded",
    ]);
  });

  it("places third-party requests before critical resources when they started first", () => {
    const har = makeHar([thirdPartyScript(60), criticalCss(120), secondaryImage(200)]);
    const flow = generateFlow([{ name: "Home", har }]);

    expect(indexOf(flow, "Third-party")).toBeLessThan(indexOf(flow, "Critical"));
    expect(indexOf(flow, "Critical")).toBeLessThan(indexOf(flow, "Secondary"));
  });

  it("places FCP before Secondary resources when it paints before the first secondary request", () => {
    const har = makeHar([criticalCss(60), secondaryImage(150), thirdPartyScript(160)]);
    const flow = generateFlow([{ name: "Home", har, trace: makeTrace(90, 400) }]);

    expect(indexOf(flow, "Critical")).toBeLessThan(indexOf(flow, "First Contentful"));
    expect(indexOf(flow, "First Contentful")).toBeLessThan(indexOf(flow, "Secondary"));
    expect(indexOf(flow, "Third-party")).toBeLessThan(indexOf(flow, "Largest Contentful"));
    expect(indexOf(flow, "Largest Contentful")).toBeLessThan(indexOf(flow, "Page loaded"));
  });

  it("places FCP and LCP after every resource group when they paint later", () => {
    const har = makeHar([criticalCss(60), secondaryImage(80), thirdPartyScript(100)]);
    const flow = generateFlow([{ name: "Home", har, trace: makeTrace(500, 600) }]);

    expect(titles(flow)).toEqual([
      "DNS + initial connection",
      "First request in flight",
      "TTFB — First byte received",
      "Critical resources loading",
      "Secondary resources",
      "Third-party requests",
      "First Contentful Paint",
      "Largest Contentful Paint",
      "Page loaded",
    ]);
  });

  it("keeps connection, request and TTFB first and the load event last whatever the timestamps", () => {
    // An Early-Hints preload can start before the document's first byte (TTFB 50ms).
    const har = makeHar([criticalCss(5), secondaryImage(700)], { onContentLoad: 20, onLoad: 30 });
    const flow = generateFlow([{ name: "Home", har, trace: makeTrace(10, 15) }]);

    expect(titles(flow).slice(0, 3)).toEqual([
      "DNS + initial connection",
      "First request in flight",
      "TTFB — First byte received",
    ]);
    expect(titles(flow).at(-1)).toBe("Page loaded");
  });

  it("keeps empty resource groups in their classic position", () => {
    const har = makeHar([thirdPartyScript(300)]);
    const flow = generateFlow([{ name: "Home", har }]);

    expect(titles(flow).slice(3)).toEqual([
      "Critical resources loading",
      "Secondary resources",
      "Third-party requests",
      "Page loaded",
    ]);
  });

  it("adds CLS and INP to the Page loaded metrics", () => {
    const har = makeHar([criticalCss(60)]);
    const flow = generateFlow([
      { name: "Home", har, trace: makeTrace(90, 400, { cls: 0.17, inp: 250 }) },
    ]);
    const metrics = flow.steps[indexOf(flow, "Page loaded")].metrics;

    expect(metrics).toContainEqual({ label: "CLS", value: "0.170" });
    expect(metrics).toContainEqual({ label: "INP", value: "250ms" });
  });

  it("shows n/a for CLS and INP when the trace has none or there is no trace", () => {
    const har = makeHar([criticalCss(60)]);
    for (const trace of [makeTrace(90, 400), undefined]) {
      const flow = generateFlow([{ name: "Home", har, trace }]);
      const metrics = flow.steps[indexOf(flow, "Page loaded")].metrics;
      expect(metrics).toContainEqual({ label: "CLS", value: "n/a" });
      expect(metrics).toContainEqual({ label: "INP", value: "n/a" });
    }
  });

  it("stamps every page step with its timestamp in ms from the page origin", () => {
    const har = makeHar([criticalCss(60), secondaryImage(150), thirdPartyScript(160)]);
    const flow = generateFlow([{ name: "Home", har, trace: makeTrace(90, 400) }]);
    const at = (needle: string) => flow.steps[indexOf(flow, needle)].timestamp;

    expect(at("DNS")).toBe(0);
    // First byte = startTime + blocked + dns + connect + ssl + send + wait (the
    // TTFB badge shows only the wait): 0 + 0 + 10 + 20 + 0 + 1 + 50.
    expect(at("TTFB")).toBe(81);
    expect(at("Critical")).toBe(60);
    expect(at("First Contentful")).toBe(90);
    expect(at("Secondary")).toBe(150);
    expect(at("Third-party")).toBe(160);
    expect(at("Largest Contentful")).toBe(400);
    expect(at("Page loaded")).toBe(500);
  });

  it("sorts the steps of each page independently in a multi-page flow", () => {
    const early = makeHar([thirdPartyScript(60), criticalCss(120)]);
    const classic = makeHar([criticalCss(60), thirdPartyScript(120)]);
    const flow = generateFlow([
      { name: "A", har: early },
      { name: "B", har: classic },
    ]);
    const pageTitles = (pageIndex: number) =>
      flow.steps.filter((s) => s.pageIndex === pageIndex).map((s) => s.title);

    expect(pageTitles(0).indexOf("Third-party requests")).toBeLessThan(
      pageTitles(0).indexOf("Critical resources loading")
    );
    expect(pageTitles(1).indexOf("Critical resources loading")).toBeLessThan(
      pageTitles(1).indexOf("Third-party requests")
    );
    expect(pageTitles(1)[0]).toBe("→ User navigates to B");
  });
});

describe("generateFlow — third-party clusters", () => {
  const thirdParty = (
    url: string,
    responseHeaders: Record<string, string>,
    extra: Partial<HarEntry> = {}
  ) =>
    makeSyntheticEntry({
      url,
      startTime: 200,
      mimeType: "application/javascript",
      resourceType: "script",
      priority: "Low",
      responseHeaders,
      ...extra,
    });
  const cloudflareLax = (url: string, extra: Partial<HarEntry> = {}, cache = "MISS") =>
    thirdParty(
      url,
      { "cf-ray": "8a1b2c3d4e5f-LAX", server: "cloudflare", "cf-cache-status": cache },
      extra
    );
  const cloudfrontFra = (url: string) =>
    thirdParty(url, { "x-amz-cf-pop": "FRA56-P1", "x-cache": "Hit from cloudfront" });
  const direct = (url: string) => thirdParty(url, {});

  function analyze(entries: HarEntry[], options: Parameters<typeof generateFlow>[1] = {}) {
    const flow = generateFlow([{ name: "P", har: makeHar(entries) }], options);
    return { flow, analysis: flow.pageAnalyses[0] };
  }

  const twoProviders = () => [
    cloudflareLax(
      "https://cdnjs.cloudflare.com/a.js",
      { duration: 100, transferSize: 1000 },
      "HIT"
    ),
    cloudfrontFra("https://d1.cloudfront.net/x.js"),
    cloudflareLax(
      "https://cdnjs.cloudflare.com/b.js",
      { duration: 200, transferSize: 2000 },
      "HIT"
    ),
    cloudflareLax("https://static.cfassets.com/c.js", { duration: 300, transferSize: 3000 }),
    cloudfrontFra("https://d1.cloudfront.net/y.js"),
  ];

  it("groups third parties by CDN provider and region, biggest first", () => {
    const { analysis } = analyze(twoProviders());

    expect(analysis.thirdPartyClusters).toHaveLength(2);
    const [cloudflare, cloudfront] = analysis.thirdPartyClusters;
    expect(cloudflare).toMatchObject({
      label: "Cloudflare · LAX",
      provider: "cloudflare",
      region: "united-states",
      hosts: ["cdnjs.cloudflare.com", "static.cfassets.com"],
      requests: 3,
      avgMs: 200,
      bytes: 6000,
    });
    expect(cloudflare.pop).toMatchObject({ code: "lax", city: "Los Angeles" });
    expect(cloudflare.hitRatio).toBeCloseTo(2 / 3);
    expect(cloudfront).toMatchObject({
      label: "CloudFront · FRA",
      provider: "cloudfront",
      region: "europe",
      hosts: ["d1.cloudfront.net"],
      requests: 2,
      hitRatio: 1,
    });
    expect(cloudflare.id).not.toBe(cloudfront.id);
  });

  it("labels third parties without a CDN as Direct", () => {
    const { analysis } = analyze([
      direct("https://widgets.thirdparty.com/a.js"),
      direct("https://pixel.tracker.io/p.gif"),
    ]);

    expect(analysis.thirdPartyClusters).toEqual([
      expect.objectContaining({
        label: "Direct",
        provider: "unknown",
        region: "origin",
        pop: null,
        hosts: ["widgets.thirdparty.com", "pixel.tracker.io"],
        requests: 2,
        hitRatio: 0,
      }),
    ]);
  });

  it("keeps every direct third party in one Direct cluster, in the region most of its hosts share", () => {
    const { analysis } = analyze([
      direct("https://widgets.thirdparty.com/a.js"),
      direct("https://static.analytics.de/tag.js"),
      direct("https://consent.privacy.eu/c.js"),
      direct("https://pixel.tracker.io/p.gif"),
      direct("https://pixel.tracker.io/q.gif"),
      direct("https://pixel.tracker.io/r.gif"),
      cloudflareLax("https://cdnjs.cloudflare.com/a.js"),
    ]);

    const directCluster = analysis.thirdPartyClusters.find((c) => c.provider === "unknown")!;
    expect(directCluster).toMatchObject({
      id: "direct",
      label: "Direct",
      // Two European hosts against two hosts with no region hint: the tie goes to the region
      // of the busier hosts (origin: pixel.tracker.io with three requests).
      region: "origin",
      requests: 6,
    });
    expect(analysis.thirdPartyClusters.filter((c) => c.provider === "unknown")).toHaveLength(1);
    expect(analysis.nodes.find((n) => n.label === "Direct")?.subLabel).toBe("pixel.tracker.io +3");
  });

  it("places the Direct cluster in the region of most of its hosts", () => {
    const { analysis } = analyze([
      direct("https://static.analytics.de/tag.js"),
      direct("https://consent.privacy.eu/c.js"),
      direct("https://pixel.tracker.io/p.gif"),
      direct("https://pixel.tracker.io/q.gif"),
    ]);

    expect(analysis.thirdPartyClusters).toEqual([
      expect.objectContaining({ label: "Direct", region: "europe", requests: 4 }),
    ]);
  });

  it("captions a Direct cluster with its busiest host, cut from the left when too long", () => {
    const { analysis } = analyze([
      direct("https://a-very-long-subdomain.of.some-analytics-vendor.com/x.js"),
      cloudflareLax("https://cdnjs.cloudflare.com/a.js"),
    ]);

    expect(analysis.nodes.find((n) => n.label === "Direct")?.subLabel).toBe("…nalytics-vendor.com");
  });

  it("shortens a long busiest host to its last labels that fit", () => {
    const { analysis } = analyze([
      direct("https://media-us2.digital.nuance.com/a.js"),
      direct("https://media-us2.digital.nuance.com/b.js"),
      direct("https://pixel.tracker.io/p.gif"),
      cloudflareLax("https://cdnjs.cloudflare.com/a.js"),
    ]);

    expect(analysis.nodes.find((n) => n.label === "Direct")?.subLabel).toBe(
      "…digital.nuance.com +1"
    );
  });

  it("places a Google Frontend without PoP in the United States and an Akamai edge at the edge", () => {
    const { analysis } = analyze([
      thirdParty("https://fonts.googleapis.com/css", { server: "Google Frontend" }),
      thirdParty("https://fonts.googleapis.com/css2", { server: "Google Frontend" }),
      thirdParty("https://assets.akamaized.net/a.js", { server: "AkamaiNetStorage" }),
    ]);

    expect(analysis.thirdPartyClusters.map((c) => [c.label, c.region])).toEqual([
      ["Google", "united-states"],
      ["Akamai Edge", "edge"],
    ]);
  });

  const cdn = {
    cloudflareSin: (n: number) =>
      thirdParty(`https://cdnjs.cloudflare.com/sin-${n}.js`, { "cf-ray": "abc-SIN" }),
    cloudflareFra: (n: number) =>
      thirdParty(`https://cdnjs.cloudflare.com/fra-${n}.js`, { "cf-ray": "abc-FRA" }),
    fastly: (n: number) =>
      thirdParty(`https://cdn.fastly-vendor.net/${n}.js`, { "x-served-by": "cache-sin18034-SIN" }),
    akamai: (n: number) =>
      thirdParty(`https://assets.akamaized.net/${n}.js`, { server: "AkamaiNetStorage" }),
    google: (n: number) =>
      thirdParty(`https://fonts.googleapis.com/${n}.css`, { server: "Google Frontend" }),
    azure: (n: number) =>
      thirdParty(`https://media.vendor.com/${n}.js`, { "x-azure-ref": "20261028T222212Z-1" }),
  };
  const times = (count: number, make: (n: number) => HarEntry) =>
    Array.from({ length: count }, (_, n) => make(n));

  it("splits a provider by region when the clusters stay within the cap", () => {
    const { analysis } = analyze([
      cloudflareLax("https://cdnjs.cloudflare.com/a.js"),
      cloudflareLax("https://cdnjs.cloudflare.com/b.js"),
      cdn.cloudflareFra(1),
      cloudfrontFra("https://d1.cloudfront.net/x.js"),
    ]);

    expect(analysis.thirdPartyClusters.map((c) => [c.id, c.label, c.region, c.requests])).toEqual([
      ["cloudflare-united-states", "Cloudflare · LAX", "united-states", 2],
      ["cloudflare-europe", "Cloudflare · FRA", "europe", 1],
      ["cloudfront", "CloudFront · FRA", "europe", 1],
    ]);
  });

  it("keeps a provider whole, naming its PoPs, when splitting it would exceed the cap", () => {
    const { analysis } = analyze([
      ...times(9, (n) => direct(`https://h${n % 4}.vendor-${n % 4}.com/${n}.js`)),
      ...times(4, cdn.akamai),
      ...times(3, cdn.google),
      ...times(2, cdn.azure),
      cloudflareLax("https://cdnjs.cloudflare.com/a.js"),
      cloudflareLax("https://cdnjs.cloudflare.com/b.js"),
      cdn.cloudflareSin(1),
    ]);

    expect(MAX_THIRD_PARTY_CLUSTERS).toBe(5);
    expect(analysis.thirdPartyClusters.map((c) => [c.label, c.requests])).toEqual([
      ["Direct", 9],
      ["Akamai Edge", 4],
      ["Google", 3],
      ["Cloudflare · LAX, SIN", 3],
      ["Azure Front Door", 2],
    ]);
    const cloudflare = analysis.thirdPartyClusters.find((c) => c.provider === "cloudflare")!;
    expect(cloudflare).toMatchObject({ id: "cloudflare", region: "united-states" });
  });

  it("names as many PoPs as fit a diagram caption, or none for a long provider name", () => {
    const azure = (pop: string, n: number) =>
      thirdParty(`https://media.vendor.com/${pop}-${n}.js`, {
        "x-azure-ref": `Ref A: 1 Ref B: ${pop}30EDGE0815 Ref C: 2026-01-01`,
      });
    const { analysis } = analyze([
      ...times(3, (n) => azure("IAD", n)),
      ...times(2, (n) => azure("AMS", n)),
      ...times(4, (n) => direct(`https://h${n}.vendor-${n}.com/a.js`)),
      ...times(3, cdn.akamai),
      ...times(2, cdn.google),
      cloudfrontFra("https://d1.cloudfront.net/x.js"),
    ]);

    expect(analysis.thirdPartyClusters.map((c) => [c.label, c.pop?.city])).toContainEqual([
      "Azure Front Door",
      "Washington DC",
    ]);
    for (const cluster of analysis.thirdPartyClusters) {
      expect(cluster.label.length, cluster.label).toBeLessThanOrEqual(22);
    }
  });

  it("merges the smallest CDN clusters into Other third parties past the cap, never Direct", () => {
    const { analysis } = analyze([
      direct("https://pixel.tracker.io/p.gif"),
      ...times(6, (n) => cloudflareLax(`https://cdnjs.cloudflare.com/${n}.js`)),
      ...times(5, (n) => cloudfrontFra(`https://d1.cloudfront.net/${n}.js`)),
      ...times(4, cdn.fastly),
      ...times(3, cdn.akamai),
      ...times(2, cdn.google),
    ]);

    expect(analysis.thirdPartyClusters.map((c) => [c.label, c.requests])).toEqual([
      ["Cloudflare · LAX", 6],
      ["CloudFront · FRA", 5],
      ["Fastly CDN · SIN", 4],
      ["Direct", 1],
      ["Other third parties", 3 + 2],
    ]);
    const other = analysis.thirdPartyClusters.at(-1)!;
    expect(other).toMatchObject({ id: "other", provider: "mixed", pop: null });
    expect(other.hosts).toEqual(["assets.akamaized.net", "fonts.googleapis.com"]);
  });

  it("draws one node and one browser path per cluster instead of the single third-parties node", () => {
    const { analysis } = analyze(twoProviders());
    const [cloudflare, cloudfront] = analysis.thirdPartyClusters;

    const thirdPartyNodes = analysis.nodes.filter((n) => nodeKind(n.id) === "third-parties");
    expect(thirdPartyNodes).toEqual([
      {
        id: `third-parties:${cloudflare.id}`,
        label: "Cloudflare · LAX",
        subLabel: "Los Angeles",
        present: true,
        region: "united-states",
        resourceStats: { count: 3, avgMs: 200 },
      },
      {
        id: `third-parties:${cloudfront.id}`,
        label: "CloudFront · FRA",
        subLabel: "Frankfurt",
        present: true,
        region: "europe",
        resourceStats: { count: 2, avgMs: 50 },
      },
    ]);
    expect(
      analysis.paths.filter((p) => p.from === "browser" && nodeKind(p.to) === "third-parties")
    ).toEqual([
      {
        id: `browser-third-parties:${cloudflare.id}`,
        from: "browser",
        to: `third-parties:${cloudflare.id}`,
      },
      {
        id: `browser-third-parties:${cloudfront.id}`,
        from: "browser",
        to: `third-parties:${cloudfront.id}`,
      },
    ]);
  });

  it("keeps the single third-parties node when every third party falls in one cluster", () => {
    const { analysis } = analyze([
      cloudflareLax("https://cdnjs.cloudflare.com/a.js"),
      cloudflareLax("https://cdnjs.cloudflare.com/b.js"),
    ]);

    expect(analysis.thirdPartyClusters).toHaveLength(1);
    const thirdPartyNodes = analysis.nodes.filter((n) => nodeKind(n.id) === "third-parties");
    expect(thirdPartyNodes).toEqual([
      expect.objectContaining({
        id: "third-parties",
        label: "3rd Parties",
        region: "united-states",
      }),
    ]);
    expect(analysis.paths.map((p) => p.id)).toContain("browser-third-parties");
  });

  it("activates every cluster in the third-party step, with a timing per cluster path", () => {
    const { flow, analysis } = analyze(twoProviders());
    const [cloudflare, cloudfront] = analysis.thirdPartyClusters;
    const step = flow.steps.find((s) => s.title === "Third-party requests")!;

    expect(step.activeNodes).toEqual([
      "browser",
      `third-parties:${cloudflare.id}`,
      `third-parties:${cloudfront.id}`,
    ]);
    expect(step.activePaths).toEqual([
      `browser-third-parties:${cloudflare.id}`,
      `browser-third-parties:${cloudfront.id}`,
    ]);
    expect(step.pathTimings).toEqual({
      [`browser-third-parties:${cloudflare.id}`]: "avg 200ms",
      [`browser-third-parties:${cloudfront.id}`]: "avg 50ms",
    });
    // Still one step: the sidebar lists every third-party request, grouped by domain.
    expect(step.resourceRefs).toHaveLength(5);
    expect(flow.steps.filter((s) => s.title === "Third-party requests")).toHaveLength(1);
  });

  it("references only paths and nodes of the page topology in every step", () => {
    const { flow, analysis } = analyze(twoProviders(), { clientRegion: "cn" });
    const nodeIds = new Set(analysis.nodes.map((n) => n.id));
    const pathIds = new Set(analysis.paths.map((p) => p.id));
    for (const step of flow.steps) {
      for (const id of step.activeNodes) expect(nodeIds.has(id), id).toBe(true);
      for (const id of step.activePaths) expect(pathIds.has(id), id).toBe(true);
    }
  });
});

describe("step kinds", () => {
  const kinds = (flow: Flow) => flow.steps.map((s) => s.kind);

  it("tags every page step with a stable kind, in step order", () => {
    const har = makeHar([criticalCss(100), secondaryImage(200), thirdPartyScript(300)]);
    const flow = generateFlow([{ name: "Home", har, trace: makeTrace(150, 400) }]);

    expect(kinds(flow)).toEqual([
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
  });

  it("tags the step that leads to another page as a transition", () => {
    const flow = generateFlow([
      { name: "Home", har: makeHar([criticalCss(100)]) },
      { name: "Docs", har: makeHar([criticalCss(100)]) },
    ]);

    const docs = flow.steps.filter((s) => s.pageIndex === 1);
    expect(docs[0].kind).toBe("transition");
    expect(docs.slice(1).map((s) => s.kind)).not.toContain("transition");
  });

  it("derives the kind from the title for flows that predate it", () => {
    const current = generateFlow([
      { name: "Home", har: loadHar(), trace: loadTrace() },
      { name: "Docs", har: loadHar() },
    ]);
    const legacy = JSON.parse(JSON.stringify(current)) as Flow;
    legacy.version = 4;
    for (const step of legacy.steps) delete (step as Partial<DiagramStep>).kind;

    const normalized = normalizeFlow(legacy);

    expect(kinds(normalized)).toEqual(kinds(current));
  });

  it("falls back to the badge, then to a resource group, for an unknown title", () => {
    expect(stepKindFromTitle("Something else", "lcp")).toBe("lcp");
    expect(stepKindFromTitle("Something else", "onload")).toBe("loaded");
    expect(stepKindFromTitle("Something else")).toBe("secondary");
  });
});

describe("generateFlow — browser cache node", () => {
  const cachedImage = (n: number, fromCache: HarEntry["fromCache"]) =>
    makeSyntheticEntry({
      url: `https://example.com/cached-${n}.png`,
      startTime: 120 + n,
      mimeType: "image/png",
      resourceType: "image",
      priority: "Low",
      fromCache,
    });
  const analyzeEntries = (entries: HarEntry[]) => {
    const flow = generateFlow([{ name: "Page", har: makeHar(entries) }]);
    const step = (kind: DiagramStep["kind"]) => flow.steps.find((s) => s.kind === kind)!;
    return { flow, analysis: flow.pageAnalyses[0], step };
  };

  it("keeps the cache node absent, without a path, when nothing came from the browser cache", () => {
    const { flow, analysis } = analyzeEntries([criticalCss(100), secondaryImage(120)]);

    expect(analysis.nodes.find((n) => n.id === "cache")?.present).toBe(false);
    expect(analysis.paths.map((p) => p.id)).not.toContain("browser-cache");
    for (const step of flow.steps) {
      expect(step.activeNodes).not.toContain("cache");
      expect(step.activePaths).not.toContain("browser-cache");
    }
  });

  it("adds the cache node and its path from the browser when the page used the cache", () => {
    const { analysis } = analyzeEntries([
      criticalCss(100),
      cachedImage(1, "memory"),
      cachedImage(2, "memory"),
    ]);

    expect(analysis.nodes.find((n) => n.id === "cache")).toEqual({
      id: "cache",
      label: "Browser cache",
      subLabel: "memory",
      present: true,
      region: "client",
      resourceStats: { count: 2, label: "from cache" },
    });
    expect(analysis.paths).toContainEqual({ id: "browser-cache", from: "browser", to: "cache" });
    // The cache hits are counted on the cache node only.
    expect(analysis.nodes.find((n) => n.id === "browser")?.resourceStats).toBeUndefined();
  });

  it("names the stores the page read from", () => {
    const subLabel = (entries: HarEntry[]) =>
      analyzeEntries(entries).analysis.nodes.find((n) => n.id === "cache")?.subLabel;

    expect(subLabel([cachedImage(1, "disk")])).toBe("disk");
    expect(subLabel([cachedImage(1, "memory"), cachedImage(2, "disk")])).toBe("memory + disk");
  });

  it("activates the cache hop on the steps that read from the cache", () => {
    const { step } = analyzeEntries([
      criticalCss(100),
      secondaryImage(110),
      cachedImage(1, "memory"),
      cachedImage(2, "memory"),
    ]);
    const secondary = step("secondary");

    expect(secondary.activeNodes).toContain("cache");
    expect(secondary.activePaths).toContain("browser-cache");
    expect(secondary.pathTimings?.["browser-cache"]).toBe("2 from cache");
    expect(secondary.pathDirections?.["browser-cache"]).toBe("response");
    expect(step("critical").activeNodes).not.toContain("cache");
    expect(step("critical").activePaths).not.toContain("browser-cache");
  });

  it("splits the timing by store when a step read from both", () => {
    const { step } = analyzeEntries([
      secondaryImage(110),
      cachedImage(1, "memory"),
      cachedImage(2, "memory"),
      cachedImage(3, "disk"),
    ]);

    expect(step("secondary").pathTimings?.["browser-cache"]).toBe("2 memory · 1 disk");
  });

  it("lights only the cache hop for a step served entirely from the cache", () => {
    const { step } = analyzeEntries([criticalCss(100), cachedImage(1, "memory")]);
    const secondary = step("secondary");

    expect(secondary.activeNodes).toEqual(["browser", "cache"]);
    expect(secondary.activePaths).toEqual(["browser-cache"]);
  });

  it("activates the cache hop on the third-party step for cached third parties", () => {
    const cachedTag = makeSyntheticEntry({
      ...thirdPartyScript(130),
      fromCache: "disk",
    });
    const { step } = analyzeEntries([thirdPartyScript(120), cachedTag]);
    const thirdParty = step("third-party");

    expect(thirdParty.activePaths).toEqual(["browser-third-parties", "browser-cache"]);
    expect(thirdParty.pathTimings?.["browser-cache"]).toBe("1 from cache");
  });

  it("closes the page with the cache hop when the page used the cache", () => {
    const withCache = analyzeEntries([
      criticalCss(100),
      cachedImage(1, "memory"),
      cachedImage(2, "disk"),
    ]);
    const loaded = withCache.step("loaded");

    expect(loaded.activeNodes).toEqual(["browser", "cache"]);
    expect(loaded.activePaths).toEqual(["browser-cache"]);
    expect(loaded.pathTimings).toEqual({ "browser-cache": "1 memory · 1 disk" });
    expect(loaded.pathDirections).toEqual({ "browser-cache": "response" });

    const withoutCache = analyzeEntries([criticalCss(100)]).step("loaded");
    expect(withoutCache.activeNodes).toEqual(["browser"]);
    expect(withoutCache.activePaths).toEqual([]);
  });

  it("reads the recorded warm-cache visit: the secondary step reads its hits from the cache", () => {
    const flow = generateFlow([{ name: "Cache", har: loadRootHar("Cache-20260519T123746") }]);
    const cache = flow.pageAnalyses[0].nodes.find((n) => n.id === "cache")!;
    const secondary = flow.steps.find((s) => s.kind === "secondary")!;

    expect(cache.present).toBe(true);
    expect(cache.resourceStats?.count).toBeGreaterThan(0);
    expect(secondary.activePaths).toContain("browser-cache");
    expect(secondary.pathTimings?.["browser-cache"]).toMatch(
      /^\d+ (from cache|memory · \d+ disk)$/
    );
  });

  it("leaves older flows without the node: normalizeFlow adds nothing", () => {
    const flow = analyzeEntries([cachedImage(1, "memory")]).flow;
    const legacy = JSON.parse(JSON.stringify(flow)) as Flow;
    legacy.pageAnalyses[0].nodes = legacy.pageAnalyses[0].nodes.filter((n) => n.id !== "cache");

    const normalized = normalizeFlow(legacy);

    expect(normalized.pageAnalyses[0].nodes.map((n) => n.id)).not.toContain("cache");
    expect(normalized.version).toBe(FLOW_VERSION);
  });
});

describe("generateFlow — document served by the CDN cache", () => {
  const VERCEL_HIT = { "x-vercel-cache": "HIT", "x-vercel-id": "cdg1::abcde-1779186962459" };
  const VERCEL_MISS = { "x-vercel-cache": "MISS", "x-vercel-id": "cdg1::abcde-1779186962459" };
  const CLOUDFLARE_HIT = { "cf-ray": "8a1b2c3d4e5f-LHR", "cf-cache-status": "HIT" };
  const CLOUDFLARE_MISS = { "cf-ray": "8a1b2c3d4e5f-LHR", "cf-cache-status": "MISS" };

  function flowFor(
    documentHeaders: Record<string, string>,
    entries: HarEntry[] = [],
    options: Parameters<typeof generateFlow>[1] = {}
  ) {
    const har = makeHar(entries);
    har.documentEntry.responseHeaders = documentHeaders;
    const flow = generateFlow([{ name: "Page", har }], options);
    const step = (kind: DiagramStep["kind"]) => flow.steps.find((s) => s.kind === kind)!;
    return { flow, step, origin: flow.nodes.find((n) => n.id === "origin")! };
  }

  it("stops the request and the first byte at the edge on a Vercel HIT", () => {
    const { step } = flowFor(VERCEL_HIT);

    for (const kind of ["request", "ttfb"] as const) {
      expect(step(kind).activeNodes, kind).toEqual(["browser", "edge"]);
      expect(step(kind).activePaths, kind).toEqual(["browser-edge"]);
    }
    expect(step("request").pathDirections).toEqual({ "browser-edge": "request" });
    expect(step("ttfb").pathDirections).toEqual({ "browser-edge": "response" });
    expect(Object.keys(step("ttfb").pathTimings ?? {})).toEqual(["browser-edge"]);
    expect(step("ttfb").description).toContain("edge cache in Paris");
  });

  it("stops at the edge on a Cloudflare HIT too", () => {
    const { step } = flowFor(CLOUDFLARE_HIT);

    expect(step("ttfb").activePaths).toEqual(["browser-edge"]);
    expect(step("ttfb").description).toContain("edge cache in London");
  });

  it("reaches the origin on a MISS", () => {
    for (const headers of [VERCEL_MISS, CLOUDFLARE_MISS]) {
      const { step } = flowFor(headers);

      expect(step("request").activeNodes).toEqual(["browser", "edge", "origin"]);
      expect(step("ttfb").activePaths).toEqual(["browser-edge", "edge-origin"]);
      expect(step("ttfb").pathDirections).toEqual({
        "browser-edge": "response",
        "edge-origin": "response",
      });
      expect(step("ttfb").description).not.toContain("edge cache");
    }
  });

  it("reaches the origin when the cache status is unknown", () => {
    const { step } = flowFor({ "cf-ray": "8a1b2c3d4e5f-LHR" });

    expect(step("ttfb").activePaths).toEqual(["browser-edge", "edge-origin"]);
  });

  it("stops at the edge behind the GFW as well", () => {
    const { step } = flowFor(CLOUDFLARE_HIT, [], { clientRegion: "cn" });

    expect(step("request").activeNodes).toEqual(["browser", "gfw", "edge"]);
    expect(step("request").activePaths).toEqual(["browser-gfw", "gfw-edge"]);
  });

  it("keeps resources that the CDN served at the edge, and shows 0 req on an idle origin", () => {
    const hitCss = makeSyntheticEntry({ ...criticalCss(100), responseHeaders: CLOUDFLARE_HIT });
    const { step, origin } = flowFor(CLOUDFLARE_HIT, [hitCss]);

    expect(step("critical").activeNodes).toEqual(["browser", "edge"]);
    expect(step("critical").activePaths).toEqual(["browser-edge"]);
    expect(origin.present).toBe(true);
    expect(origin.resourceStats).toEqual({ count: 0 });
  });

  it("sends a resource the CDN missed to the origin, which then counts it", () => {
    const missCss = makeSyntheticEntry({ ...criticalCss(100), responseHeaders: CLOUDFLARE_MISS });
    const { step, origin } = flowFor(CLOUDFLARE_HIT, [missCss]);

    expect(step("critical").activePaths).toEqual(["browser-edge", "edge-origin"]);
    expect(origin.resourceStats).toMatchObject({ count: 1, label: "CDN miss" });
  });

  it("gives the origin no stats when only the document reached it", () => {
    const { origin } = flowFor(CLOUDFLARE_MISS);

    expect(origin.resourceStats).toBeUndefined();
  });

  it("stops the Chrome fixture's document at the edge: it is a Vercel HIT", () => {
    const flow = generateFlow([{ name: "Home", har: loadHar() }]);

    expect(loadHar().documentEntry.responseHeaders["x-vercel-cache"]).toBe("HIT");
    expect(flow.steps[1].activePaths).toEqual(["browser-edge"]);
    expect(flow.steps[2].activePaths).toEqual(["browser-edge"]);
  });
});
