import { isBrowserCacheHit } from "./network-requests.js";
import { requestDurationMs } from "./waterfall.js";
import type { HarEntry, HttpVersion, ParsedHar, ResourcePriority, ResourceType } from "../types.js";

/**
 * How a request of A found its request in B: "url" by the same URL, "similar" by a URL that
 * differs only in what changes between two loads of the same page (a hash in a file name, a
 * cache-busting or session parameter, the query of a beacon). A similar match is a guess.
 */
export type RequestMatch = "url" | "similar";

/** Where the response came from: the network (a 304 included) or the browser cache. */
export type RequestSource = "network" | "browser";

/** One request of a side, as the comparison reads it: the numbers of its waterfall row. */
export interface RequestSnapshot {
  /** The request's index in its page's `har.entries`. */
  entryIndex: number;
  url: string;
  method: string;
  resourceType: ResourceType;
  status: number;
  /** Null when the HAR does not say. */
  protocol: Exclude<HttpVersion, "unknown"> | null;
  cache: RequestSource;
  /** Null when the HAR carries no priority. */
  priority: ResourcePriority | null;
  startMs: number;
  durationMs: number;
  ttfbMs: number;
  transferBytes: number;
}

/** What a pair can change besides its numbers; protocol and priority only when both sides know them. */
export type RequestChange = "status" | "protocol" | "cache" | "priority";

/** A request of A and its request in B, with B − A of each number. */
export interface RequestPair {
  match: RequestMatch;
  a: RequestSnapshot;
  b: RequestSnapshot;
  delta: { startMs: number; durationMs: number; ttfbMs: number; transferBytes: number };
  changes: RequestChange[];
}

/** The requests of two pages: paired, only in B (added) and only in A (removed). */
export interface RequestComparison {
  /** The biggest change of time first, then of bytes, then by A's start. */
  pairs: RequestPair[];
  /** By start. */
  added: RequestSnapshot[];
  /** By start. */
  removed: RequestSnapshot[];
}

// Query parameters that change between two loads of the same resource and say nothing of
// what it is: cache busters, session ids, campaign and click ids.
const VOLATILE_PARAMS = new Set([
  "_",
  "cb",
  "cachebust",
  "cachebuster",
  "cache_buster",
  "nocache",
  "rand",
  "random",
  "rnd",
  "t",
  "time",
  "timestamp",
  "ts",
  "v",
  "ver",
  "version",
  "sid",
  "session",
  "sessionid",
  "session_id",
  "jsessionid",
  "phpsessid",
  "token",
  "gclid",
  "dclid",
  "fbclid",
  "msclkid",
  "_ga",
  "_gl",
]);

const isVolatileParam = (name: string) => {
  const lower = name.toLowerCase();
  return VOLATILE_PARAMS.has(lower) || lower.startsWith("utm_");
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX = /^[0-9a-f]{8,}$/i;

/**
 * A run of letters and digits as a hash-free token: a hex string of 8 or more with a digit
 * (a content hash), or any 16 or more with a digit (a build id), becomes "*"; elsewhere a run
 * of 6 or more digits (a timestamp, a version) does.
 */
function stripToken(token: string): string {
  const hasDigit = /\d/.test(token);
  if (hasDigit && (HEX.test(token) || token.length >= 16)) return "*";
  return token.replace(/\d{6,}/g, "*");
}

const stripHashes = (text: string) =>
  text.replace(UUID, "*").replace(/[0-9a-z]+/gi, (token) => stripToken(token));

function similarUrl(url: string): { origin: string; path: string; query: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { origin: "", path: url, query: "" };
  }
  const params = [...parsed.searchParams]
    .filter(([name]) => !isVolatileParam(name))
    .map(([name, value]) => `${name}=${stripHashes(value)}`)
    .sort();
  return {
    origin: `${parsed.protocol}//${parsed.host}`,
    path: stripHashes(parsed.pathname),
    query: params.join("&"),
  };
}

/**
 * The keys a request is matched by, tried in this order: its URL and type, its URL alone, then
 * its similar URL (hashes and volatile parameters stripped) with its query and type, and with
 * its type alone. Every key holds the method.
 */
export function requestMatchKeys(entry: HarEntry): [string, string, string, string] {
  const method = entry.method ?? "GET";
  const { origin, path, query } = similarUrl(entry.url);
  return [
    `url ${method} ${entry.resourceType} ${entry.url}`,
    `url ${method} ${entry.url}`,
    `similar ${method} ${entry.resourceType} ${origin}${path}?${query}`,
    `similar-path ${method} ${entry.resourceType} ${origin}${path}`,
  ];
}

// Each pass: the key it reads (an index into requestMatchKeys) and the match it makes.
const PASSES = [
  [0, "url"],
  [1, "url"],
  [2, "similar"],
  [3, "similar"],
] as const;

