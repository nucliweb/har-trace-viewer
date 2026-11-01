// ── HAR types ────────────────────────────────────────────────────────────────

export interface HarTiming {
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
  blocked: number;
  // Phases the HAR marked -1, "does not apply": a request over a connection the browser
  // already had open skips dns, connect and ssl; plain HTTP skips ssl. Their value above is
  // 0, so sums still hold. Absent when every phase applied, and in flows parsed before it.
  notApplicable?: OptionalTimingPhase[];
}

// The timing phases a HAR may mark -1 (not applicable).
export type OptionalTimingPhase = "blocked" | "dns" | "connect" | "ssl";

export type ResourceType =
  "document" | "stylesheet" | "script" | "image" | "font" | "fetch" | "other";
export type ResourcePriority = "VeryHigh" | "High" | "Medium" | "Low" | "VeryLow";
export type PreconnectSource = "link-header" | "early-hints";

export interface HarEntry {
  url: string;
  method?: string; // request method; absent in flows parsed before it was kept
  // Chrome's "ping" resource type: navigator.sendBeacon or <a ping>. Absent otherwise.
  ping?: true;
  startTime: number; // ms relative to first entry startedDateTime
  duration: number; // ms total
  timing: HarTiming;
  ttfb: number; // ms: wait (time to first byte)
  status: number;
  mimeType: string;
  resourceType: ResourceType;
  priority?: ResourcePriority; // undefined when the HAR carries no priority (non-Chrome)
  responseHeaders: Record<string, string>;
  transferSize: number; // bytes on the wire (headers + compressed body)
  bodySize: number; // decompressed body bytes (response.content.size)
  isDocument: boolean;
  fromCache: "disk" | "memory" | false;
  // Signs that the response is specific to the user, kept as flags so that no cookie or
  // credential reaches the report: the response sets a cookie, the request carried an
  // Authorization header. Omitted when absent.
  setsCookie?: true;
  sendsAuthorization?: true;
  // Where a 3xx redirect points (redirectURL or Location, resolved against the request URL).
  // Absent on other responses, and in flows parsed before it was kept.
  redirectURL?: string;
  // The request asked to bypass the browser cache (Cache-Control or Pragma: no-cache), as
  // DevTools' "Disable cache" and a hard reload do. Absent otherwise.
  bypassesCache?: true;
  // How the response crossed the network: the protocol, the connection it used (Chrome's
  // _connectionId), its Content-Encoding, its parsed Server-Timing, whether its Alt-Svc
  // advertises HTTP/3, and the size of the Cookie the request sent (never its value).
  // Absent in flows parsed before they were kept; connectionId, serverTiming,
  // advertisesHttp3 and requestCookieBytes are also absent when the HAR has none.
  httpVersion?: HttpVersion;
  connectionId?: string;
  contentEncoding?: ContentEncoding;
  serverTiming?: ServerTimingMetric[];
  advertisesHttp3?: true;
  requestCookieBytes?: number;
  // Who requested the resource, from Chrome's _initiator. Absent when the HAR has none, and in
  // flows parsed before it was kept.
  initiator?: HarInitiator;
}

// The HTTP version a response came over; "unknown" when the HAR does not say.
export type HttpVersion = "h1" | "h2" | "h3" | "unknown";

// The response's Content-Encoding: "none" without the header, "identity" for one that
// names no known compression. Shared-dictionary Brotli (dcb) and Zstandard (dcz) read as
// br and zstd.
export type ContentEncoding = "br" | "gzip" | "zstd" | "deflate" | "identity" | "none";

// One metric of a Server-Timing header: `db;dur=53;desc="Database"`.
export interface ServerTimingMetric {
  name: string;
  dur?: number; // milliseconds
  desc?: string;
}

