import { profileResourceCache } from "../inference/cache-analyzer.js";
import { headerPairs, isMaskedHeader } from "./secret-rules.js";
import type { CdnCacheStatus, ContentEncoding, HarEntry, ParsedHar } from "../types.js";

/** One header of a request or a response; `masked` when the redaction rules hid its value. */
export interface HeaderField {
  name: string;
  value: string;
  masked: boolean;
}

/**
 * A link of an initiator chain: the request before it was requested by `type` (parser, script...)
 * at `url`, which is the page's entry `entryIndex`, or null when the page never requested it.
 */
export interface InitiatorLink {
  type: string;
  url: string;
  lineNumber?: number; // 0-based, as Chrome records it
  entryIndex: number | null;
}

/** What a view of one request shows beyond its waterfall row. */
export interface RequestDetail {
  /**
   * What requested it: the initiator's type, and the chain of requests that led to it, the
   * closest first. Null when the HAR records no initiator.
   */
  initiator: { type: string; chain: InitiatorLink[] } | null;
  /** Its request and response headers; null in a flow that kept no header lists (before v8). */
  headers: { request: HeaderField[]; response: HeaderField[] } | null;
  sizes: {
    /** Bytes on the wire, headers included. */
    transfer: number;
    /** The response body as it crossed the network, compressed; null when the HAR does not say. */
    compressedBody: number | null;
    /** The response body decompressed. */
    body: number;
    encoding: ContentEncoding | null;
  };
  cache: {
    /** The browser cache that served it, or false. */
    browser: HarEntry["fromCache"];
    /** A 304: the browser revalidated its copy. */
    revalidated: boolean;
    /** The request asked to bypass the cache (Disable cache, a hard reload). */
    bypassed: boolean;
    cdn: CdnCacheStatus;
    cacheControl: string | null;
    age: number | null;
  };
}

// A chain longer than this is a loop the URLs do not show (redirects to the same URL).
const MAX_CHAIN = 50;

function initiatorOf(har: ParsedHar, entry: HarEntry): RequestDetail["initiator"] {
  if (!entry.initiator) return null;
  const indexByUrl = new Map<string, number>();
  har.entries.forEach((e, index) => {
    if (!indexByUrl.has(e.url)) indexByUrl.set(e.url, index);
  });
  const chain: InitiatorLink[] = [];
  const seen = new Set([entry.url]);
  for (let current: HarEntry | undefined = entry; current?.initiator?.url !== undefined;) {
    const { type, lineNumber } = current.initiator;
    const url: string = current.initiator.url;
    const entryIndex: number | null = indexByUrl.get(url) ?? null;
    chain.push({ type, url, ...(lineNumber !== undefined ? { lineNumber } : {}), entryIndex });
    if (seen.has(url) || chain.length >= MAX_CHAIN) break;
    seen.add(url);
    current = entryIndex === null ? undefined : har.entries[entryIndex];
  }
  return { type: entry.initiator.type, chain };
}

const fields = (lines: string[]): HeaderField[] =>
  headerPairs(lines).map(({ name, value }) => ({
    name,
    value,
    masked: isMaskedHeader(name, value),
  }));

/** The detail of one of the page's entries: its initiator, headers, sizes and cache. */
export function requestDetail(har: ParsedHar, entry: HarEntry): RequestDetail {
  const profile = profileResourceCache(entry.responseHeaders);
  return {
    initiator: initiatorOf(har, entry),
    headers: entry.headers
      ? { request: fields(entry.headers.request), response: fields(entry.headers.response) }
      : null,
    sizes: {
      transfer: entry.transferSize,
      compressedBody: entry.encodedBodySize ?? null,
      body: entry.bodySize,
      encoding: entry.contentEncoding ?? null,
    },
    cache: {
      browser: entry.fromCache,
      revalidated: entry.status === 304,
      bypassed: entry.bypassesCache === true,
      cdn: profile.cdnStatus,
      cacheControl: entry.responseHeaders["cache-control"] ?? null,
      age: profile.age,
    },
  };
}
