import { networkRequests } from "./network-requests.js";
import { getHostname } from "../utils/domain.js";
import { formatBytes } from "../utils/format.js";
import type {
  ConnectionsReport,
  HarEntry,
  HostConnections,
  HostProtocol,
  ParsedHar,
  Recommendation,
  RecommendationResource,
  ResourceType,
} from "../types.js";

// From this many requests, an HTTP/1.1 host queues them behind its six connections.
const H1_WARNING_REQUESTS = 6;
// A Cookie this big on one request to a static host is worth moving off it.
const MIN_STATIC_COOKIE_BYTES = 1_000;
// Hosts with fewer requests say little about connection reuse.
const MIN_JUDGED_REQUESTS = 3;

const STATIC_TYPES: readonly ResourceType[] = ["stylesheet", "script", "image", "font"];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * The HTTP version of a host's network requests: the one they all used, "mixed" when they used
 * several, "unknown" when the HAR does not say (requests of an unknown version are left out).
 */
export function hostProtocol(network: HarEntry[]): HostProtocol {
  const versions = new Set(
    network.map((e) => e.httpVersion ?? "unknown").filter((v) => v !== "unknown")
  );
  if (versions.size === 0) return "unknown";
  if (versions.size > 1) return "mixed";
  return [...versions][0] as HostProtocol;
}

/** Distinct connections the network requests used; null when the HAR has no connection ids. */
export function connectionCount(network: HarEntry[]): number | null {
  const ids = new Set(network.flatMap((e) => (e.connectionId ? [e.connectionId] : [])));
  return ids.size > 0 ? ids.size : null;
}

function analyzeHost(host: string, network: HarEntry[]): HostConnections {
  const connections = connectionCount(network);
  const cookies = network.map((e) => e.requestCookieBytes ?? 0);
  return {
    host,
    protocol: hostProtocol(network),
    requests: network.length,
    connections,
    requestsPerConnection:
      connections === null ? null : Math.round((network.length / connections) * 10) / 10,
    dnsLookups: network.filter((e) => e.timing.dns > 0).length,
    tcpHandshakes: network.filter((e) => e.timing.connect > 0).length,
    tlsHandshakes: network.filter((e) => e.timing.ssl > 0).length,
    advertisesHttp3: network.some((e) => e.advertisesHttp3 === true),
    staticOnly: network.every((e) => STATIC_TYPES.includes(e.resourceType)),
    cookieBytes: cookies.reduce((sum, bytes) => sum + bytes, 0),
    maxCookieBytes: Math.max(0, ...cookies),
  };
}

// ── Recommendations ──────────────────────────────────────────────────────────

const PROTOCOL_LABEL: Record<HostProtocol, string> = {
  h1: "HTTP/1.1",
  h2: "HTTP/2",
  h3: "HTTP/3",
  mixed: "mixed",
  unknown: "unknown",
};

const connectionsText = (count: number | null) =>
  count === null ? "" : ` · ${count} ${plural(count, "connection", "connections")}`;

// The network requests of each host.
type HostEntries = Map<string, HarEntry[]>;

/** A host as a recommendation resource: its origin and the bytes of its requests. */
function hostResource(
  hop: HostConnections,
  entries: HostEntries,
  detail: string
): RecommendationResource {
  const network = entries.get(hop.host) ?? [];
  let origin = `https://${hop.host}`;
  try {
    if (network[0]) origin = new URL(network[0].url).origin;
  } catch {
    // keep the https origin
  }
  return {
    url: `${origin}/`,
    transferSize: network.reduce((sum, e) => sum + e.transferSize, 0),
    detail,
  };
}

function http1Recommendation(hosts: HostConnections[], entries: HostEntries) {
  const h1 = hosts.filter((h) => h.protocol === "h1");
  if (h1.length === 0) return null;
  const busy = h1.some((h) => h.requests >= H1_WARNING_REQUESTS);
  return {
    label: "Hosts still on HTTP/1.1",
    description: `${h1.length} ${plural(h1.length, "host serves", "hosts serve")} the page over HTTP/1.1, which sends one request at a time per connection: the browser opens up to six connections per host, each with its own handshake, and queues the rest. Serve ${plural(h1.length, "it", "them")} over HTTP/2 or HTTP/3, which multiplex every request on one connection, from the server or a CDN in front of it.`,
    severity: busy ? "warning" : "info",
    resources: h1.map((h) =>
      hostResource(
        h,
        entries,
        `${h.requests} ${plural(h.requests, "request", "requests")}${connectionsText(h.connections)}`
      )
    ),
  } satisfies Recommendation;
}

function handshakesText(h: HostConnections): string {
  if (h.tcpHandshakes === 0 && h.tlsHandshakes === 0) return "";
  return ` · ${h.tcpHandshakes} TCP and ${h.tlsHandshakes} TLS ${plural(h.tlsHandshakes, "handshake", "handshakes")}`;
}

