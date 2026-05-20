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

export type ResourceType = "document" | "stylesheet" | "script" | "image" | "font" | "fetch" | "other";
export type ResourcePriority = "VeryHigh" | "High" | "Medium" | "Low" | "VeryLow";
export type PreconnectSource = "link-header" | "early-hints";

export interface HarEntry {
  url: string;
  startTime: number;        // ms relative to first entry startedDateTime
  duration: number;         // ms total
  timing: HarTiming;
  ttfb: number;             // ms: wait (time to first byte)
  status: number;
  mimeType: string;
  resourceType: ResourceType;
  priority: ResourcePriority;
  responseHeaders: Record<string, string>;
  transferSize: number;
  isDocument: boolean;
  fromCache: "disk" | "memory" | false;
}

export interface HarPage {
  id: string;
  title: string;
  onContentLoad: number;    // ms relative to page startedDateTime
  onLoad: number;           // ms relative to page startedDateTime
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
  ts: number;               // microseconds (raw from trace)
  args?: Record<string, unknown>;
}

export interface ParsedTrace {
  navigationStart: number;  // microseconds
  fcp: number | null;       // ms relative to navigationStart
  lcp: number | null;       // ms relative to navigationStart
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
}

export type PathId =
  | "browser-gfw"
  | "gfw-edge"
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

export interface Flow {
  pages: PageFlow[];
  steps: DiagramStep[];
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
