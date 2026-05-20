import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { detectCdnRegion, detectGfw, detectNode, hasThirdParties } from "../src/inference/node-detector.js";
import { parseHarJson } from "../src/parsers/har-parser.js";

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

  it("returns origin for the webperf-snippets document (Vercel, no CDN headers)", () => {
    const json = readFileSync(harFixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    const result = detectNode(documentEntry.responseHeaders);

    expect(result.cdnProvider).toBe("unknown");
    expect(result.type).toBe("origin");
  });
});

describe("detectGfw", () => {
  it("triggers on high DNS (> 80ms)", () => {
    expect(detectGfw(169, 0)).toBe(true);
  });

  it("triggers on high max TCP connect (> 300ms) even with cached DNS", () => {
    expect(detectGfw(0, 419)).toBe(true);
  });

  it("does not trigger for cached local connections", () => {
    expect(detectGfw(0, 0)).toBe(false);
  });

  it("does not trigger for moderate cross-continent latency (< 300ms)", () => {
    expect(detectGfw(0, 150)).toBe(false);
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

  it("returns the fallback when PoP is unknown", () => {
    expect(detectCdnRegion({ "cf-ray": "abc123-XYZ" }, "edge")).toBe("edge");
  });

  it("returns default fallback (edge) when no PoP headers present", () => {
    expect(detectCdnRegion({})).toBe("edge");
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
