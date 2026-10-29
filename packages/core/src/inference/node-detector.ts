import { getRootDomain } from "../utils/domain.js";
import { detectPop } from "./pops.js";
import type {
  CdnProvider,
  ClientRegionSuggestion,
  NetworkRegion,
  NodeDetectionResult,
  ParsedHar,
} from "../types.js";

export function detectNode(responseHeaders: Record<string, string>): NodeDetectionResult {
  const cdnProvider = detectCdnProvider(responseHeaders);

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

const GFW_DNS_THRESHOLD_MS = 80;
const GFW_CONNECT_THRESHOLD_MS = 300;

// Suggests the "cn" client region when the latencies are compatible with
// China / GFW-mediated routing:
// 1. High DNS on the document (not cached): > 80ms
// 2. High TCP connect on any entry: > 300ms (cross-continental from China)
// Slow or mobile networks produce the same signals, so the result is only a
// hint for the user; it never switches the topology on its own.
export function suggestClientRegion(har: ParsedHar): ClientRegionSuggestion | null {
  const documentDnsMs = har.documentEntry.timing.dns;
  const maxConnectMs = Math.max(0, ...har.entries.map((e) => e.timing.connect));

  const signals: string[] = [];
  if (documentDnsMs > GFW_DNS_THRESHOLD_MS) {
    signals.push(`document DNS ${Math.round(documentDnsMs)}ms > ${GFW_DNS_THRESHOLD_MS}ms`);
  }
  if (maxConnectMs > GFW_CONNECT_THRESHOLD_MS) {
    signals.push(`max TCP connect ${Math.round(maxConnectMs)}ms > ${GFW_CONNECT_THRESHOLD_MS}ms`);
  }

  return signals.length > 0 ? { region: "cn", reason: signals.join(", ") } : null;
}

// Infers origin server region from response headers.
// Checks for hosting-platform markers (Vercel, Fly.io, AWS) before falling back.
export function detectOriginRegion(headers: Record<string, string>): NetworkRegion {
  const vercelId = headers["x-vercel-id"];
  if (vercelId) {
    return detectPop({ "x-vercel-id": vercelId })?.region ?? "united-states";
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

// Detects the dominant geographic region of a set of third-party entries.
// Priority: azure-cloud > europe > united-states > asia-pacific > north-america >
// south-america > africa > middle-east > origin.
export function detectThirdPartyRegion(
  entries: { url: string; responseHeaders: Record<string, string> }[]
): NetworkRegion {
  if (entries.some((e) => isAzureEntry(e.url, e.responseHeaders))) return "azure-cloud";

  for (const e of entries) {
    try {
      const hostname = new URL(e.url).hostname;
      if (EU_TLD_RE.test(hostname)) return "europe";
    } catch {
      /* skip */
    }
  }

  const regions = entries
    .map((e) => detectCdnRegion(e.responseHeaders))
    .filter((r) => r !== "edge");
  if (regions.includes("europe")) return "europe";
  if (regions.includes("united-states")) return "united-states";
  if (regions.includes("asia-pacific")) return "asia-pacific";
  for (const region of ["north-america", "south-america", "africa", "middle-east"] as const) {
    if (regions.includes(region)) return region;
  }

  return "origin";
}

// Provider detection order, most specific header first. The first rule that matches
// wins, so hosting platforms with their own request id (Vercel, Netlify) are checked
// before the CDNs that may sit in front of them, and generic signals (the `via` and
// `server` headers) come last.
//   1. vercel            x-vercel-id, x-vercel-cache
//   2. netlify           x-nf-request-id
//   3. azure-front-door  x-azure-ref, x-fd-*
//   4. bunny             cdn-cache, server: BunnyCDN
//   5. keycdn            server: keycdn-engine (x-edge-location)
//   6. akamai            x-akamai-transformed, server: AkamaiNetStorage
//   7. cloudflare        cf-ray, server: cloudflare
//   8. fastly            x-fastly-request-id, x-served-by: cache-*
//   9. cloudfront        x-amz-cf-pop, x-cache or via mentioning cloudfront
//  10. google-cloud-cdn  via: 1.1 google with x-goog-* or cache-status
//  11. gfe               server: Google Frontend, or via: 1.1 google alone
function detectCdnProvider(headers: Record<string, string>): CdnProvider {
  const has = (name: string) => headers[name] !== undefined;
  const hasPrefix = (prefix: string) => Object.keys(headers).some((n) => n.startsWith(prefix));
  const server = (headers["server"] ?? "").toLowerCase();
  const via = (headers["via"] ?? "").toLowerCase();

  if (has("x-vercel-id") || has("x-vercel-cache")) return "vercel";
  if (has("x-nf-request-id")) return "netlify";
  if (has("x-azure-ref") || hasPrefix("x-fd-")) return "azure-front-door";
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
