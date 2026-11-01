import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import {
  detectCdnCacheStatus,
  profileResourceCache,
  analyzeCacheForHar,
} from "../src/inference/cache-analyzer.js";
import type { HarEntry, InferredCacheHit } from "../src/types.js";
import { makeEntry, makeHar as makeSyntheticHar } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const harPath = join(__dirname, "fixtures/webperf-snippets.har.fixture.json");

function loadHar() {
  return parseHarJson(readFileSync(harPath, "utf8"));
}

describe("detectCdnCacheStatus", () => {
  it("detects HIT from x-vercel-cache", () => {
    expect(detectCdnCacheStatus({ "x-vercel-cache": "HIT" })).toBe("hit");
  });

  it("detects MISS from x-vercel-cache", () => {
    expect(detectCdnCacheStatus({ "x-vercel-cache": "MISS" })).toBe("miss");
  });

  it("detects STALE from x-vercel-cache", () => {
    expect(detectCdnCacheStatus({ "x-vercel-cache": "STALE" })).toBe("stale");
  });

  it("detects BYPASS from x-vercel-cache", () => {
    expect(detectCdnCacheStatus({ "x-vercel-cache": "BYPASS" })).toBe("bypass");
  });

  it("detects HIT from cf-cache-status", () => {
    expect(detectCdnCacheStatus({ "cf-cache-status": "HIT" })).toBe("hit");
  });

  it("detects MISS from cf-cache-status", () => {
    expect(detectCdnCacheStatus({ "cf-cache-status": "MISS" })).toBe("miss");
  });

  it("detects stale from cf-cache-status EXPIRED", () => {
    expect(detectCdnCacheStatus({ "cf-cache-status": "EXPIRED" })).toBe("stale");
  });

  it("detects bypass from cf-cache-status DYNAMIC", () => {
    expect(detectCdnCacheStatus({ "cf-cache-status": "DYNAMIC" })).toBe("bypass");
  });

  it("detects HIT from x-cache (CloudFront style)", () => {
    expect(detectCdnCacheStatus({ "x-cache": "Hit from cloudfront" })).toBe("hit");
  });

  it("detects MISS from x-cache", () => {
    expect(detectCdnCacheStatus({ "x-cache": "Miss from cloudfront" })).toBe("miss");
  });

  it("detects HIT from x-cache-status", () => {
    expect(detectCdnCacheStatus({ "x-cache-status": "HIT" })).toBe("hit");
  });

  it("returns unknown when no recognisable CDN header is present", () => {
    expect(detectCdnCacheStatus({ server: "nginx" })).toBe("unknown");
  });

  it("returns unknown for empty headers", () => {
    expect(detectCdnCacheStatus({})).toBe("unknown");
  });
});

describe("detectCdnCacheStatus per provider header", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["x-vercel-cache HIT", { "x-vercel-cache": "HIT" }, "hit"],
    ["x-vercel-cache MISS", { "x-vercel-cache": "MISS" }, "miss"],
    ["x-vercel-cache STALE", { "x-vercel-cache": "STALE" }, "stale"],
    ["x-vercel-cache PRERENDER", { "x-vercel-cache": "PRERENDER" }, "hit"],
    ["x-vercel-cache REVALIDATED", { "x-vercel-cache": "REVALIDATED" }, "stale"],
    ["cf-cache-status HIT", { "cf-cache-status": "HIT" }, "hit"],
    ["cdn-cache HIT", { "cdn-cache": "HIT" }, "hit"],
    ["cdn-cache MISS", { "cdn-cache": "MISS" }, "miss"],
    ["cdn-cache EXPIRED", { "cdn-cache": "EXPIRED" }, "stale"],
    ["cdn-cache BYPASS", { "cdn-cache": "BYPASS" }, "bypass"],
    ["x-cache TCP_HIT", { "x-cache": "TCP_HIT from a23-1-2-3" }, "hit"],
    ["x-cache TCP_MISS", { "x-cache": "TCP_MISS from a23-1-2-3" }, "miss"],
    ["x-cache TCP_REFRESH_HIT", { "x-cache": "TCP_REFRESH_HIT" }, "stale"],
    ["x-cache TCP_REFRESH_MISS", { "x-cache": "TCP_REFRESH_MISS" }, "miss"],
    ["x-cache Hit from cloudfront", { "x-cache": "Hit from cloudfront" }, "hit"],
    ["x-cache RefreshHit from cloudfront", { "x-cache": "RefreshHit from cloudfront" }, "stale"],
    ["x-cache Error from cloudfront", { "x-cache": "Error from cloudfront" }, "unknown"],
    ["x-cache multi tier, last wins", { "x-cache": "HIT, MISS" }, "miss"],
    ["x-cache-remote TCP_HIT", { "x-cache-remote": "TCP_HIT from a1" }, "hit"],
    ["x-cache-remote TCP_MISS", { "x-cache-remote": "TCP_MISS from a1" }, "miss"],
    [
      "x-cache wins over x-cache-remote",
      { "x-cache": "TCP_HIT", "x-cache-remote": "TCP_MISS" },
      "hit",
    ],
    ["x-cache-status HIT", { "x-cache-status": "HIT" }, "hit"],
  ];

  it.each(cases)("%s", (_label, headers, expected) => {
    expect(detectCdnCacheStatus(headers)).toBe(expected);
  });
});

