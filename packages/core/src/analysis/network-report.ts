import { isBeacon } from "./host-ttfb.js";
import { networkRequests } from "./network-requests.js";
import { formatBytes, formatMs } from "../utils/format.js";
import type {
  DuplicateRequest,
  FailedRequest,
  HarEntry,
  MixedContentRequest,
  NetworkReport,
  ParsedHar,
  Recommendation,
  RecommendationResource,
  RedirectHop,
} from "../types.js";

// A document redirect chain this long, or this slow, is critical.
const CRITICAL_REDIRECT_HOPS = 2;
const CRITICAL_REDIRECT_DELAY_MS = 500;
// From this many resource redirects on, they are a warning rather than a note.
const RESOURCE_REDIRECT_WARNING = 3;

const isRedirect = (entry: HarEntry) => entry.status >= 300 && entry.status < 400;
const sameRequest = (a: HarEntry, b: HarEntry) => a.url === b.url && a.startTime === b.startTime;
const withoutFragment = (url: string) => url.split("#")[0];
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * Whether a network request downloaded a response the browser could have reused: a GET
 * answered with content or an error. 304 revalidations (a cache finding), redirects (reported
 * apart), requests that got no response (status 0) and beacons, which report rather than
 * download, are left out.
 */
function isDownload(entry: HarEntry): boolean {
  const answered = (entry.status >= 200 && entry.status < 300) || entry.status >= 400;
  return (entry.method ?? "GET").toUpperCase() === "GET" && !isBeacon(entry) && answered;
}

function findDuplicates(network: HarEntry[]): DuplicateRequest[] {
  const byUrl = new Map<string, HarEntry[]>();
  for (const entry of network.filter(isDownload)) {
    const url = withoutFragment(entry.url);
    byUrl.set(url, [...(byUrl.get(url) ?? []), entry]);
  }
  return [...byUrl]
    .filter(([, fetches]) => fetches.length > 1)
    .map(([url, fetches]) => {
      const [, ...repeats] = [...fetches].sort((a, b) => a.startTime - b.startTime);
      return {
        url,
        fetches: fetches.length,
        wastedBytes: repeats.reduce((sum, e) => sum + e.transferSize, 0),
        cacheBypassed: repeats.every((e) => e.bypassesCache === true),
      };
    })
    .sort((a, b) => b.wastedBytes - a.wastedBytes);
}

function documentRedirectHops(har: ParsedHar): NetworkReport["documentRedirects"] {
  const redirects = har.documentRedirects ?? [];
  if (redirects.length === 0) return { hops: [], delayMs: 0 };
  const chain = [...redirects, har.documentEntry];
  const hops = redirects.map((entry, i) => ({
    url: entry.url,
    status: entry.status,
    target: entry.redirectURL ?? chain[i + 1].url,
    costMs: chain[i + 1].startTime - entry.startTime,
  }));
  return { hops, delayMs: har.documentEntry.startTime - redirects[0].startTime };
}

function resourceRedirectHops(har: ParsedHar): NetworkReport["resourceRedirects"] {
  const documentChain = har.documentRedirects ?? [];
  const hops: RedirectHop[] = [];
  har.entries.forEach((entry, index) => {
    const target = entry.redirectURL;
    if (!target || !isRedirect(entry) || entry.fromCache !== false) return;
    if (documentChain.some((hop) => sameRequest(hop, entry))) return;
    const next = har.entries.find((e, i) => i > index && e.url === target);
    if (!next) return;
    hops.push({
      url: entry.url,
      status: entry.status,
      target,
      costMs: next.startTime - entry.startTime,
    });
  });
  return { hops, totalMs: hops.reduce((sum, hop) => sum + hop.costMs, 0) };
}

function failedRequests(network: HarEntry[]): FailedRequest[] {
  return network
    .filter((e) => e.status >= 400 && e.status < 600)
    .map(({ url, status, resourceType, transferSize }) => ({
      url,
      status,
      resourceType,
      transferSize,
    }));
}

function mixedContent(har: ParsedHar): MixedContentRequest[] {
  if (!har.documentEntry.url.startsWith("https:")) return [];
  const documentChain = har.documentRedirects ?? [];
  const seen = new Set<string>();
  const result: MixedContentRequest[] = [];
  for (const entry of har.entries) {
    if (!entry.url.startsWith("http:") || seen.has(entry.url)) continue;
    if (documentChain.some((hop) => sameRequest(hop, entry))) continue;
    seen.add(entry.url);
    result.push({
      url: entry.url,
      resourceType: entry.resourceType,
      transferSize: entry.transferSize,
    });
  }
  return result;
}

// ── Recommendations ──────────────────────────────────────────────────────────

const hopDetail = (hop: RedirectHop) => `${hop.status} → ${hop.target} · ${formatMs(hop.costMs)}`;

function hopResources(hops: RedirectHop[], har: ParsedHar): RecommendationResource[] {
  return hops.map((hop) => ({
    url: hop.url,
    transferSize: har.entries.find((e) => e.url === hop.url && isRedirect(e))?.transferSize ?? 0,
    detail: hopDetail(hop),
  }));
}

