import { getRootDomain } from "../utils/domain.js";
import { formatBytes, formatMs } from "../utils/format.js";
import {
  documentTiming,
  harEntryFor,
  harsherSeverity,
  milderSeverity,
  resourceTypeOf,
  severityFor,
  traceRequestFor,
  type ProblemSeverity,
} from "./render-timing.js";
import type {
  CriticalChain,
  CriticalChainRequest,
  HarEntry,
  ParsedHar,
  ParsedTrace,
  Recommendation,
  RenderBlockingReport,
  RenderBlockingResource,
  ResourceType,
  TraceRequest,
} from "../types.js";

// web.dev FCP thresholds.
const FCP_GOOD_MS = 1800;
const FCP_POOR_MS = 3000;
// How long blocking resources may hold the first paint before it is a warning, or critical.
const HELD_INFO_MS = 300;
const HELD_WARNING_MS = 1000;
// A critical chain this deep (document included), or this long, is worth shortening.
const LONG_CHAIN_DEPTH = 3;
const LONG_CHAIN_MS = 1000;
const DEEP_CHAIN_DEPTH = 4;

// Statuses Chrome gives requests that hold the first paint. "in_body_parser_blocking" counts
// only with a high enough priority, as in DevTools' render-blocking insight: a script low in
// the body that gets a low priority does not hold the first paint.
const BLOCKING_STATUSES = new Set(["blocking", "in_body_parser_blocking", "potentially_blocking"]);
// What a critical request can load in turn: stylesheets (@import), scripts and fonts.
const CHAIN_TYPES = new Set<ResourceType>(["stylesheet", "script", "font"]);
const HIGH_PRIORITIES = new Set(["VeryHigh", "High"]);

// A request as the render analysis sees it: timed by the trace when it has the request, else
// by the HAR.
interface PageRequest {
  url: string;
  resourceType: ResourceType;
  sentAtMs: number;
  startMs: number;
  endMs: number;
  transferSize: number;
  priority: string | undefined;
  parentUrl: string | undefined; // the initiator's URL
}

function pageRequest(har: ParsedHar, trace: ParsedTrace | undefined, url: string): PageRequest {
  const entry = harEntryFor(har, url);
  const request = traceRequestFor(trace, url);
  return describe(entry, request, url);
}

function describe(entry: HarEntry | null, request: TraceRequest | null, url: string): PageRequest {
  const harStart = entry?.startTime ?? 0;
  const startMs = request ? (request.startMs ?? request.sentAtMs) : harStart;
  return {
    url,
    resourceType: resourceTypeOf(entry, request),
    sentAtMs: request ? request.sentAtMs : harStart,
    startMs,
    endMs: request
      ? (request.endMs ?? request.responseEndMs ?? startMs)
      : harStart + (entry?.duration ?? 0),
    transferSize: entry?.transferSize ?? request?.encodedDataLength ?? 0,
    priority: entry?.priority ?? request?.priority,
    parentUrl: entry?.initiator?.url ?? request?.initiator?.url,
  };
}

function isTraceBlocking(request: TraceRequest): boolean {
  const status = request.renderBlocking;
  if (status === undefined || !BLOCKING_STATUSES.has(status)) return false;
  if (status !== "in_body_parser_blocking") return true;
  const blockingScript = request.resourceType === "Script" && request.priority === "High";
  return request.priority === "VeryHigh" || blockingScript;
}

// The HAR's view, without the trace: a stylesheet the HTML references with the highest
// priority (not a print or media-specific one), or a synchronous script in the HTML (async and
// deferred scripts get a low priority).
function isHarBlocking(entry: HarEntry, documentUrl: string): boolean {
  if (entry.initiator?.type !== "parser" || entry.initiator.url !== documentUrl) return false;
  if (entry.resourceType === "stylesheet") return entry.priority === "VeryHigh";
  if (entry.resourceType === "script") return HIGH_PRIORITIES.has(entry.priority ?? "");
  return false;
}

