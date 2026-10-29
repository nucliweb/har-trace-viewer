// ── HAR types ────────────────────────────────────────────────────────────────

export interface HarTiming {
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
  blocked: number;
}

export type ResourceType =
  "document" | "stylesheet" | "script" | "image" | "font" | "fetch" | "other";
export type ResourcePriority = "VeryHigh" | "High" | "Medium" | "Low" | "VeryLow";
export type PreconnectSource = "link-header" | "early-hints";

export interface HarEntry {
  url: string;
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
  resourceStats?: { count: number; avgMs?: number; label?: string };
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
  avgMs: number;
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
  cacheControl: string;
}

export interface CacheRecommendation {
  label: string;
  description: string;
  severity: "good" | "info" | "warning" | "critical";
  // The resources the recommendation is about, biggest first, when it names them.
  resources?: RecommendationResource[];
}

export interface CacheReport {
  document: ResourceCacheProfile;
  ownResources: {
    total: number;
    cdnHits: number;
    cdnHitRatio: number;
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
