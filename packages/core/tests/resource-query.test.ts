import { describe, expect, it } from "vitest";
import {
  RESOURCE_QUERY_HELP,
  matchesResourceQuery,
  parseResourceQuery,
} from "../src/analysis/resource-query.js";
import {
  buildWaterfall,
  filterWaterfallRows,
  sortWaterfallRows,
} from "../src/analysis/waterfall.js";
import type { WaterfallRow } from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const css = makeEntry({
  url: "https://example.com/css/main.css?v=3",
  startTime: 120,
  duration: 40,
  ttfb: 30,
  priority: "VeryHigh",
  httpVersion: "h2",
  contentEncoding: "br",
  method: "GET",
  transferSize: 4_000,
  bodySize: 12_000,
  initiator: { type: "parser", url: "https://example.com/" },
});
const hero = makeEntry({
  url: "https://img.example.com/hero.avif",
  startTime: 200,
  duration: 80,
  ttfb: 20,
  resourceType: "image",
  mimeType: "image/avif",
  priority: "High",
  httpVersion: "h3",
  contentEncoding: "none",
  transferSize: 48_000,
  bodySize: 48_000,
});
const tag = makeEntry({
  url: "https://cdn.third.com/tag.js",
  startTime: 150,
  duration: 1_200,
  ttfb: 400,
  resourceType: "script",
  mimeType: "application/javascript",
  priority: "Low",
  httpVersion: "h1",
  contentEncoding: "gzip",
  transferSize: 150_000,
  bodySize: 400_000,
});
const beacon = makeEntry({
  url: "https://stats.third.com/collect",
  startTime: 900,
  duration: 30,
  method: "POST",
  status: 204,
  resourceType: "fetch",
  mimeType: "",
  priority: "VeryLow",
  transferSize: 300,
  bodySize: 0,
});
const missing = makeEntry({
  url: "https://example.com/gone.png",
  startTime: 300,
  status: 404,
  resourceType: "image",
  mimeType: "text/html",
  transferSize: 500,
});
const moved = makeEntry({
  url: "https://example.com/old.js",
  startTime: 250,
  status: 301,
  resourceType: "script",
  redirectURL: "https://example.com/new.js",
  transferSize: 0,
});
const cached = makeEntry({
  url: "https://example.com/font.woff2",
  startTime: 260,
  resourceType: "font",
  fromCache: "memory",
  transferSize: 0,
});

const har = makeHar([css, hero, tag, beacon, missing, moved, cached]);
const rows = buildWaterfall(har, {
  navigationStart: 0,
  navigationId: null,
  url: null,
  fcp: 250,
  lcp: 410,
  cls: null,
  inp: null,
  lcpCandidate: { timeMs: 410, type: "image", url: hero.url },
}).rows;

/** The short names of the rows a query keeps, in waterfall order. */
const kept = (text: string) =>
  rows.filter((row) => matchesResourceQuery(row, parseResourceQuery(text))).map((r) => r.shortName);

