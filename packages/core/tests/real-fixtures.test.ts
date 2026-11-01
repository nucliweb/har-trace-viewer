import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  analyzeHops,
  detectPop,
  generateFlow,
  parseHarJson,
  parseHarPagesJson,
  type PageFlow,
} from "../src/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));
const text = (name: string) => fixture(name).toString("utf8");

describe("wpt-first-repeat.har.fixture.json (WebPageTest, 2 runs x first + repeat view)", () => {
  const pages = parseHarPagesJson(text("wpt-first-repeat.har.fixture.json"));
  const [run1First, run1Repeat, run2First, run2Repeat] = pages;

  it("splits into one page per view, in WebPageTest's id scheme", () => {
    expect(pages.map((p) => p.pages[0].id)).toEqual([
      "page_1_0_1",
      "page_1_1_1",
      "page_2_0_1",
      "page_2_1_1",
    ]);
    expect(pages.map((p) => p.entries.length)).toEqual([10, 5, 10, 5]);
    expect(pages.every((p) => p.pages[0].onContentLoad !== null && p.pages[0].onLoad !== null)).toBe(
      true
    );
  });

  it("reads the main document of every view", () => {
    for (const page of pages) {
      expect(page.documentEntry.url).toBe("https://www.example.org/");
      expect(page.documentEntry.httpVersion).toBe("h2");
    }
  });

  it("sizes responses from bodySize and headersSize, and a 304 as headers alone", () => {
    const css = run1Repeat.entries.find((e) => e.url.endsWith("theme.css"))!;
    expect(css.status).toBe(304);
    expect(css.transferSize).toBe(290);
    const vendor = run1First.entries.find((e) => e.url.endsWith("vendor.js"))!;
    expect(vendor.transferSize).toBe(31800 + 290);
  });

  it("infers browser-cache hits only for repeat views", () => {
    expect(run1First.inferredCacheHits).toBeUndefined();
    expect(run2First.inferredCacheHits).toBeUndefined();

    for (const repeat of [run1Repeat, run2Repeat]) {
      expect(repeat.inferredCacheHits?.map((h) => h.url.split("/").pop())).toEqual([
        "vendor.js",
        "app.js",
        "logo.svg",
        "hero.jpg",
        "inter.woff2",
        "collect.js",
      ]);
    }
    const lifetimes = run1Repeat.inferredCacheHits!.map((h) => h.lifetime);
    expect(lifetimes).toEqual([3600, 31536000, 86400, 604800, 31536000, 1800]);
  });

  it("does not infer hits for resources the repeat view revalidated or the server forbids storing", () => {
    const inferred = run1Repeat.inferredCacheHits!.map((h) => h.url);
    expect(inferred.some((u) => u.endsWith("theme.css"))).toBe(false);
    expect(inferred.some((u) => u.endsWith("config.json"))).toBe(false);
    expect(inferred.some((u) => u.endsWith("pixel.gif"))).toBe(false);
  });

  it("pairs each repeat view with the first view of its own run", () => {
    // Run 2 is slower, so its repeat view starts later but infers from run 2's first view.
    expect(run2Repeat.inferredCacheHits).toHaveLength(6);
    expect(run2First.entries[0].startTime).toBe(0);
  });

  it("builds a flow with one analysis per view and counts the inferred hits", () => {
    const flow = generateFlow(
      pages.map((har): PageFlow => ({ name: har.pages[0].id, har }))
    );
    expect(flow.pageAnalyses).toHaveLength(4);
    expect(flow.pageAnalyses[1].cacheReport.browser.inferred).toBe(6);
    expect(flow.pageAnalyses[0].cacheReport.browser.inferred).toBe(0);
  });
});

describe("firefox.har.fixture.json (Firefox DevTools export)", () => {
  const har = parseHarJson(text("firefox.har.fixture.json"));
  const byUrl = (suffix: string) => har.entries.find((e) => e.url.endsWith(suffix))!;

  it("parses 12 entries and the page timings Firefox records", () => {
    expect(har.entries).toHaveLength(12);
    expect(har.pages[0]).toMatchObject({ id: "page_1", onContentLoad: 640, onLoad: 1710 });
    expect(har.documentEntry.url).toBe("https://www.example.net/");
  });

  it("falls back to bodySize + headersSize for the transfer size", () => {
    expect(har.documentEntry.transferSize).toBe(5400 + 410);
    expect(byUrl("app.js").transferSize).toBe(17800 + 340);
    expect(byUrl("hero.webp").transferSize).toBe(88000 + 300);
  });

  it("counts a 304 as headers only and a cache.beforeRequest entry as a cache hit", () => {
    expect(byUrl("team.png")).toMatchObject({ status: 304, transferSize: 260, fromCache: false });
    expect(byUrl("banner.jpg")).toMatchObject({ transferSize: 0, fromCache: "disk" });
  });

  it("does not treat cache.afterRequest as a cache hit", () => {
    expect(byUrl("team.png").fromCache).toBe(false);
  });

  it("has no Chrome extras and infers resource type from mime or extension", () => {
    expect(har.entries.every((e) => e.priority === undefined && e.initiator === undefined)).toBe(
      true
    );
    expect(byUrl("site.css").resourceType).toBe("stylesheet");
    expect(byUrl("app.js").resourceType).toBe("script");
    expect(byUrl("user.json").resourceType).toBe("fetch");
    expect(byUrl("hero.webp").resourceType).toBe("image");
    // Empty mime type: the extension decides.
    expect(byUrl("body.woff2").resourceType).toBe("font");
    // application/octet-stream and no extension: nothing to go on.
    expect(byUrl("sprite").resourceType).toBe("other");
  });

  it("reads HTTP/2, content encoding and connection reuse from the standard fields", () => {
    expect(har.entries.every((e) => e.httpVersion === "h2")).toBe(true);
    expect(har.documentEntry.contentEncoding).toBe("br");
    expect(byUrl("site.css").contentEncoding).toBe("gzip");
    expect(byUrl("hero.webp").contentEncoding).toBe("none");
  });

  it("marks timing phases Firefox reports as -1 as not applicable and clamps them to zero", () => {
    const css = byUrl("site.css");
    expect(css.timing).toMatchObject({ dns: 0, connect: 0, ssl: 0, wait: 45, receive: 11 });
    expect(css.timing.notApplicable).toEqual(["dns", "connect", "ssl"]);
    expect(har.documentEntry.timing.notApplicable).toBeUndefined();
    expect(har.documentEntry.ttfb).toBe(120);
  });

  it("builds a flow from it", () => {
    const flow = generateFlow([{ name: "Firefox", har }]);
    expect(flow.pageAnalyses).toHaveLength(1);
    expect(flow.steps.length).toBeGreaterThan(0);
  });
});