function severalConnectionsRecommendation(hosts: HostConnections[], entries: HostEntries) {
  // HTTP/1.1 needs several connections, and a host moving from HTTP/2 to HTTP/3 opens a new one.
  const split = hosts.filter(
    (h) => (h.protocol === "h2" || h.protocol === "h3") && (h.connections ?? 0) > 1
  );
  if (split.length === 0) return null;
  const paid = split.some((h) => h.tcpHandshakes > 1 || h.tlsHandshakes > 1);
  return {
    label: "Several connections to the same host",
    description: `HTTP/2 and HTTP/3 carry every request to a host on one connection, yet ${plural(split.length, "this host was", "these hosts were")} reached over several${paid ? ", each paying its own handshake" : ""}. Browsers keep anonymous requests (fonts, crossorigin scripts and fetches) apart from credentialed ones: a preconnect without crossorigin, or a mix of both kinds, opens a second connection. Match the crossorigin attribute of the preconnect to the requests, or serve the anonymous ones from another host.`,
    severity: paid ? "warning" : "info",
    resources: split.map((h) =>
      hostResource(
        h,
        entries,
        `${h.connections} ${plural(h.connections ?? 0, "connection", "connections")}${handshakesText(h)}`
      )
    ),
  } satisfies Recommendation;
}

function staticCookiesRecommendation(hosts: HostConnections[], entries: HostEntries) {
  const hit = hosts.filter((h) => h.staticOnly && h.maxCookieBytes >= MIN_STATIC_COOKIE_BYTES);
  if (hit.length === 0) return null;
  const total = hit.reduce((sum, h) => sum + h.cookieBytes, 0);
  return {
    label: "Cookies sent to static hosts",
    description: `The browser sent ${formatBytes(total)} of cookies to ${plural(hit.length, "a host", "hosts")} that only ${plural(hit.length, "serves", "serve")} stylesheets, scripts, images and fonts, which never read them: they ride on every request, upstream where bandwidth is scarcest, and can keep a CDN from caching. Serve static files from a cookieless domain, or scope the cookies to the paths that need them.`,
    severity: "info",
    resources: hit.map((h) =>
      hostResource(
        h,
        entries,
        `${formatBytes(h.cookieBytes)} of cookies over ${h.requests} ${plural(h.requests, "request", "requests")}`
      )
    ),
  } satisfies Recommendation;
}

function unusedHttp3Recommendation(hosts: HostConnections[], entries: HostEntries) {
  const unused = hosts.filter(
    (h) => h.advertisesHttp3 && (h.protocol === "h1" || h.protocol === "h2")
  );
  if (unused.length === 0) return null;
  return {
    label: "HTTP/3 advertised but not used",
    description: `${plural(unused.length, "This host advertises", "These hosts advertise")} HTTP/3 in Alt-Svc, but every request went over ${unused.every((h) => h.protocol === "h2") ? "HTTP/2" : "TCP"}. A browser learns Alt-Svc on its first visit and switches on later ones, so a cold load stays on TCP; a network that blocks UDP keeps it there for good. An HTTPS DNS record that announces h3 lets the browser use HTTP/3 from the first request.`,
    severity: "info",
    resources: unused.map((h) =>
      hostResource(h, entries, `${PROTOCOL_LABEL[h.protocol]} · Alt-Svc h3`)
    ),
  } satisfies Recommendation;
}

function goodRecommendation(hosts: HostConnections[]): Recommendation | null {
  const busy = hosts.filter((h) => h.requests >= MIN_JUDGED_REQUESTS);
  if (busy.length === 0) return null;
  const reused = busy.every(
    (h) => (h.protocol === "h2" || h.protocol === "h3") && h.connections === 1
  );
  if (!reused) return null;
  return {
    label: "Every busy host on one HTTP/2 or HTTP/3 connection",
    description: `Each host with ${MIN_JUDGED_REQUESTS} requests or more (${busy.length} ${plural(busy.length, "host", "hosts")}) served them all over a single HTTP/2 or HTTP/3 connection: one handshake per host, and requests multiplexed instead of queued.`,
    severity: "good",
  };
}

/**
 * How the page's network requests reached each host: the HTTP version, the connections opened
 * and the handshakes paid, HTTP/3 advertised and not used, and the cookies sent to hosts that
 * only serve static files, plus the document's Server-Timing, with a recommendation for each
 * finding.
 */
export function analyzeConnections(har: ParsedHar): ConnectionsReport {
  const entries: HostEntries = new Map();
  for (const entry of networkRequests(har)) {
    const host = getHostname(entry.url);
    if (host === null) continue;
    entries.set(host, [...(entries.get(host) ?? []), entry]);
  }
  const hosts = [...entries]
    .map(([host, network]) => analyzeHost(host, network))
    .sort((a, b) => b.requests - a.requests);

  const findings = [
    http1Recommendation(hosts, entries),
    severalConnectionsRecommendation(hosts, entries),
    staticCookiesRecommendation(hosts, entries),
    unusedHttp3Recommendation(hosts, entries),
  ].filter((rec): rec is NonNullable<typeof rec> => rec !== null);
  const good = findings.length === 0 ? goodRecommendation(hosts) : null;

  return {
    hosts,
    serverTiming: har.documentEntry.serverTiming ?? [],
    recommendations: good ? [good] : findings,
  };
}