describe("parseResourceQuery", () => {
  it("keeps every row with an empty query", () => {
    expect(parseResourceQuery("").terms).toEqual([]);
    expect(parseResourceQuery("   ").terms).toEqual([]);
    expect(kept("")).toHaveLength(8);
  });

  it("matches free text against the URL, case-insensitively", () => {
    expect(kept("THIRD.com")).toEqual(["tag.js", "collect"]);
    expect(kept("css/")).toEqual(["main.css?v=3"]);
  });

  it("quotes a value with spaces and negates a term with a leading dash", () => {
    expect(kept('"main.css?v=3"')).toEqual(["main.css?v=3"]);
    expect(kept("-example.com")).toEqual(["tag.js", "collect"]);
    expect(kept("-domain:example.com -type:script")).toEqual(["collect"]);
  });

  it("ands every term together", () => {
    expect(kept("example.com type:image")).toEqual(["hero.avif", "gone.png"]);
    expect(kept("example.com type:image status:200")).toEqual(["hero.avif"]);
  });

  it("filters by domain: the host, its subdomains, or a * wildcard", () => {
    expect(kept("domain:example.com")).toEqual([
      "example.com",
      "main.css?v=3",
      "hero.avif",
      "old.js",
      "font.woff2",
      "gone.png",
    ]);
    expect(kept("host:img.example.com")).toEqual(["hero.avif"]);
    expect(kept("domain:*.third.com")).toEqual(["tag.js", "collect"]);
    expect(kept("domain:cdn.*")).toEqual(["tag.js"]);
  });

  it("filters by status: a code, a class such as 4xx, or a range", () => {
    expect(kept("status:404")).toEqual(["gone.png"]);
    expect(kept("status:3xx")).toEqual(["old.js"]);
    expect(kept("status-code:2xx")).toHaveLength(6);
    expect(kept("status:300-499")).toEqual(["old.js", "gone.png"]);
    expect(kept("status:>=300")).toEqual(["old.js", "gone.png"]);
  });

  it("filters by type, with the DevTools aliases", () => {
    expect(kept("type:stylesheet")).toEqual(["main.css?v=3"]);
    expect(kept("type:css")).toEqual(["main.css?v=3"]);
    expect(kept("type:js")).toEqual(["tag.js", "old.js"]);
    expect(kept("type:img")).toEqual(["hero.avif", "gone.png"]);
    expect(kept("type:xhr")).toEqual(["collect"]);
    expect(kept("type:doc")).toEqual(["example.com"]);
    expect(kept("type:font")).toEqual(["font.woff2"]);
  });

  it("filters by MIME type as a prefix or a substring, and by method", () => {
    expect(kept("mime:image/")).toEqual(["hero.avif"]);
    expect(kept("mime-type:javascript")).toEqual(["tag.js"]);
    expect(kept("method:post")).toEqual(["collect"]);
  });

  it("filters by size with larger-than and smaller-than, in bytes, k or M", () => {
    expect(kept("larger-than:100k")).toEqual(["tag.js"]);
    expect(kept("larger-than:40000")).toEqual(["tag.js", "hero.avif"]);
    expect(kept("smaller-than:1k")).toEqual(["old.js", "font.woff2", "gone.png", "collect"]);
    expect(kept("larger-than:0.1M")).toEqual(["tag.js"]);
  });

  it("filters by duration with slower-than and faster-than, in ms or s", () => {
    expect(kept("slower-than:1s")).toEqual(["tag.js"]);
    // The document takes 86 ms: its phases add up to more than its duration.
    expect(kept("slower-than:60ms")).toEqual(["example.com", "tag.js", "hero.avif"]);
    expect(kept("faster-than:35")).toEqual(["collect"]);
  });

  it("compares size, body, time, ttfb and start with an operator", () => {
    expect(kept("size:>=48k")).toEqual(["tag.js", "hero.avif"]);
    expect(kept("body:>100k")).toEqual(["tag.js"]);
    expect(kept("time:<=30ms")).toEqual(["collect"]);
    expect(kept("ttfb:>300")).toEqual(["tag.js"]);
    expect(kept("start:>=0.3s")).toEqual(["gone.png", "collect"]);
    expect(kept("size:0")).toEqual(["old.js", "font.woff2"]);
  });

  it("filters by priority, protocol, encoding and party", () => {
    expect(kept("priority:low")).toEqual(["tag.js"]);
    expect(kept("priority:highest")).toEqual([
      "example.com",
      "main.css?v=3",
      "old.js",
      "font.woff2",
      "gone.png",
    ]);
    expect(kept("protocol:h3")).toEqual(["hero.avif"]);
    expect(kept("protocol:http/1.1")).toEqual(["tag.js"]);
    expect(kept("encoding:br")).toEqual(["main.css?v=3"]);
    expect(kept("encoding:none")).toEqual(["hero.avif"]);
    expect(kept("party:third")).toEqual(["tag.js", "collect"]);
    expect(kept("party:1p type:script")).toEqual(["old.js"]);
  });

  it("filters by what a request is: cached, render-blocking, the LCP resource, a redirect, an error", () => {
    expect(kept("is:cached")).toEqual(["font.woff2"]);
    expect(kept("-is:cached type:font")).toEqual([]);
    expect(kept("is:lcp")).toEqual(["hero.avif"]);
    expect(kept("is:redirect")).toEqual(["old.js"]);
    expect(kept("is:error")).toEqual(["gone.png"]);
    expect(kept("is:document")).toEqual(["example.com"]);
    expect(kept("is:blocking")).toEqual(["main.css?v=3"]);
  });

  it("treats an unknown field as text", () => {
    expect(kept("v=3")).toEqual(["main.css?v=3"]);
    expect(kept("nothing:here")).toEqual([]);
    expect(parseResourceQuery("nothing:here").problems).toEqual([]);
  });

  it("reports a value it cannot read and keeps nothing for that term", () => {
    const query = parseResourceQuery("type:video larger-than:big status:ok is:slow");

    expect(query.problems).toEqual([
      'type: unknown type "video"',
      'larger-than: expected a size such as 100k or 2M, got "big"',
      'status: expected a code, a class such as 4xx or a range, got "ok"',
      'is: unknown flag "slow"',
    ]);
    expect(rows.filter((row) => matchesResourceQuery(row, query))).toEqual([]);
  });

  it("documents every field with an example", () => {
    const fields = RESOURCE_QUERY_HELP.map((h) => h.field);

    expect(fields).toEqual(
      expect.arrayContaining(["domain", "status", "type", "larger-than", "slower-than", "is"])
    );
    for (const help of RESOURCE_QUERY_HELP) {
      expect(parseResourceQuery(help.example).problems).toEqual([]);
    }
  });
});