describe("detectCdnCacheStatus Cache-Status (RFC 9211)", () => {
  const cases: [string, string, string][] = [
    ["hit", '"Netlify Edge"; hit', "hit"],
    ["fwd=miss", '"Netlify Edge"; fwd=miss', "miss"],
    ["fwd=uri-miss", "Edge; fwd=uri-miss", "miss"],
    ["fwd=stale; stored", '"Netlify Edge"; fwd=stale; stored', "stale"],
    ["fwd=bypass", "Edge; fwd=bypass", "bypass"],
    ["last member wins", 'OriginCache; hit, "Netlify Edge"; fwd=miss; stored', "miss"],
    ["last member with hit/fwd wins", 'Edge; hit, "Origin"; ttl=60', "hit"],
    ["quoted comma is not a separator", '"Edge, EU"; hit', "hit"],
    ["hit=?1 boolean", "Edge; hit=?1", "hit"],
    ["no hit/fwd", "Edge; detail=thing", "unknown"],
  ];

  it.each(cases)("%s", (_label, value, expected) => {
    expect(detectCdnCacheStatus({ "cache-status": value })).toBe(expected);
  });
});

describe("profileResourceCache", () => {
  it("parses max-age from cache-control", () => {
    const p = profileResourceCache({ "cache-control": "public, max-age=31536000, immutable" });
    expect(p.maxAge).toBe(31536000);
  });

  it("parses max-age=0", () => {
    const p = profileResourceCache({ "cache-control": "public, max-age=0, must-revalidate" });
    expect(p.maxAge).toBe(0);
  });

  it("returns null maxAge when cache-control is absent", () => {
    const p = profileResourceCache({});
    expect(p.maxAge).toBeNull();
  });

  it("detects immutable directive", () => {
    const p = profileResourceCache({ "cache-control": "public, max-age=31536000, immutable" });
    expect(p.immutable).toBe(true);
  });

  it("detects must-revalidate", () => {
    const p = profileResourceCache({ "cache-control": "public, max-age=0, must-revalidate" });
    expect(p.mustRevalidate).toBe(true);
  });

  it("detects no-store", () => {
    const p = profileResourceCache({ "cache-control": "no-store, no-cache" });
    expect(p.noStore).toBe(true);
  });

  it("parses Age header", () => {
    const p = profileResourceCache({ "cache-control": "public, max-age=0", age: "468968" });
    expect(p.age).toBe(468968);
  });

  it("returns null age when Age header absent", () => {
    const p = profileResourceCache({ "cache-control": "public, max-age=3600" });
    expect(p.age).toBeNull();
  });

  it("sets cdnStatus from x-vercel-cache", () => {
    const p = profileResourceCache({
      "x-vercel-cache": "HIT",
      "cache-control": "public, max-age=0",
    });
    expect(p.cdnStatus).toBe("hit");
  });
});

