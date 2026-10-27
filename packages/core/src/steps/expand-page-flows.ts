import { defaultPageName } from "../parsers/har-parser.js";
import type { PageFlow, ParsedHar, ParsedTrace } from "../types.js";

export interface ExpandPageFlowsInput {
  /** Name chosen by the user; "Page <n>" placeholders count as not chosen. */
  name?: string;
  /** One entry per HAR page, as returned by `parseHarPages`. */
  har: ParsedHar[];
  trace?: ParsedTrace;
}

function comparableUrl(url: string): string {
  const withoutHash = url.split("#")[0];
  return withoutHash.endsWith("/") ? withoutHash.slice(0, -1) : withoutHash;
}

function isPlaceholderName(name: string): boolean {
  return /^Page \d+$/.test(name);
}

/**
 * Turns the pages of one HAR into flow pages. A single-page HAR keeps the given
 * name (or "Page 1"). With several pages, names come from the page titles,
 * prefixed with the given name as "<name> · <title>". The trace goes to the page
 * whose document URL equals `trace.url` (ignoring hash and trailing slash),
 * else to the first page.
 */
export function expandPageFlows({ name, har, trace }: ExpandPageFlowsInput): PageFlow[] {
  const chosen = name?.trim() && !isPlaceholderName(name.trim()) ? name.trim() : undefined;

  if (har.length === 1) {
    return [{ name: name?.trim() || "Page 1", har: har[0], ...(trace ? { trace } : {}) }];
  }

  let traceIndex = 0;
  if (trace?.url) {
    const target = comparableUrl(trace.url);
    const match = har.findIndex((h) => comparableUrl(h.documentEntry.url) === target);
    if (match >= 0) traceIndex = match;
  }

  return har.map((h, i) => {
    const label = defaultPageName(h.pages[0], i, h.documentEntry.url);
    return {
      name: chosen ? `${chosen} · ${label}` : label,
      har: h,
      ...(trace && i === traceIndex ? { trace } : {}),
    };
  });
}
