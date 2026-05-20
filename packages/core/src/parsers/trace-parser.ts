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

function findNavigationStart(events: RawTraceEvent[]): number {
  // The main page navigation: first outermost main frame navigationStart
  const nav = events.find(
    (e) =>
      e.name === "navigationStart" &&
      (e.args?.data as Record<string, unknown> | undefined)?.isOutermostMainFrame === true
  );
  if (!nav) {
    throw new Error("No navigationStart found in trace");
  }
  return nav.ts;
}

function parseTraceEvents(events: RawTraceEvent[]): ParsedTrace {
  const navigationStart = findNavigationStart(events);

  const fcpEvent = events.find((e) => e.name === "firstContentfulPaint");
  const lcpCandidates = events.filter(
    (e) => e.name === "largestContentfulPaint::Candidate"
  );
  const lastLcp = lcpCandidates.at(-1) ?? null;

  const toMs = (ts: number) => (ts - navigationStart) / 1000;

  return {
    navigationStart,
    fcp: fcpEvent ? toMs(fcpEvent.ts) : null,
    lcp: lastLcp ? toMs(lastLcp.ts) : null,
  };
}

export function parseTrace(raw: RawTrace): ParsedTrace {
  return parseTraceEvents(raw.traceEvents);
}

export function parseTraceJson(json: string): ParsedTrace {
  const raw = JSON.parse(json) as RawTrace;
  return parseTrace(raw);
}