describe("analyzeCacheForHar — fixture", () => {
  it("document CDN status is hit (x-vercel-cache: HIT in fixture)", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.document.cdnStatus).toBe("hit");
  });

  it("document max-age is 0 (must-revalidate pattern)", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.document.maxAge).toBe(0);
    expect(report.document.mustRevalidate).toBe(true);
  });

  it("document age is parsed from Age header", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.document.age).toBeGreaterThan(0);
  });

  it("own resources CDN hits > 0", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.ownResources.cdnHits).toBeGreaterThan(0);
  });

  it("own resources CDN hit ratio is high (fixture has all HITs)", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.ownResources.cdnHitRatio).toBeGreaterThan(0.8);
  });

  it("own resources immutable count > 0", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.ownResources.immutableCount).toBeGreaterThan(0);
  });

  it("browser cache hits are zero (fixture has no _fromCache entries)", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.browser.fromDisk).toBe(0);
    expect(report.browser.fromMemory).toBe(0);
    expect(report.browser.hitRatio).toBe(0);
  });

  it("generates at least one recommendation", () => {
    const report = analyzeCacheForHar(loadHar());
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it("reports the CDN hit with its evidence instead of a revalidation note", () => {
    const report = analyzeCacheForHar(loadHar());
    const labels = report.recommendations.map((r) => r.label);
    const rec = report.recommendations.find((r) => r.label === "Document served from CDN");

    expect(labels.some((label) => label.toLowerCase().includes("revalidat"))).toBe(false);
    expect(rec?.severity).toBe("good");
    expect(rec?.description).toContain("x-vercel-cache: HIT");
    expect(rec?.description).toMatch(/Age \d/);
  });

  it("includes good recommendation for long-term immutable static assets", () => {
    const report = analyzeCacheForHar(loadHar());
    const rec = report.recommendations.find(
      (r) => r.severity === "good" && r.label.toLowerCase().includes("long-term")
    );
    expect(rec).toBeDefined();
  });

  it("says nothing about browser cache hits on a first view", () => {
    const report = analyzeCacheForHar(loadHar());
    const labels = report.recommendations.map((r) => r.label.toLowerCase());

    expect(labels.some((label) => label.includes("browser cache"))).toBe(false);
  });
});

