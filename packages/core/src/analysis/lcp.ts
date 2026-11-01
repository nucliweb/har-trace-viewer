import { formatMs } from "../utils/format.js";
import {
  documentTiming,
  harEntryFor,
  harRequestTiming,
  linkPreloadedUrls,
  severityFor,
  traceRequestFor,
} from "./render-timing.js";
import type {
  LcpAttribution,
  LcpElement,
  LcpNote,
  LcpPhases,
  LcpResource,
  ParsedHar,
  ParsedTrace,
  Recommendation,
  TraceLcpCandidate,
} from "../types.js";

// web.dev LCP thresholds.
const LCP_GOOD_MS = 2500;
const LCP_POOR_MS = 4000;
// A load delay above this share of the LCP, or above LATE_DISCOVERY_MS, means the browser
// found the LCP resource late.
const LATE_DISCOVERY_SHARE = 0.4;
const LATE_DISCOVERY_MS = 500;
// The render delay dominates from this share of the LCP on, when no other phase is longer.
const RENDER_DELAY_SHARE = 0.4;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Chrome describes the node as "IMG" or "P class='intro'": the tag is the first word.
function describeElement(candidate: TraceLcpCandidate): LcpElement | null {
  const tagName = candidate.nodeName?.trim().split(/\s+/)[0]?.toUpperCase();
  const element: LcpElement = {
    ...(candidate.nodeId !== undefined ? { nodeId: candidate.nodeId } : {}),
    ...(tagName ? { tagName } : {}),
    ...(candidate.type !== undefined ? { type: candidate.type } : {}),
    ...(candidate.loadingAttr !== undefined ? { loading: candidate.loadingAttr } : {}),
  };
  return Object.keys(element).length > 0 ? element : null;
}

/**
 * The LCP image's request: timed by the trace when it has the request, else by the HAR. Null
 * when neither requested it.
 */
function describeResource(
  har: ParsedHar,
  trace: ParsedTrace,
  candidate: TraceLcpCandidate,
  url: string,
  notes: LcpNote[]
): LcpResource | null {
  const request = traceRequestFor(trace, url);
  const entry = harEntryFor(har, url);
  if (!request && !entry) {
    notes.push("resource-not-found");
    return null;
  }

  let timeline: Pick<
    LcpResource,
    "discoveredAtMs" | "requestedAtMs" | "respondedAtMs" | "loadedAtMs"
  >;
  if (request) {
    timeline = {
      discoveredAtMs: request.sentAtMs,
      requestedAtMs: request.startMs ?? request.sentAtMs,
      respondedAtMs: request.responseEndMs ?? null,
      loadedAtMs:
        candidate.imageLoadEndMs ?? request.endMs ?? request.responseEndMs ?? request.sentAtMs,
    };
  } else {
    notes.push("har-timings");
    const { requestedAtMs, respondedAtMs, endMs } = harRequestTiming(entry!);
    timeline = {
      discoveredAtMs: entry!.startTime,
      requestedAtMs,
      respondedAtMs,
      loadedAtMs: endMs,
    };
  }

  const fromCache = (entry ? entry.fromCache !== false : false) || request?.fromCache === true;
  if (fromCache) notes.push("resource-from-cache");
  return {
    url,
    ...timeline,
    transferSize: entry?.transferSize ?? request?.encodedDataLength ?? 0,
    priority: entry?.priority ?? request?.priority ?? null,
    fetchPriorityHint: request?.fetchPriorityHint ?? null,
    preloaded: request?.isLinkPreload === true || linkPreloadedUrls(har).has(url),
    fromCache,
    initiator: entry?.initiator ?? request?.initiator ?? null,
  };
}

/**
 * The web.dev breakdown: each phase clamped so that the four add up to the LCP. Without a load
 * (text, or an image it cannot time) everything after the first byte is render delay.
 */
function breakDown(
  lcpMs: number,
  ttfbMs: number,
  load: { startMs: number; endMs: number } | null
): LcpPhases {
  const ttfb = clamp(ttfbMs, 0, lcpMs);
  if (!load) {
    return {
      ttfb,
      resourceLoadDelay: 0,
      resourceLoadDuration: 0,
      elementRenderDelay: lcpMs - ttfb,
    };
  }
  const loadStart = clamp(load.startMs, ttfb, lcpMs);
  const loadEnd = clamp(load.endMs, loadStart, lcpMs);
  return {
    ttfb,
    resourceLoadDelay: loadStart - ttfb,
    resourceLoadDuration: loadEnd - loadStart,
    elementRenderDelay: lcpMs - loadEnd,
  };
}

/**
 * Attributes the page's LCP: the element, the resource it loaded and the web.dev breakdown
 * (TTFB, resource load delay, resource load duration, element render delay). The trace's LCP
 * candidate is the last one before the first interaction. Null without a trace, an LCP or
 * the candidate behind it (flows parsed before it was kept).
 */
export function attributeLcp(
  har: ParsedHar,
  trace: ParsedTrace | undefined
): LcpAttribution | null {
  const candidate = trace?.lcpCandidate;
  if (!trace || trace.lcp === null || !candidate) return null;

  const lcpMs = candidate.timeMs;
  const notes: LcpNote[] = [];
  if (trace.firstInputMs != null) notes.push("stopped-at-first-input");

  let resource: LcpResource | null = null;
  if (candidate.type === "text") notes.push("text-element");
  else if (candidate.url === undefined) notes.push("image-url-unknown");
  else resource = describeResource(har, trace, candidate, candidate.url, notes);

  // Without its request, an image is timed by the load times Chrome reports with the candidate.
  const { imageLoadStartMs, imageLoadEndMs } = candidate;
  let load: { startMs: number; endMs: number } | null = null;
  if (resource) load = { startMs: resource.discoveredAtMs, endMs: resource.loadedAtMs };
  else if (imageLoadStartMs !== undefined && imageLoadEndMs !== undefined) {
    load = { startMs: imageLoadStartMs, endMs: imageLoadEndMs };
  }
  if (candidate.type !== "text" && load === null) notes.push("load-phases-unknown");

  const ttfb = documentTiming(har, trace).responseStartMs;
  return {
    lcpMs,
    element: describeElement(candidate),
    resource,
    phases: breakDown(lcpMs, ttfb, load),
    notes,
  };
}

