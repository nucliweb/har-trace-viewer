import { getRootDomain } from "../utils/domain.js";
import {
  detectCdnPopCity,
  detectCdnRegion,
  detectNode,
  detectOriginRegion,
  detectThirdPartyRegion,
  suggestClientRegion,
} from "../inference/node-detector.js";
import { analyzeCacheForHar, detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import { inlineResourcesToRefs } from "./step-resources.js";
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
} from "../types.js";

// Readers of a flow resolve step resources through these.
export { getStepCacheResources, getStepResources } from "./step-resources.js";

// Bump when the Flow shape changes in a way readers must detect.
// 2: per-page topology and cache report (Flow.pageAnalyses, DiagramStep.pageIndex).
// 3: steps reference page entries by index (DiagramStep.resourceRefs, cacheResourceRefs)
//    instead of carrying copies (resources, cacheResources).
export const FLOW_VERSION = 3;

export const CLIENT_REGIONS: readonly ClientRegion[] = ["default", "cn"];

export function isClientRegion(value: unknown): value is ClientRegion {
  return CLIENT_REGIONS.includes(value as ClientRegion);
}

const TRANSITION_TITLE_PREFIX = "→ User navigates to ";

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
export function normalizeFlow(flow: Flow): Flow {
  const steps = flow.steps.every((step) => typeof step.pageIndex === "number")
    ? flow.steps
    : withDerivedPageIndex(flow.steps);
  const pageCount = Math.max(flow.pages.length, (steps.at(-1)?.pageIndex ?? 0) + 1);
  const pageAnalyses =
    flow.pageAnalyses ??
    Array.from({ length: pageCount }, () => ({
      nodes: flow.nodes,
      paths: flow.paths,
      cacheReport: flow.cacheReport,
    }));

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
}

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
    },
    {
      id: "third-parties",
      label: "3rd Parties",
      present: hasThirdPartyNodes,
      region: thirdPartyRegion,
    }
  );

  let paths: DiagramPath[];
  if (hasGfw && hasCdn) {
    paths = [
      { id: "browser-gfw", from: "browser", to: "gfw" },
      { id: "gfw-edge", from: "gfw", to: "edge" },
      { id: "edge-origin", from: "edge", to: "origin" },
      { id: "browser-third-parties", from: "browser", to: "third-parties" },
    ];
  } else if (hasGfw) {
    paths = [
      { id: "browser-gfw", from: "browser", to: "gfw" },
      { id: "gfw-origin", from: "gfw", to: "origin" },
      { id: "browser-third-parties", from: "browser", to: "third-parties" },
    ];
  } else if (hasCdn) {
    paths = [
      { id: "browser-edge", from: "browser", to: "edge" },
      { id: "edge-origin", from: "edge", to: "origin" },
      { id: "browser-third-parties", from: "browser", to: "third-parties" },
    ];
  } else {
    paths = [
      { id: "browser-origin", from: "browser", to: "origin" },
      { id: "browser-third-parties", from: "browser", to: "third-parties" },
    ];
  }

  return { nodes, paths };
}

function serverNodes(hasCdn: boolean, hasGfw: boolean): NodeId[] {
  if (hasGfw) return hasCdn ? ["browser", "gfw", "edge", "origin"] : ["browser", "gfw", "origin"];
  return hasCdn ? ["browser", "edge", "origin"] : ["browser", "origin"];
}

function serverPaths(hasCdn: boolean, hasGfw: boolean): PathId[] {
  if (hasGfw)
    return hasCdn ? ["browser-gfw", "gfw-edge", "edge-origin"] : ["browser-gfw", "gfw-origin"];
  return hasCdn ? ["browser-edge", "edge-origin"] : ["browser-origin"];
}

function serverPathDirections(
  hasCdn: boolean,
  hasGfw: boolean,
  direction: "request" | "response"
): Partial<Record<PathId, "request" | "response">> {
  return Object.fromEntries(serverPaths(hasCdn, hasGfw).map((id) => [id, direction]));
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
}