describe("analyzeCacheForHar — synthetic scenarios", () => {
  function makeEntry(
    url: string,
    headers: Record<string, string>,
    fromCache: "disk" | "memory" | false = false
  ) {
    return {
      url,
      startTime: 0,
      duration: 50,
      timing: { dns: 0, connect: 0, ssl: 0, send: 1, wait: 10, receive: 5, blocked: 0 },
      ttfb: 10,
      status: 200,
      mimeType: "text/css",
      resourceType: "stylesheet" as const,
      priority: "High" as const,
      responseHeaders: headers,
      transferSize: 1024,
      bodySize: 1024,
      isDocument: false,
      fromCache,
    };
  }

  function makeHar(docHeaders: Record<string, string>, ownEntries: ReturnType<typeof makeEntry>[]) {
    const doc = {
      ...makeEntry("https://example.com/", docHeaders, false),
      mimeType: "text/html",
      isDocument: true,
      resourceType: "document" as const,
    };
    return {
      pages: [{ id: "p1", title: "Example", onContentLoad: 300, onLoad: 500 }],
      entries: [doc, ...ownEntries],
      documentEntry: doc,
      preconnectHints: {} as Record<string, "link-header" | "early-hints">,
    };
  }

  it("CDN miss on document generates warning recommendation", () => {
    const har = makeHar({ "x-vercel-cache": "MISS", "cache-control": "public, max-age=0" }, []);
    const report = analyzeCacheForHar(har);
    const rec = report.recommendations.find(
      (r) => r.severity === "warning" && r.label.includes("CDN miss")
    );
    expect(rec).toBeDefined();
  });

  it("CDN bypass on document generates warning recommendation", () => {
    const har = makeHar({ "x-vercel-cache": "BYPASS", "cache-control": "public, max-age=0" }, []);
    const report = analyzeCacheForHar(har);
    const rec = report.recommendations.find(
      (r) => r.severity === "warning" && r.label.includes("bypassed")
    );
    expect(rec).toBeDefined();
  });

  it("no-store on a document that looks static suggests caching it at the CDN", () => {
    const har = makeHar({ "cache-control": "no-store" }, []);
    const report = analyzeCacheForHar(har);
    const rec = report.recommendations.find((r) => r.label === "Document not cached");

    expect(rec?.severity).toBe("warning");
    expect(rec?.description).toContain("s-maxage");
    expect(rec?.description).toContain("stale-while-revalidate");
    expect(rec?.description).not.toContain("must-revalidate");
    expect(report.recommendations.some((r) => r.severity === "critical")).toBe(false);
  });

  it("high browser cache hit ratio generates good recommendation", () => {
    const entries = [
      makeEntry("https://example.com/a.css", {}, "disk"),
      makeEntry("https://example.com/b.css", {}, "disk"),
      makeEntry("https://example.com/c.css", {}, "memory"),
      makeEntry("https://example.com/d.css", {}, false),
    ];
    const har = makeHar({ "cache-control": "public, max-age=0" }, entries);
    const report = analyzeCacheForHar(har);
    expect(report.browser.hitRatio).toBeCloseTo(0.75, 2);
    const rec = report.recommendations.find(
      (r) => r.severity === "good" && r.label.toLowerCase().includes("browser")
    );
    expect(rec).toBeDefined();
  });

  it("low immutable ratio generates warning recommendation", () => {
    const entries = [
      makeEntry("https://example.com/a.css", { "cache-control": "public, max-age=3600" }),
      makeEntry("https://example.com/b.css", { "cache-control": "public, max-age=3600" }),
      makeEntry("https://example.com/c.css", { "cache-control": "public, max-age=3600" }),
    ];
    const har = makeHar({ "cache-control": "public, max-age=0" }, entries);
    const report = analyzeCacheForHar(har);
    const rec = report.recommendations.find(
      (r) => r.severity === "warning" && r.label.toLowerCase().includes("longer ttl")
    );
    expect(rec).toBeDefined();
  });

  it("excludes third-party entries from own resource counts", () => {
    const ownEntry = makeEntry("https://example.com/a.css", {
      "cache-control": "public, max-age=31536000, immutable",
      "x-vercel-cache": "HIT",
    });
    const thirdPartyEntry = makeEntry("https://cdn.external.com/lib.js", {
      "cache-control": "public, max-age=86400",
      "cf-cache-status": "HIT",
    });
    const har = makeHar({ "cache-control": "public, max-age=0" }, [ownEntry, thirdPartyEntry]);
    const report = analyzeCacheForHar(har);
    expect(report.ownResources.total).toBe(1);
    expect(report.ownResources.cdnHits).toBe(1);
  });

  it("leaves browser-cache hits out of the CDN hit ratio", () => {
    const immutableHit = {
      "cache-control": "public, max-age=31536000, immutable",
      "x-vercel-cache": "HIT",
    };
    const har = makeHar({ "cache-control": "public, max-age=0" }, [
      makeEntry("https://example.com/a.css", immutableHit, "disk"),
      makeEntry("https://example.com/b.css", immutableHit, "disk"),
      makeEntry("https://example.com/c.css", immutableHit, "memory"),
      makeEntry("https://example.com/d.css", immutableHit),
      makeEntry("https://example.com/e.css", { "x-vercel-cache": "MISS" }),
    ]);
    const { ownResources } = analyzeCacheForHar(har);

    expect(ownResources.network).toBe(2);
    expect(ownResources.cdnHits).toBe(1);
    expect(ownResources.cdnHitRatio).toBe(0.5);
    // Cache-Control still describes the cached copies: immutability counts every own resource.
    expect(ownResources.total).toBe(5);
    expect(ownResources.immutableRatio).toBe(0.8);
  });

  it("makes no CDN claim when the browser cache served every own resource", () => {
    const hit = { "cache-control": "public, max-age=31536000, immutable", "x-vercel-cache": "HIT" };
    const har = makeHar({ "cache-control": "public, max-age=0" }, [
      makeEntry("https://example.com/a.css", hit, "disk"),
      makeEntry("https://example.com/b.css", hit, "disk"),
    ]);
    const report = analyzeCacheForHar(har);

    expect(report.ownResources).toMatchObject({ network: 0, cdnHits: 0, cdnHitRatio: 0 });
    expect(report.recommendations.map((r) => r.label)).not.toContain(
      "CDN cache effective for static assets"
    );
  });
});

