import { medianTtfbByLoad } from "../analysis/host-ttfb.js";
import { SERVER_WAIT_LABEL, TTFB_LABEL } from "../analysis/metrics-summary.js";
import { getHostname } from "../utils/domain.js";
import { formatCaptionMs, formatMetricValue, formatMs } from "../utils/format.js";
import { phaseMs, reusesConnection, tcpConnectMs } from "../utils/timing.js";
import { avgMs, reachesOrigin, type PageContext } from "./page-context.js";
import { clusterNode, clusterPath, ttfbCaption } from "./third-party-clusters.js";
import { firstStart, sortByTimeline, type TimedItem } from "./timeline.js";
import {
  firstActivePath,
  hasClusterNodes,
  serverNodes,
  serverPathDirections,
  serverPaths,
} from "./topology.js";
import type { DiagramStep, HarEntry, Metric, MetricUnit, NodeId, PathId } from "../types.js";

// Steps are built per page and tagged with their pageIndex by generateFlow.
export type PageStep = Omit<DiagramStep, "pageIndex">;

export const TRANSITION_TITLE_PREFIX = "→ User navigates to ";

// A step metric: the number in its unit and its display, "n/a" without a number.
function metric(label: string, raw: number | null | undefined, unit: MetricUnit): Metric {
  const value = raw ?? null;
  return {
    label,
    value: formatMetricValue(value, unit),
    ...(value === null ? {} : { raw: value }),
    unit,
  };
}

const count = (label: string, n: number): Metric => metric(label, n, "count");
const ms = (label: string, value: number | null | undefined): Metric => metric(label, value, "ms");

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
function withCacheHop<T extends PageStep>(step: T, cached: HarEntry[]): T {
  if (cached.length === 0) return step;
  return {
    ...step,
    activeNodes: [...step.activeNodes, "cache"],
    activePaths: [...step.activePaths, "browser-cache"],
    pathTimings: { ...step.pathTimings, "browser-cache": cacheTiming(cached) },
    pathDirections: { ...step.pathDirections, "browser-cache": "response" },
  };
}

/**
 * The steps of one page: the connection prologue, the resource groups and paints in the
 * order they happened, and the load event.
 */
export function generatePageSteps(ctx: PageContext): PageStep[] {
  const { har, trace, hasCdn, hasGfw, cdnResult, thirdPartyEntries, thirdPartyClusters } = ctx;
  const { entries } = har;
  const { document: documentEntry, page, cacheEntries } = ctx;
  const hasThirdPartyNodes = thirdPartyEntries.length > 0;

  const entryIndex = new Map(entries.map((entry, index) => [entry, index]));
  // Steps point at the page entries instead of copying them; empty lists are omitted.
  const refs = (list: HarEntry[]): number[] | undefined =>
    list.length > 0 ? list.map((entry) => entryIndex.get(entry)!) : undefined;

  const criticalEntries = ctx.ownEntries.filter((e) => !e.isDocument && isCriticalResource(e));
  const secondaryEntries = ctx.ownEntries.filter((e) => !e.isDocument && isSecondaryResource(e));

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
  const connectionMetrics = [...(dnsMs === null ? [] : [ms("DNS", dnsMs)]), ms("TCP connect", tcp)];
  if (ssl > 0) connectionMetrics.push(ms("TLS", ssl));

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
    ...(dnsMs === null ? [] : [`DNS ${formatCaptionMs(dnsMs)}`]),
    `TCP ${formatCaptionMs(tcp)}`,
    ...(ssl > 0 ? [`TLS ${formatCaptionMs(ssl)}`] : []),
  ].join(" · ");
  const firstPath = firstActivePath(hasCdn, hasGfw);
  // A document the CDN served from its cache never reaches the origin.
  const documentToOrigin = reachesOrigin(ctx, [documentEntry]);
  const servedBy = documentToOrigin
    ? ""
    : `, served from its edge cache${ctx.popCity ? ` in ${ctx.popCity}` : ""}`;

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
    metrics: [ms(TTFB_LABEL, firstByteAt), ms(SERVER_WAIT_LABEL, documentEntry.ttfb)],
    pathTimings: { [firstPath]: `${SERVER_WAIT_LABEL} ${formatCaptionMs(documentEntry.ttfb)}` },
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
    const toOrigin = network.length === 0 || reachesOrigin(ctx, network);
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
  if (criticalCss.length > 0) criticalMetrics.push(count("CSS files", criticalCss.length));
  if (criticalJs.length > 0) criticalMetrics.push(count("JS files", criticalJs.length));
  if (criticalCache.length > 0) criticalMetrics.push(count("From cache", criticalCache.length));

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
                [firstPath]: `${criticalNetwork.length} files · avg ${formatCaptionMs(avgMs(criticalNetwork))}`,
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
        metrics: [ms("FCP", trace.fcp)],
        badge: { type: "fcp", value: formatMs(trace.fcp), node: "browser" },
      },
    });
  }

  const secondaryNetwork = secondaryEntries.filter((e) => e.fromCache === false);
  const secondaryCache = secondaryEntries.filter((e) => e.fromCache !== false);
  const secondaryMetrics: DiagramStep["metrics"] = [count("Resources", secondaryEntries.length)];
  if (secondaryCache.length > 0) secondaryMetrics.push(count("From cache", secondaryCache.length));

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
                [firstPath]: `${secondaryNetwork.length} ${secondaryNetwork.length === 1 ? "resource" : "resources"} · avg ${formatCaptionMs(avgMs(secondaryNetwork))}`,
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
        metrics: [ms("LCP", trace.lcp)],
        badge: { type: "lcp", value: formatMs(trace.lcp), node: "browser" },
      },
    });
  }

  if (hasThirdPartyNodes) {
    const thirdPartyNetwork = thirdPartyEntries.filter((e) => e.fromCache === false);
    const thirdPartyCache = thirdPartyEntries.filter((e) => e.fromCache !== false);
    const thirdPartyDomains = new Set(thirdPartyNetwork.map((e) => getHostname(e.url) ?? e.url));
    const thirdPartyMetrics: DiagramStep["metrics"] = [
      count("Domains", thirdPartyDomains.size),
      count("Requests", thirdPartyNetwork.length),
    ];
    if (thirdPartyCache.length > 0)
      thirdPartyMetrics.push(count("From cache", thirdPartyCache.length));
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
        ms("onLoad", page.onLoad),
        ms("DCL", page.onContentLoad),
        metric("CLS", trace?.cls, "score"),
        ms("INP", trace?.inp),
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

export function generateTransitionStep(fromPage: string, toPage: string): PageStep {
  return {
    kind: "transition",
    title: `${TRANSITION_TITLE_PREFIX}${toPage}`,
    description: `The user leaves ${fromPage} and navigates to ${toPage}.`,
    activeNodes: ["browser"],
    activePaths: [],
    metrics: [],
  };
}
