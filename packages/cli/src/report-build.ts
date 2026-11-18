import { readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandPageFlows,
  listHarPages,
  parsePageSelection,
  buildWaterfall,
  generateFlow,
  normalizeFlow,
  groupRuns,
  parseRunId,
  pickMedianRun,
  runSpread,
  summarizeFlowMetrics,
} from "@htv/core";
import type { ClientRegion, Flow, PageFlow, RunMetric, RunSpread } from "@htv/core";
import { readRecording, STDIN, STDIN_NAME } from "./recording";
import type { Args, CompareArg, PageArg, RunsChoice } from "./args";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Describes the pages of each --har: id, entries and title; with --format json, as
 * `{ files: [{ file, pages: [{ id, title, url, entries }] }] }`.
 */
export async function listPagesReport(args: Args): Promise<string> {
  const lines: string[] = [];
  const files: { file: string; pages: ReturnType<typeof listHarPages> }[] = [];
  for (const p of args.compareWith?.har ? [...args.pages, args.compareWith] : args.pages) {
    const pages = listHarPages(await readRecording("har", p.har));
    files.push({ file: p.har, pages });
    lines.push(`${p.har} (${pages.length} page${pages.length === 1 ? "" : "s"})`);
    for (const page of pages) {
      lines.push(`  ${page.id}  ${page.entries} entries  ${page.title || page.url}`);
    }
  }
  return args.format === "json" ? JSON.stringify({ files }, null, 2) : lines.join("\n");
}

/**
 * Reads a HAR (and its trace) into flow pages, keeping the selected pages of a multi-page HAR.
 * Without a page name, a single-page HAR is named after its file and the pages of a multi-page
 * HAR after their titles.
 */
async function readPageFlows(
  p: PageArg | CompareArg,
  spreads?: Map<PageFlow, RunSpread>
): Promise<PageFlow[]> {
  const har = await readRecording("har", p.har);
  const select = p.select !== undefined ? parsePageSelection(har, p.select) : undefined;
  const fileName = (p.har === STDIN ? STDIN_NAME : basename(p.har)).replace(/\.har(\.gz)?$/i, "");
  const pages = expandPageFlows({
    name: "name" in p ? p.name : har.length === 1 ? fileName : undefined,
    har,
    select,
    trace: p.trace ? await readRecording("trace", p.trace) : undefined,
  });
  // --runs belongs to a --har: the --compare-with HAR keeps the pages --compare-select picks.
  const runs: RunsChoice =
    ("runs" in p ? p.runs : undefined) ??
    ("name" in p && select === undefined ? { mode: "median" } : { mode: "all" });
  const { pages: expanded, notes } = keepRuns(pages, runs, p.har, spreads);
  if (har.length > 1) {
    console.error(
      `Note: ${p.har} contains ${har.length} pages; expanded into ${expanded.length} flow page${expanded.length === 1 ? "" : "s"}.`
    );
  }
  for (const note of notes) console.error(`Note: ${note}`);
  return expanded;
}

const RUN_METRIC_LABELS: Record<RunMetric, string> = {
  ttfb: "TTFB",
  serverWait: "server wait",
  fcp: "FCP",
  lcp: "LCP",
  cls: "CLS",
  inp: "INP",
  tbt: "TBT",
  dcl: "DCL",
  onLoad: "onLoad",
  requests: "requests",
  cacheHits: "cache hits",
  transferBytes: "transfer",
  cdnHitRatio: "CDN hit ratio",
  browserCacheHitRatio: "browser cache hit ratio",
};

// A HAR without pages has no page id; it is no WebPageTest run either.
const pageId = (page: PageFlow) => page.har.pages[0]?.id ?? "";

/**
 * Keeps the runs of a WebPageTest HAR that --runs asks for. A median page is named after the
 * runs it stands for, and `spreads` gets how its metrics varied over them. Pages that are not
 * WebPageTest runs stay. The notes say which runs were kept.
 */
function keepRuns(
  pages: PageFlow[],
  choice: RunsChoice,
  file: string,
  spreads?: Map<PageFlow, RunSpread>
): { pages: PageFlow[]; notes: string[] } {
  if (choice.mode === "all") return { pages, notes: [] };
  if (choice.mode === "run") {
    const runOf = pages.map((page) => parseRunId(pageId(page))?.run);
    const kept = pages.filter((_, i) => runOf[i] === choice.run);
    if (kept.length > 0) return { pages: kept, notes: [] };
    const runs = [...new Set(runOf.filter((run) => run !== undefined))].sort((a, b) => a - b);
    throw new Error(
      runs.length > 0
        ? `--runs ${choice.run}: the HAR has runs ${runs.join(", ")}.`
        : `--runs ${choice.run}: ${file} has no WebPageTest runs (page ids page_<run>_<view>_<step>).`
    );
  }

  const summaries = summarizeFlowMetrics(generateFlow(pages));
  const groups = groupRuns(
    pages.flatMap((flow, i) => {
      const metrics = summaries[i];
      return metrics ? [{ id: pageId(flow), metrics, flow }] : [];
    })
  ).filter((group) => group.runs.length > 1);
  if (groups.length === 0) return { pages, notes: [] };

  const grouped = new Set(groups.flatMap((group) => group.runs.map((r) => r.page.flow)));
  const medians = new Map<PageFlow, PageFlow>();
  const kept = groups.map((group) => {
    const median = pickMedianRun(group, choice.metric);
    const { flow } = median.page;
    const page = { ...flow, name: `${flow.name} (median of ${group.runs.length} runs)` };
    medians.set(flow, page);
    spreads?.set(page, runSpread(group));
    const by = median.metric ? RUN_METRIC_LABELS[median.metric] : "run number";
    const step = group.step > 1 ? `, step ${group.step}` : "";
    return {
      how: `the median of ${group.runs.length} runs by ${by}`,
      what: `${pageId(flow)} (${group.view} view${step})`,
    };
  });
  const hows = [...new Set(kept.map((k) => k.how))];
  const list =
    hows.length === 1
      ? `${hows[0]}: ${kept.map((k) => k.what).join(", ")}`
      : kept.map((k) => `${k.how}: ${k.what}`).join("; ");
  const notes = [`kept ${list}. Pass --runs all to keep every run.`];

  const lostTrace = pages.find((page) => page.trace && grouped.has(page) && !medians.has(page));
  const lostRun = lostTrace && parseRunId(pageId(lostTrace))?.run;
  if (lostTrace && lostRun) {
    notes.push(
      `the trace goes with ${pageId(lostTrace)}, which is not the median run; pass --runs ${lostRun} to keep it.`
    );
  }
  return {
    pages: pages.flatMap((page) => medians.get(page) ?? (grouped.has(page) ? [] : [page])),
    notes,
  };
}