function documentRedirectRecommendation(
  har: ParsedHar,
  { hops, delayMs }: NetworkReport["documentRedirects"]
): Recommendation | null {
  if (hops.length === 0) return null;
  const count = hops.length;
  const final = har.documentEntry.url;
  const critical = count >= CRITICAL_REDIRECT_HOPS || delayMs >= CRITICAL_REDIRECT_DELAY_MS;
  return {
    label: `The document is behind ${count === 1 ? "a redirect" : `${count} redirects`}`,
    description: `The navigation followed ${count} ${plural(count, "redirect", "redirects")} before it requested the document, which delayed it by ${formatMs(delayMs)}: each one is a round trip, often on a new connection, before the browser can start on the page. Link to ${final} directly${count > 1 ? ", and redirect old URLs to it in a single hop" : ""}.`,
    severity: critical ? "critical" : "warning",
    resources: hopResources(hops, har),
  };
}

const failedResources = (errors: FailedRequest[]): RecommendationResource[] =>
  errors.map((e) => ({ url: e.url, transferSize: e.transferSize, detail: String(e.status) }));

function errorRecommendations(errors: FailedRequest[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const server = errors.filter((e) => e.status >= 500);
  const client = errors.filter((e) => e.status < 500);
  if (server.length > 0) {
    recs.push({
      label: `${server.length} server ${plural(server.length, "error", "errors")} (5xx)`,
      description:
        "The server failed to answer these requests: what they should have loaded is missing from the page, and the features that depend on a failing API may break. Look for them in the server logs.",
      severity: "critical",
      resources: failedResources(server),
    });
  }
  if (client.length > 0) {
    recs.push({
      label: `${client.length} ${plural(client.length, "request", "requests")} failed (4xx)`,
      description:
        "These URLs do not exist or were refused: each one cost the browser a request that brought nothing the page can use. Fix the URLs, or remove the references to them.",
      severity: "warning",
      resources: failedResources(client),
    });
  }
  return recs;
}

function mixedContentRecommendation(requests: MixedContentRequest[]): Recommendation | null {
  if (requests.length === 0) return null;
  const count = requests.length;
  return {
    label: `${count} insecure ${plural(count, "request", "requests")} on an HTTPS page`,
    description:
      "The page is served over HTTPS but loads these resources over plain http://. Browsers block insecure scripts, stylesheets and frames, upgrade or flag images and media, and anyone on the network can read or change them. Serve them over https://.",
    severity: "warning",
    resources: requests.map((r) => ({
      url: r.url,
      transferSize: r.transferSize,
      detail: r.resourceType,
    })),
  };
}

function duplicateRecommendation(duplicates: DuplicateRequest[]): Recommendation | null {
  if (duplicates.length === 0) return null;
  const count = duplicates.length;
  const wasted = duplicates.reduce((sum, d) => sum + d.wastedBytes, 0);
  const bypassed = duplicates.filter((d) => d.cacheBypassed).length;
  const recording =
    bypassed === 0
      ? ""
      : ` ${bypassed === count ? "The repeated fetches" : `The repeated fetches of ${bypassed} of them`} asked to bypass the browser cache, as DevTools' "Disable cache" and a hard reload do, which keeps the browser from reusing a prefetched or earlier response: record the page again with the cache on to see whether they still happen.`;
  return {
    label: `${count} ${plural(count, "resource", "resources")} downloaded more than once`,
    description: `The page fetched ${plural(count, "this URL", "these URLs")} over the network more than once, downloading ${formatBytes(wasted)} again. A <link rel=preload> or prefetch whose as, crossorigin or credentials does not match the request that uses it is fetched twice, and so is a response the HTTP cache cannot reuse (no-store, an expired lifetime). Make the hint match the request, or let the response be cached.${recording}`,
    severity: bypassed === count ? "info" : "warning",
    resources: duplicates.map((d) => ({
      url: d.url,
      transferSize: d.wastedBytes,
      detail: `fetched ${d.fetches}×`,
    })),
  };
}

function resourceRedirectRecommendation(
  har: ParsedHar,
  { hops, totalMs }: NetworkReport["resourceRedirects"]
): Recommendation | null {
  if (hops.length === 0) return null;
  const count = hops.length;
  return {
    label: `${count} resource ${plural(count, "redirect", "redirects")}`,
    description: `${count} ${plural(count, "resource was", "resources were")} requested at a URL that redirects, which added ${formatMs(totalMs)} of round trips before ${plural(count, "it", "they")} could load. Reference the final ${plural(count, "URL", "URLs")} instead.`,
    severity: count >= RESOURCE_REDIRECT_WARNING ? "warning" : "info",
    resources: hopResources(hops, har),
  };
}

/**
 * What the page's requests did wrong on the network: URLs downloaded more than once, the
 * redirects in front of the document and of other resources, 4xx and 5xx responses, and
 * http:// resources of an https:// page, with a recommendation for each kind of finding.
 */
export function analyzeNetwork(har: ParsedHar): NetworkReport {
  const network = networkRequests(har);
  const duplicates = findDuplicates(network);
  const documentRedirects = documentRedirectHops(har);
  const resourceRedirects = resourceRedirectHops(har);
  const errors = failedRequests(network);
  const mixed = mixedContent(har);

  const recommendations = [
    documentRedirectRecommendation(har, documentRedirects),
    ...errorRecommendations(errors),
    mixedContentRecommendation(mixed),
    duplicateRecommendation(duplicates),
    resourceRedirectRecommendation(har, resourceRedirects),
  ].filter((rec): rec is Recommendation => rec !== null);

  return {
    duplicates,
    documentRedirects,
    resourceRedirects,
    errors,
    mixedContent: mixed,
    recommendations,
  };
}
