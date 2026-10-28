import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  parseHar,
  parseHarJson,
  parseHarPages,
  parseHarPagesJson,
  defaultPageName,
} from "../src/parsers/har-parser.js";
import { firefoxEntry, firefoxHar, twoPageHar } from "./helpers/firefox-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = join(__dirname, "fixtures/webperf-snippets.har.fixture.json");

describe("parseHar", () => {
  it("parses page timings", () => {
    const json = readFileSync(fixturePath, "utf8");
    const result = parseHarJson(json);

    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page.onLoad).toBeCloseTo(479.88, 0);
    expect(page.onContentLoad).toBeCloseTo(263.76, 0);
  });

  it("identifies the document entry (first HTML)", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.isDocument).toBe(true);
    expect(documentEntry.url).toContain("webperf-snippets.nucliweb.net");
  });

  it("extracts TTFB from the document entry", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.ttfb).toBeGreaterThan(0);
    expect(documentEntry.ttfb).toBeCloseTo(48.71, 0);
  });

  it("normalizes negative timing values to 0", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { entries } = parseHarJson(json);

    for (const entry of entries) {
      expect(entry.timing.dns).toBeGreaterThanOrEqual(0);
      expect(entry.timing.connect).toBeGreaterThanOrEqual(0);
      expect(entry.timing.ssl).toBeGreaterThanOrEqual(0);
    }
  });

  it("calculates startTime relative to page startedDateTime", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.startTime).toBeGreaterThanOrEqual(0);
    expect(documentEntry.startTime).toBeLessThan(100);
  });

  it("lowercases response header names", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    const headers = documentEntry.responseHeaders;
    expect(Object.keys(headers).every((k) => k === k.toLowerCase())).toBe(true);
  });

  it("exposes Vercel server header on the document entry", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.responseHeaders["server"]).toBe("Vercel");
  });

  it("parses all 34 entries", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { entries } = parseHarJson(json);

    expect(entries).toHaveLength(34);
  });
});

describe("parseHar — Chrome transfer sizes", () => {
  it("uses _transferSize as transferSize and content.size as bodySize", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.log.entries[1]._transferSize = 777;
    const { entries } = parseHar(raw);

    expect(entries[1].transferSize).toBe(777);
    expect(entries[1].bodySize).toBe(raw.log.entries[1].response.content.size);
  });
});

describe("parseHar — transfer size of cached entries", () => {
  const withEntry = (overrides: Record<string, unknown>) => {
    const raw = firefoxHar();
    raw.log.entries.push(firefoxEntry("https://example.com/c.js", "text/javascript", overrides));
    return parseHar(raw).entries.at(-1)!;
  };

  it("reports 0 transferred bytes for a cache entry without _transferSize, keeping bodySize", () => {
    const entry = withEntry({ _fromCache: "disk" });
    expect(entry.fromCache).toBe("disk");
    expect(entry.transferSize).toBe(0);
    expect(entry.bodySize).toBe(5000);
  });

  it("keeps the fallback chain for network entries without _transferSize", () => {
    expect(withEntry({}).transferSize).toBe(1500);
  });

  it("uses _transferSize as is, even for cache entries", () => {
    expect(withEntry({ _fromCache: "memory", _transferSize: 42 }).transferSize).toBe(42);
  });
});

describe("parseHar — Firefox-style HAR", () => {
  it("infers resourceType from mimeType", () => {
    const { entries } = parseHar(firefoxHar());

    expect(entries.map((e) => e.resourceType)).toEqual([
      "document",
      "stylesheet",
      "script",
      "image",
      "font",
    ]);
  });

  it("leaves priority undefined", () => {
    const { entries } = parseHar(firefoxHar());

    expect(entries.every((e) => e.priority === undefined)).toBe(true);
  });

  it("derives transferSize from bodySize + headersSize and keeps content.size as bodySize", () => {
    const { entries } = parseHar(firefoxHar());

    expect(entries[0].transferSize).toBe(1500);
    expect(entries[0].bodySize).toBe(5000);
  });

  it("falls back to content.size when bodySize or headersSize is unknown", () => {
    const raw = firefoxHar();
    raw.log.entries[1].response.headersSize = -1;
    const { entries } = parseHar(raw);

    expect(entries[1].transferSize).toBe(5000);
  });

  it("falls back to 0 when no size information exists", () => {
    const raw = firefoxHar();
    raw.log.entries[1].response = {
      status: 200,
      headers: [],
      content: { mimeType: "text/css" },
    } as never;
    const { entries } = parseHar(raw);

    expect(entries[1].transferSize).toBe(0);
  });

  it("maps onLoad -1 to null and keeps a fired onContentLoad", () => {
    const { pages } = parseHar(firefoxHar());

    expect(pages[0].onLoad).toBeNull();
    expect(pages[0].onContentLoad).toBe(120);
  });
});

