import { describe, it, expect } from "vitest";
import { pageDocument, parseHar, parseHarPages } from "../src/parsers/har-parser.js";
import { expandPageFlows } from "../src/steps/expand-page-flows.js";
import { firefoxEntry, firefoxHar, twoPageHar } from "./helpers/firefox-har.js";

type RawHar = Parameters<typeof parseHarPages>[0];

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();

const entryAt = (url: string, mimeType: string, seconds: number, extra = {}) =>
  firefoxEntry(url, mimeType, { startedDateTime: at(seconds), ...extra });

// An API capture: JSON responses only, the busiest domain not requested first.
const apiEntries = () => [
  entryAt("https://telemetry.vendor.io/collect", "application/json", 0),
  entryAt("https://api.example.com/v1/session", "application/json", 0.1),
  entryAt("https://api.example.com/v1/items", "application/json", 0.3),
  entryAt("https://telemetry.vendor.io/collect?b", "application/json", 0.5),
  entryAt("https://cdn.example.com/v1/items/1", "application/json", 0.6),
];

const harOf = (log: Record<string, unknown>) => ({ log }) as unknown as RawHar;

describe("parseHarPages — HARs without pages", () => {
  const site = () => [
    entryAt("https://example.com/app.js", "application/javascript", 0.2, { pageref: undefined }),
    entryAt("https://example.com/", "text/html", 0, { pageref: undefined }),
    entryAt("https://example.com/app.css", "text/css", 0.1, { pageref: undefined }),
  ];

  it.each([
    ["without a pages key", harOf({ entries: site() })],
    ["with an empty pages list", harOf({ pages: [], entries: site() })],
  ])("reads a HAR %s as one page of every entry", (_, raw) => {
    const [page, ...rest] = parseHarPages(raw);

    expect(rest).toEqual([]);
    expect(page.entries).toHaveLength(3);
    expect(page.documentEntry.url).toBe("https://example.com/");
  });

  it("starts the page with its earliest entry, wherever it is listed", () => {
    const [page] = parseHarPages(harOf({ entries: site() }));

    expect(page.entries.map((e) => e.startTime)).toEqual([200, 0, 100]);
  });

  it("leaves the page untitled and without page timings, so it is named after its document", () => {
    const [page] = parseHarPages(harOf({ entries: site() }));

    expect(page.pages[0]).toMatchObject({ title: "", onLoad: null, onContentLoad: null });
    expect(expandPageFlows({ har: [page] })[0].name).toBe("Page 1");
    expect(expandPageFlows({ har: [page, page] })[0].name).toBe("example.com/");
  });

  it("reads a page-less HAR with parseHar too", () => {
    expect(parseHar(harOf({ entries: site() })).entries).toHaveLength(3);
  });
});

describe("parseHarPages — entries whose pageref names no listed page", () => {
  it("puts each one in the page that was running when it started", () => {
    const raw = twoPageHar();
    raw.log.entries.push(
      firefoxEntry("https://example.com/late.js", "application/javascript", {
        pageref: "missing",
        startedDateTime: "2026-01-01T00:00:10.300Z",
      }),
      firefoxEntry("https://example.com/early.js", "application/javascript", {
        pageref: "missing",
        startedDateTime: "2026-01-01T00:00:00.500Z",
      })
    );
    const [home, checkout] = parseHarPages(raw);

    expect(home.entries.map((e) => e.url)).toContain("https://example.com/early.js");
    expect(checkout.entries.map((e) => e.url)).toContain("https://example.com/late.js");
  });

  it("puts one that started before every page in the first page", () => {
    const raw = twoPageHar();
    raw.log.entries.push(
      firefoxEntry("https://example.com/sw.js", "application/javascript", {
        pageref: "missing",
        startedDateTime: "2025-12-31T23:59:59.000Z",
      })
    );
    const [home] = parseHarPages(raw);

    expect(home.entries.map((e) => e.url)).toContain("https://example.com/sw.js");
  });
});