describe("multi-cdn.har.fixture.json (Cloudflare, Fastly and Akamai on one page)", () => {
  const har = parseHarJson(text("multi-cdn.har.fixture.json"));
  const hops = analyzeHops(har, har.documentEntry.url);
  const hop = (host: string) => hops.find((h) => h.host === host)!;

  it("parses 15 entries over six hosts", () => {
    expect(har.entries).toHaveLength(15);
    expect(hops.map((h) => h.host).sort()).toEqual([
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "images.shopexample.com",
      "static.shopexample.com",
      "widgets.reviewly.io",
      "www.shopexample.com",
    ]);
  });

  it("detects Cloudflare on the document host and reads the PoP from cf-ray", () => {
    expect(hop("www.shopexample.com")).toMatchObject({
      provider: "cloudflare",
      party: "first",
      pop: { code: "fra", city: "Frankfurt", region: "europe" },
    });
  });

  it("detects Fastly on the static host and takes the node closest to the client as PoP", () => {
    expect(hop("static.shopexample.com")).toMatchObject({
      provider: "fastly",
      requests: 4,
      pop: { code: "mad", city: "Madrid", region: "europe" },
      cacheHits: 4,
      hitRatio: 1,
    });
  });

  it("detects Akamai on the image host, which exposes no PoP, and counts its cache miss", () => {
    expect(hop("images.shopexample.com")).toMatchObject({
      provider: "akamai",
      requests: 4,
      pop: null,
      cacheHits: 3,
      cacheMisses: 1,
    });
    expect(detectPop(har.entries.find((e) => e.url.includes("hero.webp"))!.responseHeaders)).toBe(
      null
    );
  });

  it("detects Google Front End for the fonts and no CDN for the third-party widget", () => {
    expect(hop("fonts.googleapis.com").provider).toBe("gfe");
    expect(hop("fonts.gstatic.com")).toMatchObject({ provider: "gfe", requests: 2 });
    expect(hop("widgets.reviewly.io")).toMatchObject({ provider: "origin", party: "third" });
  });

  it("keeps the CDN identification headers and drops the rest", () => {
    const doc = har.documentEntry.responseHeaders;
    expect(doc["cf-ray"]).toBe("8f1c2b3a4d5e6f70-FRA");
    expect(doc["cf-cache-status"]).toBe("DYNAMIC");
    const img = har.entries.find((e) => e.url.includes("hero.webp"))!;
    expect(img.serverTiming).toEqual([
      { name: "cdn-cache", desc: "HIT" },
      { name: "edge", dur: 2 },
      { name: "origin", dur: 0 },
    ]);
    expect(img.responseHeaders["x-akamai-transformed"]).toBeDefined();
  });

  it("reads HTTP/3 and HTTP/2 per host", () => {
    expect(hop("www.shopexample.com").protocol).toBe("h3");
    expect(hop("static.shopexample.com").protocol).toBe("h2");
    expect(har.documentEntry.advertisesHttp3).toBe(true);
  });
});

describe("large.har.fixture.json.gz (1500 generated entries)", () => {
  const json = gunzipSync(fixture("large.har.fixture.json.gz")).toString("utf8");

  it("parses every entry and keeps the document first", () => {
    const har = parseHarJson(json);
    expect(har.entries).toHaveLength(1500);
    expect(har.entries.filter((e) => e.isDocument)).toHaveLength(1);
    expect(har.documentEntry.url).toBe("https://www.bigsite.example/");
    expect(new Set(har.entries.map((e) => new URL(e.url).hostname)).size).toBe(40);
  });

  it("builds a flow in under 2 seconds", () => {
    const har = parseHarJson(json);
    const started = performance.now();
    const flow = generateFlow([{ name: "Big site", har }]);
    const elapsed = performance.now() - started;

    expect(flow.pages[0].har.entries).toHaveLength(1500);
    expect(flow.pageAnalyses).toHaveLength(1);
    expect(flow.steps.length).toBeGreaterThan(0);
    expect(flow.pageAnalyses[0].cacheReport.browser.total).toBe(1499);
    expect(flow.pageAnalyses[0].networkReport.errors).toHaveLength(15);
    expect(elapsed).toBeLessThan(2000);
  });
});