// Chrome's request initiator: "parser" (the document or a stylesheet referenced it), "script",
// "preload", "other" (the navigation itself)... The url is the referencing document or
// stylesheet, or the first script on the initiator's stack.
export interface HarInitiator {
  type: string;
  url?: string;
  lineNumber?: number;
}

export interface HarPage {
  id: string;
  title: string;
  onContentLoad: number | null; // ms relative to page startedDateTime; null when the event never fired
  onLoad: number | null; // ms relative to page startedDateTime; null when the event never fired
}

// A first-view resource that a WebPageTest repeat view never requested: WebPageTest leaves
// browser-cache hits out of repeat views, so a resource still fresh is taken as one.
export interface InferredCacheHit {
  url: string;
  resourceType: ResourceType;
  transferSize: number; // bytes the first view downloaded, saved by the repeat view
  lifetime: number; // freshness lifetime in seconds, from Cache-Control, Expires or Last-Modified
}

export interface ParsedHar {
  pages: HarPage[];
  entries: HarEntry[];
  documentEntry: HarEntry;
  // The redirects the navigation followed before documentEntry, in order (also in
  // `entries`). Absent from flows embedded before it existed.
  documentRedirects?: HarEntry[];
  preconnectHints: Record<string, PreconnectSource>;
  // Only on WebPageTest repeat views, inferred from the first view of the same run.
  inferredCacheHits?: InferredCacheHit[];
}

// ── Trace types ───────────────────────────────────────────────────────────────

export interface TraceEvent {
  name: string;
  ts: number; // microseconds (raw from trace)
  args?: Record<string, unknown>;
}

export interface ParsedTrace {
  navigationStart: number; // microseconds
  fcp: number | null; // ms relative to navigationStart
  lcp: number | null; // ms relative to navigationStart
  cls: number | null; // unitless; null when the trace has no LayoutShift events
  inp: number | null; // ms; null when the trace has no interactions
  navigationId: string | null; // id of the main navigation, when the trace carries it
  url: string | null; // documentLoaderURL of the main navigation
  // The LCP candidate `lcp` measures: the last one before the first interaction. Null without
  // candidates; absent in flows parsed before it was kept.
  lcpCandidate?: TraceLcpCandidate | null;
  // When the first interaction (an EventTiming with an interactionId) started, in ms from
  // navigationStart; null without interactions. Absent in flows parsed before it was kept.
  firstInputMs?: number | null;
  // The main frame's http(s) requests sent up to the last paint metric (FCP or LCP), in the
  // order they were sent. Absent in flows parsed before they were kept.
  requests?: TraceRequest[];
}

// A largestContentfulPaint::Candidate, with the image URL and node name of the matching
// LargestImagePaint / LargestTextPaint candidate. Times in ms from navigationStart.
export interface TraceLcpCandidate {
  timeMs: number;
  type?: string; // "image" or "text"
  nodeId?: number;
  // Chrome's description of the node: "IMG", "P class='intro'".
  nodeName?: string;
  url?: string; // the image's URL, on image candidates
  size?: number; // painted area in px²
  loadingAttr?: string; // the image's loading attribute: "eager" or "lazy"
  // Image timings Chrome reports with the candidate (newer versions only).
  imageDiscoveryMs?: number;
  imageLoadStartMs?: number;
  imageLoadEndMs?: number;
}

// One network request of the trace, from its ResourceSendRequest, ResourceReceiveResponse and
// ResourceFinish events. Times in ms from navigationStart.
export interface TraceRequest {
  url: string;
  resourceType?: string; // Chrome's: "Document", "Stylesheet", "Script", "Image", "Font"...
  priority?: string; // the priority the request was sent with
  fetchPriorityHint?: string; // the fetchpriority attribute: "auto", "high", "low"
  // Chrome's render-blocking status: "blocking", "non_blocking", "in_body_parser_blocking",
  // "potentially_blocking", "dynamically_injected_non_blocking". The final one when a preload
  // changed it (PreloadRenderBlockingStatusChange).
  renderBlocking?: string;
  isLinkPreload?: boolean;
  // Who requested it: type "parser", "script", "preload", "other"; url is the document or
  // stylesheet that referenced it, or the script at the top of the stack.
  initiator?: { type: string; url?: string };
  sentAtMs: number; // when the renderer asked for it
  startMs?: number; // when the network request started
  responseStartMs?: number; // first byte of the response headers
  responseEndMs?: number; // response headers received
  endMs?: number; // last byte received
  encodedDataLength?: number; // bytes on the wire
  fromCache?: boolean;
}

