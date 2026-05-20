import type { HarEntry, HarPage, HarTiming, ParsedHar, PreconnectSource, ResourcePriority, ResourceType } from "../types.js";

interface RawHarTiming {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
}

interface RawHarEntry {
  pageref?: string;
  startedDateTime: string;
  time: number;
  _resourceType?: string;
  _priority?: string;
  _fromCache?: string;
  cache?: { beforeRequest?: Record<string, unknown> | null };
  request: { url: string; method: string };
  response: {
    status: number;
    headers: Array<{ name: string; value: string }>;
    content: { mimeType: string; size?: number };
  };
  timings: RawHarTiming;
}

interface RawHarPage {
  id: string;
  title: string;
  startedDateTime: string;
  pageTimings: { onContentLoad: number; onLoad: number };
}

interface RawHar {
  log: { pages: RawHarPage[]; entries: RawHarEntry[] };
}

function normalizeMs(value: number): number {
  return value < 0 ? 0 : value;
}

function parseTiming(raw: RawHarTiming): HarTiming {
  return {
    blocked: normalizeMs(raw.blocked),
    dns: normalizeMs(raw.dns),
    connect: normalizeMs(raw.connect),
    ssl: normalizeMs(raw.ssl),
    send: normalizeMs(raw.send),
    wait: normalizeMs(raw.wait),
    receive: normalizeMs(raw.receive),
  };
}

function headersToRecord(headers: Array<{ name: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    result[h.name.toLowerCase()] = h.value;
  }
  return result;
}

function parseResourceType(raw?: string): ResourceType {
  switch (raw) {
    case "document":   return "document";
    case "stylesheet": return "stylesheet";
    case "script":     return "script";
    case "image":      return "image";
    case "font":       return "font";
    case "fetch":      return "fetch";
    default:           return "other";
  }
}

function parseResourcePriority(raw?: string): ResourcePriority {
  switch (raw) {
    case "VeryHigh": return "VeryHigh";
    case "High":     return "High";
    case "Medium":   return "Medium";
    case "Low":      return "Low";
    case "VeryLow":  return "VeryLow";
    default:         return "Low";
  }
}

function isHtmlMime(mimeType: string): boolean {
  return mimeType.includes("text/html");
}

function parseFromCache(
  fromCacheField?: string,
  cache?: { beforeRequest?: Record<string, unknown> | null }
): "disk" | "memory" | false {
  if (fromCacheField === "disk") return "disk";
  if (fromCacheField === "memory") return "memory";
  if (cache?.beforeRequest != null) return "disk";
  return false;
}

function preconnectHostnames(linkHeader: string): string[] {
  const result: string[] = [];
  for (const part of linkHeader.split(",")) {
    const urlMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/\brel=["']?([^"';,\s]+)["']?/i);
    if (urlMatch && relMatch && relMatch[1].toLowerCase() === "preconnect") {
      try {
        result.push(new URL(urlMatch[1]).hostname);
      } catch {
        // malformed URL — skip
      }
    }
  }
  return result;
}

function parsePreconnectHints(
  entries: HarEntry[],
  documentHeaders: Record<string, string>
): Record<string, PreconnectSource> {
  const hints: Record<string, PreconnectSource> = {};
  for (const hostname of preconnectHostnames(documentHeaders["link"] ?? "")) {
    hints[hostname] = "link-header";
  }
  for (const entry of entries) {
    if (entry.status === 103) {
      for (const hostname of preconnectHostnames(entry.responseHeaders["link"] ?? "")) {
        if (!(hostname in hints)) hints[hostname] = "early-hints";
      }
    }
  }
  return hints;
}

export function parseHar(raw: RawHar): ParsedHar {
  const { pages, entries } = raw.log;

  if (pages.length === 0) {
    throw new Error("HAR contains no pages");
  }

  // Use the first entry's startedDateTime as origin — Chrome's page.startedDateTime
  // can be a few ms later than the first request due to rounding.
  const firstEntryMs = new Date(entries[0].startedDateTime).getTime();
  const pageOriginMs = new Date(pages[0].startedDateTime).getTime();
  const pageOrigin = Math.min(firstEntryMs, pageOriginMs);

  const parsedPages: HarPage[] = pages.map((p) => ({
    id: p.id,
    title: p.title,
    onContentLoad: p.pageTimings.onContentLoad,
    onLoad: p.pageTimings.onLoad,
  }));

  const parsedEntries: HarEntry[] = entries.map((e) => {
    const timing = parseTiming(e.timings);
    const ttfb = normalizeMs(e.timings.wait);
    const startTime = new Date(e.startedDateTime).getTime() - pageOrigin;
    const responseHeaders = headersToRecord(e.response.headers);
    const mimeType = e.response.content.mimeType;

    return {
      url: e.request.url,
      startTime,
      duration: e.time,
      timing,
      ttfb,
      status: e.response.status,
      mimeType,
      resourceType: parseResourceType(e._resourceType),
      priority: parseResourcePriority(e._priority),
      responseHeaders,
      transferSize: e.response.content.size ?? 0,
      isDocument: isHtmlMime(mimeType),
      fromCache: parseFromCache(e._fromCache, e.cache),
    };
  });

  const documentEntry = parsedEntries.find((e) => e.isDocument);
  if (!documentEntry) {
    throw new Error("HAR contains no HTML document entry");
  }

  return {
    pages: parsedPages,
    entries: parsedEntries,
    documentEntry,
    preconnectHints: parsePreconnectHints(parsedEntries, documentEntry.responseHeaders),
  };
}

export function parseHarJson(json: string): ParsedHar {
  return parseHar(JSON.parse(json) as RawHar);
}
