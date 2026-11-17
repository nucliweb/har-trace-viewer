import { getHostname } from "../utils/domain.js";
import type { ContentEncoding, HarEntry, HttpVersion, ParsedHar } from "../types.js";

/**
 * A moment of a request as it crosses the network: waiting in the browser's queue, the DNS
 * lookup, the TCP and TLS handshakes (one QUIC handshake over HTTP/3), sending the request, the
 * server working on it until its first byte, and the response arriving.
 */
export type SequenceStepKind =
  "queue" | "dns" | "tcp" | "tls" | "quic" | "request" | "wait" | "response";

export interface SequenceStep {
  kind: SequenceStepKind;
  /** When it starts, in ms from the start of the request. */
  atMs: number;
  ms: number;
}

/**
 * The connection the request travelled on: one it opened, one already open (opened by the
 * page's entry `openedBy`, or before the recording when null), none for a browser-cache hit,
 * or unknown when the HAR gives neither a connection id nor a connect phase.
 */
export type SequenceConnection =
  | { kind: "new"; id: string | null; requests: number }
  | { kind: "reused"; id: string | null; openedBy: number | null; requests: number }
  | { kind: "none" }
  | { kind: "unknown" };

/**
 * How the request went: over the network, from the browser cache without a request, as a 304
 * that confirmed the browser's copy, or as a redirect.
 */
export type SequenceOutcome = "network" | "browserCache" | "revalidated" | "redirect";

/** One request told as a sequence between the browser, the DNS resolver and the server. */
export interface RequestSequence {
  host: string;
  protocol: HttpVersion;
  outcome: SequenceOutcome;
  /** Where a redirect points. */
  redirectTo?: string;
  connection: SequenceConnection;
  steps: SequenceStep[];
  /**
   * About one round trip to the server: the TCP handshake, or the QUIC one over HTTP/3, of this
   * request or of the request that opened its connection. Null when neither is in the HAR.
   */
  roundTripMs: number | null;
  /**
   * About how long the server took: the wait (TTFB) less one round trip. Null without a round
   * trip, or when the wait is shorter than it.
   */
  serverMs: number | null;
  response: { status: number; transferSize: number; encoding: ContentEncoding | null };
}

// The steps in the order the HAR's phases happen, with how long each lasted. The HAR counts the
// TLS handshake inside connect; over HTTP/3 both are one QUIC handshake.
function phasesOf(entry: HarEntry): [SequenceStepKind, number][] {
  const { blocked, dns, connect, ssl, send, wait, receive } = entry.timing;
  const handshake: [SequenceStepKind, number][] =
    entry.httpVersion === "h3"
      ? [["quic", connect]]
      : [
          ["tcp", Math.max(0, connect - ssl)],
          ["tls", ssl],
        ];
  return [
    ["queue", blocked],
    ["dns", dns],
    ...handshake,
    ["request", send],
    ["wait", wait],
    ["response", receive],
  ];
}

// Steps that only happen sometimes; the request, wait and response always do.
const OPTIONAL: readonly SequenceStepKind[] = ["queue", "dns", "tcp", "tls", "quic"];

function stepsOf(entry: HarEntry): SequenceStep[] {
  const steps: SequenceStep[] = [];
  let atMs = 0;
  for (const [kind, ms] of phasesOf(entry)) {
    if (ms > 0 || !OPTIONAL.includes(kind)) steps.push({ kind, atMs, ms });
    atMs += ms;
  }
  return steps;
}

// One round trip: how long the handshake that opened the connection took.
function handshakeMs(entry: HarEntry): number | null {
  const step = stepsOf(entry).find((s) => s.kind === "tcp" || s.kind === "quic");
  return step?.ms ?? null;
}

function connectionOf(har: ParsedHar, entry: HarEntry): SequenceConnection {
  const id = entry.connectionId ?? null;
  const sharing = id === null ? [entry] : har.entries.filter((e) => e.connectionId === id);
  const requests = sharing.length;
  if (entry.timing.connect > 0) return { kind: "new", id, requests };
  if (id === null && !entry.timing.notApplicable?.includes("connect")) return { kind: "unknown" };
  const opener = id === null ? undefined : sharing.find((e) => e.timing.connect > 0);
  return { kind: "reused", id, openedBy: opener ? har.entries.indexOf(opener) : null, requests };
}

function outcomeOf(entry: HarEntry): SequenceOutcome {
  if (entry.fromCache) return "browserCache";
  if (entry.status === 304) return "revalidated";
  if (entry.redirectURL) return "redirect";
  return "network";
}

/** One of the page's entries as a sequence of steps over the network, with their real times. */
export function requestSequence(har: ParsedHar, entry: HarEntry): RequestSequence {
  const outcome = outcomeOf(entry);
  const cached = outcome === "browserCache";
  const steps = cached ? [] : stepsOf(entry);
  const connection: SequenceConnection = cached ? { kind: "none" } : connectionOf(har, entry);
  const opener =
    connection.kind === "reused" && connection.openedBy !== null
      ? har.entries[connection.openedBy]
      : undefined;
  const roundTripMs = cached ? null : (handshakeMs(entry) ?? (opener ? handshakeMs(opener) : null));
  return {
    host: getHostname(entry.url) ?? entry.url,
    protocol: entry.httpVersion ?? "unknown",
    outcome,
    ...(outcome === "redirect" && { redirectTo: entry.redirectURL }),
    connection,
    steps,
    roundTripMs,
    // A wait shorter than the round trip means the estimate does not hold for this request.
    serverMs:
      roundTripMs === null || entry.timing.wait < roundTripMs
        ? null
        : entry.timing.wait - roundTripMs,
    response: {
      status: entry.status,
      transferSize: entry.transferSize,
      encoding: entry.contentEncoding ?? null,
    },
  };
}
