import { getRootDomain } from "../utils/domain.js";
import type { HarEntry, ParsedHar } from "../types.js";

// The one definition of what reached the network and what a page owns, shared by the
// metrics summary, the comparison, the hosts table, the cache report and the topology.

/** Served by the browser cache (the parser's `fromCache`): nothing crossed the network. */
export function isBrowserCacheHit(entry: HarEntry): boolean {
  return entry.fromCache !== false;
}

/** The entries that reached the network, the document and 304 revalidations included. */
export function networkRequests(har: ParsedHar): HarEntry[] {
  return har.entries.filter((entry) => !isBrowserCacheHit(entry));
}

/**
 * Resources the browser cache served, the document included, plus the hits inferred for a
 * WebPageTest repeat view, which leaves them out of its entries.
 */
export function browserCacheHits(har: ParsedHar): number {
  return har.entries.filter(isBrowserCacheHit).length + (har.inferredCacheHits?.length ?? 0);
}

/** A resource of the document's registrable domain, the HTML documents aside. */
export function isOwnResource(entry: HarEntry, documentRoot: string): boolean {
  return !entry.isDocument && getRootDomain(entry.url) === documentRoot;
}

/** An own resource that reached the network: the only kind a CDN status describes for this load. */
export function isOwnNetworkResource(entry: HarEntry, documentRoot: string): boolean {
  return isOwnResource(entry, documentRoot) && !isBrowserCacheHit(entry);
}