describe("analyzeCacheForHar — WebPageTest inferred cache hits", () => {
  const inferred = (url: string): InferredCacheHit => ({
    url,
    resourceType: "script",
    transferSize: 5000,
    lifetime: 86400,
  });

  it("counts inferred hits as browser-cache hits among the resources the page used", () => {
    const har = {
      ...makeSyntheticHar([makeEntry(), makeEntry({ url: "https://example.com/b.css" })]),
      inferredCacheHits: [
        inferred("https://example.com/a.js"),
        inferred("https://example.com/c.js"),
      ],
    };
    const { browser } = analyzeCacheForHar(har);

    expect(browser.inferred).toBe(2);
    expect(browser.total).toBe(4);
    expect(browser.hitRatio).toBe(0.5);
  });

  it("says the hits are inferred from the WebPageTest first view", () => {
    const har = {
      ...makeSyntheticHar([makeEntry()]),
      inferredCacheHits: [inferred("https://example.com/a.js")],
    };
    const labels = analyzeCacheForHar(har).recommendations.map((r) => r.label);

    expect(labels).toContain("Browser cache hits inferred from WebPageTest");
    expect(labels).not.toContain("No browser cache hits");
  });

  it("reports no inferred hits for HARs that list cache hits themselves", () => {
    expect(analyzeCacheForHar(makeSyntheticHar([makeEntry()])).browser.inferred).toBe(0);
  });
});

describe("analyzeCacheForHar — revalidations", () => {
  it("counts 304 responses as revalidated, not as cache hits", () => {
    const har = makeSyntheticHar([
      makeEntry({ status: 304 }),
      makeEntry({ status: 304, url: "https://example.com/b.css" }),
      makeEntry(),
    ]);
    const { browser, recommendations } = analyzeCacheForHar(har);

    expect(browser.revalidated).toBe(2);
    expect(browser.hitRatio).toBe(0);
    expect(recommendations.find((r) => r.label === "2 resources revalidated (304)")).toMatchObject({
      severity: "info",
    });
  });
});

