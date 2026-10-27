import type { ParsedTrace } from "../types.js";

interface RawTraceEvent {
  name: string;
  ts: number;
  pid?: number;
  tid?: number;
  ph?: string;
  args?: Record<string, unknown>;
}

interface RawTrace {
  traceEvents: RawTraceEvent[];
}

type EventData = Record<string, unknown>;

const dataOf = (e: RawTraceEvent): EventData => (e.args?.data as EventData | undefined) ?? {};

const navigationIdOf = (e: RawTraceEvent): string | null => {
  const id = dataOf(e).navigationId;
  return typeof id === "string" && id !== "" ? id : null;
};

function findMainNavigation(events: RawTraceEvent[]): RawTraceEvent {
  const navs = events.filter(
    (e) => e.name === "navigationStart" && dataOf(e).isOutermostMainFrame === true
  );
  if (navs.length === 0) {
    throw new Error("No navigationStart found in trace");
  }

  // Prefer the navigation that actually produced paint events.
  const paintIds = new Set(
    events
      .filter(
        (e) => e.name === "firstContentfulPaint" || e.name === "largestContentfulPaint::Candidate"
      )
      .map(navigationIdOf)
      .filter((id): id is string => id !== null)
  );
  const withPaint = navs.filter((n) => {
    const id = navigationIdOf(n);
    return id !== null && paintIds.has(id);
  });
  const hasUrl = (n: RawTraceEvent) => {
    const u = dataOf(n).documentLoaderURL;
    return typeof u === "string" && u !== "";
  };
  const withPaintAndUrl = withPaint.filter(hasUrl);
  if (withPaintAndUrl.length > 0) return withPaintAndUrl.at(-1)!;
  if (withPaint.length > 0) return withPaint.at(-1)!;

  const withUrl = navs.filter(hasUrl);
  return withUrl.at(-1) ?? navs[0];
}

function isMainFrameCandidate(data: EventData): boolean {
  if (typeof data.isOutermostMainFrame === "boolean") return data.isOutermostMainFrame;
  if (typeof data.isMainFrame === "boolean") return data.isMainFrame;
  return true;
}

function parseTraceEvents(events: RawTraceEvent[]): ParsedTrace {
  const nav = findMainNavigation(events);
  const navigationStart = nav.ts;
  const navigationId = navigationIdOf(nav);
  const url = dataOf(nav).documentLoaderURL;

  // Events without a navigationId (older traces) are matched by the fallback.
  const sameNavigation = (e: RawTraceEvent) => {
    const id = navigationIdOf(e);
    return navigationId === null || id === null || id === navigationId;
  };

  const fcpEvents = events.filter((e) => e.name === "firstContentfulPaint" && sameNavigation(e));
  const fcpEvent = fcpEvents.find((e) => navigationIdOf(e) === navigationId) ?? fcpEvents[0];

  const lastLcp =
    events
      .filter(
        (e) =>
          e.name === "largestContentfulPaint::Candidate" &&
          sameNavigation(e) &&
          isMainFrameCandidate(dataOf(e))
      )
      .at(-1) ?? null;

  const toMs = (ts: number) => (ts - navigationStart) / 1000;

  return {
    navigationStart,
    fcp: fcpEvent ? toMs(fcpEvent.ts) : null,
    lcp: lastLcp ? toMs(lastLcp.ts) : null,
    navigationId,
    url: typeof url === "string" && url !== "" ? url : null,
  };
}

export function parseTrace(raw: RawTrace): ParsedTrace {
  return parseTraceEvents(raw.traceEvents);
}

export function parseTraceJson(json: string): ParsedTrace {
  const raw = JSON.parse(json) as RawTrace;
  return parseTrace(raw);
}
