import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { analyzeNetwork } from "../src/analysis/network-report.js";
import type { HarEntry, NetworkReport } from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixture = (path: string) => parseHarJson(readFileSync(join(__dirname, path), "utf8"));

const recommendation = (report: NetworkReport, label: RegExp) =>
  report.recommendations.find((rec) => label.test(rec.label));

describe("analyzeNetwork — a Chrome HAR with network problems", () => {
  const report = analyzeNetwork(fixture("fixtures/network-problems.har.fixture.json"));

  it("reports the script fetched twice and the bytes the second fetch wasted", () => {
    expect(report.duplicates).toEqual([
      {
        url: "https://www.example.com/js/app.js",
        fetches: 2,
        wastedBytes: 42_000,
        cacheBypassed: false,
      },
    ]);
  });

  it("leaves out an image served again by the memory cache and beacons sent to one URL", () => {
    const urls = report.duplicates.map((d) => d.url);
    expect(urls).not.toContain("https://www.example.com/img/hero.webp");
    expect(urls).not.toContain("https://www.example.com/collect");
  });

  it("reports each hop of the document redirect chain with its cost, and the total delay", () => {
    expect(report.documentRedirects).toEqual({
      hops: [
        { url: "http://example.com/", status: 301, target: "https://example.com/", costMs: 120 },
        {
          url: "https://example.com/",
          status: 301,
          target: "https://www.example.com/",
          costMs: 300,
        },
      ],
      delayMs: 420,
    });
  });

  it("reports the image redirect whose target was fetched, with its cost", () => {
    expect(report.resourceRedirects).toEqual({
      hops: [
        {
          url: "https://www.example.com/img/logo.png",
          status: 301,
          target: "https://www.example.com/img/logo-v2.png",
          costMs: 45,
        },
      ],
      totalMs: 45,
    });
  });

  it("lists the 4xx and 5xx responses", () => {
    expect(report.errors.map((e) => [e.status, e.url])).toEqual([
      [404, "https://www.example.com/api/recommendations.json"],
      [500, "https://www.example.com/api/cart"],
    ]);
  });

  it("reports the http:// image as mixed content, not the http:// redirect that led to the page", () => {
    expect(report.mixedContent).toEqual([
      { url: "http://img.example-cdn.net/banner.jpg", resourceType: "image", transferSize: 64_300 },
    ]);
  });

  it("turns every finding into a recommendation with its severity", () => {
    expect(report.recommendations.map((rec) => [rec.severity, rec.label])).toEqual([
      ["critical", "The document is behind 2 redirects"],
      ["critical", "1 server error (5xx)"],
      ["warning", "1 request failed (4xx)"],
      ["warning", "1 insecure request on an HTTPS page"],
      ["warning", "1 resource downloaded more than once"],
      ["info", "1 resource redirect"],
    ]);
  });

  it("names the resources of each recommendation, with what went wrong", () => {
    expect(recommendation(report, /redirects$/)?.resources).toEqual([
      {
        url: "http://example.com/",
        transferSize: 180,
        detail: "301 → https://example.com/ · 120 ms",
      },
      {
        url: "https://example.com/",
        transferSize: 210,
        detail: "301 → https://www.example.com/ · 300 ms",
      },
    ]);
    expect(recommendation(report, /more than once/)?.resources).toEqual([
      { url: "https://www.example.com/js/app.js", transferSize: 42_000, detail: "fetched 2×" },
    ]);
    expect(recommendation(report, /4xx/)?.resources).toEqual([
      {
        url: "https://www.example.com/api/recommendations.json",
        transferSize: 450,
        detail: "404",
      },
    ]);
    expect(recommendation(report, /insecure/)?.resources?.[0].detail).toBe("image");
  });

  it("says how much the redirects delayed the document and what the duplicates cost", () => {
    expect(recommendation(report, /redirects$/)?.description).toContain("420 ms");
    expect(recommendation(report, /more than once/)?.description).toContain("42 KB");
    expect(recommendation(report, /resource redirect/)?.description).toContain("45 ms");
  });
});