// ── Diagram types ─────────────────────────────────────────────────────────────

// What a node is, whatever its id: the diagram draws, colours and places nodes by kind.
// "cache" is the browser's own HTTP cache (memory and disk), next to the browser.
export type NodeKind = "browser" | "cache" | "gfw" | "edge" | "origin" | "third-parties";

// A page whose third parties fall in several clusters gets one node per cluster,
// `third-parties:<cluster id>`, instead of the single "third-parties" node.
export type ThirdPartyClusterNodeId = `third-parties:${string}`;

export type NodeId = NodeKind | ThirdPartyClusterNodeId;

export type NetworkRegion =
  | "china"
  | "asia-pacific"
  | "europe"
  | "azure-cloud"
  | "united-states"
  | "north-america"
  | "south-america"
  | "africa"
  | "middle-east"
  | "client"
  | "edge"
  | "origin";

export interface DiagramNode {
  id: NodeId;
  label: string;
  subLabel?: string;
  present: boolean;
  region?: NetworkRegion;
  resourceStats?: {
    count: number;
    avgMs?: number;
    // What avgMs measures: the mean request duration when absent; "median-ttfb" on third-party
    // nodes, the median TTFB of the requests that loaded the page (see ThirdPartyCluster).
    avgMsKind?: "median-ttfb";
    label?: string;
  };
}

export type PathId =
  | "browser-gfw"
  | "gfw-edge"
  | "gfw-origin"
  | "browser-edge"
  | "edge-origin"
  | "browser-origin"
  | "browser-third-parties"
  | "browser-cache"
  | ThirdPartyClusterPathId;

// Browser → one third-party cluster node: `browser-third-parties:<cluster id>`.
export type ThirdPartyClusterPathId = `browser-third-parties:${string}`;

export interface DiagramPath {
  id: PathId;
  from: NodeId;
  to: NodeId;
}

// What a number measures: milliseconds, bytes, a count, a 0–1 ratio or a unitless score (CLS).
export type MetricUnit = "ms" | "bytes" | "count" | "ratio" | "score";

export interface Metric {
  label: string;
  // What the step shows: "480 ms", "1.8 s", "3", "0.012", "n/a".
  value: string;
  // The number behind the value, absent when there is none ("n/a"). Flows generated before
  // it existed carry neither raw nor unit: readers fall back to parsing the value.
  raw?: number;
  unit?: MetricUnit;
}

// What a step shows, whatever its title: comparisons pair the steps of two flows by kind.
// A page has at most one step of each kind; "transition" leads from one page to the next.
export type StepKind =
  | "connection"
  | "request"
  | "ttfb"
  | "critical"
  | "secondary"
  | "third-party"
  | "fcp"
  | "lcp"
  | "loaded"
  | "transition";

export interface DiagramStep {
  // Index into Flow.pages / Flow.pageAnalyses. A transition step belongs to the
  // page it leads to, so the diagram already shows the destination topology.
  pageIndex: number;
  kind: StepKind;
  title: string;
  description: string;
  // Milliseconds from the page origin at which the step's event happens
  // (connection start, first byte, first request of a resource group, paint,
  // load event). Page steps are ordered by it; transition steps have none.
  timestamp?: number;
  activeNodes: NodeId[];
  activePaths: PathId[];
  metrics: Metric[];
  pathTimings?: Partial<Record<PathId, string>>;
  pathDirections?: Partial<Record<PathId, "request" | "response">>;
  // Indices into pages[pageIndex].har.entries; resolve them with getStepResources
  // and getStepCacheResources. Network requests and browser-cache hits, respectively.
  resourceRefs?: number[];
  cacheResourceRefs?: number[];
  badge?: {
    type: "ttfb" | "fcp" | "lcp" | "onload";
    value: string;
    node: NodeId;
  };
}

