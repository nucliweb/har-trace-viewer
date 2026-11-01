import { describe, expect, it } from "vitest";
import { buildWaterfall, filterWaterfallRows, waterfallAxisMs } from "../src/analysis/waterfall.js";
import type { ParsedTrace } from "../src/types.js";
import { makeEntry, makeHar, makeTrace } from "./helpers/synthetic-har.js";

const css = makeEntry({
  url: "https://example.com/css/main.css?v=3",
  startTime: 120,
  duration: 40,
  timing: { blocked: 2, dns: 0, connect: 0, ssl: 0, send: 1, wait: 30, receive: 7 },
  priority: "VeryHigh",
  initiator: { type: "parser", url: "https://example.com/" },
});
const hero = makeEntry({
  url: "https://img.example.com/hero.avif",
  startTime: 200,
  duration: 80,
  resourceType: "image",
  mimeType: "image/avif",
  priority: "High",
  transferSize: 48_000,
});
const tag = makeEntry({
  url: "https://cdn.third.com/tag.js",
  startTime: 150,
  duration: 120,
  resourceType: "script",
  mimeType: "application/javascript",
  priority: "Low",
  // A new connection: dns, then connect, whose last 30 ms are the TLS handshake.
  timing: { blocked: 5, dns: 10, connect: 50, ssl: 30, send: 1, wait: 40, receive: 14 },
});

