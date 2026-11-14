import type {
  ContentEncoding,
  HarEntry,
  HarPage,
  InferredCacheHit,
  HarTiming,
  HttpVersion,
  OptionalTimingPhase,
  ParsedHar,
  PreconnectSource,
  ResourcePriority,
  ResourceType,
  ServerTimingMetric,
} from "../types.js";
import { getRootDomain } from "../utils/domain.js";

// HAR 1.2 makes blocked, dns, connect and ssl optional; exporters such as Playwright leave
// them out instead of writing -1.
interface RawHarTiming {
  blocked?: number;
  dns?: number;
  connect?: number;
  ssl?: number;
  send?: number;
  wait?: number;
  receive?: number;
}

interface RawHarEntry {
  pageref?: string;
  startedDateTime: string;
  time: number;
  // The frame that made the request (Playwright).
  _frameref?: string;
  _resourceType?: string;
  _priority?: string;
  _fromCache?: string;
  // Chrome: the id of the connection the request used ("" for a browser-cache hit).
  _connectionId?: string | number;
  cache?: { beforeRequest?: Record<string, unknown> | null };
  request: {
    url: string;
    method: string;
    headers?: { name: string; value: string }[];
    cookies?: { name: string; value: string }[];
  };
  _transferSize?: number;
  // WebPageTest omits or nulls parts of the response (content: null, no headers).
  response?: {
    // Where Chrome DevTools exports the bytes on the wire.
    _transferSize?: number;
    status?: number;
    httpVersion?: string;
    headers?: { name: string; value: string }[];
    content?: { mimeType?: string; size?: number } | null;
    redirectURL?: string;
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
  // WebPageTest copies its result data into each page, every key prefixed with "_".
  [extra: `_${string}`]: unknown;
}

// The WebPageTest page extras that hold its own paint times, in order of preference.
const WPT_FCP_KEYS = ["_firstContentfulPaint", "_chromeUserTiming.firstContentfulPaint"] as const;
const WPT_LCP_KEYS = ["_chromeUserTiming.LargestContentfulPaint"] as const;

/** The first of the page's extras that holds a positive time in ms. */
function pageExtraMs(page: RawHarPage, keys: readonly `_${string}`[]): number | undefined {
  for (const key of keys) {
    const value = page[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function recordedPaints(page: RawHarPage): { fcp?: number; lcp?: number } {
  const fcp = pageExtraMs(page, WPT_FCP_KEYS);
  const lcp = pageExtraMs(page, WPT_LCP_KEYS);
  return { ...(fcp !== undefined ? { fcp } : {}), ...(lcp !== undefined ? { lcp } : {}) };
}

interface RawHar {
  log: { creator?: { name?: string }; pages?: RawHarPage[]; entries?: RawHarEntry[] };
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

const OPTIONAL_PHASES: readonly OptionalTimingPhase[] = ["blocked", "dns", "connect", "ssl"];

function parseTiming(raw: RawHarTiming): HarTiming {
  // An optional phase left out did not happen, as -1 says; a required one left out took 0 ms.
  const optional = (phase: OptionalTimingPhase) => raw[phase] ?? -1;
  const notApplicable = OPTIONAL_PHASES.filter((phase) => optional(phase) < 0);
  return {
    blocked: normalizeMs(optional("blocked")),
    dns: normalizeMs(optional("dns")),
    connect: normalizeMs(optional("connect")),
    ssl: normalizeMs(optional("ssl")),
    send: normalizeMs(raw.send ?? 0),
    wait: normalizeMs(raw.wait ?? 0),
    receive: normalizeMs(raw.receive ?? 0),
    ...(notApplicable.length > 0 ? { notApplicable } : {}),
  };
}

// HAR 1.2 defines an entry's time as the sum of its timings.
const timingTotal = (t: HarTiming) => t.blocked + t.dns + t.connect + t.send + t.wait + t.receive;

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
  // Protocol and server timings
  "alt-svc",
  "server-timing",
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
  "x-edge-location",
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
  "x-fd",
  "x-goog",
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

function hasHeader(headers: { name: string; value: string }[] | undefined, name: string): boolean {
  return (headers ?? []).some((h) => h.name.toLowerCase() === name);
}

// Flags for the headers that mark a response as user-specific; their values never leave the HAR.
function personalizationFlags(e: RawHarEntry): Pick<HarEntry, "setsCookie" | "sendsAuthorization"> {
  return {
    ...(hasHeader(e.response?.headers, "set-cookie") && { setsCookie: true }),
    ...(hasHeader(e.request.headers, "authorization") && { sendsAuthorization: true }),
  };
}

// DevTools' "Disable cache" and a hard reload send Cache-Control: no-cache and Pragma: no-cache.
function bypassFlag(e: RawHarEntry): Pick<HarEntry, "bypassesCache"> {
  const bypasses = (e.request.headers ?? []).some(
    (h) =>
      ["cache-control", "pragma"].includes(h.name.toLowerCase()) && /\bno-cache\b/i.test(h.value)
  );
  return bypasses ? { bypassesCache: true } : {};
}

// Chrome's _initiator, trimmed to its type and the URL and line that requested the resource:
// a script initiator's URL is the first stack frame that has one, async parents included.
function initiatorField(e: RawHarEntry): Pick<HarEntry, "initiator"> {
  interface Frame {
    url?: unknown;
    lineNumber?: unknown;
  }
  interface Stack {
    callFrames?: Frame[];
    parent?: Stack;
  }
  const raw = (e as { _initiator?: unknown })._initiator;
  if (typeof raw !== "object" || raw === null) return {};
  const { type, url, lineNumber, stack } = raw as Frame & { type?: unknown; stack?: Stack };
  if (typeof type !== "string" || type === "") return {};

  let frame: Frame | undefined =
    typeof url === "string" && url !== "" ? { url, lineNumber } : undefined;
  for (let s = stack; frame === undefined && s; s = s.parent) {
    frame = (Array.isArray(s.callFrames) ? s.callFrames : []).find(
      (f) => typeof f.url === "string" && f.url !== ""
    );
  }
  if (frame === undefined) return { initiator: { type } };
  return {
    initiator: {
      type,
      url: frame.url as string,
      ...(typeof frame.lineNumber === "number" ? { lineNumber: frame.lineNumber } : {}),
    },
  };
}

// Repeated headers are joined with ", ", which means the same as listing them apart
// (RFC 9110 §5.3). Set-Cookie is the exception: its values may contain commas, so only
// the first one is kept.
function headersToRecord(headers: { name: string; value: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    const name = h.name.toLowerCase();
    const previous = result[name];
    if (previous === undefined) result[name] = h.value;
    else if (name !== "set-cookie") result[name] = `${previous}, ${h.value}`;
  }
  return result;
}

// ── Transport: protocol, connection, encoding, Server-Timing, cookies ────────

function parseHttpVersion(raw: string | undefined): HttpVersion {
  const version = (raw ?? "").trim().toLowerCase();
  // Older Chrome exports gQUIC as "http/2+quic/43".
  if (/^(h3|http\/3)/.test(version) || version.includes("quic")) return "h3";
  if (/^(h2|http\/2)/.test(version)) return "h2";
  if (/^http\/1/.test(version)) return "h1";
  return "unknown";
}

const CONTENT_CODINGS: Record<string, ContentEncoding> = {
  br: "br",
  dcb: "br",
  gzip: "gzip",
  "x-gzip": "gzip",
  zstd: "zstd",
  dcz: "zstd",
  deflate: "deflate",
};

/**
 * The compression a Content-Encoding value applies: the last coding listed, the one applied
 * last; "none" without one, "identity" when it names no compression the analyzers know.
 */
export function parseContentEncoding(value: string | undefined): ContentEncoding {
  const last = (value ?? "")
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .filter(Boolean)
    .at(-1);
  if (last === undefined) return "none";
  return CONTENT_CODINGS[last] ?? "identity";
}

// Splits on a separator outside double-quoted strings.
function splitUnquoted(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && inQuotes) {
      current += char + (value[i + 1] ?? "");
      i++;
      continue;
    }
    if (char === '"') inQuotes = !inQuotes;
    if (char === separator && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

const unquote = (value: string) =>
  value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1).replace(/\\(.)/g, "$1")
    : value;

/** The metrics of a Server-Timing header, each with its duration and description when given. */
function parseServerTiming(header: string): ServerTimingMetric[] {
  const metrics: ServerTimingMetric[] = [];
  for (const part of splitUnquoted(header, ",")) {
    const [rawName = "", ...params] = splitUnquoted(part, ";");
    const name = rawName.trim();
    if (!name) continue;
    const metric: ServerTimingMetric = { name };
    for (const param of params) {
      const eq = param.indexOf("=");
      const key = (eq === -1 ? param : param.slice(0, eq)).trim().toLowerCase();
      const value = eq === -1 ? "" : unquote(param.slice(eq + 1).trim());
      if (key === "dur" && metric.dur === undefined) {
        const dur = parseFloat(value);
        if (Number.isFinite(dur)) metric.dur = dur;
      } else if (key === "desc" && metric.desc === undefined) {
        metric.desc = value;
      }
    }
    metrics.push(metric);
  }
  return metrics;
}

// Alt-Svc lists alternatives as protocol-id="authority"; h3 and its drafts (h3-29) are HTTP/3.
const advertisesHttp3 = (altSvc: string) => /(^|,)\s*h3(-\w+)?\s*=/i.test(altSvc);

// The size of the Cookie the request sent, as one header would carry it (HTTP/2 may split it
// into several); from the request's cookie list when the headers leave it out. 0 without one.
function requestCookieBytes(request: RawHarEntry["request"]): number {
  const headerValues = (request.headers ?? [])
    .filter((h) => h.name.toLowerCase() === "cookie")
    .map((h) => h.value);
  if (headerValues.length > 0) return headerValues.join("; ").length;
  return (request.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ").length;
}

// How the response crossed the network. Only the Cookie's size leaves the HAR, never its value.
function transportFields(
  e: RawHarEntry,
  headers: Record<string, string>
): Pick<
  HarEntry,
  | "httpVersion"
  | "connectionId"
  | "contentEncoding"
  | "serverTiming"
  | "advertisesHttp3"
  | "requestCookieBytes"
> {
  const connectionId = e._connectionId === undefined ? "" : String(e._connectionId);
  const serverTiming = headers["server-timing"];
  const cookieBytes = requestCookieBytes(e.request);
  return {
    httpVersion: parseHttpVersion(e.response?.httpVersion),
    ...(connectionId !== "" && { connectionId }),
    contentEncoding: parseContentEncoding(headers["content-encoding"]),
    ...(serverTiming !== undefined && { serverTiming: parseServerTiming(serverTiming) }),
    ...(advertisesHttp3(headers["alt-svc"] ?? "") && { advertisesHttp3: true as const }),
    ...(cookieBytes > 0 && { requestCookieBytes: cookieBytes }),
  };
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
  const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1];
  return extension ? (URL_EXTENSION_TYPES[extension.toLowerCase()] ?? null) : null;
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

const isSize = (value: unknown): value is number => typeof value === "number" && value >= 0;

// Bytes on the wire: headers plus the compressed body. HAR's bodySize is what crossed the
// network (0 for a 304) and content.size the uncompressed body, used only when nothing else is.
function parseTransferSize(e: RawHarEntry): number {
  const { _transferSize, bodySize, headersSize, content } = e.response ?? {};
  if (isSize(e._transferSize)) return e._transferSize;
  if (isSize(_transferSize)) return _transferSize;
  // Served from the browser cache: nothing crossed the network.
  if (parseFromCache(e._fromCache, e.cache)) return 0;
  if (isSize(bodySize)) return bodySize + (isSize(headersSize) ? headersSize : 0);
  return isSize(content?.size) ? content.size : 0;
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

// Splits a Link header into its links: on the commas outside the <URL> and outside
// quoted parameter values.
function splitLinks(linkHeader: string): string[] {
  const links: string[] = [];
  let current = "";
  let inUrl = false;
  let inQuotes = false;
  for (const char of linkHeader) {
    if (char === "<" && !inQuotes) inUrl = true;
    else if (char === ">" && !inQuotes) inUrl = false;
    else if (char === '"' && !inUrl) inQuotes = !inQuotes;
    else if (char === "," && !inUrl && !inQuotes) {
      links.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  links.push(current);
  return links;
}

function preconnectHostnames(linkHeader: string): string[] {
  const result: string[] = [];
  for (const part of splitLinks(linkHeader)) {
    const linkUrl = part.match(/<([^>]+)>/)?.[1];
    // rel may list several relations: rel="dns-prefetch preconnect".
    const relMatch = part.match(/;\s*rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i);
    const rels = (relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? "").toLowerCase().split(/\s+/);
    if (linkUrl && rels.includes("preconnect")) {
      try {
        result.push(new URL(linkUrl).hostname);
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

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Informational (1xx) responses and redirects are not the document the page rendered;
// a 304 is: the browser renders its cached copy. Unknown statuses (0) count as final.
function isFinalStatus(status: number): boolean {
  return !REDIRECT_STATUSES.has(status) && (status < 100 || status >= 200);
}

// Where a redirect points, from the HAR's redirectURL or the Location header, resolved
// against the request URL; null when the entry is not a redirect.
function redirectTarget(raw: RawHarEntry): string | null {
  const response = raw.response ?? {};
  if (!REDIRECT_STATUSES.has(response.status ?? 0)) return null;
  const location =
    response.redirectURL ||
    response.headers?.find((h) => h.name.toLowerCase() === "location")?.value;
  if (!location) return null;
  try {
    return new URL(location, raw.request.url).href;
  } catch {
    return null;
  }
}

// The redirects the navigation followed from the page's first request, in order, and the
// response they led to; no redirects when the first request is not one or the HAR did not
// record where the chain ends.
function followRedirects(entries: HarEntry[]): {
  redirects: HarEntry[];
  final: HarEntry | null;
} {
  const redirects: HarEntry[] = [];
  let current = entries[0];
  let final: HarEntry | null = null;
  let index = 0;
  while (current?.redirectURL !== undefined) {
    redirects.push(current);
    const url = current.redirectURL;
    const next = entries.findIndex((e, i) => i > index && e.url === url);
    const nextEntry = entries[next];
    if (!nextEntry) return { redirects: [], final: null };
    index = next;
    current = final = nextEntry;
  }
  return { redirects, final };
}

/**
 * The page's main document: the response its first request's redirect chain ends at, else
 * the first final HTML response, preferring the one whose URL is the page title (Chrome
 * titles pages with their URL) so iframes and earlier HTML responses do not take its place.
 * Falls back to the first HTML response, and null without one.
 */
function findDocument(
  entries: HarEntry[],
  pageTitle: string
): { documentEntry: HarEntry; documentRedirects: HarEntry[] } | null {
  const { redirects, final } = followRedirects(entries);
  if (final?.isDocument && isFinalStatus(final.status)) {
    return { documentEntry: final, documentRedirects: redirects };
  }
  const candidates = entries.filter((e) => e.isDocument && isFinalStatus(e.status));
  const title = pageTitle.trim();
  const documentEntry =
    candidates.find((e) => e.url === title) ?? candidates[0] ?? entries.find((e) => e.isDocument);
  return documentEntry ? { documentEntry, documentRedirects: [] } : null;
}

// Playwright marks no browser-cache hit: a hit is a successful response that put no byte on
// the wire (_transferSize 0) and still has a body. Redirects and failures have no body.
function isPlaywrightCacheHit(e: RawHarEntry): boolean {
  const { status = 0, _transferSize, content } = e.response ?? {};
  return status >= 200 && status < 300 && _transferSize === 0 && (content?.size ?? 0) > 0;
}

interface HarSource {
  // Recorded by Playwright, which marks cache hits only by their size (isPlaywrightCacheHit).
  playwright: boolean;
}

function buildParsedHar(
  rawPages: RawHarPage[],
  entries: RawHarEntry[],
  source: HarSource
): ParsedHar | null {
  const [firstEntry] = entries;
  const [firstPage] = rawPages;
  if (!firstEntry || !firstPage) return null;

  // Use the first entry's startedDateTime as origin; Chrome's page.startedDateTime
  // can be a few ms later than the first request due to rounding.
  const firstEntryMs = new Date(firstEntry.startedDateTime).getTime();
  const pageOriginMs = new Date(firstPage.startedDateTime).getTime();
  const pageOrigin = Math.min(firstEntryMs, pageOriginMs);

  const parsedPages: HarPage[] = rawPages.map((p) => ({
    id: p.id,
    title: p.title,
    onContentLoad: parsePageTime(p.pageTimings?.onContentLoad),
    onLoad: parsePageTime(p.pageTimings?.onLoad),
    ...recordedPaints(p),
  }));

  const parsedEntries: HarEntry[] = entries.map((e) => {
    const rawTimings = e.timings ?? ZERO_TIMING;
    const timing = parseTiming(rawTimings);
    const ttfb = timing.wait;
    const startTime = new Date(e.startedDateTime).getTime() - pageOrigin;
    const response = e.response ?? {};
    const allResponseHeaders = headersToRecord(response.headers ?? []);
    const responseHeaders = pickResponseHeaders(allResponseHeaders);
    const mimeType = response.content?.mimeType ?? "";
    const redirectURL = redirectTarget(e);

    return {
      url: e.request.url,
      method: e.request.method,
      ...(e._resourceType === "ping" ? { ping: true as const } : {}),
      startTime,
      duration: typeof e.time === "number" ? e.time : timingTotal(timing),
      timing,
      ttfb,
      status: response.status ?? 0,
      mimeType,
      resourceType: parseResourceType(e._resourceType, e.request.url, mimeType),
      priority: parseResourcePriority(e._priority),
      responseHeaders,
      transferSize: parseTransferSize(e),
      bodySize: Math.max(0, response.content?.size ?? 0),
      isDocument: isHtmlMime(mimeType),
      fromCache:
        parseFromCache(e._fromCache, e.cache) ||
        (source.playwright && isPlaywrightCacheHit(e) ? "unknown" : false),
      ...personalizationFlags(e),
      ...(redirectURL !== null ? { redirectURL } : {}),
      ...bypassFlag(e),
      ...transportFields(e, allResponseHeaders),
      ...initiatorField(e),
    };
  });

  const document = findDocument(parsedEntries, firstPage.title);
  const { documentEntry, documentRedirects } = document ?? {
    documentEntry: primaryRequest(parsedEntries),
    documentRedirects: [],
  };

  return {
    pages: parsedPages,
    entries: parsedEntries,
    documentEntry,
    documentRedirects,
    preconnectHints: parsePreconnectHints(
      parsedEntries,
      document ? documentEntry.responseHeaders : {}
    ),
  };
}

/**
 * What stands for the document of a page without one (an API capture): the first request to
 * the registrable domain that received the most requests, the most plausible first party.
 */
function primaryRequest(entries: HarEntry[]): HarEntry {
  const byStart = [...entries].sort((a, b) => a.startTime - b.startTime);
  const requests = new Map<string, number>();
  for (const e of byStart) {
    const root = getRootDomain(e.url);
    requests.set(root, (requests.get(root) ?? 0) + 1);
  }
  const count = (e: HarEntry) => requests.get(getRootDomain(e.url))!;
  return byStart.reduce((best, e) => (count(e) > count(best) ? e : best));
}

/**
 * The page's HTML document; null for a page without one, whose documentEntry is then its
 * primary request (the first party's first request) and no document metric applies.
 */
export function pageDocument(har: Pick<ParsedHar, "documentEntry">): HarEntry | null {
  return har.documentEntry.isDocument ? har.documentEntry : null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isValidDate = (value: unknown) => typeof value === "string" && !isNaN(Date.parse(value));

// The least an entry needs to be read: a request with a URL and a start time to place it.
function isReadableEntry(e: unknown): e is RawHarEntry {
  if (!isObject(e) || !isObject(e.request)) return false;
  const { url } = e.request;
  return typeof url === "string" && url !== "" && isValidDate(e.startedDateTime);
}

type NonEmptyPages = [RawHarPage, ...RawHarPage[]];

// A page whose start is missing or invalid starts with the earliest of its entries.
function startingWith(page: RawHarPage, entries: RawHarEntry[]): RawHarPage {
  if (isValidDate(page.startedDateTime) || entries.length === 0) return page;
  const earliest = Math.min(...entries.map(startMs));
  return { ...page, startedDateTime: new Date(earliest).toISOString() };
}

/**
 * The HAR's readable entries and its pages, each page titled and, when its start is missing
 * or invalid, started with the earliest entry that names it. HAR 1.2 makes pages optional:
 * without them the HAR is one untitled page that starts with its earliest entry.
 */
function readContent(raw: RawHar): { pages: NonEmptyPages; entries: RawHarEntry[] } {
  const rawEntries: unknown[] = Array.isArray(raw.log.entries) ? raw.log.entries : [];
  if (rawEntries.length === 0) throw new Error("HAR contains no entries");
  const entries = rawEntries.filter(isReadableEntry);
  if (entries.length === 0) {
    throw new Error("No entry of the HAR has a request URL and a valid start time.");
  }
  const [firstRawPage, ...otherRawPages] = (
    Array.isArray(raw.log.pages) ? raw.log.pages : []
  ).filter(isObject);
  if (!firstRawPage) {
    return {
      pages: [startingWith({ id: "page_1", title: "", startedDateTime: "" }, entries)],
      entries,
    };
  }
  const readPage = (page: RawHarPage) =>
    startingWith(
      { ...page, title: typeof page.title === "string" ? page.title : "" },
      entries.filter((e) => e.pageref === page.id)
    );
  return { pages: [readPage(firstRawPage), ...otherRawPages.map(readPage)], entries };
}

export function parseHar(raw: RawHar): ParsedHar {
  const { pages, entries } = readContent(raw);
  const source = harSource(raw);
  const [first, ...rest] = pages;
  const page = anchorAtNavigation(startingWith(first, entries), entries, source);
  return buildParsedHar([page, ...rest], entries, source)!;
}

// Seconds a response may be reused without asking the server, from Cache-Control max-age,
// else Expires, else 10% of the time since Last-Modified (the heuristic browsers apply).
// Null when the browser must revalidate or the response says nothing.
function freshnessLifetime(headers: Record<string, string>): number | null {
  const cacheControl = (headers["cache-control"] ?? "").toLowerCase();
  if (/\b(no-store|no-cache)\b/.test(cacheControl)) return null;
  const maxAge = cacheControl.match(/\bmax-age=(\d+)/)?.[1];
  if (maxAge) return parseInt(maxAge, 10);
  const date = Date.parse(headers["date"] ?? "");
  if (isNaN(date)) return null;
  if (headers["expires"] !== undefined) {
    const expires = Date.parse(headers["expires"]);
    return isNaN(expires) ? 0 : Math.max(0, (expires - date) / 1000);
  }
  const lastModified = Date.parse(headers["last-modified"] ?? "");
  return isNaN(lastModified) || lastModified >= date
    ? null
    : Math.floor((date - lastModified) / 10_000);
}

// WebPageTest names its pages page_<run>_<view>_<step>, view 0 the first view and 1 the repeat.
export const WPT_REPEAT_VIEW_ID = /^page_(\d+)_1_(\d+)$/;

const isWebPageTest = (raw: RawHar): boolean => /webpagetest/i.test(raw.log.creator?.name ?? "");

const harSource = (raw: RawHar): HarSource => ({
  playwright: /^playwright$/i.test(raw.log.creator?.name ?? ""),
});

interface ParsedPage {
  page: RawHarPage;
  entries: RawHarEntry[];
  parsed: ParsedHar;
}

/**
 * The resources of a WebPageTest first view that its repeat view never requested and that
 * were still fresh when the repeat view started: browser-cache hits WebPageTest left out.
 */
function inferCacheHits(firstView: ParsedPage, repeatView: ParsedPage): InferredCacheHit[] {
  const requested = new Set(repeatView.entries.map((e) => e.request.url));
  const repeatStart = new Date(repeatView.page.startedDateTime).getTime();
  const hits: InferredCacheHit[] = [];
  firstView.entries.forEach((raw, i) => {
    const entry = firstView.parsed.entries[i];
    if (!entry || entry.isDocument || requested.has(entry.url)) return;
    if (raw.request.method !== "GET" || entry.status !== 200) return;
    const lifetime = freshnessLifetime(entry.responseHeaders);
    if (lifetime === null) return;
    const age = parseInt(entry.responseHeaders["age"] ?? "", 10) || 0;
    const elapsed = (repeatStart - new Date(raw.startedDateTime).getTime()) / 1000;
    if (lifetime <= age + elapsed) return;
    requested.add(entry.url);
    hits.push({
      url: entry.url,
      resourceType: entry.resourceType,
      transferSize: entry.transferSize,
      lifetime,
      ...(entry.priority ? { priority: entry.priority } : {}),
    });
  });
  return hits;
}

interface RawPageGroup {
  page: RawHarPage;
  entries: RawHarEntry[];
}

const startMs = (e: { startedDateTime: string }) => new Date(e.startedDateTime).getTime();

/**
 * A HAR page started at its first navigation. Chrome DevTools starts a page there, but
 * Playwright opens it with the browser page, before page.goto(): the wait until the first
 * document request (seconds of test setup) would count as TTFB and shift every time of the
 * page. For Playwright the page starts with its first document request, the page timings
 * moved by the same amount; a page with no document stays as it is.
 */
function anchorAtNavigation(page: RawHarPage, entries: RawHarEntry[], source: HarSource) {
  if (!source.playwright) return page;
  const documents = entries.filter((e) => e._resourceType === "document");
  if (documents.length === 0) return page;
  const navigationStart = Math.min(...documents.map(startMs));
  const offset = navigationStart - startMs(page);
  if (offset <= 0) return page;
  const shift = (value: number | undefined) =>
    value !== undefined && value >= 0 ? Math.max(0, value - offset) : value;
  return {
    ...page,
    startedDateTime: new Date(navigationStart).toISOString(),
    pageTimings: {
      ...page.pageTimings,
      onContentLoad: shift(page.pageTimings?.onContentLoad),
      onLoad: shift(page.pageTimings?.onLoad),
    },
  };
}

// A page time (ms from the page start) moved to a navigation that starts `offset` ms later;
// -1 when the event did not fire during that navigation.
function pageTimeIn(value: number | undefined, offset: number, fired: boolean): number {
  return fired && value !== undefined && value >= 0 ? value - offset : -1;
}

/**
 * Splits a HAR page at each navigation of its main frame. Playwright keeps a whole session
 * under one page; each load then gets its own steps, TTFB and load event. The main frame is
 * the frame (_frameref) of the first document; a document that answers the redirect of the
 * previous one belongs to the same navigation. Entries go to the navigation running when
 * they started. The page timings belong to the navigation the event fired in, timed from its
 * start, and the page title to the last navigation. A page whose entries name no frame, or
 * that navigated once, stays whole.
 */
function splitNavigations(page: RawHarPage, entries: RawHarEntry[]): RawPageGroup[] {
  const isDocument = (e: RawHarEntry) => e._resourceType === "document";
  const mainFrame = entries.find(isDocument)?._frameref;
  if (mainFrame === undefined) return [{ page, entries }];

  const documents = entries
    .filter((e) => isDocument(e) && e._frameref === mainFrame)
    .sort((a, b) => startMs(a) - startMs(b));
  const starts: number[] = [];
  documents.forEach((d, i) => {
    const previous = documents[i - 1];
    if (previous && redirectTarget(previous) === d.request.url) return;
    starts.push(i === 0 ? startMs(page) : startMs(d));
  });
  if (starts.length < 2) return [{ page, entries }];

  const laterStarts = starts.slice(1);
  const navigationAt = (ms: number) => {
    let index = 0;
    for (const start of laterStarts) {
      if (start > ms) break;
      index++;
    }
    return index;
  };
  const pageStart = startMs(page);
  const { onContentLoad, onLoad } = page.pageTimings ?? {};
  const firedIn = (value: number | undefined) =>
    value !== undefined && value >= 0 ? navigationAt(pageStart + value) : -1;
  const loadIn = firedIn(onLoad);
  const contentLoadIn = firedIn(onContentLoad);
  const last = starts.length - 1;

  const groups: RawPageGroup[] = starts.map((start, index) => ({
    page: {
      ...page,
      id: index === 0 ? page.id : `${page.id}#${index + 1}`,
      title: index === last ? page.title : "",
      startedDateTime: new Date(start).toISOString(),
      pageTimings: {
        onContentLoad: pageTimeIn(onContentLoad, start - pageStart, contentLoadIn === index),
        onLoad: pageTimeIn(onLoad, start - pageStart, loadIn === index),
      },
    },
    entries: [],
  }));
  // navigationAt stays below starts.length, the length of groups.
  for (const entry of entries) groups[navigationAt(startMs(entry))]!.entries.push(entry);
  return groups;
}

// A page's start for ordering: one that has none sorts after every other.
const orderMs = (page: RawHarPage) => {
  const ms = startMs(page);
  return isNaN(ms) ? Infinity : ms;
};

/**
 * Splits a HAR recorded across several navigations into one ParsedHar per page,
 * ordered by page startedDateTime (pages that start together keep the HAR's order).
 * Entries are grouped by `pageref` and timed against their own page: entries without
 * one belong to the first page, and an entry whose pageref names no listed page to the
 * page that was running when it started, so no request is dropped. A page that holds
 * several navigations of its main frame is split at each (splitNavigations).
 * Pages without an HTML document are skipped, unless no page has one (an API capture):
 * then every page stays, each standing on its primary request (pageDocument).
 * WebPageTest repeat views carry the browser-cache hits inferred from the first view of
 * their run.
 */
export function parseHarPages(raw: RawHar): ParsedHar[] {
  const { pages, entries } = readContent(raw);
  const ordered: NonEmptyPages = [...pages];
  ordered.sort((a, b) => (orderMs(a) === orderMs(b) ? 0 : orderMs(a) - orderMs(b)));
  const firstId = ordered[0].id;
  const listed = new Set(ordered.map((page) => page.id));
  const runningAt = (ms: number) =>
    ordered.reduce((running, page) => (orderMs(page) <= ms ? page : running), ordered[0]);
  const pageIdOf = (e: RawHarEntry) => {
    if (e.pageref === undefined) return firstId;
    return listed.has(e.pageref) ? e.pageref : runningAt(startMs(e)).id;
  };
  const source = harSource(raw);

  const allPages = new Map<string, ParsedPage>();
  for (const harPage of ordered) {
    const harPageEntries = entries.filter((e) => pageIdOf(e) === harPage.id);
    const started = startingWith(harPage, harPageEntries);
    const navigated = anchorAtNavigation(started, harPageEntries, source);
    for (const { page, entries: pageEntries } of splitNavigations(navigated, harPageEntries)) {
      const parsed = buildParsedHar([page], pageEntries, source);
      if (parsed) allPages.set(page.id, { page, entries: pageEntries, parsed });
    }
  }
  const withDocument = [...allPages].filter(([, { parsed }]) => pageDocument(parsed) !== null);
  const parsedPages = withDocument.length > 0 ? new Map(withDocument) : allPages;

  if (isWebPageTest(raw)) {
    for (const [id, repeatView] of parsedPages) {
      const match = WPT_REPEAT_VIEW_ID.exec(id);
      const firstView = match && parsedPages.get(`page_${match[1]}_0_${match[2]}`);
      if (firstView) repeatView.parsed.inferredCacheHits = inferCacheHits(firstView, repeatView);
    }
  }
  return [...parsedPages.values()].map(({ parsed }) => parsed);
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
