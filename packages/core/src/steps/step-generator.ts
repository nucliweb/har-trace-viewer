import { detectCdnPopCity, detectCdnRegion, detectGfw, detectNode, detectOriginRegion, detectThirdPartyRegion, hasThirdParties } from "../inference/node-detector.js";
import { analyzeCacheForHar, detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import type {
  DiagramNode,
  DiagramPath,
  DiagramStep,
  Flow,
  HarEntry,
  NetworkRegion,
  NodeId,
  PageFlow,
  PathId,
} from "../types.js";

function getRootDomain(url: string): string {
  try {
    const parts = new URL(url).hostname.split(".");
    return parts.slice(-2).join(".");
  } catch {
    return url;
  }
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`;
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
}

function isSecondaryResource(entry: HarEntry): boolean {
  return (
    !entry.isDocument &&
    !isCriticalResource(entry) &&
    entry.resourceType !== "fetch"
  );
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
  const { hasCdn, hasThirdPartyNodes, hasGfw, edgeName, edgeRegion, edgeSubLabel, originRegion, originSubLabel, thirdPartyRegion } = opts;
  const browserRegion: NetworkRegion = hasGfw ? "china" : "client";

  const nodes: DiagramNode[] = [
    { id: "browser", label: "Browser", present: true, region: browserRegion },
  ];

  if (hasGfw) {
    nodes.push({ id: "gfw", label: "GFW", subLabel: "DPI inspection", present: true, region: "china" });
  }

  nodes.push(
    { id: "edge", label: edgeName, subLabel: edgeSubLabel ?? undefined, present: hasCdn, region: edgeRegion },
    { id: "origin", label: "Origin Server", subLabel: originSubLabel ?? undefined, present: true, region: originRegion },
    { id: "third-parties", label: "3rd Parties", present: hasThirdPartyNodes, region: thirdPartyRegion },
  );

  let paths: DiagramPath[];
  if (hasGfw && hasCdn) {
    paths = [
      { id: "browser-gfw", from: "browser", to: "gfw" },
      { id: "gfw-edge", from: "gfw", to: "edge" },
      { id: "edge-origin", from: "edge", to: "origin" },
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
  if (hasGfw && hasCdn) return ["browser", "gfw", "edge", "origin"];
  return hasCdn ? ["browser", "edge", "origin"] : ["browser", "origin"];
}

function serverPaths(hasCdn: boolean, hasGfw: boolean): PathId[] {
  if (hasGfw && hasCdn) return ["browser-gfw", "gfw-edge", "edge-origin"];
  return hasCdn ? ["browser-edge", "edge-origin"] : ["browser-origin"];
}

function firstActivePath(hasCdn: boolean, hasGfw: boolean): PathId {
  if (hasGfw) return "browser-gfw";
  return hasCdn ? "browser-edge" : "browser-origin";
}

function generatePageSteps(pageFlow: PageFlow): DiagramStep[] {
  const { har, trace } = pageFlow;
  const { documentEntry, pages, entries } = har;
  const page = pages[0];

  const cdnResult = detectNode(documentEntry.responseHeaders);
  const hasCdn = cdnResult.type === "edge";
  const maxConnectMs = Math.max(0, ...entries.map((e) => e.timing.connect));
  const hasGfw = detectGfw(documentEntry.timing.dns, maxConnectMs);
  const documentRoot = getRootDomain(documentEntry.url);
  const thirdPartyEntries = entries.filter((e) => !e.isDocument && isThirdParty(e, documentRoot));
  const hasThirdPartyNodes = thirdPartyEntries.length > 0;

  const ownEntries = entries.filter((e) => !isThirdParty(e, documentRoot));
  const criticalEntries = ownEntries.filter((e) => !e.isDocument && isCriticalResource(e));
  const secondaryEntries = ownEntries.filter((e) => !e.isDocument && isSecondaryResource(e));

  const apacFallback: NetworkRegion = hasGfw ? "asia-pacific" : "edge";
  const edgeRegion = detectCdnRegion(documentEntry.responseHeaders, apacFallback);
  const edgeLabel = hasCdn ? cdnResult.name : "Origin";
  const steps: DiagramStep[] = [];

  // Step 1 — DNS + initial connection
  const { dns, connect, ssl } = documentEntry.timing;
  const connectionMetrics = [
    { label: "DNS", value: formatMs(dns) },
    { label: "TCP connect", value: formatMs(connect) },
  ];
  if (ssl > 0) connectionMetrics.push({ label: "TLS", value: formatMs(ssl) });

  steps.push({
    title: "DNS + initial connection",
    description: `Browser resolves the domain and establishes a TCP${ssl > 0 ? "/TLS" : ""} connection to ${edgeLabel}.`,
    activeNodes: ["browser"],
    activePaths: [],
    metrics: connectionMetrics,
  });

  // Step 2 — First request in flight
  const reqConnectionLabel = `DNS ${formatMs(dns)} · TCP ${formatMs(connect)}${ssl > 0 ? ` · TLS ${formatMs(ssl)}` : ""}`;
  const firstPath = firstActivePath(hasCdn, hasGfw);

  const step2PathTimings: Partial<Record<PathId, string>> = {
    [firstPath]: reqConnectionLabel,
  };

  const step2PathDirections: Partial<Record<PathId, "request" | "response">> = hasGfw && hasCdn
    ? { "browser-gfw": "request", "gfw-edge": "request", "edge-origin": "request" }
    : hasCdn
    ? { "browser-edge": "request", "edge-origin": "request" }
    : { "browser-origin": "request" };

  steps.push({
    title: "First request in flight",
    description: "Browser sends the HTTP request for the HTML document.",
    activeNodes: serverNodes(hasCdn, hasGfw),
    activePaths: serverPaths(hasCdn, hasGfw),
    metrics: [],
    pathTimings: step2PathTimings,
    pathDirections: step2PathDirections,
  });

  // Step 3 — TTFB
  const step3PathTimings: Partial<Record<PathId, string>> = {
    [firstPath]: `TTFB ${formatMs(documentEntry.ttfb)}`,
  };

  const step3PathDirections: Partial<Record<PathId, "request" | "response">> = hasGfw && hasCdn
    ? { "browser-gfw": "response", "gfw-edge": "response", "edge-origin": "response" }
    : hasCdn
    ? { "browser-edge": "response", "edge-origin": "response" }
    : { "browser-origin": "response" };

  steps.push({
    title: "TTFB — First byte received",
    description: `${edgeLabel} responds with the first byte of the HTML document.`,
    activeNodes: serverNodes(hasCdn, hasGfw),
    activePaths: serverPaths(hasCdn, hasGfw),
    metrics: [{ label: "TTFB", value: formatMs(documentEntry.ttfb) }],
    pathTimings: step3PathTimings,
    pathDirections: step3PathDirections,
    badge: { type: "ttfb", value: formatMs(documentEntry.ttfb), node: "browser" },
  });

  // Step 4 — Critical resources
  const criticalNetwork = criticalEntries.filter((e) => e.fromCache === false);
  const criticalCache = criticalEntries.filter((e) => e.fromCache !== false);
  const criticalCss = criticalNetwork.filter((e) => e.resourceType === "stylesheet");
  const criticalJs = criticalNetwork.filter((e) => e.resourceType === "script");
  const criticalMetrics: DiagramStep["metrics"] = [];
  if (criticalCss.length > 0) criticalMetrics.push({ label: "CSS files", value: String(criticalCss.length) });
  if (criticalJs.length > 0) criticalMetrics.push({ label: "JS files", value: String(criticalJs.length) });
  if (criticalCache.length > 0) criticalMetrics.push({ label: "From cache", value: String(criticalCache.length) });

  const criticalAvg = avgMs(criticalNetwork);
  const step4PathTimings: Partial<Record<PathId, string>> = criticalNetwork.length > 0
    ? { [firstPath]: `${criticalNetwork.length} files · avg ${formatMs(criticalAvg)}` }
    : {};

  steps.push({
    title: "Critical resources loading",
    description: "Browser parses the HTML and fetches render-blocking CSS and scripts.",
    activeNodes: serverNodes(hasCdn, hasGfw),
    activePaths: serverPaths(hasCdn, hasGfw),
    metrics: criticalMetrics,
    pathTimings: step4PathTimings,
    resources: criticalNetwork.length > 0 ? criticalNetwork : undefined,
    cacheResources: criticalCache.length > 0 ? criticalCache : undefined,
  });

  // Steps from trace (FCP / LCP) — inserted chronologically after critical resources
  if (trace?.fcp != null) {
    steps.push({
      title: "First Contentful Paint",
      description: "The browser renders the first visible content on screen.",
      activeNodes: ["browser"],
      activePaths: [],
      metrics: [{ label: "FCP", value: formatMs(trace.fcp) }],
      badge: { type: "fcp", value: formatMs(trace.fcp), node: "browser" },
    });
  }

  // Step 5 — Secondary resources
  const secondaryNetwork = secondaryEntries.filter((e) => e.fromCache === false);
  const secondaryCache = secondaryEntries.filter((e) => e.fromCache !== false);
  const secondaryAvg = avgMs(secondaryNetwork);
  const step5PathTimings: Partial<Record<PathId, string>> = secondaryNetwork.length > 0
    ? { [firstPath]: `${secondaryNetwork.length} resources · avg ${formatMs(secondaryAvg)}` }
    : {};

  const secondaryMetrics: DiagramStep["metrics"] = [{ label: "Resources", value: String(secondaryEntries.length) }];
  if (secondaryCache.length > 0) secondaryMetrics.push({ label: "From cache", value: String(secondaryCache.length) });

  steps.push({
    title: "Secondary resources",
    description: "Async scripts, images, and fonts load in the background.",
    activeNodes: serverNodes(hasCdn, hasGfw),
    activePaths: serverPaths(hasCdn, hasGfw),
    metrics: secondaryMetrics,
    pathTimings: step5PathTimings,
    resources: secondaryNetwork.length > 0 ? secondaryNetwork : undefined,
    cacheResources: secondaryCache.length > 0 ? secondaryCache : undefined,
  });

  // LCP (from trace) — inserted after secondary resources
  if (trace?.lcp != null) {
    steps.push({
      title: "Largest Contentful Paint",
      description: "The largest visible element in the viewport has finished rendering.",
      activeNodes: ["browser"],
      activePaths: [],
      metrics: [{ label: "LCP", value: formatMs(trace.lcp) }],
      badge: { type: "lcp", value: formatMs(trace.lcp), node: "browser" },
    });
  }

  // Step 6 — 3rd parties (only if present)
  if (hasThirdPartyNodes) {
    const thirdPartyNetwork = thirdPartyEntries.filter((e) => e.fromCache === false);
    const thirdPartyCache = thirdPartyEntries.filter((e) => e.fromCache !== false);
    const thirdPartyDomains = new Set(thirdPartyNetwork.map((e) => getRootDomain(e.url)));
    const thirdPartyAvg = avgMs(thirdPartyNetwork);
    const thirdPartyMetrics: DiagramStep["metrics"] = [
      { label: "Domains", value: String(thirdPartyDomains.size) },
      { label: "Requests", value: String(thirdPartyNetwork.length) },
    ];
    if (thirdPartyCache.length > 0) thirdPartyMetrics.push({ label: "From cache", value: String(thirdPartyCache.length) });
    steps.push({
      title: "Third-party requests",
      description: "Browser fetches resources from external domains.",
      activeNodes: ["browser", "third-parties"],
      activePaths: thirdPartyNetwork.length > 0 ? ["browser-third-parties"] : [],
      metrics: thirdPartyMetrics,
      pathTimings: thirdPartyNetwork.length > 0 ? {
        "browser-third-parties": `${thirdPartyNetwork.length} req · avg ${formatMs(thirdPartyAvg)}`,
      } : {},
      resources: thirdPartyNetwork.length > 0 ? thirdPartyNetwork : undefined,
      cacheResources: thirdPartyCache.length > 0 ? thirdPartyCache : undefined,
    });
  }

  // Step 7 — onLoad
  steps.push({
    title: "Page loaded",
    description: "The load event fires — all resources have been downloaded.",
    activeNodes: ["browser"],
    activePaths: [],
    metrics: [
      { label: "onLoad", value: formatMs(page.onLoad) },
      { label: "DCL", value: formatMs(page.onContentLoad) },
    ],
    badge: { type: "onload", value: formatMs(page.onLoad), node: "browser" },
  });

  return steps;
}

function generateTransitionStep(fromPage: string, toPage: string): DiagramStep {
  return {
    title: `→ User navigates to ${toPage}`,
    description: `The user leaves ${fromPage} and navigates to ${toPage}.`,
    activeNodes: ["browser"],
    activePaths: [],
    metrics: [],
  };
}

export function generateFlow(pages: PageFlow[]): Flow {
  if (pages.length === 0) {
    throw new Error("Flow requires at least one page");
  }

  const allSteps: DiagramStep[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) {
      allSteps.push(generateTransitionStep(pages[i - 1].name, pages[i].name));
    }
    allSteps.push(...generatePageSteps(pages[i]));
  }

  // Topology is derived from the first page's document
  const firstDoc = pages[0].har.documentEntry;
  const firstPageEntries = pages[0].har.entries;
  const cdnResult = detectNode(firstDoc.responseHeaders);
  const hasCdn = cdnResult.type === "edge";
  const maxConnectMs = Math.max(0, ...firstPageEntries.map((e) => e.timing.connect));
  const hasGfw = detectGfw(firstDoc.timing.dns, maxConnectMs);
  const documentRoot = getRootDomain(firstDoc.url);
  const allThirdPartyEntries = pages.flatMap((p) =>
    p.har.entries.filter((e) => !e.isDocument && getRootDomain(e.url) !== getRootDomain(p.har.documentEntry.url))
  );
  const hasThirdPartyNodes = allThirdPartyEntries.length > 0;
  const apacFallback: NetworkRegion = hasGfw ? "asia-pacific" : "edge";
  const edgeRegion = detectCdnRegion(firstDoc.responseHeaders, apacFallback);
  const edgeName = hasCdn ? cdnResult.name : "Origin Server";
  const edgeSubLabel = hasCdn ? detectCdnPopCity(firstDoc.responseHeaders, cdnResult.cdnProvider, hasGfw) : null;
  const originRegion = detectOriginRegion(firstDoc.responseHeaders);
  const originSubLabel = firstDoc.responseHeaders["server"] ?? null;
  const thirdPartyRegion = hasThirdPartyNodes
    ? detectThirdPartyRegion(allThirdPartyEntries)
    : "origin" as NetworkRegion;

  void documentRoot;

  const { nodes, paths } = buildTopology({
    hasCdn,
    hasThirdPartyNodes,
    hasGfw,
    edgeName,
    edgeRegion,
    edgeSubLabel,
    originRegion,
    originSubLabel,
    thirdPartyRegion,
  });

  const ownNonDocNetwork = firstPageEntries.filter(
    (e) => !e.isDocument && getRootDomain(e.url) === documentRoot && e.fromCache === false
  );
  const cdnHitEntries = hasCdn
    ? ownNonDocNetwork.filter((e) => detectCdnCacheStatus(e.responseHeaders) === "hit")
    : [];
  const originEntries = hasCdn
    ? ownNonDocNetwork.filter((e) => detectCdnCacheStatus(e.responseHeaders) !== "hit")
    : ownNonDocNetwork;
  const browserCacheEntries = firstPageEntries.filter(
    (e) => !e.isDocument && e.fromCache !== false
  );
  const thirdPartyNetworkEntries = allThirdPartyEntries.filter((e) => e.fromCache === false);

  for (const node of nodes) {
    if (node.id === "browser" && browserCacheEntries.length > 0) {
      node.resourceStats = { count: browserCacheEntries.length };
    } else if (node.id === "edge" && hasCdn && cdnHitEntries.length > 0) {
      node.resourceStats = { count: cdnHitEntries.length, avgMs: avgMs(cdnHitEntries), label: "CDN hit" };
    } else if (node.id === "origin" && originEntries.length > 0) {
      node.resourceStats = {
        count: originEntries.length,
        avgMs: avgMs(originEntries),
        label: hasCdn ? "CDN miss" : undefined,
      };
    } else if (node.id === "third-parties" && thirdPartyNetworkEntries.length > 0) {
      node.resourceStats = { count: thirdPartyNetworkEntries.length, avgMs: avgMs(thirdPartyNetworkEntries) };
    }
  }

  const cacheReport = analyzeCacheForHar(pages[0].har);

  return { pages, steps: allSteps, nodes, paths, cacheReport };
}
