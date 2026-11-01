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
  const notApplicable = OPTIONAL_PHASES.filter((phase) => raw[phase] < 0);
  return {
    blocked: normalizeMs(raw.blocked),
    dns: normalizeMs(raw.dns),
    connect: normalizeMs(raw.connect),
    ssl: normalizeMs(raw.ssl),
    send: normalizeMs(raw.send),
    wait: normalizeMs(raw.wait),
    receive: normalizeMs(raw.receive),
    ...(notApplicable.length > 0 ? { notApplicable } : {}),
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
export function parseServerTiming(header: string): ServerTimingMetric[] {
  const metrics: ServerTimingMetric[] = [];
  for (const part of splitUnquoted(header, ",")) {
    const [rawName, ...params] = splitUnquoted(part, ";");
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
    const urlMatch = part.match(/<([^>]+)>/);
    // rel may list several relations: rel="dns-prefetch preconnect".
    const relMatch = part.match(/;\s*rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i);
    const rels = (relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? "").toLowerCase().split(/\s+/);
    if (urlMatch && rels.includes("preconnect")) {
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
function followRedirects(
  raw: RawHarEntry[],
  entries: HarEntry[]
): { redirects: HarEntry[]; final: HarEntry | null } {
  const redirects: HarEntry[] = [];
  let index = 0;
  let target = redirectTarget(raw[0]);
  while (target !== null) {
    redirects.push(entries[index]);
    const url = target;
    const next = entries.findIndex((e, i) => i > index && e.url === url);
    if (next === -1) return { redirects: [], final: null };
    index = next;
    target = redirectTarget(raw[index]);
  }
  return redirects.length > 0 ? { redirects, final: entries[index] } : { redirects, final: null };
}

/**
 * The page's main document: the response its first request's redirect chain ends at, else
 * the first final HTML response, preferring the one whose URL is the page title (Chrome
 * titles pages with their URL) so iframes and earlier HTML responses do not take its place.
 * Falls back to the first HTML response, and null without one.
 */
function findDocument(
  raw: RawHarEntry[],
  entries: HarEntry[],
  pageTitle: string
): { documentEntry: HarEntry; documentRedirects: HarEntry[] } | null {
  const { redirects, final } = followRedirects(raw, entries);
  if (final?.isDocument && isFinalStatus(final.status)) {
    return { documentEntry: final, documentRedirects: redirects };
  }
  const candidates = entries.filter((e) => e.isDocument && isFinalStatus(e.status));
  const title = pageTitle.trim();
  const documentEntry =
    candidates.find((e) => e.url === title) ?? candidates[0] ?? entries.find((e) => e.isDocument);
  return documentEntry ? { documentEntry, documentRedirects: [] } : null;
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
      duration: e.time,
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
      fromCache: parseFromCache(e._fromCache, e.cache),
      ...personalizationFlags(e),
      ...(redirectURL !== null ? { redirectURL } : {}),
      ...bypassFlag(e),
      ...transportFields(e, allResponseHeaders),
      ...initiatorField(e),
    };
  });

  const document = findDocument(entries, parsedEntries, rawPages[0].title ?? "");
  if (!document) return null;
  const { documentEntry, documentRedirects } = document;

  return {
    pages: parsedPages,
    entries: parsedEntries,
    documentEntry,
    documentRedirects,
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

// Seconds a response may be reused without asking the server, from Cache-Control max-age,
// else Expires, else 10% of the time since Last-Modified (the heuristic browsers apply).
// Null when the browser must revalidate or the response says nothing.
function freshnessLifetime(headers: Record<string, string>): number | null {
  const cacheControl = (headers["cache-control"] ?? "").toLowerCase();
  if (/\b(no-store|no-cache)\b/.test(cacheControl)) return null;
  const maxAge = cacheControl.match(/\bmax-age=(\d+)/);
  if (maxAge) return parseInt(maxAge[1], 10);
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
    if (entry.isDocument || requested.has(entry.url)) return;
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
    });
  });
  return hits;
}

/**
 * Splits a HAR recorded across several navigations into one ParsedHar per page,
 * ordered by page startedDateTime. Entries are grouped by `pageref` (entries
 * without one belong to the first page) and timed against their own page.
 * Pages without an HTML document are skipped. WebPageTest repeat views carry the
 * browser-cache hits inferred from the first view of their run.
 */
export function parseHarPages(raw: RawHar): ParsedHar[] {
  const { pages, entries } = assertHasContent(raw);
  const ordered = [...pages].sort(
    (a, b) => new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime()
  );
  const firstId = ordered[0].id;

  const parsedPages = new Map<string, ParsedPage>();
  for (const page of ordered) {
    const pageEntries = entries.filter((e) => (e.pageref ?? firstId) === page.id);
    const parsed = buildParsedHar([page], pageEntries);
    if (parsed) parsedPages.set(page.id, { page, entries: pageEntries, parsed });
  }
  if (parsedPages.size === 0) throw new Error(NO_DOCUMENT_ERROR);

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