describe("filterWaterfallRows", () => {
  it("reads the search as a resource query", () => {
    const names = (f: Parameters<typeof filterWaterfallRows>[1]) =>
      filterWaterfallRows(rows, f).map((r) => r.shortName);

    expect(names({ search: "status:4xx" })).toEqual(["gone.png"]);
    expect(names({ search: "-is:cached", party: "first", types: ["font", "image"] })).toEqual([
      "hero.avif",
      "gone.png",
    ]);
  });
});

describe("sortWaterfallRows", () => {
  const names = (sorted: WaterfallRow[]) => sorted.map((r) => r.shortName);

  it("sorts by size, largest first on desc, keeping the start order on a tie", () => {
    expect(names(sortWaterfallRows(rows, { key: "size", direction: "desc" }))).toEqual([
      "tag.js",
      "hero.avif",
      "main.css?v=3",
      "example.com",
      "gone.png",
      "collect",
      "old.js",
      "font.woff2",
    ]);
  });

  it("sorts by name, type, status, time, ttfb and host", () => {
    expect(names(sortWaterfallRows(rows, { key: "name", direction: "asc" })).slice(0, 3)).toEqual([
      "collect",
      "example.com",
      "font.woff2",
    ]);
    expect(
      names(sortWaterfallRows(rows, { key: "status", direction: "desc" })).slice(0, 2)
    ).toEqual(["gone.png", "old.js"]);
    expect(names(sortWaterfallRows(rows, { key: "time", direction: "desc" }))[0]).toBe("tag.js");
    expect(names(sortWaterfallRows(rows, { key: "ttfb", direction: "desc" }))[0]).toBe("tag.js");
    expect(names(sortWaterfallRows(rows, { key: "host", direction: "asc" }))[0]).toBe("tag.js");
    expect(names(sortWaterfallRows(rows, { key: "type", direction: "asc" }))[0]).toBe(
      "example.com"
    );
  });

  it("orders priorities from VeryHigh to VeryLow and puts the rows without one last", () => {
    const noPriority = { ...rows[1], priority: null };
    const sorted = sortWaterfallRows([noPriority, ...rows.slice(2)], {
      key: "priority",
      direction: "asc",
    });

    expect(sorted[0].priority).toBe("VeryHigh");
    expect(sorted[sorted.length - 2].priority).toBe("VeryLow");
    expect(sorted[sorted.length - 1].priority).toBeNull();
    const reversed = sortWaterfallRows([noPriority, ...rows.slice(2)], {
      key: "priority",
      direction: "desc",
    });
    expect(reversed[0].priority).toBe("VeryLow");
    expect(reversed[reversed.length - 1].priority).toBeNull();
  });

  it("orders protocols h1, h2, h3 and leaves the input untouched", () => {
    const before = [...rows];
    const sorted = sortWaterfallRows(rows, { key: "protocol", direction: "asc" });

    expect(sorted.slice(0, 3).map((r) => r.httpVersion)).toEqual(["h1", "h2", "h3"]);
    expect(rows).toEqual(before);
  });
});
