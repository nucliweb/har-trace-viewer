import { describe, expect, it } from "vitest";
import {
  compareRequests,
  requestMatchKeys,
  requestPairChanged,
} from "../src/analysis/request-diff.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { compareFlows } from "../src/analysis/compare.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";
import type { HarEntry } from "../src/types.js";

const script = (url: string, startTime: number, overrides: Partial<HarEntry> = {}) =>
  makeEntry({
    url,
    startTime,
    mimeType: "application/javascript",
    resourceType: "script",
    priority: "Low",
    ...overrides,
  });

const urlsOf = (requests: { url: string }[]) => requests.map((r) => r.url);

describe("compareRequests — matching", () => {
  it("pairs the requests both sides made to the same URL", () => {
    const a = makeHar([script("https://example.com/app.js", 100)]);
    const b = makeHar([script("https://example.com/app.js", 120)]);

    const { pairs, added, removed } = compareRequests(a, b);

    expect(pairs.map((p) => [p.a.url, p.b.url, p.match])).toEqual([
      ["https://example.com/", "https://example.com/", "url"],
      ["https://example.com/app.js", "https://example.com/app.js", "url"],
    ]);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("lists what only B requested as added and what only A requested as removed", () => {
    const a = makeHar([script("https://example.com/old.js", 100)]);
    const b = makeHar([
      script("https://example.com/new.js", 100),
      script("https://cdn.other.com/tag.js", 200),
    ]);

    const { pairs, added, removed } = compareRequests(a, b);

    expect(urlsOf(pairs.map((p) => p.b))).toEqual(["https://example.com/"]);
    expect(urlsOf(added)).toEqual(["https://example.com/new.js", "https://cdn.other.com/tag.js"]);
    expect(urlsOf(removed)).toEqual(["https://example.com/old.js"]);
  });

  it("pairs repeated requests to one URL in their order of start, the k-th with the k-th", () => {
    const poll = (startTime: number, transferSize: number) =>
      makeEntry({
        url: "https://example.com/api/poll",
        startTime,
        resourceType: "fetch",
        transferSize,
      });
    // B's entries are recorded out of order: the start decides, not the position.
    const a = makeHar([poll(100, 1), poll(200, 2), poll(300, 3)]);
    const b = makeHar([poll(310, 30), poll(110, 10), poll(210, 20)]);

    const { pairs, added } = compareRequests(a, b);

    const polls = pairs.filter((p) => p.a.url.endsWith("/poll"));
    expect(polls.map((p) => [p.a.transferBytes, p.b.transferBytes])).toEqual(
      expect.arrayContaining([
        [1, 10],
        [2, 20],
        [3, 30],
      ])
    );
    expect(polls).toHaveLength(3);
    expect(added).toEqual([]);
  });

  it("pairs a URL requested twice with different types by type before order", () => {
    // A prefetched the chunk ("other") then ran it; B only ran it.
    const chunk = "https://example.com/chunk.js";
    const a = makeHar([
      script(chunk, 100, { resourceType: "other", priority: "VeryLow", transferSize: 10 }),
      script(chunk, 200, { transferSize: 20 }),
    ]);
    const b = makeHar([script(chunk, 150, { transferSize: 25 })]);

    const { pairs, removed } = compareRequests(a, b);

    const pair = pairs.find((p) => p.a.url === chunk)!;
    expect([pair.a.resourceType, pair.a.transferBytes, pair.b.transferBytes]).toEqual([
      "script",
      20,
      25,
    ]);
    expect(removed.map((r) => r.resourceType)).toEqual(["other"]);
  });

  it("pairs a URL whose type changed when nothing better is left", () => {
    const url = "https://example.com/data.json";
    const a = makeHar([makeEntry({ url, startTime: 100, resourceType: "fetch" })]);
    const b = makeHar([makeEntry({ url, startTime: 100, resourceType: "other" })]);

    const { pairs, added } = compareRequests(a, b);

    expect(pairs.find((p) => p.a.url === url)?.match).toBe("url");
    expect(added).toEqual([]);
  });

  it("pairs hashed file names as similar", () => {
    const a = makeHar([
      script("https://example.com/_next/static/chunks/main-93d7eb3c1c216c38.js", 100),
    ]);
    const b = makeHar([
      script("https://example.com/_next/static/chunks/main-0a1b2c3d4e5f6789.js", 100),
    ]);

    const { pairs, added, removed } = compareRequests(a, b);

    const pair = pairs.find((p) => p.a.url.includes("main-"))!;
    expect(pair.match).toBe("similar");
    expect(pair.b.url).toContain("main-0a1b2c3d4e5f6789.js");
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("pairs cache-busting query strings and session ids as similar", () => {
    const a = makeHar([
      script("https://example.com/app.js?v=1&_=1716000000000", 100),
      makeEntry({
        url: "https://example.com/api/cart?sid=abc&lang=en",
        startTime: 200,
        resourceType: "fetch",
      }),
    ]);
    const b = makeHar([
      script("https://example.com/app.js?v=2&_=1716000999999", 100),
      makeEntry({
        url: "https://example.com/api/cart?lang=en&sid=xyz",
        startTime: 200,
        resourceType: "fetch",
      }),
    ]);

    const { pairs, added } = compareRequests(a, b);

    expect(pairs.filter((p) => p.match === "similar").map((p) => p.b.url)).toEqual([
      "https://example.com/app.js?v=2&_=1716000999999",
      "https://example.com/api/cart?lang=en&sid=xyz",
    ]);
    expect(added).toEqual([]);
  });

  it("pairs a beacon whose query changed by host, path and type, after the exact matches", () => {
    const beacon = (query: string, startTime: number) =>
      makeEntry({
        url: `https://analytics.example.net/collect?${query}`,
        startTime,
        resourceType: "fetch",
      });
    const a = makeHar([beacon("en=page_view&seq=1", 400)]);
    const b = makeHar([beacon("en=scroll&seq=7", 450)]);

    const { pairs } = compareRequests(a, b);

    expect(pairs.find((p) => p.a.url.includes("collect"))?.match).toBe("similar");
  });

  it("prefers an exact URL to a similar one, whatever the order", () => {
    // B's v=2 starts first, but A's v=1 has an exact match later in B.
    const a = makeHar([script("https://example.com/app.js?v=1", 100)]);
    const b = makeHar([
      script("https://example.com/app.js?v=2", 90),
      script("https://example.com/app.js?v=1", 100),
    ]);

    const { pairs, added } = compareRequests(a, b);

    const pair = pairs.find((p) => p.a.url.includes("app.js"))!;
    expect([pair.b.url, pair.match]).toEqual(["https://example.com/app.js?v=1", "url"]);
    expect(urlsOf(added)).toEqual(["https://example.com/app.js?v=2"]);
  });

  it("never pairs requests of different methods or hosts", () => {
    const a = makeHar([
      makeEntry({ url: "https://api.example.com/items", resourceType: "fetch", method: "GET" }),
      script("https://a.example.com/x-93d7eb3c1c216c38.js", 100),
    ]);
    const b = makeHar([
      makeEntry({ url: "https://api.example.com/items", resourceType: "fetch", method: "POST" }),
      script("https://b.example.com/x-0a1b2c3d4e5f6789.js", 100),
    ]);

    const { added, removed } = compareRequests(a, b);

    expect(added).toHaveLength(2);
    expect(removed).toHaveLength(2);
  });

  it("pairs every request at most once and keeps every request on some list", () => {
    const a = makeHar([
      script("https://example.com/a-11111111aaaa.js", 100),
      script("https://example.com/a-22222222bbbb.js", 110),
      script("https://example.com/a-33333333cccc.js", 120),
    ]);
    const b = makeHar([
      script("https://example.com/a-44444444dddd.js", 100),
      script("https://example.com/a-55555555eeee.js", 105),
    ]);

    const { pairs, added, removed } = compareRequests(a, b);

    expect(pairs.length + removed.length).toBe(a.entries.length);
    expect(pairs.length + added.length).toBe(b.entries.length);
    // Same key: paired by order of start, the third of A left over.
    expect(removed.map((r) => r.url)).toEqual(["https://example.com/a-33333333cccc.js"]);
  });
});

describe("requestMatchKeys", () => {
  const keys = (url: string, overrides: Partial<HarEntry> = {}) =>
    requestMatchKeys(makeEntry({ url, resourceType: "script", ...overrides }));

  // The key of the similar pass that keeps the query.
  const similar = (url: string) => keys(url)[2];

  it("strips hex hashes, long tokens, long numbers and UUIDs from the path", () => {
    expect(similar("https://example.com/c/1a001d9d-d1ad1d66024adf38.js")).toBe(
      similar("https://example.com/c/ffff0000-0123456789abcdef.js")
    );
    expect(
      similar("https://example.com/_next/static/Ssnu0sFGh6UAVvqPLv-Oh/_buildManifest.js")
    ).toBe(similar("https://example.com/_next/static/Q7mE2kLpX9vRt4bNw8Zc-Oh/_buildManifest.js"));
    expect(similar("https://res.example.com/upload/v1685735993/hero.jpg")).toBe(
      similar("https://res.example.com/upload/v1700000000/hero.jpg")
    );
    expect(similar("https://example.com/u/550e8400-e29b-41d4-a716-446655440000/avatar.png")).toBe(
      similar("https://example.com/u/123e4567-e89b-12d3-a456-426614174000/avatar.png")
    );
  });

  it("keeps the readable parts of a path apart", () => {
    expect(similar("https://example.com/pages/Loading/TTFB-8c60f813cd42c5b3.js")).not.toBe(
      similar("https://example.com/pages/Loading/FCP-8c60f813cd42c5b3.js")
    );
    // Words without a digit are no hash, short numbers no version.
    expect(similar("https://example.com/deadbeefcafe/9033.js")).not.toBe(
      similar("https://example.com/feedfacecafe/9034.js")
    );
  });

  it("drops volatile query parameters and sorts the others", () => {
    expect(similar("https://example.com/a.js?b=2&a=1&utm_source=x&cb=9&ts=123")).toBe(
      similar("https://example.com/a.js?a=1&b=2")
    );
    expect(similar("https://example.com/a.js?page=1")).not.toBe(
      similar("https://example.com/a.js?page=2")
    );
  });

  it("goes from the exact URL to the host and path alone", () => {
    const all = keys("https://example.com/a.js?page=1", { method: "GET" });
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
    expect(all[3]).toBe(keys("https://example.com/a.js?page=2", { method: "GET" })[3]);
  });

  it("keeps a URL it cannot parse as it is", () => {
    const [exact, , similar] = keys("not a url");
    expect(exact).toContain("not a url");
    expect(similar).toContain("not a url");
  });
});

describe("compareRequests — what a pair carries", () => {
  it("reads both sides and B − A of start, time, TTFB and transfer", () => {
    const a = makeHar([
      script("https://example.com/app.js", 100, {
        duration: 80,
        ttfb: 30,
        transferSize: 5000,
        status: 200,
        httpVersion: "h2",
        priority: "High",
      }),
    ]);
    const b = makeHar([
      script("https://example.com/app.js", 140, {
        duration: 5,
        ttfb: 2,
        transferSize: 0,
        status: 200,
        httpVersion: "h2",
        priority: "High",
        fromCache: "memory",
      }),
    ]);

    const pair = compareRequests(a, b).pairs.find((p) => p.a.url.endsWith("app.js"))!;

    expect(pair.a).toMatchObject({
      method: "GET",
      resourceType: "script",
      startMs: 100,
      durationMs: 80,
      ttfbMs: 30,
      transferBytes: 5000,
      status: 200,
      protocol: "h2",
      cache: "network",
      priority: "High",
    });
    expect(pair.b).toMatchObject({ cache: "browser", durationMs: 16 });
    // The time is the waterfall's: the phases add up to 16 ms, more than the 5 ms duration.
    expect(pair.delta).toEqual({ startMs: 40, durationMs: -64, ttfbMs: -28, transferBytes: -5000 });
    expect(pair.changes).toEqual(["cache"]);
  });

  it("points each side at its entry in the page's HAR", () => {
    const a = makeHar([script("https://example.com/x.js", 100)]);
    const b = makeHar([
      script("https://example.com/y.js", 50),
      script("https://example.com/x.js", 100),
    ]);

    const { pairs, added } = compareRequests(a, b);

    const pair = pairs.find((p) => p.a.url.endsWith("x.js"))!;
    expect(a.entries[pair.a.entryIndex].url).toBe(pair.a.url);
    expect(b.entries[pair.b.entryIndex].url).toBe(pair.b.url);
    expect(pair.b.entryIndex).toBe(2);
    expect(added[0].entryIndex).toBe(1);
  });

  it("names the status, protocol, cache and priority that changed", () => {
    const a = makeHar([
      script("https://example.com/app.js", 100, {
        status: 200,
        httpVersion: "h2",
        priority: "High",
      }),
    ]);
    const b = makeHar([
      script("https://example.com/app.js", 100, {
        status: 304,
        httpVersion: "h3",
        priority: "Low",
        fromCache: "disk",
      }),
    ]);

    const pair = compareRequests(a, b).pairs.find((p) => p.a.url.endsWith("app.js"))!;

    expect(pair.changes).toEqual(["status", "protocol", "cache", "priority"]);
  });

  it("names no protocol or priority change when a side does not know it", () => {
    const a = makeHar([script("https://example.com/app.js", 100, { httpVersion: "unknown" })]);
    const b = makeHar([
      script("https://example.com/app.js", 100, { httpVersion: "h2", priority: undefined }),
    ]);

    const pair = compareRequests(a, b).pairs.find((p) => p.a.url.endsWith("app.js"))!;

    expect(pair.a.protocol).toBeNull();
    expect(pair.b.priority).toBeNull();
    expect(pair.changes).toEqual([]);
  });

  it("orders the pairs by the biggest change of time first, then of bytes", () => {
    const a = makeHar([
      script("https://example.com/small.js", 100, { duration: 50, transferSize: 1000 }),
      script("https://example.com/slow.js", 110, { duration: 50 }),
      script("https://example.com/big.js", 120, { duration: 50, transferSize: 1000 }),
    ]);
    const b = makeHar([
      script("https://example.com/small.js", 100, { duration: 50, transferSize: 1100 }),
      script("https://example.com/slow.js", 110, { duration: 400 }),
      script("https://example.com/big.js", 120, { duration: 50, transferSize: 90000 }),
    ]);

    const { pairs } = compareRequests(a, b);

    expect(pairs.map((p) => p.b.url.split("/").pop())).toEqual([
      "slow.js",
      "big.js",
      "small.js",
      "",
    ]);
  });

  it("orders added and removed requests by their start", () => {
    const a = makeHar([
      script("https://example.com/r2.js", 300),
      script("https://example.com/r1.js", 200),
    ]);
    const b = makeHar([
      script("https://example.com/n2.js", 300),
      script("https://example.com/n1.js", 200),
    ]);

    const { added, removed } = compareRequests(a, b);

    expect(urlsOf(added)).toEqual(["https://example.com/n1.js", "https://example.com/n2.js"]);
    expect(urlsOf(removed)).toEqual(["https://example.com/r1.js", "https://example.com/r2.js"]);
  });
});

describe("requestPairChanged", () => {
  const pairWith = (b: Partial<HarEntry>) =>
    compareRequests(
      makeHar([script("https://example.com/app.js", 100)]),
      makeHar([script("https://example.com/app.js", 100, b)])
    ).pairs.find((p) => p.a.url.endsWith("app.js"))!;

  it("is false for a request that took the same time and bytes, with nothing else changed", () => {
    expect(requestPairChanged(pairWith({}))).toBe(false);
    // Under half a millisecond reads as the same time.
    expect(requestPairChanged(pairWith({ duration: 50.4 }))).toBe(false);
  });

  it("is true for a whole millisecond, a byte or an attribute changed", () => {
    expect(requestPairChanged(pairWith({ duration: 51 }))).toBe(true);
    expect(requestPairChanged(pairWith({ transferSize: 1025 }))).toBe(true);
    expect(requestPairChanged(pairWith({ status: 304 }))).toBe(true);
  });
});

describe("compareFlows — requests", () => {
  it("compares the requests of the first page of each flow", () => {
    const a = generateFlow([
      { name: "Cold", har: makeHar([script("https://example.com/app.js", 100)]) },
      { name: "Second", har: makeHar([script("https://example.com/other.js", 100)]) },
    ]);
    const b = generateFlow([
      { name: "Warm", har: makeHar([script("https://example.com/app.js", 90)]) },
    ]);

    const { requests } = compareFlows(a, b);

    expect(requests.pages).toEqual({ a: "Cold", b: "Warm" });
    expect(requests.added).toEqual([]);
    expect(requests.removed).toEqual([]);
    expect(requests.pairs).toHaveLength(2);
  });
});