describe("analyzeCacheForHar — versioned assets that cannot be cached", () => {
  const asset = (
    url: string,
    cacheControl: string,
    transferSize = 1000,
    headers: Record<string, string> = {}
  ) =>
    makeEntry({
      url,
      transferSize,
      responseHeaders: { "cache-control": cacheControl, ...headers },
    });

  const recommendation = (label: string, entries: ReturnType<typeof makeEntry>[]) =>
    analyzeCacheForHar(makeSyntheticHar(entries)).recommendations.find((r) => r.label === label);

  const finding = (entries: ReturnType<typeof makeEntry>[]) =>
    recommendation("Versioned assets are not cached", entries);

  const revalidating = (entries: ReturnType<typeof makeEntry>[]) =>
    recommendation("Versioned assets revalidate on every use", entries);

  it("lists versioned assets served with no-store as critical, biggest first", () => {
    const rec = finding([
      asset(
        "https://example.com/app/chunk-47TTPNLV.js",
        "no-cache, no-store, must-revalidate",
        20000
      ),
      asset("https://example.com/static/main.3f2a9c1b.js", "max-age=0", 50000),
      asset("https://example.com/assets/index-BkD3x9_a.js", "no-store", 1000),
    ]);

    expect(rec?.severity).toBe("critical");
    expect(rec?.resources).toEqual([
      {
        url: "https://example.com/app/chunk-47TTPNLV.js",
        transferSize: 20000,
        cacheControl: "no-cache, no-store, must-revalidate",
      },
      {
        url: "https://example.com/assets/index-BkD3x9_a.js",
        transferSize: 1000,
        cacheControl: "no-store",
      },
    ]);
    expect(rec?.description).toContain("2 versioned assets");
    expect(rec?.description).toContain("max-age=31536000, immutable");
  });

  it.each([
    "https://example.com/static/main.3f2a9c1b.js",
    "https://example.com/static/main.3f2a9c1b.chunk.js",
    "https://example.com/app/chunk-47TTPNLV.js",
    "https://example.com/app/styles-VC4FUF6G.css",
    "https://example.com/assets/index-BkD3x9_a.js",
    "https://example.com/img/logo_a1b2c3d4e5.png",
    "https://example.com/fonts/inter.8f3c2a1d9e.woff2",
    "https://example.com/lib.js?v=1.2.3",
    "https://example.com/theme.css?ver=6.4.2",
    "https://example.com/app.js?hash=9f8e7d6c",
  ])("treats %s as versioned", (url) => {
    expect(finding([asset(url, "no-store")])?.resources?.map((r) => r.url)).toEqual([url]);
  });

  it.each([
    "https://example.com/img/hero-1920x1080.jpg",
    "https://example.com/img/banner_1200x630.webp",
    "https://example.com/js/widget-v20240115.js",
    "https://example.com/build-20260101.js",
    "https://example.com/jquery-3.6.1.min.js",
    "https://example.com/js/app-v2.13.10.js",
    "https://example.com/bootstrap-datepicker.js",
    "https://example.com/theme/nuance-c2c-button.css",
    "https://example.com/app.js",
    "https://example.com/app.js?utm_source=newsletter",
    "https://example.com/api/data?v=2",
  ])("does not treat %s as versioned", (url) => {
    expect(finding([asset(url, "no-store")])).toBeUndefined();
  });

  it("ignores versioned assets with a lifetime", () => {
    expect(
      finding([
        asset("https://example.com/chunk-47TTPNLV.js", "public, max-age=31536000, immutable"),
      ])
    ).toBeUndefined();
  });

  it("ignores the document, cache hits and failed responses", () => {
    expect(
      finding([
        { ...asset("https://example.com/chunk-47TTPNLV.js", "no-store"), fromCache: "disk" },
        { ...asset("https://example.com/chunk-Q4K72MKY.js", "no-store"), status: 404 },
      ])
    ).toBeUndefined();
  });

  it("classifies no-cache and max-age=0 as revalidating, not as downloaded on every visit", () => {
    const entries = [
      asset("https://example.com/static/main.3f2a9c1b.js", "max-age=0", 50000, { etag: '"a1"' }),
      asset("https://example.com/app/styles-VC4FUF6G.css", "no-cache", 30000, {
        "last-modified": "Tue, 19 May 2026 10:00:00 GMT",
      }),
    ];
    const report = analyzeCacheForHar(makeSyntheticHar(entries));
    const rec = revalidating(entries);

    expect(finding(entries)).toBeUndefined();
    expect(report.recommendations.some((r) => r.severity === "critical")).toBe(false);
    expect(rec?.severity).toBe("warning");
    expect(rec?.resources?.map((r) => r.url)).toEqual([
      "https://example.com/static/main.3f2a9c1b.js",
      "https://example.com/app/styles-VC4FUF6G.css",
    ]);
    expect(rec?.description).toContain("2 versioned assets");
    expect(rec?.description).toContain("304");
    expect(rec?.description).toContain("max-age=31536000, immutable");
    expect(rec?.description).not.toContain("ETag or Last-Modified");
  });

  it("names the revalidating assets that have no ETag or Last-Modified", () => {
    const rec = revalidating([
      asset("https://example.com/static/main.3f2a9c1b.js", "no-cache", 1000, { etag: '"a1"' }),
      asset("https://example.com/app/chunk-47TTPNLV.js", "max-age=0"),
    ]);

    expect(rec?.description).toContain("1 of them has no ETag or Last-Modified");
  });

  it("counts a single asset in the singular", () => {
    const notCached = finding([asset("https://example.com/lib.js?v=1.2.3", "no-store")]);
    const revalidated = revalidating([asset("https://example.com/main.3f2a9c1b.js", "no-cache")]);

    expect(notCached?.description).toContain("1 versioned asset is served with no-store");
    expect(revalidated?.description).toContain("1 versioned asset is served with no-cache");
    expect(revalidated?.description).toContain("whether it changed");
  });
});

