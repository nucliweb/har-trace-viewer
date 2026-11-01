import { getHostname, getRootDomain } from "../utils/domain.js";
import { detectPop, detectVercelFunctionRegion } from "./pops.js";
import type {
  CdnProvider,
  ClientRegionSuggestion,
  NetworkRegion,
  NodeDetectionResult,
  ParsedHar,
  PopDetection,
} from "../types.js";

// `url` lets the hostname count as evidence too (Azure CDN on *.azureedge.net).
export function detectNode(
  responseHeaders: Record<string, string>,
  url?: string
): NodeDetectionResult {
  const cdnProvider = detectCdnProvider(responseHeaders, url);

  if (cdnProvider === "unknown") {
    return { type: "origin", name: "Origin Server", cdnProvider };
  }

  return {
    type: "edge",
    name: CDN_NAMES[cdnProvider],
    cdnProvider,
  };
}

const CDN_NAMES: Record<Exclude<CdnProvider, "unknown">, string> = {
  akamai: "Akamai Edge",
  cloudflare: "Cloudflare",
  fastly: "Fastly CDN",
  cloudfront: "CloudFront",
  gfe: "Google",
  "google-cloud-cdn": "Google Cloud CDN",
  vercel: "Vercel Edge",
  netlify: "Netlify Edge",
  "azure-front-door": "Azure Front Door",
  "azure-cdn": "Azure CDN",
  bunny: "Bunny CDN",
  keycdn: "KeyCDN",
};

// Returns the geographic region of the CDN PoP from response headers (see detectPop
// for the supported headers); other CDNs fall back to the provided `fallback` region
// (caller supplies context-derived default).
export function detectCdnRegion(
  responseHeaders: Record<string, string>,
  fallback: NetworkRegion = "edge"
): NetworkRegion {
  return detectPop(responseHeaders)?.region ?? fallback;
}

// Returns a human-readable PoP city for the CDN edge node, if detectable.
// For Akamai serving a client behind the Great Firewall, falls back to "Hong Kong"
// since HK is the canonical APAC PoP for China-routed requests.
export function detectCdnPopCity(
  responseHeaders: Record<string, string>,
  cdnProvider: CdnProvider,
  behindGfw: boolean
): string | null {
  const pop = detectPop(responseHeaders);
  if (pop) return pop.city;

  if (cdnProvider === "akamai" && behindGfw) return "Hong Kong";

  return null;
}

const GFW_DNS_THRESHOLD_MS = 300;
const GFW_CONNECT_THRESHOLD_MS = 500;

// Signs that the page was loaded from China, whatever its latencies: a document host
// under .cn, or a CDN that served it from a PoP in mainland China.
function chinaSignals(har: ParsedHar): string[] {
  const signals: string[] = [];
  if ((getHostname(har.documentEntry.url) ?? "").endsWith(".cn")) {
    signals.push("document host under .cn");
  }
  const pop = har.entries.map((e) => detectPop(e.responseHeaders)).find((p) => p?.country === "CN");
  if (pop) signals.push(`CDN PoP in ${pop.city} (CN)`);
  return signals;
}

// Suggests the "cn" client region when the page looks loaded through China / GFW-mediated
// routing: a slow uncached DNS lookup of the document (≥ 300ms) together with a slow TCP
// connect (≥ 500ms, cross-border from China), or one of them with a sign of China (see
// chinaSignals). A slow or mobile network (WebPageTest 3G profiles) slows down one or both
// moderately, so the latencies alone take thresholds above those profiles. The result is
// only a hint for the user; it never switches the topology on its own.
export function suggestClientRegion(har: ParsedHar): ClientRegionSuggestion | null {
  const documentDnsMs = har.documentEntry.timing.dns;
  const maxConnectMs = Math.max(0, ...har.entries.map((e) => e.timing.connect));

  const latencies: string[] = [];
  if (documentDnsMs >= GFW_DNS_THRESHOLD_MS) {
    latencies.push(`document DNS ${Math.round(documentDnsMs)}ms ≥ ${GFW_DNS_THRESHOLD_MS}ms`);
  }
  if (maxConnectMs >= GFW_CONNECT_THRESHOLD_MS) {
    latencies.push(`max TCP connect ${Math.round(maxConnectMs)}ms ≥ ${GFW_CONNECT_THRESHOLD_MS}ms`);
  }
  if (latencies.length === 0) return null;

  const signals = [...latencies, ...chinaSignals(har)];
  return signals.length >= 2 ? { region: "cn", reason: signals.join(", ") } : null;
}

