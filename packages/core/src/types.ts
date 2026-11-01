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

export interface Metric {
  label: string;
  value: string;
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
  // First page's topology and cache report, kept for readers of version-1 flows.
  nodes: DiagramNode[];
  paths: DiagramPath[];
  cacheReport: CacheReport;
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
