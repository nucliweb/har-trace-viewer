import type {
  HarEntry,
  HarPage,
  HarTiming,
  ParsedHar,
  PreconnectSource,
  ResourcePriority,
  ResourceType,
} from "../types.js";

interface RawHarTiming {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

interface RawHarEntry {
  pageref?: string;
  startedDateTime: string;
  time: number;
  _resourceType?: string;
  _priority?: string;
  _fromCache?: string;
  cache?: { beforeRequest?: Record<string, unknown> | null };
  request: { url: string; method: string };
  _transferSize?: number;
  response: {
    status: number;
    headers: { name: string; value: string }[];
    content: { mimeType?: string; size?: number };
    bodySize?: number;
    headersSize?: number;
  };
  timings?: RawHarTiming;
}

interface RawHarPage {
  id: string;
  title: string;
  startedDateTime: string;
  pageTimings?: { onContentLoad?: number; onLoad?: number };
}

interface RawHar {
  log: { pages?: RawHarPage[]; entries?: RawHarEntry[] };
}

function normalizeMs(value: number): number {
  return value < 0 ? 0 : value;
}

const ZERO_TIMING: RawHarTiming = {
  blocked: 0,
  dns: 0,
  connect: 0,
  ssl: 0,
  send: 0,
  wait: 0,
  receive: 0,
};

function parseTiming(raw: RawHarTiming): HarTiming {
  return {
    blocked: normalizeMs(raw.blocked),
    dns: normalizeMs(raw.dns),
    connect: normalizeMs(raw.connect),
    ssl: normalizeMs(raw.ssl),
    send: normalizeMs(raw.send),
    wait: normalizeMs(raw.wait),
    receive: normalizeMs(raw.receive),
  };
}

// Response headers that the analyzers read, or that describe how a response was
// cached and served. Every other header is dropped while parsing: the parsed HAR is
// embedded in each report, and most of a HAR's headers are never looked at.
export const RESPONSE_HEADER_ALLOW_LIST: readonly string[] = [
  // HTTP caching and content
  "age",
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "date",
  "etag",
  "expires",
  "last-modified",
  "vary",
  // Server, proxies and resource hints
  "link",
  "server",
  "via",
  // CDN cache status
  "cache-status",
  "cdn-cache",
  "x-check-cacheable",
  // CDN and hosting identification (provider, PoP and region detection)
  "fly-request-id",
  "x-amz-id-2",
  "x-amz-request-id",
  "x-azure-ref",
  "x-fastly-request-id",
  "x-iinfo",
  "x-ms-request-id",
  "x-msedge-ref",
  "x-nf-request-id",
  "x-served-by",
];

// Families of CDN headers kept whole, e.g. x-cache-hits, cf-ray, x-amz-cf-pop.
export const RESPONSE_HEADER_ALLOW_PREFIXES: readonly string[] = [
  "x-cache",
  "x-akamai",
  "cf-",
  "x-amz-cf",
  "x-vercel",
];

const ALLOWED_HEADERS = new Set(RESPONSE_HEADER_ALLOW_LIST);

function isAllowedHeader(name: string): boolean {
  return (
    ALLOWED_HEADERS.has(name) ||
    RESPONSE_HEADER_ALLOW_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** Returns the allow-listed response headers, with lowercased names. */
export function pickResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (isAllowedHeader(key)) result[key] = value;
  }
  return result;
}

function headersToRecord(headers: { name: string; value: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

const URL_EXTENSION_TYPES: Record<string, ResourceType> = {
  js: "script",
  mjs: "script",
  css: "stylesheet",
  woff: "font",
  woff2: "font",
  ttf: "font",
  otf: "font",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  ico: "image",
};

function resourceTypeFromMime(mimeType: string): ResourceType | null {
  const mime = mimeType.toLowerCase();
  if (mime.includes("text/html")) return "document";
  if (mime.includes("text/css")) return "stylesheet";
  if (mime.includes("javascript") || mime.includes("ecmascript")) return "script";
  if (mime.startsWith("image/")) return "image";
  if (
    mime.startsWith("font/") ||
    mime.startsWith("application/font") ||
    mime.includes("application/vnd.ms-fontobject") ||
    mime.includes("x-font")
  ) {
    return "font";
  }
  if (mime.includes("application/json") || mime.includes("text/plain")) return "fetch";
  return null;
}

function resourceTypeFromUrl(url: string): ResourceType | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return match ? (URL_EXTENSION_TYPES[match[1].toLowerCase()] ?? null) : null;
}

function inferResourceType(url: string, mimeType: string): ResourceType {
  const mime = mimeType.trim().toLowerCase();
  if (mime === "" || mime === "application/octet-stream") {
    return resourceTypeFromUrl(url) ?? "other";
  }
  return resourceTypeFromMime(mime) ?? "other";
}

function parseResourceType(raw: string | undefined, url: string, mimeType: string): ResourceType {
  switch (raw) {
    case "document":
    case "stylesheet":
    case "script":
    case "image":
    case "font":
    case "fetch":
      return raw;
    default:
      return inferResourceType(url, mimeType);
  }
}

function parseResourcePriority(raw?: string): ResourcePriority | undefined {
  switch (raw) {
    case "VeryHigh":
    case "High":
    case "Medium":
    case "Low":
    case "VeryLow":
      return raw;
    default:
      return undefined;
  }
}

function parseTransferSize(e: RawHarEntry): number {
  if (typeof e._transferSize === "number" && e._transferSize >= 0) return e._transferSize;
  const { bodySize, headersSize, content } = e.response;
  if (typeof bodySize === "number" && typeof headersSize === "number") {
    if (bodySize >= 0 && headersSize >= 0) return bodySize + headersSize;
  }
  return content.size != null && content.size >= 0 ? content.size : 0;
}

function parsePageTime(value: number | undefined): number | null {
  return typeof value === "number" && value >= 0 ? value : null;
}

function isHtmlMime(mimeType: string): boolean {
  return mimeType.includes("text/html");
}

function parseFromCache(
  fromCacheField?: string,
  cache?: { beforeRequest?: Record<string, unknown> | null }
): "disk" | "memory" | false {
  if (fromCacheField === "disk") return "disk";
  if (fromCacheField === "memory") return "memory";
  if (cache?.beforeRequest != null) return "disk";
  return false;
}

function preconnectHostnames(linkHeader: string): string[] {
  const result: string[] = [];
  for (const part of linkHeader.split(",")) {
    const urlMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/\brel=["']?([^"';,\s]+)["']?/i);
    if (urlMatch && relMatch && relMatch[1].toLowerCase() === "preconnect") {
      try {
        result.push(new URL(urlMatch[1]).hostname);
      } catch {
        // malformed URL — skip
      }
    }
  }
  return result;
}

function parsePreconnectHints(
  entries: HarEntry[],
  documentHeaders: Record<string, string>
): Record<string, PreconnectSource> {
  const hints: Record<string, PreconnectSource> = {};
  for (const hostname of preconnectHostnames(documentHeaders["link"] ?? "")) {
    hints[hostname] = "link-header";
  }
  for (const entry of entries) {
    if (entry.status === 103) {
      for (const hostname of preconnectHostnames(entry.responseHeaders["link"] ?? "")) {
        if (!(hostname in hints)) hints[hostname] = "early-hints";
      }
    }
  }
  return hints;
}

function buildParsedHar(rawPages: RawHarPage[], entries: RawHarEntry[]): ParsedHar | null {
  if (entries.length === 0) return null;

  // Use the first entry's startedDateTime as origin; Chrome's page.startedDateTime
  // can be a few ms later than the first request due to rounding.
  const firstEntryMs = new Date(entries[0].startedDateTime).getTime();
  const pageOriginMs = new Date(rawPages[0].startedDateTime).getTime();
  const pageOrigin = Math.min(firstEntryMs, pageOriginMs);

  const parsedPages: HarPage[] = rawPages.map((p) => ({
    id: p.id,
    title: p.title,
    onContentLoad: parsePageTime(p.pageTimings?.onContentLoad),
    onLoad: parsePageTime(p.pageTimings?.onLoad),
  }));

  const parsedEntries: HarEntry[] = entries.map((e) => {
    const rawTimings = e.timings ?? ZERO_TIMING;
    const timing = parseTiming(rawTimings);
    const ttfb = normalizeMs(rawTimings.wait);
    const startTime = new Date(e.startedDateTime).getTime() - pageOrigin;
    const responseHeaders = pickResponseHeaders(headersToRecord(e.response.headers));
    const mimeType = e.response.content.mimeType ?? "";

    return {
      url: e.request.url,
      startTime,
      duration: e.time,
      timing,
      ttfb,
      status: e.response.status,
      mimeType,
      resourceType: parseResourceType(e._resourceType, e.request.url, mimeType),
      priority: parseResourcePriority(e._priority),
      responseHeaders,
      transferSize: parseTransferSize(e),
      bodySize: Math.max(0, e.response.content.size ?? 0),
      isDocument: isHtmlMime(mimeType),
      fromCache: parseFromCache(e._fromCache, e.cache),
    };
  });

  const documentEntry = parsedEntries.find((e) => e.isDocument);
  if (!documentEntry) return null;

  return {
    pages: parsedPages,
    entries: parsedEntries,
    documentEntry,
    preconnectHints: parsePreconnectHints(parsedEntries, documentEntry.responseHeaders),
  };
}

function assertHasContent(raw: RawHar): { pages: RawHarPage[]; entries: RawHarEntry[] } {
  const pages = raw.log.pages ?? [];
  const entries = raw.log.entries ?? [];
  if (pages.length === 0) throw new Error("HAR contains no pages");
  if (entries.length === 0) throw new Error("HAR contains no entries");
  return { pages, entries };
}

const NO_DOCUMENT_ERROR = "HAR contains no HTML document entry";

export function parseHar(raw: RawHar): ParsedHar {
  const { pages, entries } = assertHasContent(raw);
  const parsed = buildParsedHar(pages, entries);
  if (!parsed) throw new Error(NO_DOCUMENT_ERROR);
  return parsed;
}

/**
 * Splits a HAR recorded across several navigations into one ParsedHar per page,
 * ordered by page startedDateTime. Entries are grouped by `pageref` (entries
 * without one belong to the first page) and timed against their own page.
 * Pages without an HTML document are skipped.
 */
export function parseHarPages(raw: RawHar): ParsedHar[] {
  const { pages, entries } = assertHasContent(raw);
  const ordered = [...pages].sort(
    (a, b) => new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime()
  );
  const firstId = ordered[0].id;

  const result: ParsedHar[] = [];
  for (const page of ordered) {
    const pageEntries = entries.filter((e) => (e.pageref ?? firstId) === page.id);
    const parsed = buildParsedHar([page], pageEntries);
    if (parsed) result.push(parsed);
  }
  if (result.length === 0) throw new Error(NO_DOCUMENT_ERROR);
  return result;
}

export function parseHarJson(json: string): ParsedHar {
  return parseHar(JSON.parse(json) as RawHar);
}

export function parseHarPagesJson(json: string): ParsedHar[] {
  return parseHarPages(JSON.parse(json) as RawHar);
}

/** Page label: its title, else the document host and path, else "Page N". */
export function defaultPageName(page: HarPage, index: number, documentUrl?: string): string {
  const title = page.title.trim();
  if (title) return title;
  if (documentUrl) {
    try {
      const url = new URL(documentUrl);
      return `${url.hostname}${url.pathname}`;
    } catch {
      // fall through
    }
  }
  return `Page ${index + 1}`;
}
