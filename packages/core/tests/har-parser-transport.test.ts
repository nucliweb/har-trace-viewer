import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHar, pickResponseHeaders } from "../src/parsers/har-parser.js";
import { firefoxEntry, firefoxHar } from "./helpers/firefox-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const recording = (name: string) =>
  parseHar(JSON.parse(readFileSync(join(__dirname, `../../../fixtures/${name}`), "utf8")));

// One entry appended to a Firefox-style HAR, with the given request and response fields.
function parseEntry(
  response: Record<string, unknown> = {},
  request: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) {
  const raw = firefoxHar();
  const base = firefoxEntry("https://example.com/c.js", "text/javascript");
  raw.log.entries.push({
    ...base,
    request: { ...base.request, ...request },
    response: { ...base.response, ...response },
    ...extra,
  } as typeof base);
  return parseHar(raw).entries.at(-1)!;
}

const headers = (...pairs: [string, string][]) => pairs.map(([name, value]) => ({ name, value }));

describe("parseHar — HTTP version", () => {
  it.each([
    ["http/1.1", "h1"],
    ["HTTP/1.0", "h1"],
    ["http/2.0", "h2"],
    ["h2", "h2"],
    ["HTTP/2", "h2"],
    ["h3", "h3"],
    ["http/3", "h3"],
    ["h3-29", "h3"],
    ["", "unknown"],
    ["spdy/3", "unknown"],
  ])("normalises %j to %s", (httpVersion, expected) => {
    expect(parseEntry({ httpVersion }).httpVersion).toBe(expected);
  });

  it("is unknown when the HAR does not record it", () => {
    expect(parseEntry().httpVersion).toBe("unknown");
  });
});

describe("parseHar — connection id", () => {
  it("keeps Chrome's _connectionId as a string", () => {
    expect(parseEntry({}, {}, { _connectionId: "569258" }).connectionId).toBe("569258");
    expect(parseEntry({}, {}, { _connectionId: 42 }).connectionId).toBe("42");
  });

  it("leaves it out when the HAR has none, or an empty one (a browser-cache hit)", () => {
    expect(parseEntry()).not.toHaveProperty("connectionId");
    expect(parseEntry({}, {}, { _connectionId: "" })).not.toHaveProperty("connectionId");
  });
});

describe("parseHar — content encoding", () => {
  it.each([
    ["br", "br"],
    ["gzip", "gzip"],
    ["x-gzip", "gzip"],
    ["zstd", "zstd"],
    ["deflate", "deflate"],
    ["identity", "identity"],
    ["BR", "br"],
    // Several codings apply in order: the last one is what crossed the network.
    ["gzip, br", "br"],
    // Shared-dictionary Brotli and Zstandard.
    ["dcb", "br"],
    ["dcz", "zstd"],
  ])("reads %j as %s", (value, expected) => {
    const entry = parseEntry({ headers: headers(["Content-Encoding", value]) });
    expect(entry.contentEncoding).toBe(expected);
  });

  it("is none without a Content-Encoding header", () => {
    expect(parseEntry().contentEncoding).toBe("none");
  });
});

describe("parseHar — Server-Timing", () => {
  it("parses each metric with its duration and description", () => {
    const entry = parseEntry({
      headers: headers(
        ["Server-Timing", 'db;dur=53.2, app;dur=47.2;desc="Render, layout", cache;desc=hit'],
        ["Server-Timing", "edge"]
      ),
    });
    expect(entry.serverTiming).toEqual([
      { name: "db", dur: 53.2 },
      { name: "app", dur: 47.2, desc: "Render, layout" },
      { name: "cache", desc: "hit" },
      { name: "edge" },
    ]);
    expect(entry.responseHeaders["server-timing"]).toContain("db;dur=53.2");
  });

  it("is absent without the header", () => {
    expect(parseEntry()).not.toHaveProperty("serverTiming");
  });
});