describe("buildWaterfall", () => {
  it("lists every request sorted by start, the document first", () => {
    const waterfall = buildWaterfall(makeHar([hero, css, tag]), undefined);

    expect(waterfall.rows.map((r) => r.url)).toEqual([
      "https://example.com/",
      "https://example.com/css/main.css?v=3",
      "https://cdn.third.com/tag.js",
      "https://img.example.com/hero.avif",
    ]);
  });

  it("keeps the recording order of requests that start at the same time", () => {
    const first = makeEntry({ url: "https://example.com/a.js", startTime: 100 });
    const second = makeEntry({ url: "https://example.com/b.js", startTime: 100 });
    const rows = buildWaterfall(makeHar([first, second]), undefined).rows;

    expect(rows.map((r) => r.shortName)).toEqual(["example.com", "a.js", "b.js"]);
  });

  it("describes each request: short name, host, party, type, status, size and priority", () => {
    const rows = buildWaterfall(makeHar([css, hero, tag]), undefined).rows;
    const byUrl = (url: string) => rows.find((r) => r.url === url)!;

    expect(byUrl(css.url)).toMatchObject({
      shortName: "main.css?v=3",
      host: "example.com",
      party: "first",
      resourceType: "stylesheet",
      status: 200,
      transferSize: 1024,
      priority: "VeryHigh",
      fromCache: false,
    });
    // A subdomain of the document's registrable domain is first party.
    expect(byUrl(hero.url)).toMatchObject({ host: "img.example.com", party: "first" });
    expect(byUrl(tag.url)).toMatchObject({ host: "cdn.third.com", party: "third" });
  });

  it("splits each request into consecutive phases, TLS apart from the TCP connection", () => {
    const row = buildWaterfall(makeHar([tag]), undefined).rows.find((r) => r.url === tag.url)!;

    expect(row.startMs).toBe(150);
    expect(row.endMs).toBe(270);
    expect(row.phases).toEqual({
      blocked: 5,
      dns: 10,
      connect: 20,
      ssl: 30,
      send: 1,
      wait: 40,
      receive: 14,
    });
  });

  it("gives null for the phases the HAR marks as not applicable", () => {
    const reused = makeEntry({
      url: "https://example.com/reused.js",
      timing: {
        blocked: 1,
        dns: 0,
        connect: 0,
        ssl: 0,
        send: 1,
        wait: 10,
        receive: 3,
        notApplicable: ["dns", "connect", "ssl"],
      },
    });
    const row = buildWaterfall(makeHar([reused]), undefined).rows[1];

    expect(row.phases).toEqual({
      blocked: 1,
      dns: null,
      connect: null,
      ssl: null,
      send: 1,
      wait: 10,
      receive: 3,
    });
  });

  it("ends a request at its duration, or at its phases when they add up to more", () => {
    const short = makeEntry({
      url: "https://example.com/short.js",
      startTime: 100,
      duration: 5,
      timing: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 1, wait: 10, receive: 4 },
    });
    const row = buildWaterfall(makeHar([short]), undefined).rows[1];

    expect(row.endMs).toBe(115);
  });

  it("flags browser-cache hits", () => {
    const cached = makeEntry({ url: "https://example.com/cached.css", fromCache: "memory" });
    const row = buildWaterfall(makeHar([cached]), undefined).rows[1];

    expect(row.fromCache).toBe("memory");
  });

  it("keeps the redirects the navigation followed, with where they point", () => {
    const redirect = makeEntry({
      url: "http://example.com/",
      startTime: -60,
      duration: 50,
      status: 301,
      resourceType: "document",
      mimeType: "",
      redirectURL: "https://example.com/",
      transferSize: 0,
    });
    const rows = buildWaterfall(makeHar([redirect]), undefined).rows;

    expect(rows[0]).toMatchObject({
      url: "http://example.com/",
      status: 301,
      redirectURL: "https://example.com/",
    });
    expect(rows[1].url).toBe("https://example.com/");
  });

  it("badges the LCP resource and the render-blocking requests from the trace", () => {
    const trace: ParsedTrace = {
      ...makeTrace(300, 450),
      lcpCandidate: { timeMs: 450, type: "image", url: hero.url },
      requests: [
        { url: css.url, resourceType: "Stylesheet", renderBlocking: "blocking", sentAtMs: 110 },
        { url: hero.url, resourceType: "Image", renderBlocking: "non_blocking", sentAtMs: 190 },
      ],
    };
    const rows = buildWaterfall(makeHar([css, hero, tag]), trace).rows;
    const byUrl = (url: string) => rows.find((r) => r.url === url)!;

    expect(byUrl(css.url).renderBlocking).toBe(true);
    expect(byUrl(hero.url).renderBlocking).toBeFalsy();
    expect(byUrl(hero.url).isLcpResource).toBe(true);
    expect(byUrl(css.url).isLcpResource).toBeFalsy();
  });

  it("infers the render-blocking requests from the HAR without a trace", () => {
    const rows = buildWaterfall(makeHar([css, hero]), undefined).rows;

    expect(rows.find((r) => r.url === css.url)!.renderBlocking).toBe(true);
    expect(rows.find((r) => r.url === hero.url)!.renderBlocking).toBeFalsy();
  });

  it("marks the document's first byte, the paints and the page events", () => {
    const waterfall = buildWaterfall(
      makeHar([css], { onContentLoad: 300, onLoad: 520 }),
      makeTrace(250, 410)
    );

    // The document: dns 10 + connect 20 + send 1 + wait 50.
    expect(waterfall.marks).toEqual({ ttfb: 81, fcp: 250, lcp: 410, dcl: 300, onLoad: 520 });
  });

  it("leaves the marks the recording lacks as null", () => {
    const waterfall = buildWaterfall(
      makeHar([css], { onContentLoad: null, onLoad: null }),
      undefined
    );

    expect(waterfall.marks).toMatchObject({ fcp: null, lcp: null, dcl: null, onLoad: null });
    expect(waterfall.marks.ttfb).toBe(81);
  });

  it("spans the axis to the last request end or the last mark", () => {
    expect(buildWaterfall(makeHar([tag], { onContentLoad: 100, onLoad: 200 })).totalMs).toBe(270);
    expect(buildWaterfall(makeHar([tag], { onContentLoad: 100, onLoad: 900 })).totalMs).toBe(900);
  });

  it("filters by type, party, host and URL text, keeping the axis of the whole page", () => {
    const har = makeHar([css, hero, tag], { onContentLoad: 100, onLoad: 200 });
    const urls = (filter: Parameters<typeof buildWaterfall>[2]) =>
      buildWaterfall(har, undefined, filter).rows.map((r) => r.url);

    expect(urls({ filter: { types: ["image", "script"] } })).toEqual([tag.url, hero.url]);
    expect(urls({ filter: { party: "third" } })).toEqual([tag.url]);
    expect(urls({ filter: { host: "img.example.com" } })).toEqual([hero.url]);
    expect(urls({ filter: { search: "MAIN.CSS" } })).toEqual([css.url]);
    expect(urls({ filter: { party: "first", search: "example" } })).toEqual([
      "https://example.com/",
      css.url,
      hero.url,
    ]);
    expect(buildWaterfall(har, undefined, { filter: { party: "third" } }).totalMs).toBe(280);
  });

  it("filters rows already built", () => {
    const { rows } = buildWaterfall(makeHar([css, hero, tag]));

    expect(filterWaterfallRows(rows, { types: ["stylesheet"] }).map((r) => r.url)).toEqual([
      css.url,
    ]);
    expect(filterWaterfallRows(rows, {})).toHaveLength(4);
  });

  it("ends the axis at the recording's end, or at the last page mark to zoom on the load", () => {
    const late = makeEntry({ url: "https://example.com/beacon", startTime: 9_000, duration: 20 });
    const waterfall = buildWaterfall(
      makeHar([css, late], { onContentLoad: 300, onLoad: 520 }),
      makeTrace(250, 610)
    );

    expect(waterfallAxisMs(waterfall, "end")).toBe(9_020);
    // The LCP comes after onLoad here: the axis keeps it.
    expect(waterfallAxisMs(waterfall, "load")).toBe(610);
  });

  it("builds the waterfall of 10 000 requests quickly", () => {
    const entries = Array.from({ length: 10_000 }, (_, i) =>
      makeEntry({
        url: `https://${i % 2 ? "cdn.third.com" : "example.com"}/asset-${i}.js`,
        startTime: (i * 7919) % 5000,
        initiator: { type: "parser", url: "https://example.com/" },
        resourceType: "script",
        priority: "High",
      })
    );
    const har = makeHar(entries);
    const started = performance.now();
    const waterfall = buildWaterfall(har, undefined);
    const elapsed = performance.now() - started;

    expect(waterfall.rows).toHaveLength(10_001);
    expect(elapsed).toBeLessThan(500);
  });
});