/** The blocking requests and where their status comes from. */
function findBlocking(
  har: ParsedHar,
  trace: ParsedTrace | undefined
): { source: RenderBlockingReport["source"]; blocking: { url: string; status: string }[] } {
  const documentUrl = har.documentEntry.url;
  const traced = (trace?.requests ?? []).filter((r) => r.renderBlocking !== undefined);
  if (traced.length > 0) {
    const blocking = traced
      .filter((r) => r.resourceType !== "Document" && r.url !== documentUrl && isTraceBlocking(r))
      .map((r) => ({ url: r.url, status: r.renderBlocking! }));
    return { source: "trace", blocking };
  }
  if (har.entries.some((e) => e.initiator !== undefined)) {
    const blocking = har.entries
      .filter((e) => e !== har.documentEntry && isHarBlocking(e, documentUrl))
      .map((e) => ({ url: e.url, status: "inferred" }));
    return { source: "har", blocking };
  }
  return { source: "none", blocking: [] };
}

const uniqueByUrl = <T extends { url: string }>(items: T[]) =>
  items.filter((item, i) => items.findIndex((other) => other.url === item.url) === i);

/**
 * The critical request tree from the document: the blocking requests with the requests that
 * led to them, and what they loaded in turn before FCP with a high priority (fonts of a
 * stylesheet, scripts a script injected). Each root-to-leaf path is one chain.
 */
function buildChains(
  har: ParsedHar,
  trace: ParsedTrace | undefined,
  documentRequest: PageRequest,
  blocking: PageRequest[],
  fcpMs: number | null
): CriticalChain[] {
  const documentUrl = documentRequest.url;
  const allUrls = uniqueByUrl([...har.entries, ...(trace?.requests ?? [])]).map((r) => r.url);
  const requests = new Map<string, PageRequest>(
    allUrls.map((url) => [
      url,
      url === documentUrl ? documentRequest : pageRequest(har, trace, url),
    ])
  );

  // Who loaded whom: a request whose initiator is unknown hangs from the document.
  const parentOf = (request: PageRequest) =>
    request.parentUrl !== undefined &&
    requests.has(request.parentUrl) &&
    request.parentUrl !== request.url
      ? request.parentUrl
      : documentUrl;

  const critical = new Set<string>([documentUrl]);
  for (const request of blocking) {
    // The blocking request and the requests that led to it.
    const seen = new Set<string>();
    for (let url = request.url; !critical.has(url) && !seen.has(url);) {
      seen.add(url);
      critical.add(url);
      url = parentOf(requests.get(url) ?? request);
    }
  }
  const beforeFcp = (r: PageRequest) => fcpMs === null || r.sentAtMs < fcpMs;
  const loadsCritically = (r: PageRequest) =>
    CHAIN_TYPES.has(r.resourceType) && HIGH_PRIORITIES.has(r.priority ?? "") && beforeFcp(r);
  for (let added = true; added;) {
    added = false;
    for (const request of requests.values()) {
      if (critical.has(request.url) || request.url === documentUrl) continue;
      if (
        critical.has(parentOf(request)) &&
        parentOf(request) !== documentUrl &&
        loadsCritically(request)
      ) {
        critical.add(request.url);
        added = true;
      }
    }
  }

  const children = new Map<string, PageRequest[]>();
  for (const url of critical) {
    if (url === documentUrl) continue;
    const request = requests.get(url)!;
    const parent = parentOf(request);
    children.set(parent, [...(children.get(parent) ?? []), request]);
  }

  const chains: CriticalChain[] = [];
  const walk = (path: PageRequest[]) => {
    const last = path[path.length - 1];
    const next = (children.get(last.url) ?? []).filter((c) => !path.includes(c));
    if (next.length === 0) {
      if (path.length > 1) chains.push(toChain(path));
      return;
    }
    for (const child of next.sort((a, b) => a.startMs - b.startMs)) walk([...path, child]);
  };
  walk([documentRequest]);
  return chains.sort((a, b) => b.depth - a.depth || b.durationMs - a.durationMs);
}

