import { getRootDomain } from "../utils/domain.js";
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

  const names: Record<Exclude<CdnProvider, "unknown">, string> = {
    akamai: "Akamai Edge",
    cloudflare: "Cloudflare",
    fastly: "Fastly CDN",
    cloudfront: "CloudFront",
    gfe: "Google GFE",
  };

  return {
    type: "edge",
    name: names[cdnProvider],
    cdnProvider,
  };
}

// Returns the geographic region of the CDN PoP from response headers.
// Cloudflare and CloudFront expose the PoP code directly; other CDNs fall back
// to the provided `fallback` region (caller supplies context-derived default).
export function detectCdnRegion(
  responseHeaders: Record<string, string>,
  fallback: NetworkRegion = "edge"
): NetworkRegion {
  const cfRay = responseHeaders["cf-ray"];
  if (cfRay) {
    const pop = cfRay.split("-").pop()?.toLowerCase() ?? "";
    return popToRegion(pop) ?? fallback;
  }

  const cfPop = responseHeaders["x-amz-cf-pop"];
  if (cfPop) {
    const pop = cfPop.slice(0, 3).toLowerCase();
    return popToRegion(pop) ?? fallback;
  }

  return fallback;
}

// Returns a human-readable PoP city for the CDN edge node, if detectable.
// For Akamai serving a client behind the Great Firewall, falls back to "Hong Kong"
// since HK is the canonical APAC PoP for China-routed requests.
export function detectCdnPopCity(
  responseHeaders: Record<string, string>,
  cdnProvider: CdnProvider,
  behindGfw: boolean
): string | null {
  const cfRay = responseHeaders["cf-ray"];
  if (cfRay) {
    const pop = cfRay.split("-").pop()?.toLowerCase() ?? "";
    return POP_CITIES[pop] ?? null;
  }

  const cfPop = responseHeaders["x-amz-cf-pop"];
  if (cfPop) {
    const pop = cfPop.slice(0, 3).toLowerCase();
    return POP_CITIES[pop] ?? null;
  }

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
    const prefix = vercelId.split("::")[0].replace(/-\d+$/, "").toLowerCase().slice(0, 3);
    const region = popToRegion(prefix);
    return region ?? "united-states";
  }

  const flyId = headers["fly-request-id"];
  if (flyId) {
    const pop = flyId.split("-")[1]?.toLowerCase().slice(0, 3);
    if (pop) return popToRegion(pop) ?? "origin";
  }

  if (headers["x-amz-request-id"] || headers["x-amz-id-2"]) {
    return "united-states";
  }

  return "origin";
}

// Detects the dominant geographic region of a set of third-party entries.
// Priority: azure-cloud > europe > united-states > asia-pacific > origin.
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

  return "origin";
}

function detectCdnProvider(headers: Record<string, string>): CdnProvider {
  if (headers["x-akamai-transformed"] !== undefined) return "akamai";
  if (headers["cf-ray"] !== undefined) return "cloudflare";
  if (headers["x-fastly-request-id"] !== undefined) return "fastly";
  if (headers["x-amz-cf-pop"] !== undefined) return "cloudfront";

  const server = headers["server"] ?? "";
  const via = headers["via"] ?? "";
  if (server.toLowerCase().includes("google frontend") || via.toLowerCase().includes("google")) {
    return "gfe";
  }

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

const APAC_POPS = new Set([
  "hkg",
  "nrt",
  "hnd",
  "kix",
  "icn",
  "sin",
  "cgk",
  "bom",
  "bkk",
  "mnl",
  "syd",
  "mel",
  "per",
  "akl",
  "tpe",
  "tsa",
  "hel",
  "pvg",
]);
const EUROPE_POPS = new Set([
  "lhr",
  "ams",
  "fra",
  "cdg",
  "mad",
  "mxp",
  "waw",
  "vie",
  "arn",
  "cph",
  "dub",
  "prg",
  "bud",
  "sof",
  "ath",
  "otp",
  "bcn",
  "muc",
  "ham",
]);
const US_POPS = new Set([
  "iad",
  "dca",
  "ewr",
  "jfk",
  "bos",
  "ord",
  "dfw",
  "atl",
  "mia",
  "phx",
  "sjc",
  "sfo",
  "lax",
  "sea",
  "pdx",
  "den",
  "msp",
  "yyz",
  "yul",
]);

function popToRegion(pop: string): NetworkRegion | null {
  if (APAC_POPS.has(pop)) return "asia-pacific";
  if (EUROPE_POPS.has(pop)) return "europe";
  if (US_POPS.has(pop)) return "united-states";
  return null;
}

const POP_CITIES: Record<string, string> = {
  hkg: "Hong Kong",
  hnd: "Tokyo",
  nrt: "Tokyo",
  kix: "Osaka",
  icn: "Seoul",
  sin: "Singapore",
  cgk: "Jakarta",
  bom: "Mumbai",
  bkk: "Bangkok",
  mnl: "Manila",
  syd: "Sydney",
  mel: "Melbourne",
  per: "Perth",
  akl: "Auckland",
  tpe: "Taipei",
  pvg: "Shanghai",
  lhr: "London",
  ams: "Amsterdam",
  fra: "Frankfurt",
  cdg: "Paris",
  mad: "Madrid",
  mxp: "Milan",
  waw: "Warsaw",
  vie: "Vienna",
  arn: "Stockholm",
  cph: "Copenhagen",
  dub: "Dublin",
  prg: "Prague",
  bud: "Budapest",
  bcn: "Barcelona",
  muc: "Munich",
  ham: "Hamburg",
  iad: "Washington DC",
  dca: "Washington DC",
  ewr: "Newark",
  jfk: "New York",
  bos: "Boston",
  ord: "Chicago",
  dfw: "Dallas",
  atl: "Atlanta",
  mia: "Miami",
  phx: "Phoenix",
  sjc: "San Jose",
  sfo: "San Francisco",
  lax: "Los Angeles",
  sea: "Seattle",
  pdx: "Portland",
  den: "Denver",
};

export function hasThirdParties(entries: { url: string }[], documentUrl: string): boolean {
  const documentRoot = getRootDomain(documentUrl);
  return entries.some((e) => getRootDomain(e.url) !== documentRoot);
}