describe("parseHar — request cookies", () => {
  it("measures the Cookie request header without keeping its value", () => {
    const entry = parseEntry({}, { headers: headers(["Cookie", "session=abc123; theme=dark"]) });
    expect(entry.requestCookieBytes).toBe(26);
    expect(JSON.stringify(entry)).not.toContain("abc123");
  });

  it("joins the Cookie headers HTTP/2 splits, as one header would carry them", () => {
    const entry = parseEntry({}, { headers: headers(["cookie", "a=1"], ["cookie", "b=22"]) });
    expect(entry.requestCookieBytes).toBe("a=1; b=22".length);
  });

  it("falls back to the request cookies list when the headers leave the cookie out", () => {
    const entry = parseEntry(
      {},
      {
        cookies: [
          { name: "a", value: "1" },
          { name: "id", value: "xyz" },
        ],
      }
    );
    expect(entry.requestCookieBytes).toBe("a=1; id=xyz".length);
  });

  it("is absent when the request carried no cookie", () => {
    expect(parseEntry({}, { cookies: [] })).not.toHaveProperty("requestCookieBytes");
  });
});

describe("parseHar — Alt-Svc", () => {
  it("flags a response that advertises HTTP/3", () => {
    const entry = parseEntry({ headers: headers(["alt-svc", 'h3=":443"; ma=86400']) });
    expect(entry.advertisesHttp3).toBe(true);
    expect(entry.responseHeaders["alt-svc"]).toBe('h3=":443"; ma=86400');
  });

  it("does not flag an Alt-Svc without h3, or a clear", () => {
    expect(parseEntry({ headers: headers(["alt-svc", 'h2=":443"']) })).not.toHaveProperty(
      "advertisesHttp3"
    );
    expect(parseEntry({ headers: headers(["alt-svc", "clear"]) })).not.toHaveProperty(
      "advertisesHttp3"
    );
  });
});

describe("pickResponseHeaders — transport headers", () => {
  it("keeps Server-Timing, Alt-Svc, Vary and Content-Encoding", () => {
    const kept = {
      "server-timing": "db;dur=1",
      "alt-svc": "h3=:443",
      vary: "Accept-Encoding",
      "content-encoding": "br",
    };
    expect(pickResponseHeaders(kept)).toEqual(kept);
  });
});

describe("parseHar — transport fields of a Chrome recording", () => {
  const { entries } = recording("webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har");

  it("reads the protocol of every request: h2 to the site and Cloudinary, h3 elsewhere", () => {
    const protocols = new Map(entries.map((e) => [new URL(e.url).host, e.httpVersion]));
    expect(Object.fromEntries(protocols)).toEqual({
      "webperf-snippets.nucliweb.net": "h2",
      "res.cloudinary.com": "h2",
      "cdn.debugbear.com": "h3",
      "www.googletagmanager.com": "h3",
      "region1.google-analytics.com": "h3",
      "data.debugbear.com": "h3",
    });
  });

  it("keeps the connection ids: every request to the site shares one", () => {
    const site = entries.filter((e) => new URL(e.url).host === "webperf-snippets.nucliweb.net");
    expect(new Set(site.map((e) => e.connectionId))).toEqual(new Set(["569258"]));
  });

  it("reads the encodings: Brotli, Zstandard for gtag.js, none for tiny responses", () => {
    const count = (encoding: string) => entries.filter((e) => e.contentEncoding === encoding);
    expect(count("br")).toHaveLength(29);
    expect(count("zstd").map((e) => e.url)).toEqual([
      "https://www.googletagmanager.com/gtag/js?id=G-NNX9SYKEV2",
    ]);
    expect(count("none")).toHaveLength(4);
  });

  it("parses Cloudinary's Server-Timing", () => {
    const image = entries.find((e) => e.url.includes("res.cloudinary.com"))!;
    expect(image.serverTiming?.[0]).toMatchObject({ name: "cld-fastly", dur: 2 });
  });
});