function toChain(path: PageRequest[]): CriticalChain {
  const requests: CriticalChainRequest[] = path.map(
    ({ url, resourceType, startMs, endMs, transferSize }) => ({
      url,
      resourceType,
      startMs,
      endMs,
      transferSize,
    })
  );
  return {
    requests,
    depth: requests.length,
    durationMs: requests[requests.length - 1].endMs - requests[0].startMs,
    transferSize: requests.reduce((sum, r) => sum + r.transferSize, 0),
  };
}

/**
 * The blocking requests that held the first paint: requested before FCP, fonts aside, in the
 * order they were sent. Looks each URL up once, so that it stays fast on large recordings.
 */
function heldFirstPaint(
  har: ParsedHar,
  trace: ParsedTrace | undefined
): {
  source: RenderBlockingReport["source"];
  requests: { request: PageRequest; status: string }[];
} {
  const fcpMs = trace?.fcp ?? null;
  const { source, blocking } = findBlocking(har, trace);
  const entries = firstByUrl(har.entries);
  const traced = firstByUrl(trace?.requests ?? []);
  const requests = blocking
    .map(({ url, status }) => ({
      request: describe(entries.get(url) ?? null, traced.get(url) ?? null, url),
      status,
    }))
    .filter(({ request }) => request.resourceType !== "font")
    .filter(({ request }) => fcpMs === null || request.sentAtMs < fcpMs)
    .sort((a, b) => a.request.sentAtMs - b.request.sentAtMs);
  return { source, requests };
}

function firstByUrl<T extends { url: string }>(items: T[]): Map<string, T> {
  const byUrl = new Map<string, T>();
  for (const item of items) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  return byUrl;
}

/** The URLs of the resources that held the first paint (see analyzeRenderBlocking). */
export function renderBlockingUrls(har: ParsedHar, trace: ParsedTrace | undefined): Set<string> {
  return new Set(heldFirstPaint(har, trace).requests.map(({ request }) => request.url));
}

/**
 * The resources that held the first paint, from the trace's render-blocking status (the HAR's
 * initiators and priorities without it): requested before FCP, fonts aside (whether a font
 * blocks depends on font-display, which neither records). With how long they held the first
 * paint after the document arrived, and the critical request chains that lead to them.
 */
export function analyzeRenderBlocking(
  har: ParsedHar,
  trace: ParsedTrace | undefined
): RenderBlockingReport {
  const fcpMs = trace?.fcp ?? null;
  const documentRoot = getRootDomain(har.documentEntry.url);
  const docTiming = documentTiming(har, trace);
  const documentRequest: PageRequest = {
    ...pageRequest(har, trace, har.documentEntry.url),
    startMs: docTiming.startMs,
    endMs: docTiming.endMs,
  };

  const { source, requests: blockingRequests } = heldFirstPaint(har, trace);

  const resources: RenderBlockingResource[] = uniqueByUrl(
    blockingRequests.map(({ request, status }) => ({
      url: request.url,
      resourceType: request.resourceType,
      transferSize: request.transferSize,
      startMs: request.startMs,
      endMs: request.endMs,
      status,
      thirdParty: getRootDomain(request.url) !== documentRoot,
    }))
  );

  const lastEnd = Math.max(...resources.map((r) => r.endMs));
  const heldMs =
    resources.length === 0 ? 0 : Math.max(0, Math.min(lastEnd, fcpMs ?? lastEnd) - docTiming.endMs);

  return {
    source,
    fcpMs,
    documentEndMs: docTiming.endMs,
    resources,
    totalBytes: resources.reduce((sum, r) => sum + r.transferSize, 0),
    heldMs,
    chains: buildChains(
      har,
      trace,
      documentRequest,
      blockingRequests.map(({ request }) => request),
      fcpMs
    ),
  };
}