// ── Flow types ────────────────────────────────────────────────────────────────

export interface PageFlow {
  name: string;
  har: ParsedHar;
  trace?: ParsedTrace;
}

// Where the client browser sits on the network. "cn" puts it behind the Great
// Firewall: the diagram adds a GFW node between the browser and the first server.
export type ClientRegion = "default" | "cn";

export interface FlowOptions {
  clientRegion?: ClientRegion; // "default" when omitted
}

// Non-binding hint derived from timings: never changes the topology by itself.
export interface ClientRegionSuggestion {
  region: Exclude<ClientRegion, "default">;
  reason: string;
}

export interface FlowHints {
  suggestedClientRegion?: ClientRegionSuggestion;
}

// Third-party network requests of a page that share a CDN provider and a region.
export interface ThirdPartyCluster {
  // Unique within the page, e.g. "cloudflare-united-states", "direct-origin", "other".
  id: string;
  // "Cloudflare · LAX", "Google", "Direct" (no CDN) or "Other third parties".
  label: string;
  // "unknown" when no CDN serves them; "mixed" for the merged "Other third parties".
  provider: CdnProvider | "mixed";
  region: NetworkRegion;
  // The PoP that served most of the cluster's requests, when the headers name one.
  pop: PopDetection | null;
  // Hostnames, busiest first (in order of first request on a tie).
  hosts: string[];
  requests: number;
  // Median TTFB of the requests sent before onLoad, beacons (POST, ping, 204/205) and 304
  // revalidations aside; null when none qualifies. Flows generated before it measured the
  // mean duration of every request: the name stays so their shape does not change.
  avgMs: number | null;
  bytes: number; // transfer size
  hitRatio: number; // CDN cache hits / requests, 0 without a CDN
}

// Topology and cache analysis of a single page of the flow.
export interface PageAnalysis {
  nodes: DiagramNode[];
  paths: DiagramPath[];
  cacheReport: CacheReport;
  // Biggest first, at most four. Empty without third-party network requests, and for
  // flows older than version 4, whose topology keeps a single third-parties node.
  thirdPartyClusters: ThirdPartyCluster[];
  // Duplicate requests, redirects, failed responses and mixed content. Absent in flows
  // generated before it existed.
  networkReport?: NetworkReport;
  // Compression of text responses and image formats. Absent in flows generated before it existed.
  compressionReport?: CompressionReport;
  // Protocol and connection reuse per host. Absent in flows generated before it existed.
  connectionsReport?: ConnectionsReport;
  // LCP attribution, render-blocking resources and critical request chains. Absent in flows
  // generated before it existed.
  renderReport?: RenderReport;
}

export interface Flow {
  // Data-model version. Flows embedded before versioning existed have none and
  // are read as version 0 (see normalizeFlow).
  version: number;
  clientRegion: ClientRegion;
  hints: FlowHints;
  pages: PageFlow[];
  // One entry per page, in the same order as `pages`.
  pageAnalyses: PageAnalysis[];
  steps: DiagramStep[];
  // The single topology and cache report of flows without pageAnalyses (version ≤ 1), which
  // normalizeFlow copies to every page. Flows that carry pageAnalyses may still have the
  // first page's copy here; nothing reads it.
  nodes?: DiagramNode[];
  paths?: DiagramPath[];
  cacheReport?: CacheReport;
}

// ── Waterfall ─────────────────────────────────────────────────────────────────

