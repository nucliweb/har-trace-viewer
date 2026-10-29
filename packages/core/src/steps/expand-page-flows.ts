import { defaultPageName } from "../parsers/har-parser.js";
import type { PageFlow, ParsedHar, ParsedTrace } from "../types.js";

export interface ExpandPageFlowsInput {
  /** Name chosen by the user; "Page <n>" placeholders count as not chosen. */
  name?: string;
  /** One entry per HAR page, as returned by `parseHarPages`. */
  har: ParsedHar[];
  trace?: ParsedTrace;
  /** Expands only the matching HAR pages; absent means all of them. */
  select?: PageSelection;
}

export interface PageSelection {
  /** Exact HAR page ids. */
  pageIds?: string[];
  /** Case-insensitive substring (string) or pattern (RegExp) tested against page id, title and document URL. */
  match?: RegExp | string;
}

export interface HarPageSummary {
  id: string;
  title: string;
  url: string;
  entries: number;
}

/** Describes the pages of a parsed HAR, in flow order. */
export function listHarPages(har: ParsedHar[]): HarPageSummary[] {
  return har.map((h) => ({
    id: h.pages[0].id,
    title: h.pages[0].title.trim(),
    url: h.documentEntry.url,
    entries: h.entries.length,
  }));
}

/** Run number and view of a WebPageTest page title ("Run 1, First View for https://x"). */
function parseWebPageTestTitle(title: string): { run: string; view: "First" | "Repeat" } | null {
  const m = /^Run (\d+), (First|Repeat) View for .+$/.exec(title.trim());
  return m ? { run: m[1], view: m[2] as "First" | "Repeat" } : null;
}

/** "Run 1, First View for https://x" (WebPageTest) becomes "Run 1 · First view"; other titles give null. */
export function webPageTestLabel(title: string): string | null {
  const wpt = parseWebPageTestTitle(title);
  return wpt ? `Run ${wpt.run} · ${wpt.view} view` : null;
}

/**
 * Page ids a UI should tick by default. A WebPageTest export (every title shaped
 * "Run N, First|Repeat View for ...") holds several runs and views that are rarely
 * wanted together, so only its first page is proposed; any other HAR keeps all pages.
 */
export function defaultSelectedPageIds(har: ParsedHar[]): string[] {
  const pages = listHarPages(har);
  const wpt = pages.length > 1 && pages.every((p) => webPageTestLabel(p.title) !== null);
  return (wpt ? pages.slice(0, 1) : pages).map((p) => p.id);
}

/**
 * Two page ids a UI should propose for a comparison: the first and the repeat view of the
 * same WebPageTest run (with cache vs without), else the first two pages. Null with fewer
 * than two pages.
 */
export function defaultComparePageIds(har: ParsedHar[]): [string, string] | null {
  const pages = listHarPages(har);
  if (pages.length < 2) return null;
  const views = pages.map((p) => ({ id: p.id, wpt: parseWebPageTestTitle(p.title) }));
  for (const first of views) {
    if (first.wpt?.view !== "First") continue;
    const run = first.wpt.run;
    const repeat = views.find((v) => v.wpt?.view === "Repeat" && v.wpt.run === run);
    if (repeat) return [first.id, repeat.id];
  }
  return [pages[0].id, pages[1].id];
}

function describePages(pages: HarPageSummary[]): string {
  return pages.map((p) => `  ${p.id}  ${p.title || p.url}  (${p.entries} entries)`).join("\n");
}

function matches(summary: HarPageSummary, match: RegExp | string): boolean {
  const haystacks = [summary.id, summary.title, summary.url];
  if (typeof match === "string") {
    const needle = match.toLowerCase();
    return haystacks.some((h) => h.toLowerCase().includes(needle));
  }
  return haystacks.some((h) => new RegExp(match.source, match.flags.replace(/[gy]/g, "")).test(h));
}

/**
 * Turns user text into a selection: a comma-separated list of exact page ids, else a
 * case-insensitive substring of id, title or URL, else a regular expression.
 */
export function parsePageSelection(har: ParsedHar[], text: string): PageSelection {
  const pages = listHarPages(har);
  const ids = text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (ids.length > 0 && ids.every((id) => pages.some((p) => p.id === id))) return { pageIds: ids };
  if (pages.some((p) => matches(p, text))) return { match: text };
  try {
    return { match: new RegExp(text, "i") };
  } catch {
    return { match: text };
  }
}

function selectPages(har: ParsedHar[], select: PageSelection): ParsedHar[] {
  const pages = listHarPages(har);
  const unknown = (select.pageIds ?? []).filter((id) => !pages.some((p) => p.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown page id${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Available pages:\n${describePages(pages)}`
    );
  }
  const selected = har.filter((_, i) => {
    const byId = select.pageIds?.includes(pages[i].id) ?? false;
    const byMatch = select.match !== undefined && matches(pages[i], select.match);
    return byId || byMatch;
  });
  if (selected.length === 0) {
    throw new Error(`No page matches the selection. Available pages:\n${describePages(pages)}`);
  }
  return selected;
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
 * prefixed with the given name as "<name> · <title>" (WebPageTest titles are
 * shortened to "Run 1 · First view"). `select` keeps only the matching pages. The trace goes to the page
 * whose document URL equals `trace.url` (ignoring hash and trailing slash),
 * else to the first page.
 */
export function expandPageFlows({
  name,
  har: allPages,
  trace,
  select,
}: ExpandPageFlowsInput): PageFlow[] {
  const har = select ? selectPages(allPages, select) : allPages;
  const chosen = name?.trim() && !isPlaceholderName(name.trim()) ? name.trim() : undefined;

  if (allPages.length === 1) {
    return [{ name: name?.trim() || "Page 1", har: har[0], ...(trace ? { trace } : {}) }];
  }

  let traceIndex = 0;
  if (trace?.url) {
    const target = comparableUrl(trace.url);
    const match = har.findIndex((h) => comparableUrl(h.documentEntry.url) === target);
    if (match >= 0) traceIndex = match;
  }

  return har.map((h, i) => {
    const label =
      webPageTestLabel(h.pages[0].title) ?? defaultPageName(h.pages[0], i, h.documentEntry.url);
    return {
      name: chosen ? `${chosen} · ${label}` : label,
      har: h,
      ...(trace && i === traceIndex ? { trace } : {}),
    };
  });
}