function describePage(har: ParsedHar): PageContext {
  const cdnResult = detectNode(har.documentEntry.responseHeaders);
  const documentRoot = getRootDomain(har.documentEntry.url);
  return {
    cdnResult,
    hasCdn: cdnResult.type === "edge",
    documentRoot,
    thirdPartyEntries: har.entries.filter((e) => !e.isDocument && isThirdParty(e, documentRoot)),
  };
}

// Steps are built per page and tagged with their pageIndex by generateFlow.
type PageStep = Omit<DiagramStep, "pageIndex">;

function generatePageSteps(pageFlow: PageFlow, hasGfw: boolean): PageStep[] {
  const { har, trace } = pageFlow;
  const { documentEntry, pages, entries } = har;
  const page = pages[0];

  const { cdnResult, hasCdn, documentRoot, thirdPartyEntries } = describePage(har);
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
  const { dns, connect, ssl, blocked, send } = documentEntry.timing;
  const requestSentAt = documentEntry.startTime + blocked + dns + connect + ssl;
  const firstByteAt = requestSentAt + send + documentEntry.ttfb;

  // ── Fixed prologue: nothing can be fetched before the document is requested
  // and its first byte arrives (an Early-Hints preload is the one exception,
  // and it still reads better after the connection steps).
  const connectionMetrics = [
    { label: "DNS", value: formatMs(dns) },
    { label: "TCP connect", value: formatMs(connect) },
  ];
  if (ssl > 0) connectionMetrics.push({ label: "TLS", value: formatMs(ssl) });

  const connectionStep: PageStep = {
    title: "DNS + initial connection",
    description: `Browser resolves the domain and establishes a TCP${ssl > 0 ? "/TLS" : ""} connection to ${edgeLabel}.`,
    timestamp: documentEntry.startTime,
    activeNodes: ["browser"],
    activePaths: [],
    metrics: connectionMetrics,
  };

  const reqConnectionLabel = `DNS ${formatMs(dns)} · TCP ${formatMs(connect)}${ssl > 0 ? ` · TLS ${formatMs(ssl)}` : ""}`;
  const firstPath = firstActivePath(hasCdn, hasGfw);

  const requestStep: PageStep = {
    title: "First request in flight",
    description: "Browser sends the HTTP request for the HTML document.",
    timestamp: requestSentAt,
    activeNodes: serverNodes(hasCdn, hasGfw),
    activePaths: serverPaths(hasCdn, hasGfw),
    metrics: [],
    pathTimings: { [firstPath]: reqConnectionLabel },
    pathDirections: serverPathDirections(hasCdn, hasGfw, "request"),
  };

  const ttfbStep: PageStep = {
    title: "TTFB — First byte received",
    description: `${edgeLabel} responds with the first byte of the HTML document.`,
    timestamp: firstByteAt,
    activeNodes: serverNodes(hasCdn, hasGfw),
    activePaths: serverPaths(hasCdn, hasGfw),
    metrics: [{ label: "TTFB", value: formatMs(documentEntry.ttfb) }],
    pathTimings: { [firstPath]: `TTFB ${formatMs(documentEntry.ttfb)}` },
    pathDirections: serverPathDirections(hasCdn, hasGfw, "response"),
    badge: { type: "ttfb", value: formatMs(documentEntry.ttfb), node: "browser" },
  };

  // ── Timeline: resource groups and paints, ordered by when they happen.
  // A group is one step whose timestamp is its first request; resources that
  // start later still belong to it. The rank keeps the classic narrative for
  // events that share a timestamp.
  const startTimes = (list: HarEntry[]) => list.map((e) => e.startTime);
  const criticalAt = firstStart(startTimes(criticalEntries), firstByteAt);
  const secondaryAt = firstStart(startTimes(secondaryEntries), criticalAt);
  const thirdPartyAt = firstStart(startTimes(thirdPartyEntries), secondaryAt);

  const timeline: TimedItem<PageStep>[] = [];

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
    item: {
      title: "Critical resources loading",
      description: "Browser parses the HTML and fetches render-blocking CSS and scripts.",
      timestamp: criticalAt,
      activeNodes: serverNodes(hasCdn, hasGfw),
      activePaths: serverPaths(hasCdn, hasGfw),
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
    item: {
      title: "Secondary resources",
      description: "Async scripts, images, and fonts load in the background.",
      timestamp: secondaryAt,
      activeNodes: serverNodes(hasCdn, hasGfw),
      activePaths: serverPaths(hasCdn, hasGfw),
      metrics: secondaryMetrics,
      pathTimings:
        secondaryNetwork.length > 0
          ? {
              [firstPath]: `${secondaryNetwork.length} resources · avg ${formatMs(avgMs(secondaryNetwork))}`,
            }
          : {},
      resourceRefs: refs(secondaryNetwork),
      cacheResourceRefs: refs(secondaryCache),
    },
  });

  if (trace?.lcp != null) {
    timeline.push({
      timestamp: trace.lcp,
      rank: 3,
      item: {
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
    const thirdPartyDomains = new Set(thirdPartyNetwork.map((e) => getRootDomain(e.url)));
    const thirdPartyMetrics: DiagramStep["metrics"] = [
      { label: "Domains", value: String(thirdPartyDomains.size) },
      { label: "Requests", value: String(thirdPartyNetwork.length) },
    ];
    if (thirdPartyCache.length > 0)
      thirdPartyMetrics.push({ label: "From cache", value: String(thirdPartyCache.length) });
    timeline.push({
      timestamp: thirdPartyAt,
      rank: 4,
      item: {
        title: "Third-party requests",
        description: "Browser fetches resources from external domains.",
        timestamp: thirdPartyAt,
        activeNodes: ["browser", "third-parties"],
        activePaths: thirdPartyNetwork.length > 0 ? ["browser-third-parties"] : [],
        metrics: thirdPartyMetrics,
        pathTimings:
          thirdPartyNetwork.length > 0
            ? {
                "browser-third-parties": `${thirdPartyNetwork.length} req · avg ${formatMs(avgMs(thirdPartyNetwork))}`,
              }
            : {},
        resourceRefs: refs(thirdPartyNetwork),
        cacheResourceRefs: refs(thirdPartyCache),
      },
    });
  }

  // ── Epilogue: the load event closes the page. A null onLoad (event never
  // fired) shows "n/a", carries no timestamp and gets no badge. DCL stays a
  // metric of this step rather than a step of its own.
  const loadedStep: PageStep = {
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
    badge:
      page.onLoad === null
        ? undefined
        : { type: "onload", value: formatMs(page.onLoad), node: "browser" },
  };

  return [connectionStep, requestStep, ttfbStep, ...sortByTimeline(timeline), loadedStep];
}

function generateTransitionStep(fromPage: string, toPage: string): PageStep {
  return {
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
  const { cdnResult, hasCdn, documentRoot, thirdPartyEntries } = describePage(har);
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
    thirdPartyRegion: hasThirdPartyNodes ? detectThirdPartyRegion(thirdPartyEntries) : "origin",
  });

  const ownNonDocNetwork = entries.filter(
    (e) => !e.isDocument && getRootDomain(e.url) === documentRoot && e.fromCache === false
  );
  const cdnHitEntries = hasCdn
    ? ownNonDocNetwork.filter((e) => detectCdnCacheStatus(e.responseHeaders) === "hit")
    : [];
  const originEntries = hasCdn
    ? ownNonDocNetwork.filter((e) => detectCdnCacheStatus(e.responseHeaders) !== "hit")
    : ownNonDocNetwork;
  const browserCacheEntries = entries.filter((e) => !e.isDocument && e.fromCache !== false);
  const thirdPartyNetworkEntries = thirdPartyEntries.filter((e) => e.fromCache === false);

  for (const node of nodes) {
    if (node.id === "browser" && browserCacheEntries.length > 0) {
      node.resourceStats = { count: browserCacheEntries.length };
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
      node.resourceStats = {
        count: thirdPartyNetworkEntries.length,
        avgMs: avgMs(thirdPartyNetworkEntries),
      };
    }
  }

  return { nodes, paths, cacheReport: analyzeCacheForHar(har) };
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