describe("analyzeNetwork — duplicates", () => {
  const script = (overrides: Partial<HarEntry>) =>
    makeEntry({ url: "https://example.com/app.js", resourceType: "script", ...overrides });

  it("counts the transfer of every fetch after the first, the biggest waste first", () => {
    const report = analyzeNetwork(
      makeHar([
        makeEntry({ url: "https://example.com/a.css", startTime: 100, transferSize: 900 }),
        makeEntry({ url: "https://example.com/a.css", startTime: 200, transferSize: 800 }),
        script({ startTime: 110, transferSize: 5_000 }),
        script({ startTime: 210, transferSize: 4_000 }),
        script({ startTime: 310, transferSize: 3_000 }),
      ])
    );

    expect(report.duplicates.map((d) => [d.url, d.fetches, d.wastedBytes])).toEqual([
      ["https://example.com/app.js", 3, 7_000],
      ["https://example.com/a.css", 2, 800],
    ]);
  });

  it("leaves out 304 revalidations, redirects and requests that got no response", () => {
    const report = analyzeNetwork(
      makeHar([
        script({ startTime: 100 }),
        script({ startTime: 200, status: 304 }),
        script({ startTime: 300, status: 0 }),
        makeEntry({ url: "https://example.com/old", status: 302, startTime: 100 }),
        makeEntry({ url: "https://example.com/old", status: 302, startTime: 200 }),
      ])
    );

    expect(report.duplicates).toEqual([]);
  });

  it("ignores the URL fragment and keeps query strings apart", () => {
    const report = analyzeNetwork(
      makeHar([
        script({ url: "https://example.com/sprite.svg#a", startTime: 100 }),
        script({ url: "https://example.com/sprite.svg#b", startTime: 200 }),
        script({ url: "https://example.com/app.js?v=1", startTime: 100 }),
        script({ url: "https://example.com/app.js?v=2", startTime: 200 }),
      ])
    );

    expect(report.duplicates.map((d) => d.url)).toEqual(["https://example.com/sprite.svg"]);
  });

  it("says the duplicates may come from the recording when it bypassed the browser cache", () => {
    const report = analyzeNetwork(
      makeHar([
        script({ startTime: 100, bypassesCache: true }),
        script({ startTime: 200, bypassesCache: true }),
      ])
    );

    expect(report.duplicates[0].cacheBypassed).toBe(true);
    const rec = recommendation(report, /more than once/)!;
    expect(rec.severity).toBe("info");
    expect(rec.description).toContain("Disable cache");
  });
});

describe("analyzeNetwork — severities", () => {
  const redirectTo = (target: string, startTime: number): HarEntry =>
    makeEntry({
      url: `https://example.com/r${startTime}`,
      status: 301,
      startTime,
      redirectURL: target,
    });

  it("rates a single short document redirect a warning, and a slow one critical", () => {
    const harWithRedirect = (documentStart: number) => {
      const har = makeHar([]);
      const hop = makeEntry({
        url: "https://old.example.com/",
        status: 301,
        startTime: 0,
        redirectURL: "https://example.com/",
      });
      const documentEntry = { ...har.documentEntry, startTime: documentStart };
      return { ...har, entries: [hop, documentEntry], documentEntry, documentRedirects: [hop] };
    };

    const fast = recommendation(analyzeNetwork(harWithRedirect(120)), /behind/)!;
    expect(fast.severity).toBe("warning");
    expect(fast.label).toBe("The document is behind a redirect");
    expect(recommendation(analyzeNetwork(harWithRedirect(500)), /behind/)?.severity).toBe(
      "critical"
    );
  });

  it("rates resource redirects a warning from three on", () => {
    const targets = (count: number) =>
      Array.from({ length: count }, (_, i) => [
        redirectTo(`https://example.com/t${i}`, 100 + i),
        makeEntry({ url: `https://example.com/t${i}`, startTime: 150 + i }),
      ]).flat();

    expect(recommendation(analyzeNetwork(makeHar(targets(2))), /redirect/)?.severity).toBe("info");
    expect(recommendation(analyzeNetwork(makeHar(targets(3))), /redirect/)?.severity).toBe(
      "warning"
    );
  });

  it("leaves out a resource redirect whose target was never requested", () => {
    const report = analyzeNetwork(makeHar([redirectTo("https://example.com/gone", 100)]));

    expect(report.resourceRedirects).toEqual({ hops: [], totalMs: 0 });
  });

  it("reports nothing on a clean page", () => {
    const report = analyzeNetwork(makeHar([makeEntry()]));

    expect(report).toEqual({
      duplicates: [],
      documentRedirects: { hops: [], delayMs: 0 },
      resourceRedirects: { hops: [], totalMs: 0 },
      errors: [],
      mixedContent: [],
      recommendations: [],
    });
  });

  it("finds no mixed content on an http:// page", () => {
    const har = makeHar([makeEntry({ url: "http://example.com/a.css" })]);
    const documentEntry = { ...har.documentEntry, url: "http://example.com/" };
    const report = analyzeNetwork({
      ...har,
      entries: [documentEntry, ...har.entries.slice(1)],
      documentEntry,
    });

    expect(report.mixedContent).toEqual([]);
  });
});

describe("analyzeNetwork — the webperf-snippets recordings", () => {
  const recording = (name: string) => fixture(`../../../fixtures/${name}`);

  it("finds the nine resources the disable-cache run downloaded twice", () => {
    const report = analyzeNetwork(
      recording("webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har")
    );

    expect(report.duplicates).toHaveLength(9);
    expect(report.duplicates.every((d) => d.fetches === 2 && d.cacheBypassed)).toBe(true);
    expect(report.duplicates[0]).toMatchObject({
      url: "https://webperf-snippets.nucliweb.net/_next/static/chunks/169-7c4f23f868dd8b78.js",
      wastedBytes: 55_658,
    });
  });

  it("finds none in the run with the cache on, which served the repeats from disk", () => {
    const report = analyzeNetwork(
      recording("webperf-snippets.nucliweb.net_Cache-20260519T123746.har")
    );

    expect(report.duplicates).toEqual([]);
  });
});