// Whether a request goes to the document's registrable domain (its subdomains included).
export type WaterfallParty = "first" | "third";

// A request's phases in ms, one after the other: `connect` is the TCP connection alone
// (the HAR counts TLS inside it) and `ssl` the TLS handshake. Null when the HAR marks the
// phase as not applicable (a reused connection skips dns, connect and ssl).
export interface WaterfallPhases {
  blocked: number | null;
  dns: number | null;
  connect: number | null;
  ssl: number | null;
  send: number;
  wait: number;
  receive: number;
}

// One request of the waterfall. Times in ms from the page origin.
export interface WaterfallRow {
  entryIndex: number; // index into the page's har.entries
  url: string;
  shortName: string; // the last path segment and the query, or the host for a bare origin
  host: string;
  party: WaterfallParty;
  resourceType: ResourceType;
  status: number;
  fromCache: HarEntry["fromCache"];
  transferSize: number;
  startMs: number;
  endMs: number;
  phases: WaterfallPhases;
  priority: ResourcePriority | null;
  redirectURL?: string; // where a 3xx response points
  renderBlocking?: boolean; // held the first paint (trace status, else the HAR's inference)
  isLcpResource?: boolean; // the image the LCP element painted
}

// Page milestones in ms from the page origin; null when the recording lacks them.
export interface WaterfallMarks {
  ttfb: number | null; // the document's first byte
  fcp: number | null;
  lcp: number | null;
  dcl: number | null; // DOMContentLoaded
  onLoad: number | null;
}

export interface WaterfallFilter {
  types?: ResourceType[];
  host?: string;
  party?: WaterfallParty;
  search?: string; // a case-insensitive substring of the URL
}

// Where a waterfall's time axis ends: the end of the recording, or the last page mark (onLoad,
// or a paint after it) to zoom on the load when late requests stretch the recording.
export type WaterfallAxis = "end" | "load";

export interface Waterfall {
  rows: WaterfallRow[]; // sorted by start, in recording order on a tie
  marks: WaterfallMarks;
  // The end of the time axis: the last request end or the last mark, whatever the filter, so
  // that a filtered waterfall keeps the scale of the whole page.
  totalMs: number;
}

// ── Cache analysis ────────────────────────────────────────────────────────────

export type CdnCacheStatus = "hit" | "miss" | "stale" | "bypass" | "unknown";

export interface ResourceCacheProfile {
  cdnStatus: CdnCacheStatus;
  maxAge: number | null;
  age: number | null;
  immutable: boolean;
  mustRevalidate: boolean;
  noStore: boolean;
}

export interface RecommendationResource {
  url: string;
  transferSize: number;
  // The response's Cache-Control, on cache recommendations.
  cacheControl?: string;
  // What went wrong with the resource, on network recommendations: "404", "fetched 2×",
  // "301 → https://example.com/ · 120 ms".
  detail?: string;
}

export interface Recommendation {
  label: string;
  description: string;
  severity: "good" | "info" | "warning" | "critical";
  // The resources the recommendation is about, when it names them: biggest first, or in
  // request order for redirects and failed requests.
  resources?: RecommendationResource[];
}

// The cache report's recommendations; the network report gives the same shape.
export type CacheRecommendation = Recommendation;

export interface CacheReport {
  document: ResourceCacheProfile;
  ownResources: {
    total: number; // own resources the page used, browser-cache hits included
    // Own resources that reached the network: browser-cache hits never reach the CDN, so
    // cdnHits and cdnHitRatio count only these. Absent in flows generated before it existed.
    network?: number;
    cdnHits: number;
    cdnHitRatio: number; // cdnHits / network
    immutableCount: number;
    immutableRatio: number;
  };
  browser: {
    total: number; // resources the page used: network requests and cache hits, document aside
    fromDisk: number;
    fromMemory: number;
    // WebPageTest repeat-view hits inferred from the first view; absent before flow version 6.
    inferred?: number;
    // 304 responses: cached copies the browser had to confirm; absent before flow version 6.
    revalidated?: number;
    hitRatio: number;
  };
  recommendations: CacheRecommendation[];
}

