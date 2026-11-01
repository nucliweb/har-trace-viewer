import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { analyzeConnections } from "../src/analysis/connections.js";
import type { ConnectionsReport, HarEntry, ParsedHar } from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const recording = (name: string) =>
  parseHarJson(readFileSync(join(__dirname, `../../../fixtures/${name}`), "utf8"));

const NEW_CONNECTION = { dns: 5, connect: 30, ssl: 15, send: 1, wait: 20, receive: 5, blocked: 0 };

// A request to `host` over `httpVersion` and connection `connectionId`.
function request(
  host: string,
  httpVersion: HarEntry["httpVersion"],
  connectionId: string | undefined,
  over: Partial<HarEntry> = {}
): HarEntry {
  return makeEntry({
    url: `https://${host}/${Math.random().toString(36).slice(2)}.js`,
    mimeType: "application/javascript",
    resourceType: "script",
    httpVersion,
    ...(connectionId !== undefined && { connectionId }),
    ...over,
  });
}

const times = (count: number, make: (i: number) => HarEntry) =>
  Array.from({ length: count }, (_, i) => make(i));

// The document of makeHar goes to example.com over h2 on connection "doc".
function page(entries: HarEntry[], document: Partial<HarEntry> = {}): ParsedHar {
  const har = makeHar(entries);
  Object.assign(har.entries[0], { httpVersion: "h2", connectionId: "doc", ...document });
  return har;
}

const labels = (report: ConnectionsReport) =>
  report.recommendations.map((r) => [r.label, r.severity]);
const host = (report: ConnectionsReport, name: string) =>
  report.hosts.find((h) => h.host === name)!;

describe("analyzeConnections — protocol and connections per host", () => {
  const report = analyzeConnections(
    page([
      ...times(3, (i) => request("example.com", "h2", "doc", { startTime: 100 + i })),
      request("h3.example.net", "h3", "q1", { timing: NEW_CONNECTION }),
      request("old.example.org", "h1", "a", { timing: NEW_CONNECTION }),
      request("old.example.org", "h1", "b", { timing: NEW_CONNECTION }),
      request("upgrade.example.io", "h2", "t1"),
      request("upgrade.example.io", "h3", "q2"),
      request("legacy-har.example.com", "unknown", undefined),
      // A browser-cache hit replays a stored response: not a request of this load.
      request("h3.example.net", "h2", "", { fromCache: "disk" }),
    ])
  );

  it("reads one protocol per host, mixed when it changed, unknown when the HAR does not say", () => {
    expect(report.hosts.map((h) => [h.host, h.protocol])).toEqual([
      ["example.com", "h2"],
      ["old.example.org", "h1"],
      ["upgrade.example.io", "mixed"],
      ["h3.example.net", "h3"],
      ["legacy-har.example.com", "unknown"],
    ]);
  });

  it("counts the connections each host used, and the requests per connection", () => {
    expect(host(report, "example.com")).toMatchObject({
      requests: 4,
      connections: 1,
      requestsPerConnection: 4,
    });
    expect(host(report, "old.example.org")).toMatchObject({
      requests: 2,
      connections: 2,
      requestsPerConnection: 1,
    });
    expect(host(report, "legacy-har.example.com")).toMatchObject({
      connections: null,
      requestsPerConnection: null,
    });
  });

  it("counts the DNS lookups and the TCP and TLS handshakes paid per host", () => {
    expect(host(report, "old.example.org")).toMatchObject({
      dnsLookups: 2,
      tcpHandshakes: 2,
      tlsHandshakes: 2,
    });
    expect(host(report, "upgrade.example.io")).toMatchObject({
      dnsLookups: 0,
      tcpHandshakes: 0,
      tlsHandshakes: 0,
    });
  });

  it("summarizes the document's Server-Timing", () => {
    const timed = analyzeConnections(
      page([], {
        serverTiming: [
          { name: "db", dur: 53 },
          { name: "app", dur: 47, desc: "Render" },
        ],
      })
    );
    expect(timed.serverTiming).toEqual([
      { name: "db", dur: 53 },
      { name: "app", dur: 47, desc: "Render" },
    ]);
    expect(report.serverTiming).toEqual([]);
  });
});

