import { describe, it, expect } from "vitest";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { requestSequence } from "../src/analysis/request-sequence.js";
import type { HarTiming } from "../src/types.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";
import { readRecording } from "./helpers/recordings.js";

const APP = "https://cdn.example.com/app.js";

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

describe("requestSequence — a request that opens its own connection", () => {
  const entry = makeEntry({
    url: APP,
    httpVersion: "h2",
    connectionId: "7",
    timing: timing({ blocked: 2, dns: 10, connect: 50, ssl: 26, send: 1, wait: 40, receive: 7 }),
  });
  const har = makeHar([entry]);
  const sequence = requestSequence(har, entry);

  it("lays out the phases in order, each from where the one before it ends", () => {
    expect(sequence.steps).toEqual([
      { kind: "queue", atMs: 0, ms: 2 },
      { kind: "dns", atMs: 2, ms: 10 },
      { kind: "tcp", atMs: 12, ms: 24 },
      { kind: "tls", atMs: 36, ms: 26 },
      { kind: "request", atMs: 62, ms: 1 },
      { kind: "wait", atMs: 63, ms: 40 },
      { kind: "response", atMs: 103, ms: 7 },
    ]);
  });

  it("takes the TCP handshake, without the TLS the HAR counts inside connect, as the round trip", () => {
    expect(sequence.roundTripMs).toBe(24);
  });

  it("estimates the server's share of the wait: the wait less one round trip", () => {
    expect(sequence.serverMs).toBe(16);
  });

  it("names the host, the protocol and the new connection with the requests that use it", () => {
    expect(sequence).toMatchObject({
      host: "cdn.example.com",
      protocol: "h2",
      outcome: "network",
      connection: { kind: "new", id: "7", requests: 1 },
    });
  });
});

describe("requestSequence — HTTP/3", () => {
  it("draws one QUIC handshake for connect and TLS together, one round trip", () => {
    const entry = makeEntry({
      url: APP,
      httpVersion: "h3",
      timing: timing({ connect: 30, ssl: 30, send: 1, wait: 20, receive: 4 }),
    });
    const sequence = requestSequence(makeHar([entry]), entry);

    expect(sequence.steps.map((s) => [s.kind, s.atMs, s.ms])).toEqual([
      ["quic", 0, 30],
      ["request", 30, 1],
      ["wait", 31, 20],
      ["response", 51, 4],
    ]);
    expect(sequence.roundTripMs).toBe(30);
  });
});

describe("requestSequence — a reused connection", () => {
  const opener = makeEntry({
    url: "https://cdn.example.com/first.js",
    startTime: 10,
    connectionId: "7",
    timing: timing({ connect: 20, send: 1, wait: 10, receive: 1 }),
  });
  const later = makeEntry({
    url: APP,
    startTime: 80,
    connectionId: "7",
    timing: timing({ blocked: 3, send: 1, wait: 30, receive: 2 }),
  });

  it("says which request opened it and how many requests share it, with that request's round trip", () => {
    const har = makeHar([opener, later]);
    const sequence = requestSequence(har, later);

    expect(sequence.connection).toEqual({ kind: "reused", id: "7", openedBy: 1, requests: 2 });
    expect(sequence.steps.map((s) => s.kind)).toEqual(["queue", "request", "wait", "response"]);
    expect(sequence.roundTripMs).toBe(20);
    expect(sequence.serverMs).toBe(10);
  });

  it("says it was open before the recording when no request of the HAR opened it", () => {
    const sequence = requestSequence(makeHar([later]), later);
    expect(sequence.connection).toEqual({ kind: "reused", id: "7", openedBy: null, requests: 1 });
    expect(sequence.roundTripMs).toBeNull();
    expect(sequence.serverMs).toBeNull();
  });

  it("makes no estimate for the server when the wait is shorter than the round trip", () => {
    const quick = makeEntry({ ...later, timing: timing({ send: 1, wait: 12, receive: 1 }) });
    const sequence = requestSequence(makeHar([opener, quick]), quick);
    expect(sequence.roundTripMs).toBe(20);
    expect(sequence.serverMs).toBeNull();
  });

  it("reads a connect the HAR marked not applicable as a reused connection without an id", () => {
    const entry = makeEntry({ timing: timing({ wait: 5, notApplicable: ["dns", "connect"] }) });
    expect(requestSequence(makeHar([entry]), entry).connection).toEqual({
      kind: "reused",
      id: null,
      openedBy: null,
      requests: 1,
    });
  });

  it("says nothing of the connection when the HAR gives neither its id nor a connect phase", () => {
    const entry = makeEntry({ timing: timing({ wait: 5 }) });
    expect(requestSequence(makeHar([entry]), entry).connection).toEqual({ kind: "unknown" });
  });
});

describe("requestSequence — outcomes", () => {
  it("has no network step for a browser-cache hit", () => {
    const entry = makeEntry({ fromCache: "memory", timing: timing({ blocked: 1 }) });
    const sequence = requestSequence(makeHar([entry]), entry);

    expect(sequence.outcome).toBe("browserCache");
    expect(sequence.steps).toEqual([]);
    expect(sequence.connection).toEqual({ kind: "none" });
  });

  it("tells a 304 revalidation and a redirect, with where it points", () => {
    const revalidated = makeEntry({ status: 304, timing: timing({ wait: 5 }) });
    const redirect = makeEntry({
      status: 301,
      redirectURL: "https://example.com/new",
      timing: timing({ wait: 5 }),
    });
    const har = makeHar([revalidated, redirect]);

    expect(requestSequence(har, revalidated).outcome).toBe("revalidated");
    expect(requestSequence(har, redirect)).toMatchObject({
      outcome: "redirect",
      redirectTo: "https://example.com/new",
    });
  });

  it("gives the status and the bytes of the response", () => {
    const entry = makeEntry({ status: 200, transferSize: 4_000, contentEncoding: "br" });
    expect(requestSequence(makeHar([entry]), entry).response).toEqual({
      status: 200,
      transferSize: 4_000,
      encoding: "br",
    });
  });
});

describe("requestSequence — the webperf-snippets recording", () => {
  it("finds every request on connections open before the recording started", () => {
    const har = parseHarJson(readRecording("cold"));
    const doc = requestSequence(har, har.documentEntry);

    expect(doc.connection).toMatchObject({ kind: "reused", openedBy: null });
    expect(doc.steps.map((s) => s.kind)).toEqual(["queue", "request", "wait", "response"]);
    expect(har.entries.every((e) => requestSequence(har, e).roundTripMs === null)).toBe(true);
  });
});
