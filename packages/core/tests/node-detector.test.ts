import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  detectCdnPopCity,
  detectCdnRegion,
  detectNode,
  hasThirdParties,
  suggestClientRegion,
} from "../src/inference/node-detector.js";
import { detectPop } from "../src/inference/pops.js";
import { parseHarJson } from "../src/parsers/har-parser.js";
import type { CdnProvider, HarEntry, ParsedHar } from "../src/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const harFixturePath = join(__dirname, "fixtures/webperf-snippets.har.fixture.json");

describe("detectNode", () => {
  it("detects Akamai from x-akamai-transformed header", () => {
    const result = detectNode({ "x-akamai-transformed": "9 - 0 pmb=mRUM" });

    expect(result.cdnProvider).toBe("akamai");
    expect(result.type).toBe("edge");
    expect(result.name).toBe("Akamai Edge");
  });

  it("detects Cloudflare from cf-ray header", () => {
    const result = detectNode({ "cf-ray": "abc123-LHR" });

    expect(result.cdnProvider).toBe("cloudflare");
    expect(result.type).toBe("edge");
  });

  it("detects Fastly from x-fastly-request-id header", () => {
    const result = detectNode({ "x-fastly-request-id": "abc" });

    expect(result.cdnProvider).toBe("fastly");
    expect(result.type).toBe("edge");
  });

  it("detects CloudFront from x-amz-cf-pop header", () => {
    const result = detectNode({ "x-amz-cf-pop": "IAD89-C1" });

    expect(result.cdnProvider).toBe("cloudfront");
    expect(result.type).toBe("edge");
  });

  it("detects Google GFE from server header", () => {
    const result = detectNode({ server: "Google Frontend" });

    expect(result.cdnProvider).toBe("gfe");
    expect(result.type).toBe("edge");
  });

  it("detects Google GFE from via header", () => {
    const result = detectNode({ via: "1.1 google" });

    expect(result.cdnProvider).toBe("gfe");
    expect(result.type).toBe("edge");
  });

  it("returns origin when no CDN headers present", () => {
    const result = detectNode({ "content-type": "text/html" });

    expect(result.cdnProvider).toBe("unknown");
    expect(result.type).toBe("origin");
    expect(result.name).toBe("Origin Server");
  });

  it("detects a Vercel edge for the webperf-snippets document", () => {
    const json = readFileSync(harFixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    const result = detectNode(documentEntry.responseHeaders);

    expect(result).toEqual({ type: "edge", name: "Vercel Edge", cdnProvider: "vercel" });
    expect(detectPop(documentEntry.responseHeaders)).toMatchObject({
      code: "cdg",
      city: "Paris",
      provider: "vercel",
    });
  });
});

describe("detectNode providers", () => {
  // One case per provider/header. Order matters: the most specific header wins.
  const cases: [string, Record<string, string>, CdnProvider, string][] = [
    ["x-vercel-id", { "x-vercel-id": "fra1::abc" }, "vercel", "Vercel Edge"],
    ["x-vercel-cache", { "x-vercel-cache": "HIT" }, "vercel", "Vercel Edge"],
    ["x-nf-request-id", { "x-nf-request-id": "01H" }, "netlify", "Netlify Edge"],
    ["x-azure-ref", { "x-azure-ref": "2024" }, "azure-front-door", "Azure Front Door"],
    ["x-fd-*", { "x-fd-healthprobe": "1" }, "azure-front-door", "Azure Front Door"],
    ["cdn-cache", { "cdn-cache": "HIT" }, "bunny", "Bunny CDN"],
    ["server: BunnyCDN", { server: "BunnyCDN-DE1-1234" }, "bunny", "Bunny CDN"],
    [
      "x-edge-location + keycdn-engine",
      { "x-edge-location": "defr", server: "keycdn-engine" },
      "keycdn",
      "KeyCDN",
    ],
    ["x-akamai-transformed", { "x-akamai-transformed": "9 - 0" }, "akamai", "Akamai Edge"],
    ["server: AkamaiNetStorage", { server: "AkamaiNetStorage" }, "akamai", "Akamai Edge"],
    ["cf-ray", { "cf-ray": "a51d5608791cf7dd-LAX" }, "cloudflare", "Cloudflare"],
    ["server: cloudflare", { server: "cloudflare" }, "cloudflare", "Cloudflare"],
    ["x-fastly-request-id", { "x-fastly-request-id": "a" }, "fastly", "Fastly CDN"],
    ["x-served-by: cache-", { "x-served-by": "cache-fra-eddf-FRA" }, "fastly", "Fastly CDN"],
    ["x-amz-cf-pop", { "x-amz-cf-pop": "FRA56-P14" }, "cloudfront", "CloudFront"],
    ["x-cache: cloudfront", { "x-cache": "Hit from cloudfront" }, "cloudfront", "CloudFront"],
    [
      "via google + x-goog-*",
      { via: "1.1 google", "x-goog-generation": "1" },
      "google-cloud-cdn",
      "Google Cloud CDN",
    ],
    [
      "via google + cache-status",
      { via: "1.1 google", "cache-status": '"Google"; hit' },
      "google-cloud-cdn",
      "Google Cloud CDN",
    ],
    ["server: Google Frontend", { server: "Google Frontend" }, "gfe", "Google"],
    ["via google alone", { via: "1.1 google" }, "gfe", "Google"],
  ];

  it.each(cases)("detects %s", (_label, headers, provider, name) => {
    expect(detectNode(headers)).toEqual({ type: "edge", name, cdnProvider: provider });
  });

  it("does not treat generic servers as CDNs", () => {
    for (const server of ["UploadServer", "envoy", "nginx"]) {
      expect(detectNode({ server }).type).toBe("origin");
    }
  });

  it("prefers the most specific header when several providers are present", () => {
    expect(detectNode({ "x-vercel-id": "a", "cf-ray": "b-LAX" }).cdnProvider).toBe("vercel");
    expect(detectNode({ "cf-ray": "b-LAX", "x-amz-cf-pop": "FRA1" }).cdnProvider).toBe(
      "cloudflare"
    );
    expect(detectNode({ "x-amz-cf-pop": "FRA1", via: "1.1 google" }).cdnProvider).toBe(
      "cloudfront"
    );
  });
});

function latencyHar(documentDnsMs: number, connectMs: number[]): ParsedHar {
  const entries: HarEntry[] = connectMs.map((connect, i) => ({
    url: i === 0 ? "https://example.com/" : `https://example.com/${i}.js`,
    startTime: 0,
    duration: 100,
    timing: {
      dns: i === 0 ? documentDnsMs : 0,
      connect,
      ssl: 0,
      send: 1,
      wait: 20,
      receive: 5,
      blocked: 0,
    },
    ttfb: 20,
    status: 200,
    mimeType: i === 0 ? "text/html" : "application/javascript",
    resourceType: i === 0 ? "document" : "script",
    responseHeaders: {},
    transferSize: 1000,
    bodySize: 1000,
    isDocument: i === 0,
    fromCache: false,
  }));
  return {
    pages: [{ id: "p1", title: "Example", onContentLoad: 100, onLoad: 200 }],
    entries,
    documentEntry: entries[0],
    preconnectHints: {},
  };
}

describe("suggestClientRegion", () => {
  it("suggests cn on high document DNS (> 80ms) and explains why", () => {
    const suggestion = suggestClientRegion(latencyHar(169, [0]));

    expect(suggestion?.region).toBe("cn");
    expect(suggestion?.reason).toContain("DNS");
    expect(suggestion?.reason).toContain("169ms");
  });

  it("suggests cn on high max TCP connect (> 300ms) even with cached DNS", () => {
    const suggestion = suggestClientRegion(latencyHar(0, [0, 419]));

    expect(suggestion?.region).toBe("cn");
    expect(suggestion?.reason).toContain("TCP connect");
    expect(suggestion?.reason).toContain("419ms");
  });

  it("does not suggest anything for cached local connections", () => {
    expect(suggestClientRegion(latencyHar(0, [0]))).toBeNull();
  });

  it("does not suggest anything for moderate cross-continent latency (< 300ms)", () => {
    expect(suggestClientRegion(latencyHar(0, [150]))).toBeNull();
  });

  it("ignores the -1 'not applicable' timings of reused connections", () => {
    expect(suggestClientRegion(latencyHar(-1, [-1, -1]))).toBeNull();
  });
});

describe("detectCdnRegion", () => {
  it("maps Cloudflare HKG PoP to asia-pacific", () => {
    expect(detectCdnRegion({ "cf-ray": "abc123-HKG" })).toBe("asia-pacific");
  });

  it("maps Cloudflare LHR PoP to europe", () => {
    expect(detectCdnRegion({ "cf-ray": "abc123-LHR" })).toBe("europe");
  });

  it("maps Cloudflare IAD PoP to united-states", () => {
    expect(detectCdnRegion({ "cf-ray": "abc123-IAD" })).toBe("united-states");
  });

  it("maps CloudFront NRT PoP to asia-pacific", () => {
    expect(detectCdnRegion({ "x-amz-cf-pop": "NRT57-P1" })).toBe("asia-pacific");
  });

  it("maps PoPs of every other region", () => {
    expect(detectCdnRegion({ "cf-ray": "abc-GRU" })).toBe("south-america");
    expect(detectCdnRegion({ "cf-ray": "abc-JNB" })).toBe("africa");
    expect(detectCdnRegion({ "cf-ray": "abc-DXB" })).toBe("middle-east");
    expect(detectCdnRegion({ "cf-ray": "abc-YYZ" })).toBe("north-america");
    expect(detectCdnRegion({ "cf-ray": "abc-SYD" })).toBe("asia-pacific");
  });

  it("maps the PoP of Vercel, Fastly and KeyCDN", () => {
    expect(detectCdnRegion({ "x-vercel-id": "iad1::abc" })).toBe("united-states");
    expect(detectCdnRegion({ "x-served-by": "cache-nrt-rjtf-NRT" })).toBe("asia-pacific");
    expect(detectCdnRegion({ "x-edge-location": "defr" })).toBe("europe");
  });

  it("returns the fallback when PoP is unknown", () => {
    expect(detectCdnRegion({ "cf-ray": "abc123-XYZ" }, "edge")).toBe("edge");
  });

  it("returns default fallback (edge) when no PoP headers present", () => {
    expect(detectCdnRegion({})).toBe("edge");
  });
});

describe("detectCdnPopCity", () => {
  it("returns the city of the detected PoP", () => {
    expect(detectCdnPopCity({ "cf-ray": "a-LAX" }, "cloudflare", false)).toBe("Los Angeles");
    expect(detectCdnPopCity({ "x-vercel-id": "cdg1::a" }, "vercel", false)).toBe("Paris");
    expect(detectCdnPopCity({ "x-amz-cf-pop": "FRA56-P14" }, "cloudfront", false)).toBe(
      "Frankfurt"
    );
  });

  it("falls back to Hong Kong for Akamai behind the GFW and null otherwise", () => {
    expect(detectCdnPopCity({}, "akamai", true)).toBe("Hong Kong");
    expect(detectCdnPopCity({}, "akamai", false)).toBeNull();
  });
});

describe("hasThirdParties", () => {
  it("returns false when all entries share the document domain", () => {
    const entries = [
      { url: "https://webperf-snippets.nucliweb.net/" },
      { url: "https://webperf-snippets.nucliweb.net/assets/main.js" },
    ];
    expect(hasThirdParties(entries, "https://webperf-snippets.nucliweb.net/")).toBe(false);
  });

  it("returns true when an entry has a different root domain", () => {
    const entries = [
      { url: "https://webperf-snippets.nucliweb.net/" },
      { url: "https://www.googletagmanager.com/gtag/js" },
    ];
    expect(hasThirdParties(entries, "https://webperf-snippets.nucliweb.net/")).toBe(true);
  });

  it("detects third parties in the webperf-snippets HAR fixture", () => {
    const json = readFileSync(harFixturePath, "utf8");
    const { entries, documentEntry } = parseHarJson(json);

    expect(hasThirdParties(entries, documentEntry.url)).toBe(true);
  });
});

describe("hasThirdParties with multi-label public suffixes", () => {
  it("treats subdomains of the same .com.au domain as first party", () => {
    expect(
      hasThirdParties(
        [{ url: "https://static.example.com.au/a.js" }],
        "https://www.example.com.au/"
      )
    ).toBe(false);
  });

  it("treats a different .co.uk domain as third party", () => {
    expect(hasThirdParties([{ url: "https://news.co.uk/a.js" }], "https://www.bbc.co.uk/")).toBe(
      true
    );
  });
});
