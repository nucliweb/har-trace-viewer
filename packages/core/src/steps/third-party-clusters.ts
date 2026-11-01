import { medianTtfbByLoad } from "../analysis/host-ttfb.js";
import { detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import { detectThirdPartyHop, providerRegion } from "../inference/node-detector.js";
import { getHostname } from "../utils/domain.js";
import { formatCaptionMs } from "../utils/format.js";
import type {
  DiagramNode,
  DiagramPath,
  HarEntry,
  NodeId,
  NodeKind,
  PopDetection,
  ThirdPartyCluster,
  ThirdPartyClusterNodeId,
  ThirdPartyClusterPathId,
} from "../types.js";

// A page shows at most this many clusters; past it the smallest CDN clusters merge into
// "Other third parties".
export const MAX_THIRD_PARTY_CLUSTERS = 5;

const OTHER_CLUSTER = { id: "other", label: "Other third parties" } as const;
// A cluster served from several PoPs names the busiest ones that fit a diagram caption and
// counts the rest ("Cloudflare · LAX, SIN", "Cloudflare · LAX +2"); a long provider name
// with no room for any stays alone (its caption still shows the busiest PoP's city).
const MAX_LABEL_CHARS = 22;

function popsLabel(name: string, codes: string[]): string {
  for (let shown = codes.length; shown > 0; shown--) {
    const rest = codes.length - shown;
    const label = `${name} · ${codes.slice(0, shown).join(", ")}${rest > 0 ? ` +${rest}` : ""}`;
    if (label.length <= MAX_LABEL_CHARS) return label;
  }
  return name;
}

export function nodeKind(id: NodeId): NodeKind {
  return id.startsWith("third-parties:") ? "third-parties" : (id as NodeKind);
}

export const thirdPartyNodeId = (clusterId: string): ThirdPartyClusterNodeId =>
  `third-parties:${clusterId}`;

export const thirdPartyPathId = (clusterId: string): ThirdPartyClusterPathId =>
  `browser-third-parties:${clusterId}`;

// A diagram caption for a cluster's median TTFB: "TTFB 26ms". Path labels have room for
// "avg 1234ms", not for "median TTFB 1234ms"; the node's avgMsKind says it is a median.
export const ttfbCaption = (ms: number): string => `TTFB ${formatCaptionMs(ms)}`;

// PoPs by the number of entries they served, busiest first (first seen on a tie).
function popsByRequests(pops: (PopDetection | null)[]): PopDetection[] {
  const counts = new Map<string, { pop: PopDetection; count: number }>();
  for (const pop of pops) {
    if (!pop) continue;
    const seen = counts.get(pop.code) ?? { pop, count: 0 };
    seen.count++;
    counts.set(pop.code, seen);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).map((seen) => seen.pop);
}

// Hostnames by request count, busiest first (in order of first request on a tie).
function hostsByRequests(entries: HarEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const host = getHostname(e.url) ?? e.url;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([host]) => host);
}

function stats(entries: HarEntry[], onLoad: number | null) {
  const hits = entries.filter((e) => detectCdnCacheStatus(e.responseHeaders) === "hit").length;
  return {
    hosts: hostsByRequests(entries),
    requests: entries.length,
    avgMs: medianTtfbByLoad(entries, onLoad).beforeLoad,
    bytes: entries.reduce((sum, e) => sum + e.transferSize, 0),
    hitRatio: entries.length === 0 ? 0 : hits / entries.length,
  };
}

type Hop = ReturnType<typeof detectThirdPartyHop>;

const requestsOf = (entries: HarEntry[], hops: Map<HarEntry, Hop>) =>
  entries.map((e) => ({ host: getHostname(e.url) ?? e.url, region: hops.get(e)!.region }));

// `split`: the cluster holds one region of a provider split by region.
function toCluster(
  entries: HarEntry[],
  hops: Map<HarEntry, Hop>,
  split: boolean,
  onLoad: number | null
): ThirdPartyCluster {
  const { provider, name } = hops.get(entries[0])!;
  const region = providerRegion(provider, requestsOf(entries, hops));
  const pops = popsByRequests(entries.map((e) => hops.get(e)!.pop));
  const direct = provider === "unknown";
  const codes = pops.map((pop) => pop.code.toUpperCase());
  return {
    id: direct ? "direct" : split ? `${provider}-${region}` : provider,
    // Direct stays "Direct", whatever PoP a hosting platform reports.
    label: !direct && codes.length > 0 ? popsLabel(name, codes) : name,
    provider,
    region,
    pop: pops[0] ?? null,
    ...stats(entries, onLoad),
  };
}

