import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { analyzeCompression } from "../src/analysis/compression.js";
import type { CompressionReport, HarEntry, ParsedHar } from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const recording = (name: string) =>
  parseHarJson(readFileSync(join(__dirname, `../../../fixtures/${name}`), "utf8"));

// A page whose document is a 20 KB HTML compressed with Brotli to 5 KB, plus the given entries.
function page(entries: HarEntry[]): ParsedHar {
  const har = makeHar(entries);
  Object.assign(har.entries[0], { contentEncoding: "br", bodySize: 20_000, transferSize: 5_000 });
  return har;
}

const js = (url: string, over: Partial<HarEntry>) =>
  makeEntry({
    url: `https://example.com/${url}`,
    mimeType: "application/javascript",
    resourceType: "script",
    ...over,
  });
const image = (url: string, mimeType: string, over: Partial<HarEntry> = {}) =>
  makeEntry({
    url: `https://example.com/${url}`,
    mimeType,
    resourceType: "image",
    contentEncoding: "none",
    ...over,
  });

const labels = (report: CompressionReport) =>
  report.recommendations.map((r) => [r.label, r.severity]);

describe("analyzeCompression — text responses", () => {
  const report = analyzeCompression(
    page([
      makeEntry({ contentEncoding: "br", bodySize: 10_000, transferSize: 2_500 }),
      js("app.js", { contentEncoding: "gzip", bodySize: 40_000, transferSize: 12_000 }),
      js("small.js", { contentEncoding: "gzip", bodySize: 9_000, transferSize: 3_000 }),
      js("legacy.js", { contentEncoding: "none", bodySize: 5_000, transferSize: 5_200 }),
      makeEntry({
        url: "https://example.com/api",
        mimeType: "application/json; charset=utf-8",
        resourceType: "fetch",
        contentEncoding: "none",
        bodySize: 500,
        transferSize: 600,
      }),
      makeEntry({
        url: "https://example.com/icon.svg",
        mimeType: "image/svg+xml",
        resourceType: "image",
        contentEncoding: "zstd",
        bodySize: 3_000,
        transferSize: 900,
      }),
      makeEntry({
        url: "https://example.com/font.woff2",
        mimeType: "font/woff2",
        resourceType: "font",
        contentEncoding: "none",
        bodySize: 30_000,
        transferSize: 30_100,
      }),
      // Not downloads of this load: a browser-cache hit, a 304, a beacon's 204, an empty body.
      js("cached.js", { contentEncoding: "none", bodySize: 80_000, fromCache: "disk" }),
      js("revalidated.js", { contentEncoding: "none", status: 304, bodySize: 80_000 }),
      makeEntry({ url: "https://example.com/beacon", mimeType: "text/plain", status: 204 }),
      js("empty.js", { contentEncoding: "none", bodySize: 0, transferSize: 9_000 }),
    ])
  );

  it("groups the compressible responses by type with their encodings and bytes", () => {
    expect(report.byType).toEqual([
      {
        type: "js",
        requests: 3,
        uncompressedBytes: 54_000,
        wireBytes: 20_200,
        encodings: { gzip: 2, none: 1 },
      },
      {
        type: "html",
        requests: 1,
        uncompressedBytes: 20_000,
        wireBytes: 5_000,
        encodings: { br: 1 },
      },
      {
        type: "css",
        requests: 1,
        uncompressedBytes: 10_000,
        wireBytes: 2_500,
        encodings: { br: 1 },
      },
      {
        type: "svg",
        requests: 1,
        uncompressedBytes: 3_000,
        wireBytes: 900,
        encodings: { zstd: 1 },
      },
      { type: "json", requests: 1, uncompressedBytes: 500, wireBytes: 600, encodings: { none: 1 } },
    ]);
  });

  it("lists the uncompressed text responses of 1 KB or more, with 70% to save", () => {
    expect(report.uncompressed).toEqual([
      {
        url: "https://example.com/legacy.js",
        type: "js",
        bytes: 5_000,
        wireBytes: 5_200,
        potentialSavings: 3_500,
      },
    ]);
  });

  it("lists the gzip responses of 10 KB or more on the wire, with 15% to save", () => {
    expect(report.gzipOnly).toEqual([
      {
        url: "https://example.com/app.js",
        type: "js",
        encoding: "gzip",
        bytes: 40_000,
        wireBytes: 12_000,
        potentialSavings: 1_800,
      },
    ]);
  });

  it("adds up the bytes that could be saved", () => {
    expect(report.potentialSavings).toBe(3_500 + 1_800);
  });

  it("recommends compressing the text responses and switching gzip to Brotli", () => {
    expect(labels(report)).toEqual([
      ["Text responses served uncompressed", "warning"],
      ["Brotli would shrink gzip responses", "info"],
    ]);
    const [uncompressed, gzip] = report.recommendations;
    expect(uncompressed.resources).toEqual([
      {
        url: "https://example.com/legacy.js",
        transferSize: 5_200,
        detail: "5.0 KB uncompressed · ~3.5 KB to save",
      },
    ]);
    expect(gzip.resources?.map((r) => r.url)).toEqual(["https://example.com/app.js"]);
  });

  it("makes uncompressed text critical from 100 KB to save", () => {
    const big = analyzeCompression(
      page([js("bundle.js", { contentEncoding: "none", bodySize: 150_000, transferSize: 150_300 })])
    );
    expect(big.recommendations[0]).toMatchObject({
      label: "Text responses served uncompressed",
      severity: "critical",
    });
  });

  it("reads the Content-Encoding header of entries parsed before the encoding was kept", () => {
    const old = analyzeCompression(
      page([
        js("old.js", {
          bodySize: 40_000,
          transferSize: 12_000,
          responseHeaders: { "content-encoding": "gzip" },
        }),
      ])
    );
    expect(old.gzipOnly.map((g) => g.url)).toEqual(["https://example.com/old.js"]);
  });
});

