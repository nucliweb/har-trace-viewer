import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHar, parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { FLOW_VERSION, generateFlow, normalizeFlow } from "../src/steps/step-generator.js";
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

    expect(FLOW_VERSION).toBe(3);
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
        } as InlineStep,
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
