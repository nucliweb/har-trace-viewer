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

export interface ParsedHar {
  pages: HarPage[];
  entries: HarEntry[];
  documentEntry: HarEntry;
  preconnectHints: Record<string, PreconnectSource>;
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
  navigationId: string | null; // id of the main navigation, when the trace carries it
  url: string | null; // documentLoaderURL of the main navigation
}

// ── Diagram types ─────────────────────────────────────────────────────────────

export type NodeId = "browser" | "gfw" | "edge" | "origin" | "third-parties";

export type NetworkRegion =
  | "china"
  | "asia-pacific"
  | "europe"
  | "azure-cloud"
  | "united-states"
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
  | "browser-third-parties";

export interface DiagramPath {
  id: PathId;
  from: NodeId;
  to: NodeId;
}

export interface Metric {
  label: string;
  value: string;
}

export interface DiagramStep {
  // Index into Flow.pages / Flow.pageAnalyses. A transition step belongs to the
  // page it leads to, so the diagram already shows the destination topology.
  pageIndex: number;
  title: string;
  description: string;
  activeNodes: NodeId[];
  activePaths: PathId[];
  metrics: Metric[];
  pathTimings?: Partial<Record<PathId, string>>;
  pathDirections?: Partial<Record<PathId, "request" | "response">>;
  resources?: HarEntry[];
  cacheResources?: HarEntry[];
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

// Topology and cache analysis of a single page of the flow.
export interface PageAnalysis {
  nodes: DiagramNode[];
  paths: DiagramPath[];
  cacheReport: CacheReport;
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

export interface CacheRecommendation {
  label: string;
  description: string;
  severity: "good" | "info" | "warning" | "critical";
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
    total: number;
    fromDisk: number;
    fromMemory: number;
    hitRatio: number;
  };
  recommendations: CacheRecommendation[];
}

// ── Node detection ────────────────────────────────────────────────────────────

export type CdnProvider = "akamai" | "cloudflare" | "fastly" | "cloudfront" | "gfe" | "unknown";

export interface NodeDetectionResult {
  type: "edge" | "origin";
  name: string;
  cdnProvider: CdnProvider;
}
