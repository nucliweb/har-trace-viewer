import { getHostname, getRootDomain } from "../utils/domain.js";
import { shortUrl } from "../utils/format.js";
import { renderBlockingUrls } from "./critical-path.js";
import { documentTiming } from "./render-timing.js";
import { matchesResourceQuery, parseResourceQuery } from "./resource-query.js";
import type {
  HarEntry,
  ParsedHar,
  ParsedTrace,
  ResourcePriority,
  ResourceSort,
  ResourceType,
  Waterfall,
  WaterfallAxis,
  WaterfallFilter,
  WaterfallMarks,
  WaterfallPhases,
  WaterfallRow,
} from "../types.js";

export interface WaterfallOptions {
  filter?: WaterfallFilter;
}

function phasesOf(entry: HarEntry): WaterfallPhases {
  const { timing } = entry;
  const skipped = new Set(timing.notApplicable ?? []);
  const optional = (phase: "blocked" | "dns" | "connect" | "ssl", ms: number) =>
    skipped.has(phase) ? null : ms;
  return {
    blocked: optional("blocked", timing.blocked),
    dns: optional("dns", timing.dns),
    // The HAR counts the TLS handshake inside connect: the bar draws them one after the other.
    connect: optional("connect", Math.max(0, timing.connect - timing.ssl)),
    ssl: optional("ssl", timing.ssl),
    send: timing.send,
    wait: timing.wait,
    receive: timing.receive,
  };
}

const phasesTotal = (phases: WaterfallPhases): number =>
  Object.values(phases).reduce<number>((sum, ms) => sum + (ms ?? 0), 0);

function marksOf(har: ParsedHar, trace: ParsedTrace | undefined): WaterfallMarks {
  const page = har.pages[0];
  return {
    ttfb: documentTiming(har, trace).responseStartMs,
    fcp: trace?.fcp ?? null,
    lcp: trace?.lcp ?? null,
    dcl: page?.onContentLoad ?? null,
    onLoad: page?.onLoad ?? null,
  };
}

const lastMarkMs = (marks: WaterfallMarks): number =>
  Object.values(marks).reduce<number>((max, ms) => Math.max(max, ms ?? 0), 0);

/**
 * Where the time axis ends: the waterfall's totalMs for "end"; for "load", the last page mark,
 * or totalMs when the recording has none.
 */
export function waterfallAxisMs(waterfall: Waterfall, axis: WaterfallAxis): number {
  const lastMark = lastMarkMs(waterfall.marks);
  return axis === "load" && lastMark > 0 ? lastMark : waterfall.totalMs;
}

/**
 * The rows that match every criterion of the filter, the search read as a resource query;
 * all of them with an empty filter.
 */
export function filterWaterfallRows(rows: WaterfallRow[], filter: WaterfallFilter): WaterfallRow[] {
  const types = filter.types && filter.types.length > 0 ? new Set(filter.types) : null;
  const query = parseResourceQuery(filter.search ?? "");
  if (!types && !filter.host && !filter.party && query.terms.length === 0) return rows;
  return rows.filter(
    (row) =>
      (!types || types.has(row.resourceType)) &&
      (!filter.host || row.host === filter.host) &&
      (!filter.party || row.party === filter.party) &&
      matchesResourceQuery(row, query)
  );
}

// Display order of the types: render-critical first, then images, runtime requests, the rest.
const TYPE_RANK: Record<ResourceType, number> = {
  document: 0,
  stylesheet: 1,
  script: 2,
  font: 3,
  image: 4,
  fetch: 5,
  other: 6,
};
const PRIORITY_RANK: Record<ResourcePriority, number> = {
  VeryHigh: 0,
  High: 1,
  Medium: 2,
  Low: 3,
  VeryLow: 4,
};

/** The value a row sorts by for a column; null when it has none, to go last. */
function sortValue(row: WaterfallRow, key: ResourceSort["key"]): number | string | null {
  switch (key) {
    case "start":
      return row.startMs;
    case "name":
      return row.shortName.toLowerCase();
    case "host":
      return row.host;
    case "type":
      return TYPE_RANK[row.resourceType];
    case "status":
      return row.status;
    case "priority":
      return row.priority === null ? null : PRIORITY_RANK[row.priority];
    case "protocol":
      return row.httpVersion === null || row.httpVersion === "unknown" ? null : row.httpVersion;
    case "encoding":
      return row.contentEncoding;
    case "size":
      return row.transferSize;
    case "ttfb":
      return row.ttfbMs;
    default:
      return row.endMs - row.startMs;
  }
}

/**
 * A copy of the rows sorted by a column, rows that tie in their current order and rows
 * without a value for the column last, whatever the direction.
 */
export function sortWaterfallRows(rows: WaterfallRow[], sort: ResourceSort): WaterfallRow[] {
  const sign = sort.direction === "desc" ? -1 : 1;
  const keyed = rows.map((row) => ({ row, value: sortValue(row, sort.key) }));
  keyed.sort((a, b) => {
    if (a.value === null || b.value === null)
      return a.value === null ? (b.value === null ? 0 : 1) : -1;
    if (a.value < b.value) return -sign;
    if (a.value > b.value) return sign;
    return 0;
  });
  return keyed.map(({ row }) => row);
}

/**
 * The page's requests on a shared time axis, sorted by start: their phases, whether the
 * browser cache served them, the render-blocking ones and the LCP resource, with the page's
 * marks (document TTFB, FCP, LCP, DOMContentLoaded, onLoad). HAR times count from the page
 * origin and trace times from navigationStart: both mark the start of the same navigation.
 */
export function buildWaterfall(
  har: ParsedHar,
  trace?: ParsedTrace,
  options: WaterfallOptions = {}
): Waterfall {
  const documentRoot = getRootDomain(har.documentEntry.url);
  const blocking = renderBlockingUrls(har, trace);
  const lcpUrl = trace?.lcpCandidate?.url;

  const rows = har.entries.map((entry, entryIndex): WaterfallRow => {
    const phases = phasesOf(entry);
    const duration = Math.max(entry.duration || 0, phasesTotal(phases));
    return {
      entryIndex,
      url: entry.url,
      shortName: shortUrl(entry.url),
      host: getHostname(entry.url) ?? "",
      party: getRootDomain(entry.url) === documentRoot ? "first" : "third",
      resourceType: entry.resourceType,
      status: entry.status,
      fromCache: entry.fromCache,
      transferSize: entry.transferSize,
      bodySize: entry.bodySize,
      startMs: entry.startTime,
      endMs: entry.startTime + duration,
      ttfbMs: entry.ttfb,
      phases,
      priority: entry.priority ?? null,
      mimeType: entry.mimeType,
      method: entry.method ?? null,
      httpVersion: entry.httpVersion ?? null,
      contentEncoding: entry.contentEncoding ?? null,
      ...(entry.redirectURL !== undefined ? { redirectURL: entry.redirectURL } : {}),
      ...(blocking.has(entry.url) ? { renderBlocking: true } : {}),
      ...(lcpUrl !== undefined && entry.url === lcpUrl ? { isLcpResource: true } : {}),
    };
  });
  // Array.prototype.sort is stable: requests that start together keep the recording order.
  rows.sort((a, b) => a.startMs - b.startMs);

  const marks = marksOf(har, trace);
  const lastEnd = rows.reduce((max, row) => Math.max(max, row.endMs), 0);
  const lastMark = lastMarkMs(marks);

  return {
    rows: options.filter ? filterWaterfallRows(rows, options.filter) : rows,
    marks,
    totalMs: Math.max(lastEnd, lastMark),
  };
}
