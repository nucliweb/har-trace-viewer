import type {
  HarEntry,
  ParsedHar,
  ParsedTrace,
  Recommendation,
  ResourceType,
  TraceRequest,
} from "../types.js";

// Shared by the LCP attribution and the render-blocking analysis. Trace times count from
// navigationStart and HAR times from the page origin: both mark the start of the same
// navigation, so the two scales are compared directly (as the steps do).

export type ProblemSeverity = Exclude<Recommendation["severity"], "good">;

const SEVERITY_RANK: Record<ProblemSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** "info" up to `good`, "warning" up to `poor`, "critical" beyond. */
export function severityFor(value: number, good: number, poor: number): ProblemSeverity {
  if (value <= good) return "info";
  return value <= poor ? "warning" : "critical";
}

export const milderSeverity = (a: ProblemSeverity, b: ProblemSeverity): ProblemSeverity =>
  SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;

export const harsherSeverity = (a: ProblemSeverity, b: ProblemSeverity): ProblemSeverity =>
  SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;

/** The first trace request for a URL. */
export function traceRequestFor(trace: ParsedTrace | undefined, url: string): TraceRequest | null {
  return trace?.requests?.find((r) => r.url === url) ?? null;
}

/** The first HAR entry for a URL. */
export function harEntryFor(har: ParsedHar, url: string): HarEntry | null {
  return har.entries.find((e) => e.url === url) ?? null;
}

/** When a HAR request started, got its first response byte and ended. */
export function harRequestTiming(entry: HarEntry): {
  requestedAtMs: number;
  respondedAtMs: number;
  endMs: number;
} {
  const { blocked, dns, connect, send, wait } = entry.timing;
  // HAR counts TLS inside connect.
  const requestedAtMs = entry.startTime + blocked + dns + connect;
  return {
    requestedAtMs,
    respondedAtMs: requestedAtMs + send + wait,
    endMs: entry.startTime + entry.duration,
  };
}

export interface DocumentTiming {
  startMs: number;
  responseStartMs: number; // first byte: the TTFB of the LCP breakdown
  endMs: number;
}

/** The document request's start, first byte and end: from the trace, else from the HAR. */
export function documentTiming(har: ParsedHar, trace: ParsedTrace | undefined): DocumentTiming {
  const entry = har.documentEntry;
  const fromHar = harRequestTiming(entry);
  const request = trace?.requests?.find(
    (r) => r.resourceType === "Document" && r.url === entry.url
  );
  const responseStart = request?.responseStartMs ?? request?.responseEndMs;
  if (request?.startMs !== undefined && responseStart !== undefined) {
    return {
      startMs: request.startMs,
      responseStartMs: responseStart,
      endMs: request.endMs ?? responseStart,
    };
  }
  return { startMs: entry.startTime, responseStartMs: fromHar.respondedAtMs, endMs: fromHar.endMs };
}

const TRACE_RESOURCE_TYPES: Record<string, ResourceType> = {
  Document: "document",
  Stylesheet: "stylesheet",
  Script: "script",
  Image: "image",
  Font: "font",
  Fetch: "fetch",
  XHR: "fetch",
};

/** The resource type of a request: the HAR's, else the trace's. */
export function resourceTypeOf(entry: HarEntry | null, request: TraceRequest | null): ResourceType {
  if (entry) return entry.resourceType;
  return TRACE_RESOURCE_TYPES[request?.resourceType ?? ""] ?? "other";
}

// Splits a Link header on the commas between links (a comma followed by "<").
function linkHeaderTargets(linkHeader: string, rel: string, base: string): string[] {
  const targets: string[] = [];
  for (const link of linkHeader.split(/,(?=\s*<)/)) {
    const url = link.match(/<([^>]+)>/)?.[1];
    const rels =
      link
        .match(/;\s*rel\s*=\s*"?([^";]+)"?/i)?.[1]
        .toLowerCase()
        .split(/\s+/) ?? [];
    if (!url || !rels.includes(rel)) continue;
    try {
      targets.push(new URL(url, base).href);
    } catch {
      // malformed URL: skip
    }
  }
  return targets;
}

/** The URLs the document's Link header and its Early Hints (103) ask to preload. */
export function linkPreloadedUrls(har: ParsedHar): Set<string> {
  const base = har.documentEntry.url;
  const headers = [
    har.documentEntry.responseHeaders["link"],
    ...har.entries.filter((e) => e.status === 103).map((e) => e.responseHeaders["link"]),
  ];
  return new Set(headers.flatMap((h) => (h ? linkHeaderTargets(h, "preload", base) : [])));
}
