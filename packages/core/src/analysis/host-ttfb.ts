import type { HarEntry } from "../types.js";

// Empty answers: a tracker acknowledging a hit, not content the page uses.
const EMPTY_RESPONSE_STATUSES = new Set([204, 205]);

/**
 * Whether a request reports to a server instead of fetching something the page uses: a POST
 * (analytics hits, navigator.sendBeacon), Chrome's "ping" resource type, or a 204/205 answer.
 */
export function isBeacon(entry: HarEntry): boolean {
  return (
    entry.method?.toUpperCase() === "POST" ||
    entry.ping === true ||
    EMPTY_RESPONSE_STATUSES.has(entry.status)
  );
}

/** The middle value (the mean of the two middle ones for an even count); null without values. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface TtfbByLoad {
  /** Median TTFB of the requests sent before onLoad; null when there are none. */
  beforeLoad: number | null;
  /** Median TTFB of the requests sent after onLoad; null when there are none. */
  afterLoad: number | null;
}

/**
 * Median TTFB (server wait) of the network requests that fetched something, split at the load
 * event. Beacons and 304 revalidations are left out: their wait measures a tracker or a cache
 * check, not how fast the host serves content. A median, because one slow request (an API call,
 * a cold cache) would drag a mean far from what most requests saw. Requests sent after onLoad no
 * longer delay the page; with no load event (`onLoad` null) every request counts as before it.
 */
export function medianTtfbByLoad(entries: HarEntry[], onLoad: number | null): TtfbByLoad {
  const fetches = entries.filter((e) => e.fromCache === false && !isBeacon(e) && e.status !== 304);
  const afterLoad = (e: HarEntry) => onLoad !== null && e.startTime > onLoad;
  return {
    beforeLoad: median(fetches.filter((e) => !afterLoad(e)).map((e) => e.ttfb)),
    afterLoad: median(fetches.filter(afterLoad).map((e) => e.ttfb)),
  };
}
