import { detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import { detectNode } from "../inference/node-detector.js";
import { detectPop } from "../inference/pops.js";
import type { CdnProvider, HarEntry, NetworkRegion, ParsedHar } from "../types.js";
import { getHostname, getRootDomain } from "../utils/domain.js";
import { tcpConnectMs } from "../utils/timing.js";
import { isBrowserCacheHit } from "./network-requests.js";
import { phaseMs } from "../utils/timing.js";
import { medianTtfbByLoad } from "./host-ttfb.js";

export interface HostHop {
  host: string;
  party: "first" | "third";
  provider: CdnProvider | "origin";
  providerName: string;
  pop: { code: string; city: string; region: NetworkRegion } | null;
  /** Requests that reached the host; browser-cache hits never do and are counted apart. */
  requests: number;
  browserCacheHits: number;
  /** Bytes of the requests that reached the host. */
  bytes: number;
  /** CDN cache status of the requests that reached the host. */
  cacheHits: number;
  cacheMisses: number;
  /** hits / (hits + misses); 0 when no entry reported a cache status. */
  hitRatio: number;
  /**
   * Median TTFB of the requests that reached the host before onLoad, beacons (POST, ping,
   * 204/205) and 304 revalidations aside; null when none did.
   */
  medianTtfbMs: number | null;
  /** The same median over the requests sent after onLoad; null when none were. */
  afterLoadMedianTtfbMs: number | null;
  /**
   * First non-zero connection timings seen for the host, `connect` the TCP handshake alone and
   * `ssl` the TLS one, a phase that did not happen (plain HTTP has no TLS) as null; null when every entry reused a connection.
   */
  connection: { dns: number | null; connect: number | null; ssl: number | null } | null;
  fromBrowserCache: boolean;
}

export interface HopsSummary {
  providers: { providerName: string; hosts: number; requests: number }[];
  regions: { region: NetworkRegion; hosts: number; requests: number }[];
}

/** Most frequent key; ties go to the key seen first. */
function vote<T>(keys: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function buildHop(
  host: string,
  entries: HarEntry[],
  documentRoot: string,
  onLoad: number | null
): HostHop {
  const nodes = entries.map((e) => detectNode(e.responseHeaders, e.url));
  // Entries without CDN headers (dynamic or bypassed responses) must not outvote a detected CDN.
  const detected = nodes.filter((n) => n.cdnProvider !== "unknown");
  const provider = vote(detected.map((n) => n.cdnProvider)) ?? "unknown";
  const providerName = nodes.find((n) => n.cdnProvider === provider)?.name ?? "Origin Server";

  const pops = entries.map((e) => detectPop(e.responseHeaders)).filter((p) => p !== null);
  const popCode = vote(pops.map((p) => p.code));
  const pop = pops.find((p) => p.code === popCode);

  // A browser-cache hit replays a stored response: its timings and CDN headers are not this load's.
  const network = entries.filter((e) => !isBrowserCacheHit(e));
  let cacheHits = 0;
  let cacheMisses = 0;
  for (const e of network) {
    const status = detectCdnCacheStatus(e.responseHeaders);
    if (status === "hit") cacheHits++;
    else if (status === "miss") cacheMisses++;
  }
  const judged = cacheHits + cacheMisses;
  const ttfb = medianTtfbByLoad(network, onLoad);

  const handshake = network.find(
    (e) => e.timing.dns > 0 || e.timing.connect > 0 || e.timing.ssl > 0
  );

  return {
    host,
    party: getRootDomain(`https://${host}/`) === documentRoot ? "first" : "third",
    provider: provider === "unknown" ? "origin" : provider,
    providerName,
    pop: pop ? { code: pop.code, city: pop.city, region: pop.region } : null,
    requests: network.length,
    browserCacheHits: entries.length - network.length,
    bytes: network.reduce((sum, e) => sum + e.transferSize, 0),
    cacheHits,
    cacheMisses,
    hitRatio: judged > 0 ? cacheHits / judged : 0,
    medianTtfbMs: ttfb.beforeLoad,
    afterLoadMedianTtfbMs: ttfb.afterLoad,
    connection: handshake
      ? {
          dns: phaseMs(handshake.timing, "dns"),
          connect:
            phaseMs(handshake.timing, "connect") === null ? null : tcpConnectMs(handshake.timing),
          ssl: phaseMs(handshake.timing, "ssl"),
        }
      : null,
    fromBrowserCache: network.length < entries.length,
  };
}

/** One entry per hostname with its provider, PoP, cache and connection cost, busiest first. */
export function analyzeHops(har: ParsedHar, documentUrl: string): HostHop[] {
  const documentRoot = getRootDomain(documentUrl);
  const onLoad = har.pages[0]?.onLoad ?? null;
  const byHost = new Map<string, HarEntry[]>();
  for (const entry of har.entries) {
    const host = getHostname(entry.url);
    if (host === null) continue;
    const list = byHost.get(host);
    if (list) list.push(entry);
    else byHost.set(host, [entry]);
  }
  return [...byHost]
    .map(([host, entries]) => buildHop(host, entries, documentRoot, onLoad))
    .sort((a, b) => b.requests - a.requests || b.browserCacheHits - a.browserCacheHits);
}

export function summarizeHops(hops: HostHop[]): HopsSummary {
  const providers = new Map<string, { providerName: string; hosts: number; requests: number }>();
  const regions = new Map<
    NetworkRegion,
    { region: NetworkRegion; hosts: number; requests: number }
  >();
  for (const hop of hops) {
    const p = providers.get(hop.providerName) ?? {
      providerName: hop.providerName,
      hosts: 0,
      requests: 0,
    };
    p.hosts++;
    p.requests += hop.requests;
    providers.set(hop.providerName, p);
    if (hop.pop) {
      const r = regions.get(hop.pop.region) ?? { region: hop.pop.region, hosts: 0, requests: 0 };
      r.hosts++;
      r.requests += hop.requests;
      regions.set(hop.pop.region, r);
    }
  }
  const byRequests = <T extends { requests: number }>(a: T, b: T) => b.requests - a.requests;
  return {
    providers: [...providers.values()].sort(byRequests),
    regions: [...regions.values()].sort(byRequests),
  };
}
