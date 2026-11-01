import { describe, it, expect } from "vitest";
import {
  browserCacheHits,
  isBrowserCacheHit,
  isOwnNetworkResource,
  isOwnResource,
  networkRequests,
} from "../src/analysis/network-requests.js";
import { parseHar } from "../src/parsers/har-parser.js";
import { firefoxEntry, firefoxHar } from "./helpers/firefox-har.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";
import type { InferredCacheHit } from "../src/types.js";

const ROOT = "example.com";

describe("network requests and browser-cache hits", () => {
  it("takes a browser-cache hit from the parser's fromCache detection", () => {
    const raw = firefoxHar();
    raw.log.entries.push(
      firefoxEntry("https://example.com/disk.js", "text/javascript", { _fromCache: "disk" }),
      firefoxEntry("https://example.com/memory.js", "text/javascript", { _fromCache: "memory" }),
      firefoxEntry("https://example.com/legacy.js", "text/javascript", {
        cache: { beforeRequest: { lastAccess: "2026-01-01T00:00:00.000Z" } },
      })
    );
    const har = parseHar(raw);

    expect(har.entries.filter(isBrowserCacheHit).map((e) => e.url)).toEqual([
      "https://example.com/disk.js",
      "https://example.com/memory.js",
      "https://example.com/legacy.js",
    ]);
    expect(networkRequests(har)).toHaveLength(5);
  });

  it("counts a 304 revalidation as a network request, not a cache hit", () => {
    const har = makeHar([makeEntry({ status: 304, transferSize: 120 })]);

    expect(networkRequests(har)).toHaveLength(2);
    expect(browserCacheHits(har)).toBe(0);
  });

  it("counts browser-cache hits, the document included, plus WebPageTest inferred hits", () => {
    const inferred: InferredCacheHit = {
      url: "https://example.com/old.js",
      resourceType: "script",
      transferSize: 900,
      lifetime: 3600,
    };
    const har = {
      ...makeHar([makeEntry({ fromCache: "disk" }), makeEntry({ fromCache: "memory" })]),
      inferredCacheHits: [inferred],
    };
    har.documentEntry.fromCache = "disk";

    expect(browserCacheHits(har)).toBe(4);
    expect(networkRequests(har)).toHaveLength(0);
  });
});

describe("own resources", () => {
  const css = makeEntry({ url: "https://static.example.com/app.css" });
  const cachedCss = makeEntry({ url: "https://example.com/cached.css", fromCache: "disk" });
  const thirdParty = makeEntry({ url: "https://cdn.other.net/lib.js" });
  const document = makeEntry({ url: "https://example.com/", isDocument: true });

  it("is a non-document resource of the document's registrable domain", () => {
    expect(isOwnResource(css, ROOT)).toBe(true);
    expect(isOwnResource(cachedCss, ROOT)).toBe(true);
    expect(isOwnResource(thirdParty, ROOT)).toBe(false);
    expect(isOwnResource(document, ROOT)).toBe(false);
  });

  it("reaches the network only when the browser cache did not serve it", () => {
    expect(isOwnNetworkResource(css, ROOT)).toBe(true);
    expect(isOwnNetworkResource(cachedCss, ROOT)).toBe(false);
    expect(isOwnNetworkResource(thirdParty, ROOT)).toBe(false);
    expect(isOwnNetworkResource(document, ROOT)).toBe(false);
  });
});