// ── Network report ────────────────────────────────────────────────────────────

// A URL the page fetched over the network more than once (304 revalidations, redirects and
// requests without a response aside; browser-cache hits are not network requests).
export interface DuplicateRequest {
  url: string; // without the fragment, which never reaches the network
  fetches: number;
  wastedBytes: number; // transfer of every fetch after the first
  // Every fetch after the first asked to bypass the browser cache (DevTools' "Disable cache"
  // or a hard reload): with the cache on, the browser may have reused the first response.
  cacheBypassed: boolean;
}

export interface RedirectHop {
  url: string;
  status: number;
  target: string; // where the redirect points
  costMs: number; // from this request's start to the start of the request it led to
}

export interface FailedRequest {
  url: string;
  status: number; // 4xx or 5xx
  resourceType: ResourceType;
  transferSize: number;
}

// An http:// resource of an https:// page.
export interface MixedContentRequest {
  url: string;
  resourceType: ResourceType;
  transferSize: number;
}

export interface NetworkReport {
  duplicates: DuplicateRequest[]; // most bytes wasted first
  // The redirects the navigation followed, and how long they delayed the document request.
  documentRedirects: { hops: RedirectHop[]; delayMs: number };
  // Redirects of other resources whose target the page then requested, in request order.
  resourceRedirects: { hops: RedirectHop[]; totalMs: number };
  errors: FailedRequest[]; // 4xx and 5xx network responses, in request order
  mixedContent: MixedContentRequest[]; // in request order, one per URL
  recommendations: Recommendation[];
}

// ── Compression report ────────────────────────────────────────────────────────

// Response types worth compressing; fonts are left out (WOFF2 is compressed already).
export type CompressibleType = "html" | "css" | "js" | "json" | "svg" | "text";

export interface CompressionByType {
  type: CompressibleType;
  requests: number;
  uncompressedBytes: number; // decoded bodies
  wireBytes: number; // transfer sizes
  encodings: Partial<Record<ContentEncoding, number>>; // requests per encoding
}

// A compressible response sent without compression.
export interface UncompressedResponse {
  url: string;
  type: CompressibleType;
  bytes: number; // decoded body
  wireBytes: number;
  potentialSavings: number; // estimate: 70% of the body
}

// A compressible response sent with gzip or deflate, which Brotli would shrink further.
export interface GzipResponse {
  url: string;
  type: CompressibleType;
  encoding: "gzip" | "deflate";
  bytes: number; // decoded body
  wireBytes: number;
  potentialSavings: number; // estimate: 15% of the wire bytes
}

export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "avif" | "svg" | "other";

export interface ImageFormatUsage {
  format: ImageFormat;
  requests: number;
  bytes: number; // transfer sizes
}

// A JPEG or PNG that a modern format would shrink.
export interface LegacyImage {
  url: string;
  format: "jpeg" | "png";
  bytes: number; // transfer size
  webpSavings: number; // estimate: 30%
  avifSavings: number; // estimate: 50%
}

// A raster image sent with a Content-Encoding, which does not shrink it.
export interface EncodedImage {
  url: string;
  format: ImageFormat;
  encoding: ContentEncoding;
  bytes: number; // transfer size
}

export interface CompressionReport {
  byType: CompressionByType[]; // most wire bytes first
  uncompressed: UncompressedResponse[]; // biggest first
  gzipOnly: GzipResponse[]; // biggest first
  images: {
    byFormat: ImageFormatUsage[]; // most bytes first
    legacy: LegacyImage[]; // biggest first
    encoded: EncodedImage[]; // biggest first
  };
  // Bytes the page could stop sending: uncompressed text, gzip over Brotli and the WebP
  // estimate for legacy images.
  potentialSavings: number;
  recommendations: Recommendation[];
}

