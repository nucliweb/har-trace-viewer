import type { ParsedTrace, TraceLcpCandidate, TraceRequest } from "../types.js";
import { computeCls, computeInp } from "./web-vitals.js";

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

  const navigationEvents = events.filter(sameNavigation);
  const firstInput = findFirstInput(navigationEvents);

  // LCP stops at the first interaction: later candidates do not count.
  const lastLcp =
    events
      .filter(
        (e) =>
          e.name === "largestContentfulPaint::Candidate" &&
          sameNavigation(e) &&
          isMainFrameCandidate(dataOf(e)) &&
          (firstInput === null || e.ts < firstInput.ts)
      )
      .at(-1) ?? null;

  const toMs = (ts: number) => (ts - navigationStart) / 1000;
  const fcp = fcpEvent ? toMs(fcpEvent.ts) : null;
  const lcp = lastLcp ? toMs(lastLcp.ts) : null;
  const lastPaint = fcp === null && lcp === null ? null : Math.max(fcp ?? 0, lcp ?? 0);

  return {
    navigationStart,
    fcp,
    lcp,
    cls: computeCls(navigationEvents),
    inp: computeInp(navigationEvents),
    navigationId,
    url: typeof url === "string" && url !== "" ? url : null,
    lcpCandidate: lastLcp ? describeLcpCandidate(lastLcp, events, toMs) : null,
    firstInputMs: firstInput ? toMs(firstInput.ts) : null,
    requests: collectRequests(events, nav, lastPaint),
  };
}

// The first interaction: Chrome tags the events of an interaction with an interactionId.
function findFirstInput(events: RawTraceEvent[]): RawTraceEvent | null {
  let first: RawTraceEvent | null = null;
  for (const e of events) {
    if (e.name !== "EventTiming") continue;
    const { interactionId } = dataOf(e);
    if (typeof interactionId !== "number" || interactionId <= 0) continue;
    if (first === null || e.ts < first.ts) first = e;
  }
  return first;
}

const numberOr = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const stringOr = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
const booleanOr = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;
const frameOf = (e: RawTraceEvent): string | undefined =>
  stringOr(e.args?.frame) ?? stringOr(dataOf(e).frame);

// The target with the fields whose value is defined: absent fields stay out of the JSON.
function withDefined<T extends object>(target: T, fields: Partial<T>): T {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) Object.assign(target, { [key]: value });
  }
  return target;
}

const PAINT_CANDIDATES = new Set(["LargestImagePaint::Candidate", "LargestTextPaint::Candidate"]);

/**
 * The LCP candidate with its node name and, for an image, its URL: Chrome names them on the
 * LargestImagePaint / LargestTextPaint candidate of the same node and candidate index.
 */
function describeLcpCandidate(
  candidate: RawTraceEvent,
  events: RawTraceEvent[],
  toMs: (ts: number) => number
): TraceLcpCandidate {
  const data = dataOf(candidate);
  const nodeId = numberOr(data.nodeId);
  const candidateIndex = numberOr(data.candidateIndex);
  const frame = frameOf(candidate);
  const paints = events.filter((e) => {
    if (!PAINT_CANDIDATES.has(e.name)) return false;
    const paint = dataOf(e);
    if (!isMainFrameCandidate(paint) || paint.DOMNodeId !== nodeId) return false;
    if (candidateIndex !== undefined && paint.candidateIndex !== candidateIndex) return false;
    const paintFrame = frameOf(e);
    return frame === undefined || paintFrame === undefined || paintFrame === frame;
  });
  // The paint closest in time to the LCP candidate.
  const distance = (e: RawTraceEvent) => Math.abs(e.ts - candidate.ts);
  const paint = paints.sort((a, b) => distance(a) - distance(b))[0];
  const paintData = paint ? dataOf(paint) : {};

  return withDefined<TraceLcpCandidate>(
    { timeMs: toMs(candidate.ts) },
    {
      type: stringOr(data.type),
      nodeId,
      nodeName: stringOr(paintData.nodeName) ?? stringOr(data.nodeName),
      url: stringOr(paintData.imageUrl),
      size: numberOr(data.size) ?? numberOr(paintData.size),
      loadingAttr: stringOr(data.loadingAttr),
      imageDiscoveryMs: numberOr(data.imageDiscoveryTime),
      imageLoadStartMs: numberOr(data.imageLoadStart),
      imageLoadEndMs: numberOr(data.imageLoadEnd),
    }
  );
}

