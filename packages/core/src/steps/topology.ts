import { medianTtfbByLoad } from "../analysis/host-ttfb.js";
import { isOwnNetworkResource } from "../analysis/network-requests.js";
import {
  detectCdnRegion,
  detectOriginRegion,
  detectThirdPartyRegion,
} from "../inference/node-detector.js";
import { avgMs, reachesOrigin, type PageContext } from "./page-context.js";
import { clusterNode, clusterPath } from "./third-party-clusters.js";
import type {
  DiagramNode,
  DiagramPath,
  HarEntry,
  NetworkRegion,
  NodeId,
  PathId,
  ThirdPartyCluster,
} from "../types.js";

// Several clusters get a node each; one cluster (or none) keeps the single node.
export const hasClusterNodes = (clusters: ThirdPartyCluster[]) => clusters.length > 1;

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

/** The nodes and paths of a page, each server node with the requests it answered. */
export function pageTopology(ctx: PageContext): { nodes: DiagramNode[]; paths: DiagramPath[] } {
  const { har, document, hasCdn, hasGfw, cdnResult, documentRoot, thirdPartyEntries } = ctx;
  const apacFallback: NetworkRegion = hasGfw ? "asia-pacific" : "edge";

  const { nodes, paths } = buildTopology({
    hasCdn,
    hasThirdPartyNodes: thirdPartyEntries.length > 0,
    hasGfw,
    edgeName: hasCdn ? cdnResult.name : "Origin Server",
    edgeRegion: detectCdnRegion(document.responseHeaders, apacFallback),
    edgeSubLabel: ctx.popCity,
    originRegion: detectOriginRegion(document.responseHeaders),
    originSubLabel: document.responseHeaders["server"] ?? null,
    thirdPartyRegion: detectThirdPartyRegion(thirdPartyEntries),
    thirdPartyClusters: ctx.thirdPartyClusters,
    cacheEntries: ctx.cacheEntries,
  });

  const ownNonDocNetwork = har.entries.filter((e) => isOwnNetworkResource(e, documentRoot));
  const cdnHitEntries = hasCdn ? ownNonDocNetwork.filter((e) => ctx.cdnStatus(e) === "hit") : [];
  const originEntries = hasCdn
    ? ownNonDocNetwork.filter((e) => ctx.cdnStatus(e) !== "hit")
    : ownNonDocNetwork;
  const thirdPartyNetworkEntries = thirdPartyEntries.filter((e) => e.fromCache === false);
  // Behind a CDN that served the document and every resource from its cache, nothing reached
  // the origin: it says so with "0 req".
  const originIdle = hasCdn && originEntries.length === 0 && !reachesOrigin(ctx, [document]);

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

  return { nodes, paths };
}

// The server chain of a request: through the GFW checkpoint and the edge when there are
// any, on to the origin unless `toOrigin` is false (a CDN cache hit stops at the edge).
export function serverNodes(hasCdn: boolean, hasGfw: boolean, toOrigin = true): NodeId[] {
  const nodes: NodeId[] = hasGfw ? ["browser", "gfw"] : ["browser"];
  if (hasCdn) nodes.push("edge");
  if (toOrigin || !hasCdn) nodes.push("origin");
  return nodes;
}

export function serverPaths(hasCdn: boolean, hasGfw: boolean, toOrigin = true): PathId[] {
  if (!hasCdn) return hasGfw ? ["browser-gfw", "gfw-origin"] : ["browser-origin"];
  const paths: PathId[] = hasGfw ? ["browser-gfw", "gfw-edge"] : ["browser-edge"];
  if (toOrigin) paths.push("edge-origin");
  return paths;
}

export function serverPathDirections(
  hasCdn: boolean,
  hasGfw: boolean,
  direction: "request" | "response",
  toOrigin = true
): Partial<Record<PathId, "request" | "response">> {
  return Object.fromEntries(serverPaths(hasCdn, hasGfw, toOrigin).map((id) => [id, direction]));
}

export function firstActivePath(hasCdn: boolean, hasGfw: boolean): PathId {
  if (hasGfw) return "browser-gfw";
  return hasCdn ? "browser-edge" : "browser-origin";
}
