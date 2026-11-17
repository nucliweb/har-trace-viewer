import { describe, expect, it } from "vitest";
import stringWidth from "string-width";
import { buildWaterfall, parseHarJson } from "@htv/core";
import type { HarTiming, ParsedHar } from "@htv/core";
import { lineText } from "../src/tui/lines";
import { requestRegion } from "../src/tui/request-view";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";
import { readRecording } from "../../core/tests/helpers/recordings";

const timing = (phases: Partial<HarTiming>): HarTiming => ({
  blocked: 0,
  dns: 0,
  connect: 0,
  ssl: 0,
  send: 0,
  wait: 0,
  receive: 0,
  ...phases,
});

const first = makeEntry({
  url: "https://cdn.example.com/first.js",
  method: "GET",
  startTime: 20,
  httpVersion: "h2",
  connectionId: "7",
  contentEncoding: "br",
  transferSize: 4_000,
  timing: timing({ blocked: 2, dns: 10, connect: 50, ssl: 26, send: 1, wait: 40, receive: 7 }),
});
const second = makeEntry({
  url: "https://cdn.example.com/second.js",
  method: "GET",
  startTime: 120,
  httpVersion: "h2",
  connectionId: "7",
  timing: timing({ send: 1, wait: 30, receive: 2 }),
});
const cached = makeEntry({
  url: "https://example.com/logo.svg",
  startTime: 160,
  fromCache: "disk",
});
const har = makeHar([first, second, cached]);

function region(url: string, width: number, source: ParsedHar = har) {
  const row = buildWaterfall(source).rows.find((r) => r.url === url)!;
  return requestRegion(row, source, { index: 0, count: 1 }, width);
}

// The body of the Sequence panel, without its frame.
function sequencePanel(url: string, width = 100, source?: ParsedHar) {
  const lines = region(url, width, source).map(lineText);
  const top = lines.findIndex((l) => l.includes("Sequence"));
  const bottom = lines.findIndex((l, i) => i > top && l.startsWith("╰"));
  const body = lines.slice(top + 1, bottom).map((l) => l.slice(2, -2));
  // The notes and explanations wrap: their words joined back into one text.
  const prose = body.map((l) => l.trim()).join(" ");
  return { title: lines[top], body, prose };
}

describe("TUI request view: the sequence of a request", () => {
  it("tells each step of a new connection with its start, its time and an arrow between lanes", () => {
    const { title, body, prose } = sequencePanel(first.url);
    const all = body.join("\n");

    expect(title).toContain("Sequence · h2");
    expect(prose).toContain("Opens a new connection; 1 more request reuses it.");
    expect(prose).toContain("About 24 ms per round trip to cdn.example.com.");
    expect(all).toMatch(/Browser\s+DNS resolver\s+cdn\.example\.com/);
    expect(all).toMatch(/^\s+0 ms\s+●.*Queued 2 ms/m);
    expect(all).toMatch(/^\s+2 ms\s+◀═+▶.*DNS lookup 10 ms/m);
    expect(all).toMatch(/^\s+12 ms\s+◀═+▶.*TCP handshake 24 ms/m);
    expect(prose).toMatch(/SYN, SYN-ACK, ACK/);
    expect(all).toMatch(/^\s+62 ms\s+│─+▶\s+GET \/first\.js 1 ms/m);
    // Each lane name starts over its lane: the host over the dot of the server at work.
    const names = body.find((l) => l.includes("DNS resolver"))!;
    const working = body.find((l) => l.includes("Server works"))!;
    expect(names.indexOf("cdn.example.com")).toBe(working.indexOf("●"));
    expect(all).toMatch(/^\s+63 ms\s+│.*●\s+Server works 40 ms/m);
    expect(prose).toMatch(/about 24 ms are the round trip and 16 ms the server/);
    expect(all).toMatch(/^\s+103 ms\s+◀─+│\s+200 · 4\.0 KB · br 7 ms/m);
  });

  it("says which request opened a reused connection, with two lanes", () => {
    const all = sequencePanel(second.url).body.join("\n");

    expect(all).toContain("Reuses the connection first.js opened: no DNS lookup or handshakes.");
    expect(all).not.toContain("DNS resolver");
  });

  it("says a browser-cache hit never reached the network", () => {
    const all = sequencePanel(cached.url).body.join("\n");

    expect(all).toContain("Served from the browser cache: it never reached the network.");
    expect(all).not.toContain("Browser ");
  });

  it("keeps every line to the width of the panel", () => {
    for (const width of [60, 100]) {
      for (const line of region(first.url, width)) expect(stringWidth(lineText(line))).toBe(width);
    }
  });

  it("names a connection open before the recording on a real capture", () => {
    const real = parseHarJson(readRecording("cold"));
    const all = sequencePanel(real.documentEntry.url, 100, real).prose;

    expect(all).toMatch(/Reuses a connection opened before the recording started/);
    expect(all).toMatch(/\d+ requests share it\./);
    // The request went out in a tenth of a millisecond: less than one, not nothing.
    expect(all).toMatch(/GET \/ <1 ms/);
  });
});
