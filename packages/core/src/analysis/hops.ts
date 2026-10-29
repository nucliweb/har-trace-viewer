import { detectCdnCacheStatus } from "../inference/cache-analyzer.js";
import { detectNode } from "../inference/node-detector.js";
import { detectPop } from "../inference/pops.js";
import type { CdnProvider, HarEntry, NetworkRegion, ParsedHar } from "../types.js";
import { getHostname, getRootDomain } from "../utils/domain.js";

export interface HostHop {
  host: string;
  party: "first" | "third";
  provider: CdnProvider | "origin";
  providerName: string;
  pop: { code: string; city: string; region: NetworkRegion } | null;
  requests: number;
  bytes: number;
  cacheHits: number;
  cacheMisses: number;
  /** hits / (hits + misses); 0 when no entry reported a cache status. */
  hitRatio: number;
  avgTtfbMs: number;
  /** First non-zero connection timings seen for the host; null when every entry reused a connection. */
  connection: { dns: number; connect: number; ssl: number } | null;
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

function buildHop(host: string, entries: HarEntry[], documentRoot: string): HostHop {
  const nodes = entries.map((e) => detectNode(e.responseHeaders, e.url));
  // Entries without CDN headers (dynamic or bypassed responses) must not outvote a detected CDN.
  const detected = nodes.filter((n) => n.cdnProvider !== "unknown");
  const provider = vote(detected.map((n) => n.cdnProvider)) ?? "unknown";
  const providerName = nodes.find((n) => n.cdnProvider === provider)?.name ?? "Origin Server";

  const pops = entries.map((e) => detectPop(e.responseHeaders)).filter((p) => p !== null);
  const popCode = vote(pops.map((p) => p.code));
  const pop = pops.find((p) => p.code === popCode);

  let cacheHits = 0;
  let cacheMisses = 0;
  for (const e of entries) {
    const status = detectCdnCacheStatus(e.responseHeaders);
    if (status === "hit") cacheHits++;
    else if (status === "miss") cacheMisses++;
  }
  const judged = cacheHits + cacheMisses;

  const handshake = entries.find(
    (e) => e.timing.dns > 0 || e.timing.connect > 0 || e.timing.ssl > 0
  );

  return {
    host,
    party: getRootDomain(`https://${host}/`) === documentRoot ? "first" : "third",
    provider: provider === "unknown" ? "origin" : provider,
    providerName,
    pop: pop ? { code: pop.code, city: pop.city, region: pop.region } : null,
    requests: entries.length,
    bytes: entries.reduce((sum, e) => sum + e.transferSize, 0),
    cacheHits,
    cacheMisses,
    hitRatio: judged > 0 ? cacheHits / judged : 0,
    avgTtfbMs: entries.reduce((sum, e) => sum + e.ttfb, 0) / entries.length,
    connection: handshake
      ? {
          dns: Math.max(handshake.timing.dns, 0),
          connect: Math.max(handshake.timing.connect, 0),
          ssl: Math.max(handshake.timing.ssl, 0),
        }
      : null,
    fromBrowserCache: entries.some((e) => e.fromCache !== false),
  };
}

/** One entry per hostname with its provider, PoP, cache and connection cost, busiest first. */
export function analyzeHops(har: ParsedHar, documentUrl: string): HostHop[] {
  const documentRoot = getRootDomain(documentUrl);
  const byHost = new Map<string, HarEntry[]>();
  for (const entry of har.entries) {
    const host = getHostname(entry.url);
    if (host === null) continue;
    const list = byHost.get(host);
    if (list) list.push(entry);
    else byHost.set(host, [entry]);
  }
  return [...byHost]
    .map(([host, entries]) => buildHop(host, entries, documentRoot))
    .sort((a, b) => b.requests - a.requests);
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