const isLongChain = (chain: CriticalChain) =>
  chain.depth >= LONG_CHAIN_DEPTH || chain.durationMs > LONG_CHAIN_MS;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * What the render-blocking analysis suggests fixing: resources that block the first paint
 * beyond one stylesheet (rated by FCP and by how long they held it: the milder of the two), a
 * long critical request chain, and third-party scripts that block rendering. "good" when
 * nothing beyond the document and one stylesheet blocks it and no chain is long.
 */
export function renderBlockingRecommendations(report: RenderBlockingReport): Recommendation[] {
  if (report.source === "none") return [];
  const { resources, chains, fcpMs, heldMs } = report;
  const stylesheets = resources.filter((r) => r.resourceType === "stylesheet");
  const minimal = stylesheets.length <= 1 && stylesheets.length === resources.length;
  const longChains = chains.filter(isLongChain);
  const fcpSeverity: ProblemSeverity | null =
    fcpMs === null ? null : severityFor(fcpMs, FCP_GOOD_MS, FCP_POOR_MS);
  const recommendations: Recommendation[] = [];

  if (!minimal) {
    const heldSeverity = severityFor(heldMs, HELD_INFO_MS, HELD_WARNING_MS);
    const scripts = resources.filter((r) => r.resourceType === "script").length;
    recommendations.push({
      label: "Render-blocking resources delay FCP",
      description: `${resources.length} ${plural(resources.length, "resource blocks", "resources block")} the first paint (${formatBytes(report.totalBytes)}), holding it ${formatMs(heldMs)} after the document arrived. ${
        scripts > 0
          ? "Add defer or async to the scripts, or move them to the end of the body; "
          : ""
      }Inline the critical CSS and load the rest without blocking (media queries, or a preload swapped to a stylesheet once loaded).`,
      severity: fcpSeverity === null ? heldSeverity : milderSeverity(fcpSeverity, heldSeverity),
      resources: resources.map(({ url, transferSize }) => ({ url, transferSize })),
    });
  }

  const thirdPartyScripts = resources.filter((r) => r.thirdParty && r.resourceType === "script");
  if (thirdPartyScripts.length > 0) {
    recommendations.push({
      label: "Third-party script blocks rendering",
      description:
        "The first paint waits for a script from another domain: its connection setup, latency and outages hold the page. Load it with async or defer, or self-host it.",
      severity: fcpSeverity === null ? "warning" : harsherSeverity("warning", fcpSeverity),
      resources: thirdPartyScripts.map(({ url, transferSize }) => ({ url, transferSize })),
    });
  }

  if (longChains.length > 0) {
    const longest = Math.max(...longChains.map((c) => c.durationMs));
    const deepest = Math.max(...longChains.map((c) => c.depth));
    const severity: ProblemSeverity =
      longest > FCP_POOR_MS
        ? "critical"
        : longest > LONG_CHAIN_MS || deepest >= DEEP_CHAIN_DEPTH
          ? "warning"
          : "info";
    recommendations.push({
      label: "Long critical request chain",
      description: `The longest critical chain is ${deepest} requests deep and takes ${formatMs(longest)}: each request is found only once the previous one arrives. Preload the requests at the end of the chain (fonts, imported stylesheets, injected scripts) or reference them from the HTML.`,
      severity,
      resources: uniqueByUrl(longChains.map((c) => c.requests[c.requests.length - 1])).map(
        ({ url, transferSize }) => ({ url, transferSize })
      ),
    });
  }

  if (minimal && longChains.length === 0) {
    recommendations.push({
      label: "Render-blocking resources are minimal",
      description:
        resources.length === 0
          ? "Nothing but the document blocks the first paint."
          : "Only the document and one stylesheet block the first paint.",
      severity: "good",
    });
  }
  return recommendations;
}