describe("analyzeConnections — recommendations", () => {
  it("warns about a host still on HTTP/1.1 with 6 requests or more", () => {
    const busy = analyzeConnections(
      page(times(6, (i) => request("static.example.com", "h1", String(i % 6))))
    );
    expect(labels(busy)).toEqual([["Hosts still on HTTP/1.1", "warning"]]);
    expect(busy.recommendations[0].resources).toEqual([
      {
        url: "https://static.example.com/",
        transferSize: 6 * 1024,
        detail: "6 requests · 6 connections",
      },
    ]);

    const quiet = analyzeConnections(page([request("api.example.com", "h1", "a")]));
    expect(labels(quiet)).toEqual([["Hosts still on HTTP/1.1", "info"]]);
  });

  it("notes several HTTP/2 connections to one host, a warning when each paid a handshake", () => {
    const reused = analyzeConnections(
      page([
        ...times(3, () => request("cdn.example.com", "h2", "c1")),
        request("cdn.example.com", "h2", "c2"),
      ])
    );
    expect(labels(reused)).toEqual([["Several connections to the same host", "info"]]);

    const paid = analyzeConnections(
      page([
        request("cdn.example.com", "h2", "c1", { timing: NEW_CONNECTION }),
        request("cdn.example.com", "h2", "c2", { timing: NEW_CONNECTION }),
      ])
    );
    expect(labels(paid)).toEqual([["Several connections to the same host", "warning"]]);
    expect(paid.recommendations[0].resources?.[0].detail).toBe(
      "2 connections · 2 TCP and 2 TLS handshakes"
    );
  });

  it("notes the cookies sent to a host that serves only static files", () => {
    const report = analyzeConnections(
      page(
        times(3, () =>
          request("static.example.com", "h2", "s", {
            mimeType: "image/png",
            resourceType: "image",
            requestCookieBytes: 1_500,
          })
        )
      )
    );
    expect(host(report, "static.example.com")).toMatchObject({
      staticOnly: true,
      cookieBytes: 4_500,
      maxCookieBytes: 1_500,
    });
    expect(labels(report)).toEqual([["Cookies sent to static hosts", "info"]]);
    expect(report.recommendations[0].resources).toEqual([
      {
        url: "https://static.example.com/",
        transferSize: 3 * 1024,
        detail: "4.5 KB of cookies over 3 requests",
      },
    ]);
  });

  it("leaves out cookies under 1 KB, and hosts that serve more than static files", () => {
    const report = analyzeConnections(
      page([
        request("static.example.com", "h2", "s", { requestCookieBytes: 900 }),
        request("app.example.com", "h2", "a", {
          requestCookieBytes: 4_000,
          mimeType: "application/json",
          resourceType: "fetch",
        }),
      ])
    );
    expect(report.recommendations.map((r) => r.label)).not.toContain(
      "Cookies sent to static hosts"
    );
  });

  it("notes a host that advertises HTTP/3 but was only reached over HTTP/2", () => {
    const report = analyzeConnections(
      page([request("cdn.example.com", "h2", "c", { advertisesHttp3: true })])
    );
    expect(labels(report)).toEqual([["HTTP/3 advertised but not used", "info"]]);
  });

  it("does not note HTTP/3 advertised to a host that then used it", () => {
    const report = analyzeConnections(
      page([
        request("cdn.example.com", "h2", "t", { advertisesHttp3: true }),
        request("cdn.example.com", "h3", "q"),
      ])
    );
    expect(report.recommendations.map((r) => r.label)).not.toContain(
      "HTTP/3 advertised but not used"
    );
  });

  it("says so when every host with 3 requests or more is on one HTTP/2 or HTTP/3 connection", () => {
    const report = analyzeConnections(
      page([
        ...times(3, () => request("example.com", "h2", "doc")),
        ...times(3, () => request("cdn.example.net", "h3", "q")),
        request("beacon.example.org", "h3", "b"),
      ])
    );
    expect(labels(report)).toEqual([
      ["Every busy host on one HTTP/2 or HTTP/3 connection", "good"],
    ]);
  });

  it("stays silent without a host of 3 requests or more", () => {
    expect(analyzeConnections(page([])).recommendations).toEqual([]);
  });
});

describe("analyzeConnections — Chrome recordings of webperf-snippets", () => {
  it("finds the cold load on HTTP/2 and HTTP/3, one connection per host", () => {
    const report = analyzeConnections(
      recording("webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har")
    );
    expect(
      report.hosts.map((h) => [h.host, h.protocol, h.requests, h.connections, h.tcpHandshakes])
    ).toEqual([
      ["webperf-snippets.nucliweb.net", "h2", 29, 1, 0],
      ["res.cloudinary.com", "h2", 1, 1, 0],
      ["cdn.debugbear.com", "h3", 1, 1, 0],
      ["www.googletagmanager.com", "h3", 1, 1, 0],
      ["region1.google-analytics.com", "h3", 1, 1, 0],
      ["data.debugbear.com", "h3", 1, 1, 0],
    ]);
    expect(report.hosts.every((h) => h.cookieBytes === 0)).toBe(true);
    expect(report.serverTiming).toEqual([]);
    expect(labels(report)).toEqual([
      ["Every busy host on one HTTP/2 or HTTP/3 connection", "good"],
    ]);
  });

  it("finds the warm load's few requests on the same protocols, too few to judge", () => {
    const report = analyzeConnections(
      recording("webperf-snippets.nucliweb.net_Cache-20260519T123746.har")
    );
    expect(
      report.hosts.map((h) => [h.host, h.protocol, h.requests, h.connections, h.tcpHandshakes])
    ).toEqual([
      ["webperf-snippets.nucliweb.net", "h2", 1, 1, 0],
      ["region1.google-analytics.com", "h3", 1, 1, 1],
      ["data.debugbear.com", "h3", 1, 1, 1],
    ]);
    expect(report.recommendations).toEqual([]);
  });
});
