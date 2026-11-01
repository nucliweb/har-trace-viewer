import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHar, parseHarJson } from "../src/parsers/har-parser.js";
import { detectCdnCacheStatus } from "../src/inference/cache-analyzer.js";
import { firefoxEntry, firefoxHar } from "./helpers/firefox-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const redirectFixturePath = join(__dirname, "fixtures/redirect-iframe.har.fixture.json");

function harWithDocumentHeaders(headers: { name: string; value: string }[]) {
  const har = firefoxHar();
  const document = firefoxEntry("https://example.com/", "text/html", {
    response: { status: 200, headers, content: { mimeType: "text/html", size: 1000 } },
  });
  return { log: { ...har.log, entries: [document, ...har.log.entries.slice(1)] } } as Parameters<
    typeof parseHar
  >[0];
}

describe("parseHar — repeated response headers", () => {
  it("joins repeated headers with a comma, in the order received", () => {
    const parsed = parseHar(
      harWithDocumentHeaders([
        { name: "X-Cache", value: "MISS" },
        { name: "x-cache", value: "HIT" },
      ])
    );
    expect(parsed.documentEntry.responseHeaders["x-cache"]).toBe("MISS, HIT");
  });

  it("reads the cache tier closest to the client from joined x-cache headers", () => {
    const parsed = parseHar(
      harWithDocumentHeaders([
        { name: "x-cache", value: "MISS" },
        { name: "x-cache", value: "HIT" },
      ])
    );
    expect(detectCdnCacheStatus(parsed.documentEntry.responseHeaders)).toBe("hit");
  });

  it("finds a preconnect in every Link header of the document", () => {
    const parsed = parseHarJson(readFileSync(redirectFixturePath, "utf8"));
    expect(parsed.preconnectHints).toEqual({
      "fonts.gstatic.com": "link-header",
      "www.googletagmanager.com": "link-header",
    });
  });

  it("does not split a Link header on commas inside the URL", () => {
    const parsed = parseHar(
      harWithDocumentHeaders([
        {
          name: "link",
          value:
            "<https://cdn.example/fonts?family=Inter:wght@400,700>; rel=preconnect, <https://img.example>; rel=preconnect",
        },
      ])
    );
    expect(Object.keys(parsed.preconnectHints).sort()).toEqual(["cdn.example", "img.example"]);
  });

  it("reads preconnect from a rel attribute that lists several relations", () => {
    const parsed = parseHar(
      harWithDocumentHeaders([
        { name: "link", value: '<https://a.example>; rel="dns-prefetch preconnect"' },
        { name: "link", value: "<https://b.example>; rel=preload; as=style" },
      ])
    );
    expect(parsed.preconnectHints).toEqual({ "a.example": "link-header" });
  });
});