const isStylesheetUrl = (har: ParsedHar, url: string) =>
  harEntryFor(har, url)?.resourceType === "stylesheet" || /\.css(\?|#|$)/i.test(url);

// Whether the image is in the document's HTML: the parser found it in the document itself.
const inInitialHtml = (har: ParsedHar, resource: LcpResource) =>
  resource.initiator?.type === "parser" && resource.initiator.url === har.documentEntry.url;

/** Discovered by a script, or by a stylesheet (a CSS background image). */
const discoveredByScriptOrCss = (har: ParsedHar, resource: LcpResource) => {
  const initiator = resource.initiator;
  if (!initiator) return false;
  if (initiator.type === "script") return true;
  return initiator.url !== undefined && isStylesheetUrl(har, initiator.url);
};

function lateDiscovery(har: ParsedHar, lcp: LcpAttribution, resource: LcpResource) {
  const { resourceLoadDelay } = lcp.phases;
  const highPriority = resource.fetchPriorityHint === "high";
  const advice: string[] = [];
  if (!highPriority) advice.push('add fetchpriority="high" to the image');
  if (!resource.preloaded && !inInitialHtml(har, resource)) {
    advice.push(
      "preload it with <link rel=preload as=image fetchpriority=high> or a Link header, since the HTML does not reference it"
    );
  }
  const fix =
    advice.length > 0
      ? `To start it sooner, ${advice.join(", and ")}.`
      : "It already has a high priority hint and is referenced early: check what delays the request, such as a long HTML head or a busy main thread.";
  return `The browser started loading the LCP image ${formatMs(resourceLoadDelay)} after the first byte of the document (${Math.round(
    (resourceLoadDelay / lcp.lcpMs) * 100
  )}% of the LCP). ${fix}`;
}

/**
 * What the LCP attribution suggests fixing: an image discovered late, lazy-loaded, or found by
 * a script or stylesheet without a preload, and a render delay that dominates. Severity follows
 * the measured LCP (web.dev: good up to 2.5 s, poor above 4 s); "good" when the LCP is good and
 * none of them applies.
 */
export function lcpRecommendations(har: ParsedHar, lcp: LcpAttribution): Recommendation[] {
  const severity = severityFor(lcp.lcpMs, LCP_GOOD_MS, LCP_POOR_MS);
  const { phases, resource, lcpMs } = lcp;
  const resources = resource
    ? [{ url: resource.url, transferSize: resource.transferSize }]
    : undefined;
  const recommendations: Recommendation[] = [];

  if (resource && lcp.element?.loading === "lazy") {
    recommendations.push({
      label: "LCP image is lazy-loaded",
      description:
        'The LCP image has loading="lazy": the browser waits for layout to know it is in the viewport before requesting it. Remove loading="lazy" from the image above the fold.',
      severity,
      resources,
    });
  }

  if (
    resource &&
    (phases.resourceLoadDelay > LATE_DISCOVERY_SHARE * lcpMs ||
      phases.resourceLoadDelay > LATE_DISCOVERY_MS)
  ) {
    recommendations.push({
      label: "LCP image discovered late",
      description: lateDiscovery(har, lcp, resource),
      severity,
      resources,
    });
  }

  if (resource && !resource.preloaded && discoveredByScriptOrCss(har, resource)) {
    const by = resource.initiator?.type === "script" ? "a script" : "a stylesheet";
    recommendations.push({
      label: "LCP resource not preloaded and discovered by script/CSS",
      description: `The preload scanner cannot see the LCP image: ${by} requested it. Reference it in the HTML with an <img>, or preload it with <link rel=preload as=image fetchpriority=high>.`,
      severity,
      resources,
    });
  }

  // An image it cannot time leaves its load inside the render delay: nothing to blame.
  const phasesKnown = !lcp.notes.includes("load-phases-unknown");
  const longestOther = Math.max(phases.ttfb, phases.resourceLoadDelay, phases.resourceLoadDuration);
  if (
    phasesKnown &&
    phases.elementRenderDelay >= RENDER_DELAY_SHARE * lcpMs &&
    phases.elementRenderDelay > longestOther
  ) {
    const what = lcp.notes.includes("text-element")
      ? "after the document's first byte"
      : "after its resource finished loading";
    recommendations.push({
      label: "LCP element render delay",
      description: `The LCP element painted ${formatMs(phases.elementRenderDelay)} ${what} (${Math.round(
        (phases.elementRenderDelay / lcpMs) * 100
      )}% of the LCP). Render-blocking stylesheets and scripts, long main-thread tasks or client-side rendering hold it back: inline the critical CSS, defer scripts and render the element on the server.`,
      severity,
      resources,
    });
  }

  if (recommendations.length === 0 && lcpMs <= LCP_GOOD_MS) {
    recommendations.push({
      label: "LCP is good",
      description: phasesKnown
        ? `The largest element painted at ${formatMs(lcpMs)}, and no phase of its breakdown dominates.`
        : `The largest element painted at ${formatMs(lcpMs)}.`,
      severity: "good",
    });
  }
  return recommendations;
}