describe("parseHarPages — captures without an HTML document", () => {
  const apiHar = () =>
    harOf({
      pages: [{ id: "page_1", title: "API session", startedDateTime: at(0), pageTimings: {} }],
      entries: apiEntries(),
    });

  it("keeps a page whose responses are all JSON", () => {
    const [page] = parseHarPages(apiHar());

    expect(page.entries).toHaveLength(5);
    expect(page.pages[0].title).toBe("API session");
  });

  it("takes the first request to the busiest domain as the page's primary request", () => {
    const [page] = parseHarPages(apiHar());

    expect(page.documentEntry.url).toBe("https://api.example.com/v1/session");
    expect(page.documentEntry.isDocument).toBe(false);
    expect(page.documentRedirects).toEqual([]);
  });

  it("says the page has no document", () => {
    const [page] = parseHarPages(apiHar());

    expect(pageDocument(page)).toBeNull();
    expect(pageDocument(parseHar(firefoxHar()))?.url).toBe("https://example.com/");
  });

  it("reads no preconnect hints from the primary request's Link header", () => {
    const raw = apiHar();
    raw.log.entries![1] = entryAt("https://api.example.com/v1/session", "application/json", 0.1, {
      response: {
        status: 200,
        headers: [{ name: "Link", value: "<https://fonts.example.net>; rel=preconnect" }],
        content: { mimeType: "application/json", size: 100 },
      },
    }) as never;

    expect(parseHarPages(raw)[0].documentEntry.url).toBe("https://api.example.com/v1/session");
    expect(parseHarPages(raw)[0].preconnectHints).toEqual({});
  });

  it("keeps every page when no page has a document", () => {
    const har = twoPageHar();
    har.log.entries = har.log.entries.filter((e) => e.response.content.mimeType !== "text/html");

    expect(parseHarPages(har).map((p) => p.pages[0].title)).toEqual(["Home", "Checkout"]);
  });

  it("parses an API capture with parseHar", () => {
    expect(parseHar(apiHar()).documentEntry.url).toBe("https://api.example.com/v1/session");
  });
});

describe("parseHarPages — broken entries", () => {
  it("skips an entry without a request and parses the rest", () => {
    const raw = firefoxHar();
    delete (raw.log.entries[2] as { request?: unknown }).request;
    const [page] = parseHarPages(raw);

    expect(page.entries.map((e) => e.url)).toEqual([
      "https://example.com/",
      "https://example.com/app.css",
      "https://example.com/hero.png",
      "https://example.com/font.woff2",
    ]);
  });

  it.each([
    ["a request without a URL", { request: { method: "GET" } }],
    ["an empty URL", { request: { url: "", method: "GET" } }],
    ["a null entry", null],
    ["no start time", { startedDateTime: undefined }],
    ["an invalid start time", { startedDateTime: "yesterday" }],
  ])("skips an entry with %s", (_, broken) => {
    const raw = firefoxHar();
    const entries: unknown[] = raw.log.entries;
    entries[1] = broken === null ? null : { ...raw.log.entries[1], ...broken };

    expect(parseHarPages(raw)[0].entries).toHaveLength(4);
  });

  it("times an entry without a total time by its timings", () => {
    const raw = firefoxHar();
    delete (raw.log.entries[1] as { time?: unknown }).time;

    expect(parseHarPages(raw)[0].entries[1].duration).toBe(20);
  });

  it("reads a page without a title as untitled", () => {
    const raw = firefoxHar();
    delete (raw.log.pages[0] as { title?: unknown }).title;

    expect(parseHarPages(raw)[0].pages[0].title).toBe("");
  });

  it("says so in one sentence when no entry can be read", () => {
    const raw = firefoxHar();
    for (const entry of raw.log.entries) delete (entry as { request?: unknown }).request;

    expect(() => parseHarPages(raw)).toThrow(
      "No entry of the HAR has a request URL and a valid start time."
    );
  });
});

describe("parseHarPages — pages with a missing or invalid start time", () => {
  it.each([
    ["an invalid", "not a date"],
    ["a missing", undefined],
  ])("orders a page with %s start time by its first entry", (_, startedDateTime) => {
    const raw = twoPageHar();
    raw.log.pages[0].startedDateTime = startedDateTime as never;
    const pages = parseHarPages(raw);

    expect(pages.map((p) => p.pages[0].title)).toEqual(["Home", "Checkout"]);
    expect(pages[1].entries.map((e) => e.startTime)).toEqual([0, 250]);
  });

  it("orders the other pages around one it cannot place in time", () => {
    const raw = twoPageHar();
    const nowhere = { ...raw.log.pages[1], id: "page_0", title: "Nowhere", startedDateTime: "?" };
    raw.log.pages.splice(1, 0, nowhere);

    expect(parseHarPages(raw).map((p) => p.pages[0].title)).toEqual(["Home", "Checkout"]);
  });

  it("keeps the HAR's order for pages that start at the same time", () => {
    const raw = twoPageHar();
    raw.log.pages.unshift({ ...raw.log.pages[1], id: "page_0", title: "Twin" });
    raw.log.entries.push(
      firefoxEntry("https://example.com/twin", "text/html", { pageref: "page_0" })
    );

    expect(parseHarPages(raw).map((p) => p.pages[0].title)).toEqual(["Twin", "Home", "Checkout"]);
  });
});
