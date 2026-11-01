import { describe, it, expect } from "vitest";
import { analyzeHops, summarizeHops } from "../src/analysis/hops.js";
import type { HarEntry, ParsedHar } from "../src/types.js";

function entry(
  url: string,
  over: Omit<Partial<HarEntry>, "timing"> & { timing?: Partial<HarEntry["timing"]> } = {}
): HarEntry {
  const { timing, ...rest } = over;
  return {
    url,
    startTime: 0,
    duration: 100,
    timing: { dns: 0, connect: 0, ssl: 0, send: 0, wait: 50, receive: 0, blocked: 0, ...timing },
    ttfb: 50,
    status: 200,
    mimeType: "text/plain",
    resourceType: "other",
    responseHeaders: {},
    transferSize: 1000,
    bodySize: 1000,
    isDocument: false,
    fromCache: false,
    ...rest,
  } as HarEntry;
}

function har(entries: HarEntry[]): ParsedHar {
  return { pages: [], entries, documentEntry: entries[0], preconnectHints: {} };
}

const DOC = "https://www.example.com/";

describe("analyzeHops", () => {
  it("emits one entry per hostname sorted by requests desc", () => {
    const hops = analyzeHops(
      har([
        entry(DOC, { isDocument: true }),
        entry("https://cdn.other.net/a.js"),
        entry("https://cdn.other.net/b.js"),
      ]),
      DOC
    );
    expect(hops.map((h) => [h.host, h.requests])).toEqual([
      ["cdn.other.net", 2],
      ["www.example.com", 1],
    ]);
  });

  it("classifies first and third party by root domain", () => {
    const hops = analyzeHops(
      har([entry(DOC), entry("https://static.example.com/a.css"), entry("https://t.other.net/x")]),
      DOC
    );
    const party = Object.fromEntries(hops.map((h) => [h.host, h.party]));
    expect(party).toEqual({
      "www.example.com": "first",
      "static.example.com": "first",
      "t.other.net": "third",
    });
  });

  it("picks the provider by majority vote and falls back to origin", () => {
    const cf = { "cf-ray": "abc-LAX" };
    const fastly = { "x-served-by": "cache-lhr123-LHR", "x-timer": "S1,VS0" };
    const hops = analyzeHops(
      har([
        entry("https://a.net/1", { responseHeaders: fastly }),
        entry("https://a.net/2", { responseHeaders: cf }),
        entry("https://a.net/3", { responseHeaders: cf }),
        entry("https://b.net/1"),
      ]),
      DOC
    );
    const a = hops.find((h) => h.host === "a.net")!;
    expect(a.provider).toBe("cloudflare");
    expect(a.providerName).toBe("Cloudflare");
    const b = hops.find((h) => h.host === "b.net")!;
    expect(b.provider).toBe("origin");
    expect(b.pop).toBeNull();
  });

  it("ignores entries without CDN headers when voting", () => {
    const hops = analyzeHops(
      har([
        entry("https://a.net/1"),
        entry("https://a.net/2"),
        entry("https://a.net/3", { responseHeaders: { "x-akamai-transformed": "9 - 0" } }),
      ]),
      DOC
    );
    expect(hops[0].provider).toBe("akamai");
  });

  it("breaks ties by first seen", () => {
    const hops = analyzeHops(
      har([
        entry("https://a.net/1", { responseHeaders: { "cf-ray": "abc-SIN" } }),
        entry("https://a.net/2", { responseHeaders: { "x-amz-cf-pop": "FRA56-C1" } }),
      ]),
      DOC
    );
    expect(hops[0].provider).toBe("cloudflare");
  });

  it("reads the PoP from cf-ray and x-amz-cf-pop", () => {
    const hops = analyzeHops(
      har([
        entry("https://cf.net/1", { responseHeaders: { "cf-ray": "abc-LAX" } }),
        entry("https://aws.net/1", {
          responseHeaders: { "x-amz-cf-pop": "FRA56-C1", "x-cache": "Hit from cloudfront" },
        }),
      ]),
      DOC
    );
    const by = Object.fromEntries(hops.map((h) => [h.host, h]));
    expect(by["cf.net"].pop).toEqual({ code: "lax", city: "Los Angeles", region: "united-states" });
    expect(by["aws.net"].pop).toEqual({ code: "fra", city: "Frankfurt", region: "europe" });
    expect(by["aws.net"].provider).toBe("cloudfront");
  });

  it("has a null PoP for Akamai", () => {
    const hops = analyzeHops(
      har([
        entry("https://a.net/1", {
          responseHeaders: { "x-akamai-transformed": "9 - 0 pmb=mRUM,1" },
        }),
      ]),
      DOC
    );
    expect(hops[0].provider).toBe("akamai");
    expect(hops[0].pop).toBeNull();
  });

  it("computes hits, misses and hit ratio", () => {
    const hit = { "cf-ray": "a-LAX", "cf-cache-status": "HIT" };
    const miss = { "cf-ray": "a-LAX", "cf-cache-status": "MISS" };
    const hops = analyzeHops(
      har([
        entry("https://a.net/1", { responseHeaders: hit }),
        entry("https://a.net/2", { responseHeaders: hit }),
        entry("https://a.net/3", { responseHeaders: hit }),
        entry("https://a.net/4", { responseHeaders: miss }),
        entry("https://b.net/1"),
      ]),
      DOC
    );
    const a = hops.find((h) => h.host === "a.net")!;
    expect([a.cacheHits, a.cacheMisses, a.hitRatio]).toEqual([3, 1, 0.75]);
    expect(hops.find((h) => h.host === "b.net")!.hitRatio).toBe(0);
  });

  it("takes connection timings from the first entry with a handshake", () => {
    const hops = analyzeHops(
      har([
        entry("https://a.net/1"),
        entry("https://a.net/2", { timing: { dns: 663, connect: 454, ssl: 300 } }),
        entry("https://a.net/3", { timing: { dns: 10, connect: 20, ssl: 30 } }),
        entry("https://b.net/1"),
      ]),
      DOC
    );
    expect(hops.find((h) => h.host === "a.net")!.connection).toEqual({
      dns: 663,
      connect: 154,
      ssl: 300,
    });
    expect(hops.find((h) => h.host === "b.net")!.connection).toBeNull();
  });

  it("reports TCP apart from TLS, which HAR counts inside connect", () => {
    const hops = analyzeHops(
      har([
        entry("https://data.other.net/", { timing: { dns: 0.04, connect: 25.62, ssl: 25.075 } }),
        entry("http://plain.other.net/", { timing: { dns: 3, connect: 12, ssl: 0 } }),
      ]),
      DOC
    );
    const connection = (host: string) => hops.find((h) => h.host === host)!.connection!;
    expect(connection("data.other.net").connect).toBeCloseTo(0.545, 3);
    expect(connection("data.other.net").ssl).toBeCloseTo(25.075, 3);
    expect(connection("plain.other.net")).toEqual({ dns: 3, connect: 12, ssl: 0 });
  });

  it("counts browser-cache hits apart from the requests that reached the host", () => {
    const hit = { "cf-ray": "a-LAX", "cf-cache-status": "HIT" };
    const miss = { "cf-ray": "a-LAX", "cf-cache-status": "MISS" };
    const hops = analyzeHops(
      har([
        entry("https://a.net/1", { ttfb: 100, transferSize: 500, responseHeaders: hit }),
        entry("https://a.net/2", { ttfb: 300, transferSize: 700, responseHeaders: miss }),
        entry("https://a.net/3", {
          ttfb: 1,
          transferSize: 0,
          responseHeaders: hit,
          fromCache: "disk",
        }),
        entry("https://a.net/4", {
          ttfb: 0,
          transferSize: 0,
          responseHeaders: hit,
          fromCache: "memory",
        }),
      ]),
      DOC
    );

    expect(hops[0]).toMatchObject({
      requests: 2,
      browserCacheHits: 2,
      bytes: 1200,
      avgTtfbMs: 200,
      cacheHits: 1,
      cacheMisses: 1,
      hitRatio: 0.5,
      fromBrowserCache: true,
    });
  });

  it("keeps a host served only from the browser cache, without a TTFB", () => {
    const hops = analyzeHops(
      har([
        entry("https://a.net/1"),
        entry("https://c.net/1", { fromCache: "disk", responseHeaders: { "cf-ray": "a-LAX" } }),
      ]),
      DOC
    );

    expect(hops.find((h) => h.host === "c.net")).toMatchObject({
      requests: 0,
      browserCacheHits: 1,
      avgTtfbMs: null,
      provider: "cloudflare",
    });
    expect(hops.map((h) => h.host)).toEqual(["a.net", "c.net"]);
  });
});

describe("summarizeHops", () => {
  it("groups hosts and requests by provider and region", () => {
    const cf = { "cf-ray": "a-LAX" };
    const hops = analyzeHops(
      har([
        entry("https://a.net/1", { responseHeaders: cf }),
        entry("https://a.net/2", { responseHeaders: cf }),
        entry("https://b.net/1", { responseHeaders: { "cf-ray": "a-SIN" } }),
        entry("https://c.net/1"),
      ]),
      DOC
    );
    const summary = summarizeHops(hops);
    expect(summary.providers).toEqual([
      { providerName: "Cloudflare", hosts: 2, requests: 3 },
      { providerName: "Origin Server", hosts: 1, requests: 1 },
    ]);
    expect(summary.regions).toEqual([
      { region: "united-states", hosts: 1, requests: 2 },
      { region: "asia-pacific", hosts: 1, requests: 1 },
    ]);
  });
});