describe("analyzeCompression — images", () => {
  const report = analyzeCompression(
    page([
      image("hero.png", "image/png", { bodySize: 400_000, transferSize: 400_000 }),
      image("photo.jpg", "image/jpeg", { bodySize: 60_000, transferSize: 60_000 }),
      image("thumb.jpg", "image/jpeg", { bodySize: 8_000, transferSize: 8_000 }),
      image("modern.avif", "image/avif", { bodySize: 40_000, transferSize: 40_000 }),
      image("logo.webp", "image/webp", {
        contentEncoding: "gzip",
        bodySize: 12_000,
        transferSize: 11_800,
      }),
      image("spinner.gif", "image/gif", { bodySize: 2_000, transferSize: 2_000 }),
    ])
  );

  it("counts requests and bytes per format, biggest first", () => {
    expect(report.images.byFormat).toEqual([
      { format: "png", requests: 1, bytes: 400_000 },
      { format: "jpeg", requests: 2, bytes: 68_000 },
      { format: "avif", requests: 1, bytes: 40_000 },
      { format: "webp", requests: 1, bytes: 11_800 },
      { format: "gif", requests: 1, bytes: 2_000 },
    ]);
  });

  it("lists JPEG and PNG images of 20 KB or more with what WebP and AVIF would save", () => {
    expect(report.images.legacy).toEqual([
      {
        url: "https://example.com/hero.png",
        format: "png",
        bytes: 400_000,
        webpSavings: 120_000,
        avifSavings: 200_000,
      },
      {
        url: "https://example.com/photo.jpg",
        format: "jpeg",
        bytes: 60_000,
        webpSavings: 18_000,
        avifSavings: 30_000,
      },
    ]);
  });

  it("lists the images served with a Content-Encoding", () => {
    expect(report.images.encoded).toEqual([
      { url: "https://example.com/logo.webp", format: "webp", encoding: "gzip", bytes: 11_800 },
    ]);
  });

  it("counts the WebP estimate in the bytes that could be saved", () => {
    expect(report.potentialSavings).toBe(138_000);
  });

  it("recommends modern formats (a warning from 100 KB to save) and dropping the encoding", () => {
    expect(labels(report)).toEqual([
      ["Legacy image formats", "warning"],
      ["Images double-encoded", "info"],
    ]);
  });

  it("only notes legacy images below 100 KB to save", () => {
    const small = analyzeCompression(
      page([image("photo.jpg", "image/jpeg", { bodySize: 60_000, transferSize: 60_000 })])
    );
    expect(labels(small)).toEqual([["Legacy image formats", "info"]]);
  });
});

describe("analyzeCompression — a well-compressed page", () => {
  it("says so when every text response is Brotli or Zstandard and images are modern", () => {
    const report = analyzeCompression(
      page([
        js("app.js", { contentEncoding: "zstd", bodySize: 40_000, transferSize: 10_000 }),
        // Too small to be worth compressing.
        js("tiny.js", { contentEncoding: "none", bodySize: 80, transferSize: 300 }),
        image("hero.avif", "image/avif", { bodySize: 50_000, transferSize: 50_000 }),
      ])
    );
    expect(labels(report)).toEqual([
      ["Text compressed with Brotli or Zstandard, images in modern formats", "good"],
    ]);
  });

  it("stays silent without any response worth compressing", () => {
    const har = makeHar([]);
    Object.assign(har.entries[0], { status: 304 });
    expect(analyzeCompression(har).recommendations).toEqual([]);
  });
});

describe("analyzeCompression — Chrome recordings of webperf-snippets", () => {
  it("finds every text response of the cold load in Brotli or Zstandard and one AVIF image", () => {
    const report = analyzeCompression(
      recording("webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har")
    );
    expect(report.byType).toEqual([
      {
        type: "js",
        requests: 19,
        uncompressedBytes: 1_756_605,
        wireBytes: 548_266,
        encodings: { br: 17, none: 1, zstd: 1 },
      },
      {
        type: "css",
        requests: 3,
        uncompressedBytes: 140_032,
        wireBytes: 26_596,
        encodings: { br: 3 },
      },
      {
        type: "html",
        requests: 1,
        uncompressedBytes: 112_507,
        wireBytes: 15_663,
        encodings: { br: 1 },
      },
      { type: "json", requests: 1, uncompressedBytes: 2, wireBytes: 250, encodings: { none: 1 } },
    ]);
    expect(report.uncompressed).toEqual([]);
    expect(report.gzipOnly).toEqual([]);
    expect(report.images).toEqual({
      byFormat: [{ format: "avif", requests: 1, bytes: 68_681 }],
      legacy: [],
      encoded: [],
    });
    expect(report.potentialSavings).toBe(0);
    expect(labels(report)).toEqual([
      ["Text compressed with Brotli or Zstandard, images in modern formats", "good"],
    ]);
  });

  it("judges nothing on the warm load, whose downloads are a 304 and two beacons", () => {
    const report = analyzeCompression(
      recording("webperf-snippets.nucliweb.net_Cache-20260519T123746.har")
    );
    expect(report.byType).toEqual([
      { type: "json", requests: 1, uncompressedBytes: 2, wireBytes: 286, encodings: { none: 1 } },
    ]);
    expect(report.images.byFormat).toEqual([]);
    expect(report.recommendations).toEqual([]);
  });
});