// ── Connections report ────────────────────────────────────────────────────────

// The HTTP versions a host's network requests used; "mixed" for several, "unknown" when the
// HAR does not say.
export type HostProtocol = "h1" | "h2" | "h3" | "mixed" | "unknown";

export interface HostConnections {
  host: string;
  protocol: HostProtocol;
  requests: number; // network requests, browser-cache hits aside
  // Distinct connections the requests used; null when the HAR has no connection ids.
  connections: number | null;
  requestsPerConnection: number | null;
  // Requests that paid each phase of a new connection: more than one means the host was
  // looked up, connected to or negotiated with again.
  dnsLookups: number;
  tcpHandshakes: number;
  tlsHandshakes: number;
  // A response advertised HTTP/3 in Alt-Svc.
  advertisesHttp3: boolean;
  // Every request was for a stylesheet, script, image or font.
  staticOnly: boolean;
  cookieBytes: number; // Cookie request header bytes, summed over the requests
  maxCookieBytes: number; // the biggest Cookie a single request sent
}

export interface ConnectionsReport {
  hosts: HostConnections[]; // busiest first
  // The document's Server-Timing metrics, in header order.
  serverTiming: ServerTimingMetric[];
  recommendations: Recommendation[];
}

// ── Render report ─────────────────────────────────────────────────────────────
// Times in ms from the start of the navigation: the trace's navigationStart, or the HAR page
// origin when only the HAR times a request (both mark the start of the same navigation).

export interface LcpElement {
  nodeId?: number;
  tagName?: string; // "IMG", "H1"
  text?: string; // the element's text, when the source names it (Chrome traces do not)
  type?: string; // "image" or "text"
  loading?: string; // an image's loading attribute: "eager" or "lazy"
}

export interface LcpResource {
  url: string;
  discoveredAtMs: number; // when the browser asked for it: the request start
  requestedAtMs: number; // when the network request started
  respondedAtMs: number | null; // response headers received
  loadedAtMs: number; // last byte received
  transferSize: number; // bytes on the wire; 0 from the browser cache
  priority: string | null; // the final priority, from the HAR, else the trace
  fetchPriorityHint: string | null; // the fetchpriority attribute, from the trace
  // Requested early by a preload: <link rel=preload> in the HTML, or a Link header of the
  // document or its Early Hints.
  preloaded: boolean;
  fromCache: boolean;
  initiator: HarInitiator | null;
}

// The web.dev LCP breakdown; the four phases add up to the LCP.
export interface LcpPhases {
  ttfb: number; // navigation start → first byte of the document
  resourceLoadDelay: number; // first byte → the LCP resource's request start
  resourceLoadDuration: number; // request start → last byte of the LCP resource
  elementRenderDelay: number; // resource loaded (or first byte, for text) → LCP
}

// Facts about how the attribution was made:
// "text-element": the LCP element is text, so it has no resource and no load phases;
// "image-url-unknown": the trace does not name the LCP image (older Chrome);
// "resource-not-found": neither the trace nor the HAR requested the LCP image (data: URI);
// "har-timings": the trace has no request for the LCP image: the HAR times it;
// "load-phases-unknown": nothing times the image's load (no request, no candidate load times),
// so the render delay includes it;
// "resource-from-cache": the browser cache served the LCP resource;
// "stopped-at-first-input": the page was interacted with, which ends LCP; later candidates
// do not count.
export type LcpNote =
  | "text-element"
  | "image-url-unknown"
  | "resource-not-found"
  | "load-phases-unknown"
  | "har-timings"
  | "resource-from-cache"
  | "stopped-at-first-input";

export interface LcpAttribution {
  lcpMs: number;
  element: LcpElement | null;
  resource: LcpResource | null;
  phases: LcpPhases;
  notes: LcpNote[];
}