function snapshot(entry: HarEntry, entryIndex: number): RequestSnapshot {
  return {
    entryIndex,
    url: entry.url,
    method: entry.method ?? "GET",
    resourceType: entry.resourceType,
    status: entry.status,
    protocol: entry.httpVersion && entry.httpVersion !== "unknown" ? entry.httpVersion : null,
    cache: isBrowserCacheHit(entry) ? "browser" : "network",
    priority: entry.priority ?? null,
    startMs: entry.startTime,
    durationMs: requestDurationMs(entry),
    ttfbMs: entry.ttfb,
    transferBytes: entry.transferSize,
  };
}

const known = <T>(a: T | null, b: T | null) => a !== null && b !== null && a !== b;

function pairOf(match: RequestMatch, a: RequestSnapshot, b: RequestSnapshot): RequestPair {
  const changes: RequestChange[] = [];
  if (a.status !== b.status) changes.push("status");
  if (known(a.protocol, b.protocol)) changes.push("protocol");
  if (a.cache !== b.cache) changes.push("cache");
  if (known(a.priority, b.priority)) changes.push("priority");
  return {
    match,
    a,
    b,
    delta: {
      startMs: b.startMs - a.startMs,
      durationMs: b.durationMs - a.durationMs,
      ttfbMs: b.ttfbMs - a.ttfbMs,
      transferBytes: b.transferBytes - a.transferBytes,
    },
    changes,
  };
}

/** Whether a pair changed at all: a whole millisecond of time, a byte, or an attribute. */
export function requestPairChanged(pair: RequestPair): boolean {
  return (
    Math.round(Math.abs(pair.delta.durationMs)) > 0 ||
    pair.delta.transferBytes !== 0 ||
    pair.changes.length > 0
  );
}

/** "status: 200 → 304; cache: network → browser", the attributes a pair changed. */
export function requestChangesText({ a, b, changes }: RequestPair): string {
  return changes.map((change) => `${change}: ${a[change]} → ${b[change]}`).join("; ");
}

/** "34 paired (1 by a similar URL) · 0 added in B · 2 removed from A". */
export function requestCountsText({ pairs, added, removed }: RequestComparison): string {
  const similar = pairs.filter((p) => p.match === "similar").length;
  return [
    `${pairs.length} paired${similar > 0 ? ` (${similar} by a similar URL)` : ""}`,
    `${added.length} added in B`,
    `${removed.length} removed from A`,
  ].join(" · ");
}

/** What the ≈ after a request name means. */
export const SIMILAR_URL_NOTE =
  "≈ paired by a similar URL: a hash in the file name or a query parameter differs.";

interface Side {
  snapshot: RequestSnapshot;
  keys: ReturnType<typeof requestMatchKeys>;
}

// The requests of a page by start; requests that start together keep the recording order.
const sideOf = (har: ParsedHar): Side[] =>
  har.entries
    .map((entry, index) => ({ snapshot: snapshot(entry, index), keys: requestMatchKeys(entry) }))
    .sort((x, y) => x.snapshot.startMs - y.snapshot.startMs);

const byBiggestChange = (x: RequestPair, y: RequestPair) =>
  Math.abs(y.delta.durationMs) - Math.abs(x.delta.durationMs) ||
  Math.abs(y.delta.transferBytes) - Math.abs(x.delta.transferBytes) ||
  x.a.startMs - y.a.startMs;

/**
 * Compares the requests of two pages, A the baseline and B the candidate. Each pass pairs the
 * requests still unpaired that share a key (see `requestMatchKeys`), the k-th of A by start with
 * the k-th of B, so that repeated requests to one URL pair in order. The requests left over were
 * added (B) or removed (A).
 */
export function compareRequests(a: ParsedHar, b: ParsedHar): RequestComparison {
  let restA = sideOf(a);
  let restB = sideOf(b);
  const pairs: RequestPair[] = [];
  for (const [pass, match] of PASSES) {
    const waiting = new Map<string, Side[]>();
    for (const side of restB) {
      const key = side.keys[pass];
      const queue = waiting.get(key);
      if (queue) queue.push(side);
      else waiting.set(key, [side]);
    }
    const paired = new Set<Side>();
    restA = restA.filter((sideA) => {
      const sideB = waiting.get(sideA.keys[pass])?.shift();
      if (!sideB) return true;
      paired.add(sideB);
      pairs.push(pairOf(match, sideA.snapshot, sideB.snapshot));
      return false;
    });
    restB = restB.filter((side) => !paired.has(side));
  }
  return {
    pairs: pairs.sort(byBiggestChange),
    added: restB.map((side) => side.snapshot),
    removed: restA.map((side) => side.snapshot),
  };
}