// Infers origin server region from response headers.
// Checks for hosting-platform markers (Vercel, Fly.io, AWS) before falling back.
// Vercel's origin is where the function ran, not the edge that x-vercel-id names first;
// without a function region it is Vercel's default function region, iad1.
export function detectOriginRegion(headers: Record<string, string>): NetworkRegion {
  const vercelId = headers["x-vercel-id"];
  if (vercelId) {
    return detectVercelFunctionRegion(vercelId)?.region ?? "united-states";
  }

  const flyId = headers["fly-request-id"];
  if (flyId) {
    return detectPop({ "fly-request-id": flyId })?.region ?? "origin";
  }

  if (headers["x-amz-request-id"] || headers["x-amz-id-2"]) {
    return "united-states";
  }

  return "origin";
}

export interface ThirdPartyHop {
  provider: CdnProvider; // "unknown" when no CDN serves it
  name: string; // provider display name, "Direct" without a CDN
  region: NetworkRegion;
  // What placed it: its PoP, its provider's default, a hint in its host, or nothing.
  regionSource: "pop" | "provider" | "host" | "none";
  pop: PopDetection | null;
}

// Where a CDN serves from when its headers name no PoP. Google Frontend fronts
// Google's own services; any other CDN is somewhere at the edge.
const PROVIDER_DEFAULT_REGION: Partial<Record<CdnProvider, NetworkRegion>> = {
  gfe: "united-states",
};

// Where a third-party request is served from: the CDN provider, its PoP and region.
// Region: the PoP's, else the provider's default ("edge" for CDNs without one). With
// no CDN the request goes to the third party's origin: Azure hosts and European
// country domains hint at a region, anything else stays "origin".
export function detectThirdPartyHop(url: string, headers: Record<string, string>): ThirdPartyHop {
  const { cdnProvider, name } = detectNode(headers, url);
  const pop = detectPop(headers);
  const hop = { provider: cdnProvider, name: cdnProvider === "unknown" ? "Direct" : name, pop };
  if (pop) return { ...hop, region: pop.region, regionSource: "pop" };
  if (cdnProvider !== "unknown") {
    return {
      ...hop,
      region: PROVIDER_DEFAULT_REGION[cdnProvider] ?? "edge",
      regionSource: "provider",
    };
  }
  const hinted = hostRegion(url, headers);
  return hinted
    ? { ...hop, region: hinted, regionSource: "host" }
    : { ...hop, region: "origin", regionSource: "none" };
}

function hostRegion(url: string, headers: Record<string, string>): NetworkRegion | null {
  if (isAzureEntry(url, headers)) return "azure-cloud";
  return EU_TLD_RE.test(getHostname(url) ?? "") ? "europe" : null;
}

// The key seen most often; the first one seen on a tie.
function mostFrequent<T>(keys: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = -Infinity;
  for (const [key, count] of counts) {
    if (count > bestCount) [best, bestCount] = [key, count];
  }
  return best;
}

// The region of a provider's third-party requests. A CDN sits where most of its requests
// come from. Direct requests (no CDN) sit in the region most of their hosts share, the
// region with more requests on a tie, so one busy host does not outweigh many others.
export function providerRegion(
  provider: CdnProvider | "mixed",
  requests: { host: string; region: NetworkRegion }[]
): NetworkRegion {
  if (requests.length === 0) return "origin";
  const regions = requests.map((r) => r.region);
  if (provider !== "unknown") return mostFrequent(regions)!;
  const hostRegions = new Map<string, NetworkRegion>();
  for (const host of new Set(requests.map((r) => r.host))) {
    hostRegions.set(
      host,
      mostFrequent(requests.filter((r) => r.host === host).map((r) => r.region))!
    );
  }
  const count = (list: NetworkRegion[], region: NetworkRegion) =>
    list.filter((r) => r === region).length;
  const hosts = [...hostRegions.values()];
  // Most hosts first, then most requests; the first region seen on a full tie.
  return [...new Set(hosts)].reduce((best, region) =>
    count(hosts, region) > count(hosts, best) ||
    (count(hosts, region) === count(hosts, best) && count(regions, region) > count(regions, best))
      ? region
      : best
  );
}