describe("parseHar — resource type inference", () => {
  const infer = (url: string, mimeType: string) => {
    const raw = firefoxHar();
    raw.log.entries.push(firefoxEntry(url, mimeType));
    return parseHar(raw).entries.at(-1)!.resourceType;
  };

  it.each([
    ["https://x.com/a", "text/javascript", "script"],
    ["https://x.com/a", "application/x-javascript", "script"],
    ["https://x.com/a", "application/font-woff", "font"],
    ["https://x.com/a", "application/vnd.ms-fontobject", "font"],
    ["https://x.com/a", "application/x-font-ttf", "font"],
    ["https://x.com/a", "application/json", "fetch"],
    ["https://x.com/a", "text/plain", "fetch"],
    ["https://x.com/a", "video/mp4", "other"],
    ["https://x.com/a.js?v=1", "", "script"],
    ["https://x.com/a.mjs", "application/octet-stream", "script"],
    ["https://x.com/a.css", "", "stylesheet"],
    ["https://x.com/a.TTF", "application/octet-stream", "font"],
    ["https://x.com/a.avif", "", "image"],
    ["https://x.com/a.bin", "", "other"],
  ])("%s with mimeType %j is %s", (url, mime, expected) => {
    expect(infer(url, mime)).toBe(expected);
  });

  it("prefers _resourceType when present", () => {
    const raw = firefoxHar();
    raw.log.entries.push(
      firefoxEntry("https://x.com/a.js", "text/plain", { _resourceType: "script" })
    );

    expect(parseHar(raw).entries.at(-1)!.resourceType).toBe("script");
  });
});

describe("parseHar — malformed input", () => {
  it("throws a readable error for empty entries", () => {
    const raw = firefoxHar();
    raw.log.entries = [];

    expect(() => parseHar(raw)).toThrow("HAR contains no entries");
  });

  it("treats a missing pages array as no pages", () => {
    const raw = firefoxHar() as { log: { pages?: unknown } };
    delete raw.log.pages;

    expect(() => parseHar(raw as never)).toThrow("HAR contains no pages");
  });

  it("treats missing timings as zeros", () => {
    const raw = firefoxHar();
    delete (raw.log.entries[1] as { timings?: unknown }).timings;
    const { entries } = parseHar(raw);

    expect(entries[1].timing).toEqual({
      blocked: 0,
      dns: 0,
      connect: 0,
      ssl: 0,
      send: 0,
      wait: 0,
      receive: 0,
    });
    expect(entries[1].ttfb).toBe(0);
  });
});

describe("parseHarPages", () => {
  it("returns one ParsedHar per page, ordered by startedDateTime", () => {
    const result = parseHarPages(twoPageHar());
    expect(result.map((h) => h.pages[0].title)).toEqual(["Home", "Checkout"]);
    expect(result.every((h) => h.pages.length === 1)).toBe(true);
  });

  it("splits entries by pageref and sends entries without pageref to the first page", () => {
    const [home, checkout] = parseHarPages(twoPageHar());
    expect(home.entries.map((e) => e.url)).toEqual([
      "https://example.com/",
      "https://example.com/app.js",
    ]);
    expect(checkout.entries.map((e) => e.url)).toEqual([
      "https://example.com/checkout",
      "https://example.com/checkout.css",
    ]);
  });

  it("times each page against its own origin", () => {
    const [home, checkout] = parseHarPages(twoPageHar());
    expect(home.documentEntry.startTime).toBe(0);
    expect(checkout.documentEntry.startTime).toBe(0);
    expect(checkout.entries[1].startTime).toBe(250);
  });

  it("gives each page its own document entry", () => {
    const [home, checkout] = parseHarPages(twoPageHar());
    expect(home.documentEntry.url).toBe("https://example.com/");
    expect(checkout.documentEntry.url).toBe("https://example.com/checkout");
  });

  it("skips pages without an HTML document", () => {
    const har = twoPageHar();
    har.log.entries = har.log.entries.filter(
      (e) => !(e.pageref === "page_2" && e.response.content.mimeType === "text/html")
    );
    const result = parseHarPages(har);
    expect(result).toHaveLength(1);
    expect(result[0].pages[0].title).toBe("Home");
  });

  it("throws the readable error when no page has a document", () => {
    const har = twoPageHar();
    har.log.entries = har.log.entries.filter((e) => e.response.content.mimeType !== "text/html");
    expect(() => parseHarPages(har)).toThrow("HAR contains no HTML document entry");
  });

  it("returns a single ParsedHar for a single-page HAR, equal to parseHar", () => {
    expect(parseHarPages(firefoxHar())).toEqual([parseHar(firefoxHar())]);
  });

  it("parses from a JSON string", () => {
    expect(parseHarPagesJson(JSON.stringify(twoPageHar()))).toHaveLength(2);
  });
});

describe("defaultPageName", () => {
  const page = { id: "p", title: "", onLoad: null, onContentLoad: null };

  it("uses the title when present", () => {
    expect(defaultPageName({ ...page, title: " Home " }, 0, "https://a.com/x")).toBe("Home");
  });

  it("falls back to the document hostname and path", () => {
    expect(defaultPageName(page, 0, "https://a.com/shop?x=1")).toBe("a.com/shop");
  });

  it("falls back to Page N", () => {
    expect(defaultPageName(page, 2)).toBe("Page 3");
  });
});
