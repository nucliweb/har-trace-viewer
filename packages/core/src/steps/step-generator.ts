import { medianTtfbByLoad } from "../analysis/host-ttfb.js";
import { SERVER_WAIT_LABEL, TTFB_LABEL } from "../analysis/metrics-summary.js";
import { getHostname, getRootDomain } from "../utils/domain.js";
import { tcpConnectMs } from "../utils/timing.js";
import { isOwnNetworkResource } from "../analysis/network-requests.js";
import { phaseMs, reusesConnection } from "../utils/timing.js";
import {
  detectCdnPopCity,
  detectCdnRegion,
  detectNode,
  detectOriginRegion,
  detectThirdPartyRegion,
  suggestClientRegion,
} from "../inference/node-detector.js";
import { analyzeCacheForHar, detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import { analyzeNetwork } from "../analysis/network-report.js";
import { analyzeCompression } from "../analysis/compression.js";
import { analyzeConnections } from "../analysis/connections.js";
import { inlineResourcesToRefs } from "./step-resources.js";
import {
  clusterNode,
  clusterPath,
  clusterThirdParties,
  ttfbCaption,
} from "./third-party-clusters.js";
import { firstStart, sortByTimeline, type TimedItem } from "./timeline.js";
import type {
  ClientRegion,
  DiagramNode,
  DiagramPath,
  DiagramStep,
  Flow,
  FlowOptions,
  HarEntry,
  NetworkRegion,
  NodeDetectionResult,
  NodeId,
  PageAnalysis,
  PageFlow,
  ParsedHar,
  PathId,
  StepKind,
  ThirdPartyCluster,
} from "../types.js";

// Readers of a flow resolve step resources through these.
export { getStepCacheResources, getStepResources } from "./step-resources.js";
export {
  MAX_THIRD_PARTY_CLUSTERS,
  clusterThirdParties,
  nodeKind,
  thirdPartyNodeId,
  thirdPartyPathId,
} from "./third-party-clusters.js";

// Bump when the Flow shape changes in a way readers must detect.
// 2: per-page topology and cache report (Flow.pageAnalyses, DiagramStep.pageIndex).
// 3: steps reference page entries by index (DiagramStep.resourceRefs, cacheResourceRefs)
//    instead of carrying copies (resources, cacheResources).
// 4: third parties grouped by CDN provider and region (PageAnalysis.thirdPartyClusters);
//    a page with several clusters has one `third-parties:<id>` node per cluster.
// 5: steps carry their kind (DiagramStep.kind).
// 6: cache reports count inferred and revalidated browser-cache hits (CacheReport.browser
//    inferred, revalidated); WebPageTest repeat views carry ParsedHar.inferredCacheHits.
export const FLOW_VERSION = 6;

export const CLIENT_REGIONS: readonly ClientRegion[] = ["default", "cn"];

export function isClientRegion(value: unknown): value is ClientRegion {
  return CLIENT_REGIONS.includes(value as ClientRegion);
}

const TRANSITION_TITLE_PREFIX = "→ User navigates to ";

const KIND_BY_TITLE: Record<string, StepKind> = {
  "DNS + initial connection": "connection",
  "Connection reused": "connection",
  "First request in flight": "request",
  "TTFB — First byte received": "ttfb",
  "Critical resources loading": "critical",
  "Secondary resources": "secondary",
  "Third-party requests": "third-party",
  "First Contentful Paint": "fcp",
  "Largest Contentful Paint": "lcp",
  "Page loaded": "loaded",
};

const KIND_BY_BADGE: Record<NonNullable<DiagramStep["badge"]>["type"], StepKind> = {
  ttfb: "ttfb",
  fcp: "fcp",
  lcp: "lcp",
  onload: "loaded",
};

/**
 * The kind of a step generated before steps carried one (version ≤ 4), read from the titles
 * those versions used. An unknown title falls back to its badge, else to a resource group.
 */
export function stepKindFromTitle(
  title: string,
  badge?: NonNullable<DiagramStep["badge"]>["type"]
): StepKind {
  if (title.startsWith(TRANSITION_TITLE_PREFIX)) return "transition";
  return KIND_BY_TITLE[title] ?? (badge ? KIND_BY_BADGE[badge] : "secondary");
}

function withDerivedKind(steps: DiagramStep[]): DiagramStep[] {
  return steps.map((step) =>
    step.kind ? step : { ...step, kind: stepKindFromTitle(step.title, step.badge?.type) }
  );
}

// Version ≤ 1 steps carry no pageIndex: every transition step starts a new page.
function withDerivedPageIndex(steps: DiagramStep[]): DiagramStep[] {
  let pageIndex = 0;
  return steps.map((step) => {
    if (step.title.startsWith(TRANSITION_TITLE_PREFIX)) pageIndex++;
    return { ...step, pageIndex };
  });
}

// Fills the fields that older embedded flows lack, so readers can rely on the
// current shape. Version 0 means "pre-versioning". Version ≤ 1 flows had a
// single topology and cache report: every page gets a copy of the top-level ones.
// Version ≤ 2 steps carried copies of their entries: they become references.
// Version ≤ 3 analyses have no third-party clusters: their single third-parties node stays.
// Version ≤ 4 steps have no kind: it is read from their title.
export function normalizeFlow(flow: Flow): Flow {
  const indexed = flow.steps.every((step) => typeof step.pageIndex === "number")
    ? flow.steps
    : withDerivedPageIndex(flow.steps);
  const steps = indexed.every((step) => step.kind) ? indexed : withDerivedKind(indexed);
  const pageCount = Math.max(flow.pages.length, (steps.at(-1)?.pageIndex ?? 0) + 1);
  const pageAnalyses = (
    flow.pageAnalyses ??
    Array.from({ length: pageCount }, () => ({
      nodes: flow.nodes,
      paths: flow.paths,
      cacheReport: flow.cacheReport,
    }))
  ).map((analysis) =>
    analysis.thirdPartyClusters ? analysis : { ...analysis, thirdPartyClusters: [] }
  );

  const withRefs = inlineResourcesToRefs(flow.pages, steps);

  return {
    ...flow,
    version: flow.version ?? 0,
    clientRegion: isClientRegion(flow.clientRegion) ? flow.clientRegion : "default",
    hints: flow.hints ?? {},
    pageAnalyses,
    pages: withRefs.pages,
    steps: withRefs.steps,
  };
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

function formatOptionalMs(ms: number | null): string {
  return ms === null ? "n/a" : formatMs(ms);
}

function formatCls(cls: number | null | undefined): string {
  return cls == null ? "n/a" : cls.toFixed(3);
}

function avgMs(entries: HarEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.reduce((s, e) => s + e.duration, 0) / entries.length;
}

function isThirdParty(entry: HarEntry, documentRoot: string): boolean {
  return getRootDomain(entry.url) !== documentRoot;
}

function isCriticalResource(entry: HarEntry): boolean {
  return (
    entry.resourceType === "stylesheet" ||
    (entry.resourceType === "script" &&
      (entry.priority === "VeryHigh" || entry.priority === "High"))
  );
  // Without a priority (non-Chrome HARs) scripts cannot be proven render-blocking,
  // so they stay secondary; stylesheets are always critical.
}

function isSecondaryResource(entry: HarEntry): boolean {
  return !entry.isDocument && !isCriticalResource(entry) && entry.resourceType !== "fetch";
}

interface TopologyOptions {
  hasCdn: boolean;
  hasThirdPartyNodes: boolean;
  hasGfw: boolean;
  edgeName: string;
  edgeRegion: NetworkRegion;
  edgeSubLabel?: string | null;
  originRegion: NetworkRegion;
  originSubLabel?: string | null;
  thirdPartyRegion: NetworkRegion;
  // Two or more clusters replace the single third-parties node with one node each.
  thirdPartyClusters: ThirdPartyCluster[];
  // Entries the browser cache served: a cache node and its path from the browser.
  cacheEntries: HarEntry[];
}

// Several clusters get a node each; one cluster (or none) keeps the single node.
const hasClusterNodes = (clusters: ThirdPartyCluster[]) => clusters.length > 1;

function buildTopology(opts: TopologyOptions): { nodes: DiagramNode[]; paths: DiagramPath[] } {
  const {
    hasCdn,
    hasThirdPartyNodes,
    hasGfw,
    edgeName,
    edgeRegion,
    edgeSubLabel,
    originRegion,
    originSubLabel,
    thirdPartyRegion,
    thirdPartyClusters,
    cacheEntries,
  } = opts;
  const browserRegion: NetworkRegion = hasGfw ? "china" : "client";

  const nodes: DiagramNode[] = [
    { id: "browser", label: "Browser", present: true, region: browserRegion },
  ];

  if (hasGfw) {
    nodes.push({
      id: "gfw",
      label: "GFW",
      subLabel: "DPI inspection",
      present: true,
      region: "china",
    });
  }

  nodes.push(
    {
      id: "edge",
      label: edgeName,
      subLabel: edgeSubLabel ?? undefined,
      present: hasCdn,
      region: edgeRegion,
    },
    {
      id: "origin",
      label: "Origin Server",
      subLabel: originSubLabel ?? undefined,
      present: true,
      region: originRegion,
    }
  );
  const clustered = hasClusterNodes(thirdPartyClusters);
  if (clustered) {
    nodes.push(...thirdPartyClusters.map(clusterNode));
  } else {
    nodes.push({
      id: "third-parties",
      label: "3rd Parties",
      present: hasThirdPartyNodes,
      region: thirdPartyRegion,
    });
  }

  let paths: DiagramPath[];
  if (hasGfw && hasCdn) {
    paths = [
      { id: "browser-gfw", from: "browser", to: "gfw" },
      { id: "gfw-edge", from: "gfw", to: "edge" },
      { id: "edge-origin", from: "edge", to: "origin" },
    ];
  } else if (hasGfw) {
    paths = [
      { id: "browser-gfw", from: "browser", to: "gfw" },
      { id: "gfw-origin", from: "gfw", to: "origin" },
    ];
  } else if (hasCdn) {
    paths = [
      { id: "browser-edge", from: "browser", to: "edge" },
      { id: "edge-origin", from: "edge", to: "origin" },
    ];
  } else {
    paths = [{ id: "browser-origin", from: "browser", to: "origin" }];
  }
  if (clustered) {
    paths.push(...thirdPartyClusters.map(clusterPath));
  } else {
    paths.push({ id: "browser-third-parties", from: "browser", to: "third-parties" });
  }

  const hasCache = cacheEntries.length > 0;
  nodes.push({
    id: "cache",
    label: "Browser cache",
    subLabel: hasCache ? cacheStores(cacheEntries) : undefined,
    present: hasCache,
    region: "client",
    resourceStats: hasCache ? { count: cacheEntries.length, label: "from cache" } : undefined,
  });
  if (hasCache) paths.push({ id: "browser-cache", from: "browser", to: "cache" });

  return { nodes, paths };
}

// The stores the browser cache served the page from: "memory", "disk" or "memory + disk".
function cacheStores(entries: HarEntry[]): string {
  const memory = entries.some((e) => e.fromCache === "memory");
  const disk = entries.some((e) => e.fromCache === "disk");
  if (memory && disk) return "memory + disk";
  return memory ? "memory" : "disk";
}

// "3 from cache" when a single store served the entries, "2 memory · 1 disk" otherwise.
function cacheTiming(entries: HarEntry[]): string {
  const memory = entries.filter((e) => e.fromCache === "memory").length;
  const disk = entries.length - memory;
  return memory > 0 && disk > 0
    ? `${memory} memory · ${disk} disk`
    : `${entries.length} from cache`;
}

// A step that reads `cached` entries from the browser cache also lights the hop to it,
// the entries coming back to the browser.
function withCacheHop<T extends Omit<DiagramStep, "pageIndex">>(step: T, cached: HarEntry[]): T {
  if (cached.length === 0) return step;
  return {
    ...step,
    activeNodes: [...step.activeNodes, "cache"],
    activePaths: [...step.activePaths, "browser-cache"],
    pathTimings: { ...step.pathTimings, "browser-cache": cacheTiming(cached) },
    pathDirections: { ...step.pathDirections, "browser-cache": "response" },
  };
}

// Whether requests sent through the CDN went on to the origin: only a CDN cache hit stops at
// the edge (a miss, a stale or bypassed response, or no cache status at all reaches it).
// Without a CDN every request reaches the origin.
function reachesOrigin(hasCdn: boolean, requests: HarEntry[]): boolean {
  return !hasCdn || requests.some((e) => detectCdnCacheStatus(e.responseHeaders) !== "hit");
}

// The server chain of a request: through the GFW checkpoint and the edge when there are
// any, on to the origin unless `toOrigin` is false (a CDN cache hit stops at the edge).
function serverNodes(hasCdn: boolean, hasGfw: boolean, toOrigin = true): NodeId[] {
  const nodes: NodeId[] = hasGfw ? ["browser", "gfw"] : ["browser"];
  if (hasCdn) nodes.push("edge");
  if (toOrigin || !hasCdn) nodes.push("origin");
  return nodes;
}

function serverPaths(hasCdn: boolean, hasGfw: boolean, toOrigin = true): PathId[] {
  if (!hasCdn) return hasGfw ? ["browser-gfw", "gfw-origin"] : ["browser-origin"];
  const paths: PathId[] = hasGfw ? ["browser-gfw", "gfw-edge"] : ["browser-edge"];
  if (toOrigin) paths.push("edge-origin");
  return paths;
}

function serverPathDirections(
  hasCdn: boolean,
  hasGfw: boolean,
  direction: "request" | "response",
  toOrigin = true
): Partial<Record<PathId, "request" | "response">> {
  return Object.fromEntries(serverPaths(hasCdn, hasGfw, toOrigin).map((id) => [id, direction]));
}

function firstActivePath(hasCdn: boolean, hasGfw: boolean): PathId {
  if (hasGfw) return "browser-gfw";
  return hasCdn ? "browser-edge" : "browser-origin";
}

// What a page's document and entries say about its network topology.
interface PageContext {
  cdnResult: NodeDetectionResult;
  hasCdn: boolean;
  documentRoot: string;
  thirdPartyEntries: HarEntry[];
  // Third-party network requests grouped by CDN provider and region.
  thirdPartyClusters: ThirdPartyCluster[];
  // Every entry but the main document that the browser cache served.
  cacheEntries: HarEntry[];
}

function describePage(har: ParsedHar): PageContext {
  const cdnResult = detectNode(har.documentEntry.responseHeaders);
  const documentRoot = getRootDomain(har.documentEntry.url);
  // Third-party iframes are HTML documents too; only the main document is not a resource.
  const thirdPartyEntries = har.entries.filter(
    (e) => e !== har.documentEntry && isThirdParty(e, documentRoot)
  );
  return {
    cdnResult,
    hasCdn: cdnResult.type === "edge",
    documentRoot,
    thirdPartyEntries,
    thirdPartyClusters: clusterThirdParties(
      thirdPartyEntries.filter((e) => e.fromCache === false),
      har.pages[0]?.onLoad ?? null
    ),
    cacheEntries: har.entries.filter((e) => e !== har.documentEntry && e.fromCache !== false),
  };
}

// Steps are built per page and tagged with their pageIndex by generateFlow.
type PageStep = Omit<DiagramStep, "pageIndex">;

function generatePageSteps(pageFlow: PageFlow, hasGfw: boolean): PageStep[] {
  const { har, trace } = pageFlow;
  const { documentEntry, pages, entries } = har;
  const page = pages[0];

  const { cdnResult, hasCdn, documentRoot, thirdPartyEntries, thirdPartyClusters, cacheEntries } =
    describePage(har);
  const hasThirdPartyNodes = thirdPartyEntries.length > 0;

  const entryIndex = new Map(entries.map((entry, index) => [entry, index]));
  // Steps point at the page entries instead of copying them; empty lists are omitted.
  const refs = (list: HarEntry[]): number[] | undefined =>
    list.length > 0 ? list.map((entry) => entryIndex.get(entry)!) : undefined;

  const ownEntries = entries.filter((e) => !isThirdParty(e, documentRoot));
  const criticalEntries = ownEntries.filter((e) => !e.isDocument && isCriticalResource(e));
  const secondaryEntries = ownEntries.filter((e) => !e.isDocument && isSecondaryResource(e));

  const edgeLabel = hasCdn ? cdnResult.name : "Origin";

  // Time base: HAR startTime counts from the page origin (the earlier of the
  // first request and the page start) and trace FCP/LCP count from the
  // navigation's navigationStart. Both mark the start of the same navigation,
  // so the two scales are compared directly.
  // HAR counts TLS inside connect: the request leaves once connect (TCP + TLS) is over.
  const { dns, connect, ssl, blocked, send } = documentEntry.timing;
  const tcp = tcpConnectMs(documentEntry.timing);
  const requestSentAt = documentEntry.startTime + blocked + dns + connect;
  const firstByteAt = requestSentAt + send + documentEntry.ttfb;

  // ── Fixed prologue: nothing can be fetched before the document is requested
  // and its first byte arrives (an Early-Hints preload is the one exception,
  // and it still reads better after the connection steps).
  // A DNS phase the HAR marks -1 did not happen: the browser already had the address.
  const dnsMs = phaseMs(documentEntry.timing, "dns");
  const connectionMetrics = [
    ...(dnsMs === null ? [] : [{ label: "DNS", value: formatMs(dnsMs) }]),
    { label: "TCP connect", value: formatMs(tcp) },
  ];
  if (ssl > 0) connectionMetrics.push({ label: "TLS", value: formatMs(ssl) });

  const connectionStep: PageStep = {
    kind: "connection",
    title: "DNS + initial connection",
    description: `Browser resolves the domain and establishes a TCP${ssl > 0 ? "/TLS" : ""} connection to ${edgeLabel}.`,
    timestamp: documentEntry.startTime,
    activeNodes: ["browser"],
    activePaths: [],
    metrics: connectionMetrics,
  };

  const reqConnectionLabel = [
    ...(dnsMs === null ? [] : [`DNS ${formatMs(dnsMs)}`]),
    `TCP ${formatMs(tcp)}`,
    ...(ssl > 0 ? [`TLS ${formatMs(ssl)}`] : []),
  ].join(" · ");
  const firstPath = firstActivePath(hasCdn, hasGfw);
  // A document the CDN served from its cache never reaches the origin.
  const documentToOrigin = reachesOrigin(hasCdn, [documentEntry]);
  const popCity = hasCdn
    ? detectCdnPopCity(documentEntry.responseHeaders, cdnResult.cdnProvider, hasGfw)
    : null;
  const servedBy = documentToOrigin
    ? ""
    : `, served from its edge cache${popCity ? ` in ${popCity}` : ""}`;

  const requestStep: PageStep = {
    kind: "request",
    title: "First request in flight",
    description: "Browser sends the HTTP request for the HTML document.",
    timestamp: requestSentAt,
    activeNodes: serverNodes(hasCdn, hasGfw, documentToOrigin),
    activePaths: serverPaths(hasCdn, hasGfw, documentToOrigin),
    metrics: [],
    pathTimings: { [firstPath]: reqConnectionLabel },
    pathDirections: serverPathDirections(hasCdn, hasGfw, "request", documentToOrigin),
  };

  const ttfbStep: PageStep = {
    kind: "ttfb",
    title: "TTFB — First byte received",
    description: `${edgeLabel} responds with the first byte of the HTML document${servedBy}.`,
    timestamp: firstByteAt,
    activeNodes: serverNodes(hasCdn, hasGfw, documentToOrigin),
    activePaths: serverPaths(hasCdn, hasGfw, documentToOrigin),
    // TTFB counts from the navigation start, as the web.dev thresholds do: whatever came before
    // the document request (redirects), the connection and the request. The server wait (HAR
    // `wait`) is only its last part.
    metrics: [
      { label: TTFB_LABEL, value: formatMs(firstByteAt) },
      { label: SERVER_WAIT_LABEL, value: formatMs(documentEntry.ttfb) },
    ],
    pathTimings: { [firstPath]: `${SERVER_WAIT_LABEL} ${formatMs(documentEntry.ttfb)}` },
    pathDirections: serverPathDirections(hasCdn, hasGfw, "response", documentToOrigin),
    badge: { type: "ttfb", value: formatMs(firstByteAt), node: "browser" },
  };

  // A document sent over a connection the browser already had open (the HAR marks its TCP
  // connect -1) resolved nothing and shook no hands: its first step says so instead of
  // narrating a 0 ms handshake.
  const prologue: PageStep[] = reusesConnection(documentEntry.timing)
    ? [
        {
          kind: "connection",
          title: "Connection reused",
          description: `Browser reuses the connection it already had open to ${edgeLabel}: no DNS lookup, TCP or TLS handshake.`,
          timestamp: documentEntry.startTime,
          activeNodes: ["browser"],
          activePaths: [],
          metrics: [{ label: "Connection", value: "reused" }],
        },
        { ...requestStep, pathTimings: { [firstPath]: "connection reused" } },
        ttfbStep,
      ]
    : [connectionStep, requestStep, ttfbStep];

  // ── Timeline: resource groups and paints, ordered by when they happen.
  // A group is one step whose timestamp is its first request; resources that
  // start later still belong to it. The rank keeps the classic narrative for
  // events that share a timestamp.
  const startTimes = (list: HarEntry[]) => list.map((e) => e.startTime);
  const criticalAt = firstStart(startTimes(criticalEntries), firstByteAt);
  const secondaryAt = firstStart(startTimes(secondaryEntries), criticalAt);
  const thirdPartyAt = firstStart(startTimes(thirdPartyEntries), secondaryAt);

  const timeline: TimedItem<PageStep>[] = [];

  // The hops a resource group travels: its network requests go to the edge, and on to the
  // origin unless the CDN served all of them from its cache. A group the browser cache
  // served entirely stays on the client; an empty group keeps the whole chain.
  const resourceHops = (network: HarEntry[], cached: HarEntry[]) => {
    if (network.length === 0 && cached.length > 0) {
      return { activeNodes: ["browser"] as NodeId[], activePaths: [] as PathId[] };
    }
    const toOrigin = network.length === 0 || reachesOrigin(hasCdn, network);
    return {
      activeNodes: serverNodes(hasCdn, hasGfw, toOrigin),
      activePaths: serverPaths(hasCdn, hasGfw, toOrigin),
    };
  };

  const criticalNetwork = criticalEntries.filter((e) => e.fromCache === false);
  const criticalCache = criticalEntries.filter((e) => e.fromCache !== false);
  const criticalCss = criticalNetwork.filter((e) => e.resourceType === "stylesheet");
  const criticalJs = criticalNetwork.filter((e) => e.resourceType === "script");
  const criticalMetrics: DiagramStep["metrics"] = [];
  if (criticalCss.length > 0)
    criticalMetrics.push({ label: "CSS files", value: String(criticalCss.length) });
  if (criticalJs.length > 0)
    criticalMetrics.push({ label: "JS files", value: String(criticalJs.length) });
  if (criticalCache.length > 0)
    criticalMetrics.push({ label: "From cache", value: String(criticalCache.length) });

  timeline.push({
    timestamp: criticalAt,
    rank: 0,
    item: withCacheHop(
      {
        kind: "critical",
        title: "Critical resources loading",
        description: "Browser parses the HTML and fetches render-blocking CSS and scripts.",
        timestamp: criticalAt,
        ...resourceHops(criticalNetwork, criticalCache),
        metrics: criticalMetrics,
        pathTimings:
          criticalNetwork.length > 0
            ? {
                [firstPath]: `${criticalNetwork.length} files · avg ${formatMs(avgMs(criticalNetwork))}`,
              }
            : {},
        resourceRefs: refs(criticalNetwork),
        cacheResourceRefs: refs(criticalCache),
      },
      criticalCache
    ),
  });

  // Paints are placed where they fall relative to the resource requests.
  const paintNote = (paintAt: number): string => {
    if (secondaryEntries.length === 0) return "";
    return paintAt < secondaryAt
      ? " It happens before any secondary resource is requested."
      : " It happens after secondary resources started loading.";
  };

  if (trace?.fcp != null) {
    timeline.push({
      timestamp: trace.fcp,
      rank: 1,
      item: {
        kind: "fcp",
        title: "First Contentful Paint",
        description: `The browser renders the first visible content on screen.${paintNote(trace.fcp)}`,
        timestamp: trace.fcp,
        activeNodes: ["browser"],
        activePaths: [],
        metrics: [{ label: "FCP", value: formatMs(trace.fcp) }],
        badge: { type: "fcp", value: formatMs(trace.fcp), node: "browser" },
      },
    });
  }

  const secondaryNetwork = secondaryEntries.filter((e) => e.fromCache === false);
  const secondaryCache = secondaryEntries.filter((e) => e.fromCache !== false);
  const secondaryMetrics: DiagramStep["metrics"] = [
    { label: "Resources", value: String(secondaryEntries.length) },
  ];
  if (secondaryCache.length > 0)
    secondaryMetrics.push({ label: "From cache", value: String(secondaryCache.length) });

  timeline.push({
    timestamp: secondaryAt,
    rank: 2,
    item: withCacheHop(
      {
        kind: "secondary",
        title: "Secondary resources",
        description: "Async scripts, images, and fonts load in the background.",
        timestamp: secondaryAt,
        ...resourceHops(secondaryNetwork, secondaryCache),
        metrics: secondaryMetrics,
        pathTimings:
          secondaryNetwork.length > 0
            ? {
                [firstPath]: `${secondaryNetwork.length} ${secondaryNetwork.length === 1 ? "resource" : "resources"} · avg ${formatMs(avgMs(secondaryNetwork))}`,
              }
            : {},
        resourceRefs: refs(secondaryNetwork),
        cacheResourceRefs: refs(secondaryCache),
      },
      secondaryCache
    ),
  });

  if (trace?.lcp != null) {
    timeline.push({
      timestamp: trace.lcp,
      rank: 3,
      item: {
        kind: "lcp",
        title: "Largest Contentful Paint",
        description: `The largest visible element in the viewport has finished rendering.${paintNote(trace.lcp)}`,
        timestamp: trace.lcp,
        activeNodes: ["browser"],
        activePaths: [],
        metrics: [{ label: "LCP", value: formatMs(trace.lcp) }],
        badge: { type: "lcp", value: formatMs(trace.lcp), node: "browser" },
      },
    });
  }

  if (hasThirdPartyNodes) {
    const thirdPartyNetwork = thirdPartyEntries.filter((e) => e.fromCache === false);
    const thirdPartyCache = thirdPartyEntries.filter((e) => e.fromCache !== false);
    const thirdPartyDomains = new Set(thirdPartyNetwork.map((e) => getHostname(e.url) ?? e.url));
    const thirdPartyMetrics: DiagramStep["metrics"] = [
      { label: "Domains", value: String(thirdPartyDomains.size) },
      { label: "Requests", value: String(thirdPartyNetwork.length) },
    ];
    if (thirdPartyCache.length > 0)
      thirdPartyMetrics.push({ label: "From cache", value: String(thirdPartyCache.length) });
    const timing = (requests: number, ms: number | null) =>
      ms === null ? `${requests} req` : `${requests} req · ${ttfbCaption(ms)}`;
    // Several clusters: every cluster node and its path light up, each path with its median
    // TTFB when it has one (the cluster's caption carries its request count).
    const thirdPartyHops = hasClusterNodes(thirdPartyClusters)
      ? {
          activeNodes: ["browser" as const, ...thirdPartyClusters.map((c) => clusterNode(c).id)],
          activePaths: thirdPartyClusters.map((c) => clusterPath(c).id),
          pathTimings: Object.fromEntries(
            thirdPartyClusters.flatMap((c) =>
              c.avgMs === null ? [] : [[clusterPath(c).id, ttfbCaption(c.avgMs)]]
            )
          ),
        }
      : {
          activeNodes: ["browser" as const, "third-parties" as const],
          activePaths: thirdPartyNetwork.length > 0 ? ["browser-third-parties" as const] : [],
          pathTimings:
            thirdPartyNetwork.length > 0
              ? {
                  "browser-third-parties": timing(
                    thirdPartyNetwork.length,
                    medianTtfbByLoad(thirdPartyNetwork, page.onLoad).beforeLoad
                  ),
                }
              : {},
        };
    timeline.push({
      timestamp: thirdPartyAt,
      rank: 4,
      item: withCacheHop(
        {
          kind: "third-party",
          title: "Third-party requests",
          description: "Browser fetches resources from external domains.",
          timestamp: thirdPartyAt,
          ...thirdPartyHops,
          metrics: thirdPartyMetrics,
          resourceRefs: refs(thirdPartyNetwork),
          cacheResourceRefs: refs(thirdPartyCache),
        },
        thirdPartyCache
      ),
    });
  }

  // ── Epilogue: the load event closes the page. A null onLoad (event never
  // fired) shows "n/a", carries no timestamp and gets no badge. DCL stays a
  // metric of this step rather than a step of its own.
  // The last step doubles as the page overview: it references every entry but the main
  // document, network and cached alike (other HTML responses such as iframes included,
  // although no resource group lists them), so the sidebar can summarise the whole page.
  const overviewEntries = entries
    .filter((e) => e !== documentEntry)
    .sort((a, b) => a.startTime - b.startTime);
  // A page that used the browser cache closes with the hop to it, every cache hit counted.
  const loadedStep: PageStep = withCacheHop<PageStep>(
    {
      kind: "loaded",
      title: "Page loaded",
      description: "The load event fires — all resources have been downloaded.",
      timestamp: page.onLoad ?? undefined,
      activeNodes: ["browser"],
      activePaths: [],
      metrics: [
        { label: "onLoad", value: formatOptionalMs(page.onLoad) },
        { label: "DCL", value: formatOptionalMs(page.onContentLoad) },
        { label: "CLS", value: formatCls(trace?.cls) },
        { label: "INP", value: formatOptionalMs(trace?.inp ?? null) },
      ],
      resourceRefs: refs(overviewEntries),
      badge:
        page.onLoad === null
          ? undefined
          : { type: "onload", value: formatMs(page.onLoad), node: "browser" },
    },
    cacheEntries
  );

  return [...prologue, ...sortByTimeline(timeline), loadedStep];
}

function generateTransitionStep(fromPage: string, toPage: string): PageStep {
  return {
    kind: "transition",
    title: `${TRANSITION_TITLE_PREFIX}${toPage}`,
    description: `The user leaves ${fromPage} and navigates to ${toPage}.`,
    activeNodes: ["browser"],
    activePaths: [],
    metrics: [],
  };
}

function analyzePage(pageFlow: PageFlow, hasGfw: boolean): PageAnalysis {
  const { har } = pageFlow;
  const { documentEntry, entries } = har;
  const { cdnResult, hasCdn, documentRoot, thirdPartyEntries, thirdPartyClusters, cacheEntries } =
    describePage(har);
  const hasThirdPartyNodes = thirdPartyEntries.length > 0;
  const apacFallback: NetworkRegion = hasGfw ? "asia-pacific" : "edge";

  const { nodes, paths } = buildTopology({
    hasCdn,
    hasThirdPartyNodes,
    hasGfw,
    edgeName: hasCdn ? cdnResult.name : "Origin Server",
    edgeRegion: detectCdnRegion(documentEntry.responseHeaders, apacFallback),
    edgeSubLabel: hasCdn
      ? detectCdnPopCity(documentEntry.responseHeaders, cdnResult.cdnProvider, hasGfw)
      : null,
    originRegion: detectOriginRegion(documentEntry.responseHeaders),
    originSubLabel: documentEntry.responseHeaders["server"] ?? null,
    thirdPartyRegion: detectThirdPartyRegion(thirdPartyEntries),
    thirdPartyClusters,
    cacheEntries,
  });

  const ownNonDocNetwork = entries.filter((e) => isOwnNetworkResource(e, documentRoot));
  const cdnHitEntries = hasCdn
    ? ownNonDocNetwork.filter((e) => detectCdnCacheStatus(e.responseHeaders) === "hit")
    : [];
  const originEntries = hasCdn
    ? ownNonDocNetwork.filter((e) => detectCdnCacheStatus(e.responseHeaders) !== "hit")
    : ownNonDocNetwork;
  const thirdPartyNetworkEntries = thirdPartyEntries.filter((e) => e.fromCache === false);
  // Behind a CDN that served the document and every resource from its cache, nothing reached
  // the origin: it says so with "0 req".
  const originIdle =
    hasCdn && originEntries.length === 0 && !reachesOrigin(hasCdn, [documentEntry]);

  for (const node of nodes) {
    if (node.id === "origin" && originIdle) {
      node.resourceStats = { count: 0 };
    } else if (node.id === "edge" && hasCdn && cdnHitEntries.length > 0) {
      node.resourceStats = {
        count: cdnHitEntries.length,
        avgMs: avgMs(cdnHitEntries),
        label: "CDN hit",
      };
    } else if (node.id === "origin" && originEntries.length > 0) {
      node.resourceStats = {
        count: originEntries.length,
        avgMs: avgMs(originEntries),
        label: hasCdn ? "CDN miss" : undefined,
      };
    } else if (node.id === "third-parties" && thirdPartyNetworkEntries.length > 0) {
      const onLoad = har.pages[0]?.onLoad ?? null;
      const ttfb = medianTtfbByLoad(thirdPartyNetworkEntries, onLoad).beforeLoad;
      node.resourceStats = {
        count: thirdPartyNetworkEntries.length,
        ...(ttfb === null ? {} : { avgMs: ttfb, avgMsKind: "median-ttfb" as const }),
      };
    }
  }

  return {
    nodes,
    paths,
    cacheReport: analyzeCacheForHar(har),
    thirdPartyClusters,
    networkReport: analyzeNetwork(har),
    compressionReport: analyzeCompression(har),
    connectionsReport: analyzeConnections(har),
  };
}

export function generateFlow(pages: PageFlow[], options: FlowOptions = {}): Flow {
  if (pages.length === 0) {
    throw new Error("Flow requires at least one page");
  }

  const clientRegion: ClientRegion = options.clientRegion ?? "default";
  // The GFW topology is opt-in: latencies alone cannot tell China routing
  // apart from a slow or mobile network.
  const hasGfw = clientRegion === "cn";
  const suggestion = suggestClientRegion(pages[0].har);

  const steps: DiagramStep[] = [];
  pages.forEach((page, pageIndex) => {
    // The transition belongs to the page it leads to.
    const pageSteps = generatePageSteps(page, hasGfw);
    if (pageIndex > 0) {
      pageSteps.unshift(generateTransitionStep(pages[pageIndex - 1].name, page.name));
    }
    steps.push(...pageSteps.map((step) => ({ pageIndex, ...step })));
  });

  const pageAnalyses = pages.map((page) => analyzePage(page, hasGfw));
  const [firstPage] = pageAnalyses;

  return {
    version: FLOW_VERSION,
    clientRegion,
    hints: suggestion ? { suggestedClientRegion: suggestion } : {},
    pages,
    pageAnalyses,
    steps,
    nodes: firstPage.nodes,
    paths: firstPage.paths,
    cacheReport: firstPage.cacheReport,
  };
}
