import type { HarEntry, ParsedHar, ParsedTrace } from "../../src/types.js";

// Minimal in-memory HAR for step-generator tests: one document plus the given
// entries, with timings that are easy to reason about in milliseconds.
export function makeEntry(overrides: Partial<HarEntry> = {}): HarEntry {
  return {
    url: "https://example.com/style.css",
    startTime: 100,
    duration: 50,
    timing: { dns: 0, connect: 0, ssl: 0, send: 1, wait: 10, receive: 5, blocked: 0 },
    ttfb: 10,
    status: 200,
    mimeType: "text/css",
    resourceType: "stylesheet",
    priority: "VeryHigh",
    responseHeaders: {},
    transferSize: 1024,
    bodySize: 1024,
    isDocument: false,
    fromCache: false,
    ...overrides,
  };
}

export function makeHar(
  entries: HarEntry[],
  page: { onContentLoad: number | null; onLoad: number | null } = {
    onContentLoad: 300,
    onLoad: 500,
  }
): ParsedHar {
  const docEntry = makeEntry({
    url: "https://example.com/",
    startTime: 0,
    mimeType: "text/html",
    isDocument: true,
    resourceType: "document",
    timing: { dns: 10, connect: 20, ssl: 0, send: 1, wait: 50, receive: 5, blocked: 0 },
    ttfb: 50,
  });
  return {
    pages: [{ id: "p1", title: "Example", ...page }],
    entries: [docEntry, ...entries],
    documentEntry: docEntry,
    preconnectHints: {},
  };
}

export function makeTrace(
  fcp: number | null,
  lcp: number | null,
  vitals: { cls?: number | null; inp?: number | null } = {}
): ParsedTrace {
  return {
    navigationStart: 0,
    navigationId: null,
    url: null,
    fcp,
    lcp,
    cls: vitals.cls ?? null,
    inp: vitals.inp ?? null,
  };
}

export const criticalCss = (startTime: number) =>
  makeEntry({ url: `https://example.com/critical-${startTime}.css`, startTime });
export const secondaryImage = (startTime: number) =>
  makeEntry({
    url: `https://example.com/image-${startTime}.png`,
    startTime,
    mimeType: "image/png",
    resourceType: "image",
    priority: "Low",
  });
export const thirdPartyScript = (startTime: number) =>
  makeEntry({
    url: `https://cdn.third.com/tag-${startTime}.js`,
    startTime,
    mimeType: "application/javascript",
    resourceType: "script",
    priority: "Low",
  });