describe("analyzeCacheForHar — personalized documents", () => {
  const PRIVATE_MISS = { "cache-control": "private, max-age=0", "x-vercel-cache": "MISS" };

  const document = (overrides: Partial<ReturnType<typeof makeEntry>>) => {
    const har = makeSyntheticHar([]);
    const documentEntry = { ...har.documentEntry, ...overrides };
    return { ...har, entries: [documentEntry], documentEntry };
  };

  it.each([
    ["Set-Cookie", { setsCookie: true }, { "cache-control": "no-store" }],
    ["Authorization", { sendsAuthorization: true }, { "cache-control": "no-store" }],
    ["Vary: Cookie", {}, { "cache-control": "no-store", vary: "Accept-Encoding, Cookie" }],
    ["Set-Cookie with private", { setsCookie: true }, PRIVATE_MISS],
  ] as [string, Pick<HarEntry, "setsCookie" | "sendsAuthorization">, Record<string, string>][])(
    "accepts no-store or private on a document with %s",
    (_signal, flags, headers) => {
      const { recommendations } = analyzeCacheForHar(
        document({ ...flags, responseHeaders: headers })
      );
      const rec = recommendations.find((r) => r.label === "Personalized document not cached");

      expect(rec?.severity).toBe("info");
      expect(
        recommendations.filter((r) => r.severity === "critical" || r.severity === "warning")
      ).toEqual([]);
    }
  );
});

describe("analyzeCacheForHar — document served from the CDN", () => {
  const document = (headers: Record<string, string>) => {
    const har = makeSyntheticHar([]);
    const documentEntry = { ...har.documentEntry, ttfb: 49, responseHeaders: headers };
    return { ...har, entries: [documentEntry], documentEntry };
  };

  const REVALIDATE = "public, max-age=0, must-revalidate";

  it.each([
    ["x-vercel-cache", { "x-vercel-cache": "HIT", age: "468968" }, "x-vercel-cache: HIT"],
    ["cf-cache-status", { "cf-cache-status": "HIT" }, "cf-cache-status: HIT"],
    ["x-cache", { "x-cache": "Hit from cloudfront" }, "x-cache: Hit from cloudfront"],
    ["Age alone", { age: "3600" }, "Age 1 h"],
  ])("reports the CDN hit from %s instead of a revalidation note", (_name, headers, evidence) => {
    const { recommendations } = analyzeCacheForHar(
      document({ "cache-control": REVALIDATE, ...headers })
    );
    const rec = recommendations.find((r) => r.label === "Document served from CDN");

    expect(rec?.severity).toBe("good");
    expect(rec?.description).toContain(evidence);
    expect(rec?.description).toContain("TTFB 49 ms");
    expect(recommendations.map((r) => r.label)).not.toContain(
      "Document revalidates on every request"
    );
  });

  it("gives the Age in days for a document cached days ago", () => {
    const { recommendations } = analyzeCacheForHar(
      document({ "cache-control": REVALIDATE, "x-vercel-cache": "HIT", age: "468968" })
    );

    expect(
      recommendations.find((r) => r.label === "Document served from CDN")?.description
    ).toContain("Age 5.4 d");
  });

  it("keeps the revalidation note when no CDN reports a hit", () => {
    const { recommendations } = analyzeCacheForHar(document({ "cache-control": REVALIDATE }));

    expect(
      recommendations.find((r) => r.label === "Document revalidates on every request")?.severity
    ).toBe("info");
  });
});

describe("analyzeCacheForHar — no browser cache hits", () => {
  const label = "No browser cache hits";
  const labels = (har: ReturnType<typeof makeSyntheticHar>) =>
    analyzeCacheForHar(har).recommendations.map((r) => r.label);

  it("stays quiet on a first view", () => {
    expect(labels(makeSyntheticHar([makeEntry()]))).not.toContain(label);
  });

  it("warns on a WebPageTest repeat view that reused nothing", () => {
    const har = { ...makeSyntheticHar([makeEntry()]), inferredCacheHits: [] };
    const rec = analyzeCacheForHar(har).recommendations.find((r) => r.label === label);

    expect(rec?.severity).toBe("warning");
  });

  it("warns when the browser revalidated resources but reused none", () => {
    expect(labels(makeSyntheticHar([makeEntry({ status: 304 })]))).toContain(label);
  });
});