function groupBy<K>(entries: HarEntry[], key: (entry: HarEntry) => K): HarEntry[][] {
  const groups = new Map<K, HarEntry[]>();
  for (const entry of entries) {
    const k = key(entry);
    groups.set(k, [...(groups.get(k) ?? []), entry]);
  }
  return [...groups.values()];
}

const byRequests = (a: HarEntry[], b: HarEntry[]) => b.length - a.length;

// Groups third-party network requests by provider:
// - Direct requests (no CDN) always form one cluster, never merged into Other.
// - A CDN served from several regions splits into one cluster per region, biggest providers
//   first, as long as the page stays within MAX_THIRD_PARTY_CLUSTERS.
// - Past the cap, the smallest CDN clusters merge into "Other third parties", placed in the
//   region most of its requests come from.
// Clusters are ordered by requests (first request on a tie), with Other last. `onLoad` (ms, null
// when the event never fired) sets apart the requests sent after the page loaded.
export function clusterThirdParties(
  entries: HarEntry[],
  onLoad: number | null
): ThirdPartyCluster[] {
  const hops = new Map(entries.map((e) => [e, detectThirdPartyHop(e.url, e.responseHeaders)]));
  const providers = groupBy(entries, (e) => hops.get(e)!.provider);
  const direct = providers.find((group) => hops.get(group[0])!.provider === "unknown");
  const cdns = providers.filter((group) => group !== direct).sort(byRequests);

  let count = providers.length;
  const clusters: { entries: HarEntry[]; split: boolean }[] = [];
  for (const group of cdns) {
    const regions = groupBy(group, (e) => hops.get(e)!.region);
    if (regions.length > 1 && count + regions.length - 1 <= MAX_THIRD_PARTY_CLUSTERS) {
      count += regions.length - 1;
      clusters.push(...regions.map((region) => ({ entries: region, split: true })));
    } else {
      clusters.push({ entries: group, split: false });
    }
  }
  if (direct) clusters.push({ entries: direct, split: false });

  const ranked = clusters.sort((a, b) => byRequests(a.entries, b.entries));
  if (ranked.length <= MAX_THIRD_PARTY_CLUSTERS) {
    return ranked.map((c) => toCluster(c.entries, hops, c.split, onLoad));
  }
  // Room for Other and Direct; the biggest CDN clusters fill the rest.
  const cdnRoom = MAX_THIRD_PARTY_CLUSTERS - 1 - (direct ? 1 : 0);
  const mergedCdns = ranked.filter((c) => c.entries !== direct).slice(cdnRoom);
  const kept = ranked.filter((c) => !mergedCdns.includes(c));
  const merged = new Set(mergedCdns.flatMap((c) => c.entries));
  const otherEntries = entries.filter((e) => merged.has(e));
  return [
    ...kept.map((c) => toCluster(c.entries, hops, c.split, onLoad)),
    {
      ...OTHER_CLUSTER,
      provider: "mixed",
      region: providerRegion("mixed", requestsOf(otherEntries, hops)),
      pop: null,
      ...stats(otherEntries, onLoad),
    },
  ];
}

// Captions stay within the width of a diagram column.
const MAX_HOST_CHARS = 20;

// A long host keeps its last labels that fit ("…digital.nuance.com"), or its last
// characters when not even two labels fit.
function shortHost(host: string): string {
  if (host.length <= MAX_HOST_CHARS) return host;
  const labels = host.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    const suffix = `…${labels.slice(i).join(".")}`;
    if (suffix.length <= MAX_HOST_CHARS) return suffix;
  }
  return `…${host.slice(-(MAX_HOST_CHARS - 1))}`;
}

// The busiest host and how many more.
function hostsCaption([busiest, ...rest]: string[]): string {
  const host = shortHost(busiest);
  return rest.length > 0 ? `${host} +${rest.length}` : host;
}

// One node per cluster, captioned with its PoP city; Direct (and a CDN without a PoP) with
// its busiest host.
export function clusterNode(cluster: ThirdPartyCluster): DiagramNode {
  return {
    id: thirdPartyNodeId(cluster.id),
    label: cluster.label,
    subLabel:
      cluster.provider === "unknown"
        ? hostsCaption(cluster.hosts)
        : (cluster.pop?.city ?? hostsCaption(cluster.hosts)),
    present: true,
    region: cluster.region,
    resourceStats: {
      count: cluster.requests,
      ...(cluster.avgMs === null ? {} : { avgMs: cluster.avgMs, avgMsKind: "median-ttfb" }),
    },
  };
}

export function clusterPath(cluster: ThirdPartyCluster): DiagramPath {
  return {
    id: thirdPartyPathId(cluster.id),
    from: "browser",
    to: thirdPartyNodeId(cluster.id),
  };
}
