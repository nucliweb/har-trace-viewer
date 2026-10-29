import { describe, it, expect } from "vitest";
import { parseHarPages } from "../src/parsers/har-parser.js";
import { firefoxEntry } from "./helpers/firefox-har.js";

const FIRST_VIEW_START = Date.parse("2026-01-01T00:00:00.000Z");

interface ResourceSpec {
  url: string;
  headers?: Record<string, string>;
  method?: string;
  status?: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

function entry(pageref: string, startMs: number, spec: ResourceSpec) {
  const base = firefoxEntry(spec.url, "application/javascript", {
    pageref,
    startedDateTime: iso(startMs),
  });
  return {
    ...base,
    request: { url: spec.url, method: spec.method ?? "GET" },
    response: {
      ...base.response,
      status: spec.status ?? 200,
      headers: Object.entries(spec.headers ?? {}).map(([name, value]) => ({ name, value })),
    },
  };
}

/**
 * A WebPageTest HAR with run 1 (first and repeat view) and, optionally, run 2. The repeat view
 * starts `gapSeconds` after the first view; every view starts with its HTML document.
 */
function wpt({
  first,
  repeat,
  gapSeconds = 60,
  creator = "WebPagetest",
  run2,
}: {
  first: ResourceSpec[];
  repeat: ResourceSpec[];
  gapSeconds?: number;
  creator?: string;
  run2?: { first: ResourceSpec[]; repeat: ResourceSpec[] };
}) {
  const views: { id: string; start: number; resources: ResourceSpec[] }[] = [
    { id: "page_1_0_1", start: FIRST_VIEW_START, resources: first },
    { id: "page_1_1_1", start: FIRST_VIEW_START + gapSeconds * 1000, resources: repeat },
  ];
  if (run2) {
    const start = FIRST_VIEW_START + 3_600_000;
    views.push(
      { id: "page_2_0_1", start, resources: run2.first },
      { id: "page_2_1_1", start: start + gapSeconds * 1000, resources: run2.repeat }
    );
  }
  return {
    log: {
      creator: { name: creator, version: "26.09.01" },
      pages: views.map((v) => ({
        id: v.id,
        title: v.id,
        startedDateTime: iso(v.start),
        pageTimings: { onContentLoad: 100, onLoad: 200 },
      })),
      entries: views.flatMap((v) => [
        {
          ...firefoxEntry("https://example.com/", "text/html", { pageref: v.id }),
          startedDateTime: iso(v.start),
        },
        ...v.resources.map((r, i) => entry(v.id, v.start + 10 * (i + 1), r)),
      ]),
    },
  };
}

const longLived = (url: string): ResourceSpec => ({
  url,
  headers: { "Cache-Control": "public, max-age=86400" },
});

const repeatView = (raw: ReturnType<typeof wpt>) => parseHarPages(raw)[1];

describe("parseHarPages — WebPageTest repeat view cache inference", () => {
  it("infers a browser-cache hit for a fresh first-view resource the repeat view never requested", () => {
    const hits = repeatView(
      wpt({ first: [longLived("https://example.com/app.js")], repeat: [] })
    ).inferredCacheHits;

    expect(hits).toEqual([
      {
        url: "https://example.com/app.js",
        resourceType: "script",
        transferSize: 1500,
        lifetime: 86400,
      },
    ]);
  });

  it("does not infer a hit for a resource the repeat view requested again", () => {
    const raw = wpt({
      first: [longLived("https://example.com/app.js")],
      repeat: [{ ...longLived("https://example.com/app.js"), status: 304 }],
    });

    expect(repeatView(raw).inferredCacheHits).toEqual([]);
  });

  it("matches the full URL, query string included", () => {
    const raw = wpt({
      first: [longLived("https://example.com/app.js?v=1")],
      repeat: [longLived("https://example.com/app.js?v=2")],
    });

    expect(repeatView(raw).inferredCacheHits?.map((h) => h.url)).toEqual([
      "https://example.com/app.js?v=1",
    ]);
  });

  it("skips resources the browser may not reuse without asking", () => {
    const raw = wpt({
      first: [
        { url: "https://example.com/no-store.js", headers: { "cache-control": "no-store" } },
        {
          url: "https://example.com/no-cache.js",
          headers: { "cache-control": "no-cache, max-age=600" },
        },
        { url: "https://example.com/zero.js", headers: { "cache-control": "max-age=0" } },
        { url: "https://example.com/bare.js" },
      ],
      repeat: [],
    });

    expect(repeatView(raw).inferredCacheHits).toEqual([]);
  });

  it("skips resources whose lifetime ran out before the repeat view started", () => {
    const raw = wpt({
      first: [
        { url: "https://example.com/short.js", headers: { "cache-control": "max-age=120" } },
        {
          url: "https://example.com/aged.js",
          headers: { "cache-control": "max-age=600", age: "590" },
        },
      ],
      repeat: [],
      gapSeconds: 385,
    });

    expect(repeatView(raw).inferredCacheHits).toEqual([]);
  });

  it("reads the lifetime from Expires, else from Last-Modified as browsers do", () => {
    const date = "Thu, 01 Jan 2026 00:00:00 GMT";
    const raw = wpt({
      first: [
        {
          url: "https://example.com/expires.js",
          headers: { date, expires: "Thu, 01 Jan 2026 01:00:00 GMT" },
        },
        {
          url: "https://example.com/heuristic.js",
          headers: { date, "last-modified": "Thu, 01 Dec 2025 00:00:00 GMT" },
        },
      ],
      repeat: [],
    });

    expect(repeatView(raw).inferredCacheHits?.map((h) => [h.url, h.lifetime])).toEqual([
      ["https://example.com/expires.js", 3600],
      ["https://example.com/heuristic.js", 267840],
    ]);
  });

  it("only infers hits for successful GET responses", () => {
    const raw = wpt({
      first: [
        { ...longLived("https://example.com/beacon"), method: "POST" },
        { ...longLived("https://example.com/missing.js"), status: 404 },
      ],
      repeat: [],
    });

    expect(repeatView(raw).inferredCacheHits).toEqual([]);
  });

  it("pairs each repeat view with the first view of its own run", () => {
    const raw = wpt({
      first: [longLived("https://example.com/run1.js")],
      repeat: [],
      run2: { first: [longLived("https://example.com/run2.js")], repeat: [] },
    });
    const pages = parseHarPages(raw);

    expect(pages[3].inferredCacheHits?.map((h) => h.url)).toEqual(["https://example.com/run2.js"]);
  });

  it("leaves first views and HARs from other tools without inferred hits", () => {
    const fromWpt = parseHarPages(
      wpt({ first: [longLived("https://example.com/a.js")], repeat: [] })
    );
    const fromChrome = parseHarPages(
      wpt({ first: [longLived("https://example.com/a.js")], repeat: [], creator: "WebInspector" })
    );

    expect(fromWpt[0].inferredCacheHits).toBeUndefined();
    expect(fromChrome[1].inferredCacheHits).toBeUndefined();
  });
});
