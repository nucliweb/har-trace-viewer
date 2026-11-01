import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHar, parseHarJson, parseHarPages } from "../src/parsers/har-parser.js";
import { firefoxEntry, firefoxHar } from "./helpers/firefox-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const redirectFixturePath = join(__dirname, "fixtures/redirect-iframe.har.fixture.json");

function redirectResponse(status: number, mimeType: string, location: string, redirectURL = "") {
  return {
    status,
    headers: [{ name: "Location", value: location }],
    content: { mimeType, size: 0 },
    redirectURL,
    bodySize: 0,
    headersSize: 200,
  };
}

function harWith(entries: unknown[], title = "Example") {
  const har = firefoxHar();
  har.log.pages[0].title = title;
  return { log: { ...har.log, entries } } as Parameters<typeof parseHar>[0];
}

describe("parseHar — document entry behind a redirect chain (Chrome HAR)", () => {
  const parsed = parseHarJson(readFileSync(redirectFixturePath, "utf8"));

  it("takes the final response of the redirect chain as the document, not the 301", () => {
    expect(parsed.documentEntry.url).toBe("https://webperf-snippets.nucliweb.net/");
    expect(parsed.documentEntry.status).toBe(200);
    expect(parsed.documentEntry.ttfb).toBeCloseTo(196.4, 1);
  });

  it("keeps the redirects that led to the document, in order", () => {
    expect(parsed.documentRedirects?.map((e) => [e.status, e.url])).toEqual([
      [301, "https://nucliweb.net/webperf-snippets"],
    ]);
    expect(parsed.entries).toContain(parsed.documentRedirects?.[0]);
  });

  it("does not take a same-origin iframe as the document", () => {
    expect(parsed.documentEntry.url).not.toContain("/embed/");
  });
});

describe("parseHar — document entry selection", () => {
  it("has no redirects when the first request is the document", () => {
    const parsed = parseHar(firefoxHar());
    expect(parsed.documentEntry.url).toBe("https://example.com/");
    expect(parsed.documentRedirects).toEqual([]);
  });

  it("takes a 304 revalidation as the document", () => {
    const entries = [
      firefoxEntry("https://example.com/", "text/html", {
        response: { status: 304, headers: [], content: { mimeType: "text/html", size: 0 } },
      }),
      firefoxEntry("https://example.com/app.js", "application/javascript"),
    ];
    const parsed = parseHar(harWith(entries));
    expect(parsed.documentEntry.status).toBe(304);
    expect(parsed.documentRedirects).toEqual([]);
  });

  it("follows a chain of redirects without an HTML body, and relative Location headers", () => {
    const entries = [
      firefoxEntry("http://example.com/", "", {
        response: redirectResponse(308, "", "https://example.com/", "https://example.com/"),
      }),
      firefoxEntry("https://example.com/", "text/html", {
        response: redirectResponse(302, "text/html", "/home"),
      }),
      firefoxEntry("https://example.com/home", "text/html; charset=utf-8"),
      firefoxEntry("https://example.com/app.js", "application/javascript"),
    ];
    const parsed = parseHar(harWith(entries));
    expect(parsed.documentEntry.url).toBe("https://example.com/home");
    expect(parsed.documentRedirects?.map((e) => e.status)).toEqual([308, 302]);
  });

  it("skips an HTML redirect whose target the HAR did not record", () => {
    const entries = [
      firefoxEntry("https://example.com/old", "text/html", {
        startedDateTime: "2026-01-01T00:00:00.000Z",
        response: redirectResponse(301, "text/html", "https://example.com/elsewhere"),
      }),
      firefoxEntry("https://example.com/", "text/html"),
    ];
    const parsed = parseHar(harWith(entries));
    expect(parsed.documentEntry.url).toBe("https://example.com/");
    expect(parsed.documentRedirects).toEqual([]);
  });

  it("prefers the HTML response whose URL is the page title over an earlier one", () => {
    const entries = [
      firefoxEntry("https://example.com/frame.html", "text/html"),
      firefoxEntry("https://example.com/", "text/html"),
    ];
    const parsed = parseHar(harWith(entries, "https://example.com/"));
    expect(parsed.documentEntry.url).toBe("https://example.com/");
  });

  it("takes the first final HTML response when no URL matches the title", () => {
    const entries = [
      firefoxEntry("https://example.com/", "text/html"),
      firefoxEntry("https://example.com/frame.html", "text/html"),
    ];
    expect(parseHar(harWith(entries, "Example Domain")).documentEntry.url).toBe(
      "https://example.com/"
    );
  });

  it("still parses a HAR whose only HTML response is a redirect", () => {
    const entries = [
      firefoxEntry("https://example.com/", "text/html", {
        response: redirectResponse(301, "text/html", "https://other.example/"),
      }),
    ];
    expect(parseHar(harWith(entries)).documentEntry.status).toBe(301);
  });

  it("follows the redirect chain of each page in a multi-page HAR", () => {
    const raw = JSON.parse(readFileSync(redirectFixturePath, "utf8"));
    const [page] = parseHarPages(raw);
    expect(page.documentEntry.url).toBe("https://webperf-snippets.nucliweb.net/");
    expect(page.documentRedirects).toHaveLength(1);
  });
});