// A request that kept the browser from painting: a stylesheet or a synchronous script.
export interface RenderBlockingResource {
  url: string;
  resourceType: ResourceType;
  transferSize: number;
  startMs: number;
  endMs: number;
  // Chrome's render-blocking status from the trace ("blocking", "in_body_parser_blocking",
  // "potentially_blocking"), or "inferred" from the HAR's initiator, type and priority.
  status: string;
  thirdParty: boolean;
}

export interface CriticalChainRequest {
  url: string;
  resourceType: ResourceType;
  startMs: number;
  endMs: number;
  transferSize: number;
}

// One path of the critical request tree, from the document to a leaf: document → CSS → font,
// document → script → script.
export interface CriticalChain {
  requests: CriticalChainRequest[]; // the document first
  depth: number; // requests in the chain, the document included
  durationMs: number; // document request start → last byte of the chain's last request
  transferSize: number;
}

export interface RenderBlockingReport {
  // Where the blocking status comes from: the trace's renderBlocking, the HAR's initiators and
  // priorities, or nothing ("none": neither carries it, as in Firefox HARs).
  source: "trace" | "har" | "none";
  fcpMs: number | null;
  documentEndMs: number; // last byte of the document
  resources: RenderBlockingResource[]; // requested before FCP, in request order
  totalBytes: number;
  // How long they held the first paint: last blocking byte (capped at FCP) − documentEndMs.
  heldMs: number;
  chains: CriticalChain[]; // longest first
}

export interface RenderReport {
  lcp: LcpAttribution | null; // null without a trace LCP candidate
  renderBlocking: RenderBlockingReport;
  recommendations: Recommendation[];
}

// ── Node detection ────────────────────────────────────────────────────────────

export type CdnProvider =
  | "akamai"
  | "cloudflare"
  | "fastly"
  | "cloudfront"
  | "gfe"
  | "google-cloud-cdn"
  | "vercel"
  | "netlify"
  | "azure-front-door"
  | "azure-cdn"
  | "bunny"
  | "keycdn"
  | "unknown";

// Where a PoP code was read from. "fly" is a hosting platform, not a CDN.
export type PopProvider = Exclude<CdnProvider, "unknown" | "gfe" | "akamai" | "azure-cdn"> | "fly";

export interface PopDetection {
  code: string; // lowercase IATA code, e.g. "fra"
  city: string;
  country: string;
  region: NetworkRegion;
  provider: PopProvider;
}

export interface NodeDetectionResult {
  type: "edge" | "origin";
  name: string;
  cdnProvider: CdnProvider;
}

// ── Findings ──────────────────────────────────────────────────────────────────

export type FindingSeverity = Recommendation["severity"];

// The Core Web Vital or metric a finding affects.
export type FindingMetric =
  "ttfb" | "fcp" | "lcp" | "cls" | "inp" | "transfer" | "requests" | "none";

export type FindingConfidence = "high" | "medium" | "low";

// The report a finding comes from: a page analysis report named `<source>Report`, or
// "metrics" for the findings rated from the metrics summary.
export type FindingSource =
  "cache" | "network" | "render" | "compression" | "connections" | "metrics" | (string & {});

export interface FindingEvidence {
  url: string;
  detail?: string;
  bytes?: number;
  ms?: number;
}

export interface FindingPage {
  index: number; // into Flow.pages
  name: string;
  side?: "a" | "b"; // the side of a comparison
}

/** One problem (or strength) of a page, with what to do about it and what shows it. */
export interface Finding {
  // Stable kebab-case rule id: "document-redirects", "duplicate-requests", "slow-lcp".
  id: string;
  title: string;
  severity: FindingSeverity;
  metric: FindingMetric;
  summary: string; // one sentence, with the numbers
  recommendation: string; // what to do
  confidence: FindingConfidence;
  evidence: FindingEvidence[];
  page: FindingPage;
  source: FindingSource;
}