// Region of the third-party requests of the provider that serves most of them (the first
// one on a tie); "origin" without requests. It is the region of the single third-parties
// node; pages with several clusters place each cluster by its own region.
export function detectThirdPartyRegion(
  entries: { url: string; responseHeaders: Record<string, string> }[]
): NetworkRegion {
  const requests = entries.map((e) => ({
    host: getHostname(e.url) ?? e.url,
    ...detectThirdPartyHop(e.url, e.responseHeaders),
  }));
  const provider = mostFrequent(requests.map((r) => r.provider));
  if (provider === undefined) return "origin";
  return providerRegion(
    provider,
    requests.filter((r) => r.provider === provider)
  );
}

// Provider detection order, most specific header first. The first rule that matches
// wins, so hosting platforms with their own request id (Vercel, Netlify) are checked
// before the CDNs that may sit in front of them, and generic signals (the `via` and
// `server` headers) come last.
//   1. vercel            x-vercel-id, x-vercel-cache
//   2. netlify           x-nf-request-id
//   3. azure-front-door  x-azure-ref, x-msedge-ref, x-fd-*
//   3b. azure-cdn        x-cache TCP_* (Edgio/Verizon) with server ECAcc/ECS or an
//                        *.azureedge.net host; x-cache TCP_* alone is any Squid/Varnish-style
//                        cache and names no provider
//   4. bunny             cdn-cache, server: BunnyCDN
//   5. keycdn            server: keycdn-engine (x-edge-location)
//   6. akamai            x-akamai-transformed, server: AkamaiNetStorage
//   7. cloudflare        cf-ray, server: cloudflare
//   8. fastly            x-fastly-request-id, x-served-by: cache-*
//   9. cloudfront        x-amz-cf-pop, x-cache or via mentioning cloudfront
//  10. google-cloud-cdn  via: 1.1 google with x-goog-* or cache-status
//  11. gfe               server: Google Frontend, or via: 1.1 google alone
function detectCdnProvider(headers: Record<string, string>, url?: string): CdnProvider {
  const has = (name: string) => headers[name] !== undefined;
  const hasPrefix = (prefix: string) => Object.keys(headers).some((n) => n.startsWith(prefix));
  const server = (headers["server"] ?? "").toLowerCase();
  const via = (headers["via"] ?? "").toLowerCase();

  if (has("x-vercel-id") || has("x-vercel-cache")) return "vercel";
  if (has("x-nf-request-id")) return "netlify";
  if (has("x-azure-ref") || has("x-msedge-ref") || hasPrefix("x-fd-")) return "azure-front-door";
  if (
    /^TCP_/i.test(headers["x-cache"] ?? "") &&
    (/^EC(Acc|S)\b/.test(headers["server"] ?? "") ||
      (getHostname(url ?? "") ?? "").endsWith(".azureedge.net"))
  ) {
    return "azure-cdn";
  }
  if (has("cdn-cache") || server.startsWith("bunnycdn")) return "bunny";
  if (server.includes("keycdn-engine")) return "keycdn";
  if (has("x-akamai-transformed") || server.includes("akamainetstorage")) return "akamai";
  if (has("cf-ray") || server === "cloudflare") return "cloudflare";
  if (has("x-fastly-request-id") || /^cache-/i.test(headers["x-served-by"] ?? "")) {
    return "fastly";
  }
  if (
    has("x-amz-cf-pop") ||
    (headers["x-cache"] ?? "").toLowerCase().includes("cloudfront") ||
    via.includes("cloudfront")
  ) {
    return "cloudfront";
  }
  if (via.includes("google")) {
    return hasPrefix("x-goog-") || has("cache-status") ? "google-cloud-cdn" : "gfe";
  }
  if (server.includes("google frontend")) return "gfe";

  return "unknown";
}

function isAzureEntry(url: string, headers: Record<string, string>): boolean {
  try {
    const hostname = new URL(url).hostname;
    if (
      hostname.includes(".az.") ||
      hostname.endsWith(".azure.com") ||
      hostname.endsWith(".azurewebsites.net") ||
      hostname.endsWith(".core.windows.net") ||
      hostname.endsWith(".azureedge.net")
    )
      return true;
  } catch {
    /* skip */
  }
  return !!(headers["x-ms-request-id"] || headers["x-azure-ref"] || headers["x-msedge-ref"]);
}

const EU_TLD_RE = /\.(eu|de|fr|nl|ie|be|pl|es|it|se|no|dk|at|ch|co\.uk|co\.de)$/i;

export function hasThirdParties(entries: { url: string }[], documentUrl: string): boolean {
  const documentRoot = getRootDomain(documentUrl);
  return entries.some((e) => getRootDomain(e.url) !== documentRoot);
}
