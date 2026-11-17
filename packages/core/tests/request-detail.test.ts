import { describe, it, expect } from "vitest";
import { requestDetail } from "../src/analysis/request-detail.js";
import { parseHarPages } from "../src/parsers/har-parser.js";
import type { ParsedHar } from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";
import { secretHar } from "./helpers/secret-har.js";

const detailOfSecond = (har: ParsedHar) => requestDetail(har, har.entries[1]!);

const DOC = "https://example.com/";
const APP = "https://example.com/app.js";
const CHUNK = "https://example.com/chunk.js";

describe("requestDetail — initiator", () => {
  it("follows the initiators up to the document, each link with its entry", () => {
    const har = makeHar([
      makeEntry({ url: APP, initiator: { type: "parser", url: DOC, lineNumber: 4 } }),
      makeEntry({ url: CHUNK, initiator: { type: "script", url: APP, lineNumber: 12 } }),
      makeEntry({ url: "https://cdn.example/img.png", initiator: { type: "script", url: CHUNK } }),
    ]);
    har.documentEntry.initiator = { type: "other" };

    expect(requestDetail(har, har.entries[3]!).initiator).toEqual({
      type: "script",
      chain: [
        { type: "script", url: CHUNK, entryIndex: 2 },
        { type: "script", url: APP, lineNumber: 12, entryIndex: 1 },
        { type: "parser", url: DOC, lineNumber: 4, entryIndex: 0 },
      ],
    });
  });

  it("stops at a URL the page never requested, and at a loop", () => {
    const outside = makeHar([
      makeEntry({ url: APP, initiator: { type: "script", url: "https://gone.example/a.js" } }),
    ]);
    expect(requestDetail(outside, outside.entries[1]!).initiator?.chain).toEqual([
      { type: "script", url: "https://gone.example/a.js", entryIndex: null },
    ]);

    const loop = makeHar([
      makeEntry({ url: APP, initiator: { type: "script", url: CHUNK } }),
      makeEntry({ url: CHUNK, initiator: { type: "script", url: APP } }),
    ]);
    expect(requestDetail(loop, loop.entries[1]!).initiator?.chain.map((link) => link.url)).toEqual([
      CHUNK,
      APP,
    ]);
  });

  it("gives the type alone when the initiator has no URL, and null without an initiator", () => {
    const har = makeHar([]);
    har.documentEntry.initiator = { type: "other" };
    expect(requestDetail(har, har.entries[0]!).initiator).toEqual({ type: "other", chain: [] });
    expect(detailOfSecond(makeHar([makeEntry()])).initiator).toBeNull();
  });
});

describe("requestDetail — headers", () => {
  it("splits the lines into names and values and says which values are masked", () => {
    const har = makeHar([
      makeEntry({
        headers: {
          request: [
            ":authority: example.com",
            "cookie: sid=[redacted]****; theme=****",
            "authorization: [redacted]",
            "referer: https://example.com/?token=[redacted]",
            "accept: */*",
          ],
          response: ["content-type: text/css", "set-cookie: a=***; Path=/", "x-empty: "],
        },
      }),
    ]);

    expect(requestDetail(har, har.entries[1]!).headers).toEqual({
      request: [
        { name: ":authority", value: "example.com", masked: false },
        { name: "cookie", value: "sid=[redacted]****; theme=****", masked: true },
        { name: "authorization", value: "[redacted]", masked: true },
        { name: "referer", value: "https://example.com/?token=[redacted]", masked: true },
        { name: "accept", value: "*/*", masked: false },
      ],
      response: [
        { name: "content-type", value: "text/css", masked: false },
        { name: "set-cookie", value: "a=***; Path=/", masked: true },
        { name: "x-empty", value: "", masked: false },
      ],
    });
  });

  it("is null for an entry of a flow that kept no header lists", () => {
    expect(detailOfSecond(makeHar([makeEntry()])).headers).toBeNull();
  });

  it("reads the masked lines of a parsed HAR", () => {
    const [har] = parseHarPages(secretHar() as Parameters<typeof parseHarPages>[0]);
    const doc = har.entries.indexOf(har.documentEntry);
    const fields = requestDetail(har, har.entries[doc]!).headers!.request;

    expect(fields.find((f) => f.name === "authorization")).toEqual({
      name: "authorization",
      value: "[redacted]",
      masked: true,
    });
    expect(fields.find((f) => f.name === "accept")?.masked).toBe(false);
  });
});

describe("requestDetail — sizes and cache", () => {
  it("gives the bytes on the wire, the compressed and the uncompressed body", () => {
    const har = makeHar([
      makeEntry({
        transferSize: 1_300,
        encodedBodySize: 1_000,
        bodySize: 4_000,
        contentEncoding: "br",
      }),
    ]);

    expect(requestDetail(har, har.entries[1]!).sizes).toEqual({
      transfer: 1_300,
      compressedBody: 1_000,
      body: 4_000,
      encoding: "br",
    });
    expect(detailOfSecond(makeHar([makeEntry()])).sizes.compressedBody).toBeNull();
  });

  it("gives the browser cache, a revalidation, the CDN status and the freshness headers", () => {
    const har = makeHar([
      makeEntry({
        status: 304,
        bypassesCache: true,
        responseHeaders: {
          "cache-control": "public, max-age=600",
          age: "42",
          "x-cache": "HIT",
        },
      }),
      makeEntry({ fromCache: "memory" }),
    ]);

    expect(requestDetail(har, har.entries[1]!).cache).toEqual({
      browser: false,
      revalidated: true,
      bypassed: true,
      cdn: "hit",
      cacheControl: "public, max-age=600",
      age: 42,
    });
    expect(requestDetail(har, har.entries[2]!).cache).toMatchObject({
      browser: "memory",
      revalidated: false,
      bypassed: false,
      cdn: "unknown",
      cacheControl: null,
      age: null,
    });
  });
});