// The initiator's type and URL: the referencing document or stylesheet, else the script at
// the top of the stack.
function initiatorOf(raw: unknown): TraceRequest["initiator"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const initiator = raw as { type?: unknown; url?: unknown; stack?: { callFrames?: unknown } };
  const type = stringOr(initiator.type);
  if (type === undefined) return undefined;
  const frames = Array.isArray(initiator.stack?.callFrames)
    ? (initiator.stack.callFrames as { url?: unknown }[])
    : [];
  const url = stringOr(initiator.url) ?? frames.map((f) => stringOr(f.url)).find(Boolean);
  return url === undefined ? { type } : { type, url };
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);

/**
 * The main frame's http(s) requests, joined from their ResourceSendRequest,
 * PreloadRenderBlockingStatusChange, ResourceReceiveResponse and ResourceFinish events. When
 * the trace has a paint metric, only the requests sent up to the last one are kept: later
 * requests can neither block the first paint nor load the LCP element.
 */
function collectRequests(
  events: RawTraceEvent[],
  nav: RawTraceEvent,
  lastPaintMs: number | null
): TraceRequest[] {
  const navigationStart = nav.ts;
  const mainFrame = frameOf(nav);
  const usToMs = (ts: number) => (ts - navigationStart) / 1000;
  // Network timings count in seconds on the same clock as the event timestamps.
  const secondsToMs = (seconds: number) => (seconds * 1_000_000 - navigationStart) / 1000;

  const requests = new Map<string, TraceRequest>();
  for (const e of events) {
    const data = dataOf(e);
    const requestId = stringOr(data.requestId);
    if (requestId === undefined) continue;

    if (e.name === "ResourceSendRequest") {
      const url = stringOr(data.url);
      if (url === undefined || !isHttp(url) || e.ts < navigationStart) continue;
      const frame = stringOr(data.frame);
      if (mainFrame !== undefined && frame !== undefined && frame !== mainFrame) continue;
      if (requests.has(requestId)) continue;
      requests.set(
        requestId,
        withDefined<TraceRequest>(
          { url, sentAtMs: usToMs(e.ts) },
          {
            resourceType: stringOr(data.resourceType),
            priority: stringOr(data.priority),
            fetchPriorityHint: stringOr(data.fetchPriorityHint),
            renderBlocking: stringOr(data.renderBlocking),
            isLinkPreload: booleanOr(data.isLinkPreload),
            initiator: initiatorOf(data.initiator),
          }
        )
      );
      continue;
    }

    const request = requests.get(requestId);
    if (!request) continue;
    if (e.name === "PreloadRenderBlockingStatusChange") {
      request.renderBlocking = stringOr(data.renderBlocking) ?? request.renderBlocking;
    } else if (e.name === "ResourceReceiveResponse") {
      const timing = (data.timing ?? {}) as Record<string, unknown>;
      const requestTime = numberOr(timing.requestTime);
      const start = requestTime !== undefined && requestTime > 0 ? secondsToMs(requestTime) : null;
      const offset = (value: unknown) => {
        const ms = numberOr(value);
        return start !== null && ms !== undefined && ms >= 0 ? start + ms : undefined;
      };
      withDefined(request, {
        startMs: start ?? undefined,
        responseStartMs: offset(timing.receiveHeadersStart),
        responseEndMs: offset(timing.receiveHeadersEnd),
        fromCache: booleanOr(data.fromCache),
      });
    } else if (e.name === "ResourceFinish") {
      const finishTime = numberOr(data.finishTime);
      withDefined(request, {
        endMs: finishTime !== undefined && finishTime > 0 ? secondsToMs(finishTime) : usToMs(e.ts),
        encodedDataLength: numberOr(data.encodedDataLength),
      });
    }
  }

  const sent = [...requests.values()].sort((a, b) => a.sentAtMs - b.sentAtMs);
  return lastPaintMs === null ? sent : sent.filter((r) => r.sentAtMs <= lastPaintMs);
}

export function parseTrace(raw: RawTrace): ParsedTrace {
  return parseTraceEvents(raw.traceEvents);
}

export function parseTraceJson(json: string): ParsedTrace {
  const raw = JSON.parse(json) as RawTrace;
  return parseTrace(raw);
}