/** The two single-page sides of a comparison, or null without --compare/--compare-with. */
async function comparisonSides(
  pageFlows: PageFlow[],
  args: Args
): Promise<[PageFlow, PageFlow] | null> {
  if (args.compare) {
    const [a, b] = pageFlows;
    if (pageFlows.length !== 2 || !a || !b) {
      throw new Error(
        `--compare needs exactly two pages; got ${pageFlows.length}. Pick two with --select (e.g. --select page_1_0_1,page_1_1_1) or pass two --page.`
      );
    }
    return [a, b];
  }
  if (!args.compareWith) return null;
  const other = await readPageFlows(args.compareWith);
  const [a] = pageFlows;
  const [b] = other;
  if (pageFlows.length !== 1 || other.length !== 1 || !a || !b) {
    const side = pageFlows.length !== 1 ? `A has ${pageFlows.length}` : `B has ${other.length}`;
    throw new Error(
      `--compare-with needs one page on each side; ${side}. Pick one with --select or --compare-select.`
    );
  }
  return [a, b];
}

/**
 * Says on stderr why a flow drawn without an explicit region shows the Great Firewall, and which
 * flag draws the default topology instead. In a comparison it names the side.
 */
function noteSuggestedRegion(flow: Flow, explicit: ClientRegion | undefined, side?: "A" | "B") {
  const suggestion = flow.hints.suggestedClientRegion;
  if (!suggestion || explicit !== undefined) return;
  const flag = side === "B" ? "--compare-region" : "--region";
  const whose = side ? `${side}'s latencies` : "latencies";
  const drawn = side ? `${side} with the` : "the";
  console.error(
    `Note: ${whose} look compatible with China/GFW routing (${suggestion.reason}), so the report draws ${drawn} GFW topology. A slow or mobile network shows the same latencies: pass ${flag} default to draw ${drawn} default topology.`
  );
}

/** The flow to report and, for a comparison, the second flow (B). */
export interface Report {
  flow: Flow;
  compare?: Flow;
}

/** The example the web app's demo button loads: a page of a real site with its trace. */
function demoFlow(): Flow {
  return normalizeFlow(JSON.parse(readFileSync(join(__dirname, "demo-flow.json"), "utf-8")));
}

function narrowToFilter(flows: Flow[], filter: string) {
  const kept = flows.map((f) => keepMatchingRequests(f, filter));
  const total = kept.reduce((sum, k) => sum + k.total, 0);
  const matching = kept.reduce((sum, k) => sum + k.matching, 0);
  console.error(
    `Note: --filter kept ${matching} of ${total} request${total === 1 ? "" : "s"}: "${filter}".`
  );
}

export async function buildReport(args: Args): Promise<Report> {
  if (args.demo) {
    const flow = demoFlow();
    if (args.filter !== undefined) narrowToFilter([flow], args.filter);
    return { flow };
  }
  const pageFlows: PageFlow[] = [];
  const spreads = new Map<PageFlow, RunSpread>();
  for (const p of args.pages) pageFlows.push(...(await readPageFlows(p, spreads)));

  const sides = await comparisonSides(pageFlows, args);
  // Each side of a comparison has its own region: two loads from different places differ.
  const flow = generateFlow(sides ? [sides[0]] : pageFlows, { clientRegion: args.region });
  const compare = sides
    ? generateFlow([sides[1]], { clientRegion: args.compareRegion })
    : undefined;
  for (const f of compare ? [flow, compare] : [flow]) {
    f.pages.forEach((page, i) => {
      const spread = spreads.get(page);
      const analysis = f.pageAnalyses[i];
      if (spread && analysis) analysis.runSpread = spread;
    });
  }

  noteSuggestedRegion(flow, args.region, compare ? "A" : undefined);
  if (compare) noteSuggestedRegion(compare, args.compareRegion, "B");
  if (args.filter !== undefined) narrowToFilter(compare ? [flow, compare] : [flow], args.filter);
  return compare ? { flow, compare } : { flow };
}

/**
 * Narrows each page's requests (`har.entries`) of the flow, in place, to those the resource
 * query matches. The metrics, findings and diagrams stay those of the whole capture.
 */
function keepMatchingRequests(flow: Flow, query: string): { matching: number; total: number } {
  let matching = 0;
  let total = 0;
  flow.pages = flow.pages.map((page) => {
    const rows = buildWaterfall(page.har, undefined, { filter: { search: query } }).rows;
    const keep = new Set(rows.map((row) => row.entryIndex));
    const entries = page.har.entries.filter((_, i) => keep.has(i));
    matching += entries.length;
    total += page.har.entries.length;
    return { ...page, har: { ...page.har, entries } };
  });
  return { matching, total };
}
