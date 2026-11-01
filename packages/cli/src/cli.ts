import {
  readFileSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import {
  parseHarPagesJson,
  expandPageFlows,
  listHarPages,
  parsePageSelection,
  generateFlow,
  isClientRegion,
  findingsDocument,
  markdownReport,
  mermaidReport,
  requestsCsv,
  CLIENT_REGIONS,
  groupRuns,
  parseRunId,
  parseRunMetric,
  pickMedianRun,
  runSpread,
  summarizeFlowMetrics,
  RUN_METRIC_CHOICES,
} from "@htv/core";
import type { ClientRegion, Flow, PageFlow, RunMetric, RunSpread } from "@htv/core";
import { parseTraceFile, readTextFile } from "@htv/core/node";
import { buildFlowInjection } from "./serialize";
import { parseBudgets, parseFailOn } from "./budget";
import type { Budget, CheckOptions, FailOnSeverity } from "./budget";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PageArg {
  name: string;
  har: string;
  trace?: string;
  /** Page id(s) or text selecting which pages of a multi-page HAR to expand. */
  select?: string;
  /** Which runs of a WebPageTest HAR of several runs to keep. */
  runs?: RunsChoice;
}

/**
 * The runs of a WebPageTest HAR to keep: the median run of each view and step (ranked by
 * `metric`, LCP by default), every run, or one run.
 */
export type RunsChoice =
  { mode: "median"; metric?: RunMetric } | { mode: "all" } | { mode: "run"; run: number };

/** The recording a comparison report puts below the main flow (B). */
export interface CompareArg {
  har: string;
  trace?: string;
  select?: string;
}

/**
 * Where the report goes: the terminal, an HTML report, JSON, the findings as JSON, a Markdown
 * report, the requests as CSV or the document request as Mermaid diagrams.
 */
export type OutputFormat = "tui" | "html" | "json" | "findings" | "markdown" | "csv" | "mermaid";

const OUTPUT_FORMATS: readonly OutputFormat[] = [
  "tui",
  "html",
  "json",
  "findings",
  "markdown",
  "csv",
  "mermaid",
];

/** The formats written as text, with the --output extensions each accepts. */
export type TextFormat = "markdown" | "csv" | "mermaid";
const TEXT_EXTENSIONS: Record<TextFormat, readonly string[]> = {
  markdown: [".md", ".markdown"],
  csv: [".csv"],
  mermaid: [".md", ".mmd", ".mermaid"],
};
const hasExtension = (path: string, extensions: readonly string[]) =>
  extensions.some((ext) => path.toLowerCase().endsWith(ext));

export interface Args {
  pages: PageArg[];
  output: string; // "" without --output
  format?: OutputFormat; // undefined when --format is absent
  bundle: boolean;
  /** Compares the two pages of the flow: the first is A, the second B. */
  compare?: boolean;
  /** Compares the flow (A) with another recording (B). */
  compareWith?: CompareArg;
  listPages?: boolean;
  region?: ClientRegion; // undefined when --region is absent
  /** Every --budget, in the order given. */
  budgets?: Budget[];
  failOn?: FailOnSeverity;
  /** Fails a budget whose metric the page cannot provide instead of passing it. */
  budgetStrict?: boolean;
  help?: boolean;
  version?: boolean;
}

const HAR_FILE = /\.har(\.gz)?$/i;
const TRACE_FILE = /\.json(\.gz)?$/i;

function parseFormat(value: string | undefined): OutputFormat {
  if (OUTPUT_FORMATS.includes(value as OutputFormat)) return value as OutputFormat;
  throw new Error(`Invalid --format "${value ?? ""}". Valid values: ${OUTPUT_FORMATS.join(", ")}.`);
}

function parseRuns(value: string | undefined): RunsChoice {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "all") return { mode: "all" };
  if (text === "median") return { mode: "median" };
  if (/^[1-9]\d*$/.test(text)) return { mode: "run", run: Number(text) };
  const metric = text.startsWith("median:") ? parseRunMetric(text.slice("median:".length)) : null;
  if (metric) return { mode: "median", metric };
  throw new Error(
    `Invalid --runs "${value ?? ""}". Valid values: median, median:<metric>, all or a run number. Metrics: ${RUN_METRIC_CHOICES.join(", ")}.`
  );
}

function parseRegion(value: string | undefined): ClientRegion {
  if (isClientRegion(value)) return value;
  throw new Error(`Invalid --region "${value ?? ""}". Valid values: ${CLIENT_REGIONS.join(", ")}.`);
}

export function parseArgs(argv: string[]): Args {
  const { tokens } = nodeParseArgs({
    args: argv,
    options: {
      page: { type: "string", multiple: true },
      har: { type: "string", multiple: true },
      trace: { type: "string", multiple: true },
      select: { type: "string", multiple: true },
      runs: { type: "string", multiple: true },
      "list-pages": { type: "boolean" },
      compare: { type: "boolean" },
      "compare-with": { type: "string" },
      "compare-trace": { type: "string" },
      "compare-select": { type: "string" },
      output: { type: "string", short: "o" },
      format: { type: "string" },
      bundle: { type: "boolean" },
      region: { type: "string" },
      budget: { type: "string", multiple: true },
      "fail-on": { type: "string" },
      "budget-strict": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    tokens: true,
    allowPositionals: true,
    strict: true,
  });

  const pages: PageArg[] = [];
  let output = "";
  let format: OutputFormat | undefined;
  let bundle = false;
  let listPages = false;
  let help = false;
  let version = false;
  let region: ClientRegion | undefined;
  let compare = false;
  let compareWith: CompareArg | undefined;
  const budgets: Budget[] = [];
  let failOn: FailOnSeverity | undefined;
  let budgetStrict = false;
  const compareArg = () => (compareWith ??= { har: "" });
  const lastPage = () => {
    if (pages.length === 0) pages.push({ name: "Page 1", har: "" });
    return pages[pages.length - 1];
  };
  // A file given without its flag: a HAR by its extension, a trace by its own.
  const addPositional = (value: string) => {
    if (HAR_FILE.test(value)) lastPage().har = value;
    else if (TRACE_FILE.test(value)) lastPage().trace = value;
    else {
      throw new Error(
        `Unexpected argument "${value}": pass HAR files as .har or .har.gz and traces as .json or .json.gz, or use --har and --trace.`
      );
    }
  };

  for (const token of tokens ?? []) {
    if (token.kind === "positional") {
      addPositional(token.value);
      continue;
    }
    if (token.kind !== "option") continue;
    const value = token.value as string;
    switch (token.name) {
      case "page":
        pages.push({ name: value, har: "" });
        break;
      case "har":
        lastPage().har = value;
        break;
      case "trace":
        lastPage().trace = value;
        break;
      case "select":
        lastPage().select = value;
        break;
      case "runs":
        lastPage().runs = parseRuns(value);
        break;
      case "list-pages":
        listPages = true;
        break;
      case "compare":
        compare = true;
        break;
      case "compare-with":
        compareArg().har = value;
        break;
      case "compare-trace":
        compareArg().trace = value;
        break;
      case "compare-select":
        compareArg().select = value;
        break;
      case "output":
        output = value;
        break;
      case "format":
        format = parseFormat(value);
        break;
      case "bundle":
        bundle = true;
        break;
      case "region":
        region = parseRegion(value);
        break;
      case "budget":
        budgets.push(...parseBudgets(value));
        break;
      case "fail-on":
        failOn = parseFailOn(value);
        break;
      case "budget-strict":
        budgetStrict = true;
        break;
      case "help":
        help = true;
        break;
      case "version":
        version = true;
        break;
    }
  }

  return {
    pages,
    output,
    bundle,
    ...(format ? { format } : {}),
    ...(listPages ? { listPages } : {}),
    ...(compare ? { compare } : {}),
    ...(compareWith ? { compareWith } : {}),
    ...(region ? { region } : {}),
    ...(budgets.length > 0 ? { budgets } : {}),
    ...(failOn ? { failOn } : {}),
    ...(budgetStrict ? { budgetStrict } : {}),
    ...(help ? { help } : {}),
    ...(version ? { version } : {}),
  };
}

const ASSET_MIME: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Replaces `url(...)` references to local asset files with base64 data URIs. */
function inlineCssUrls(css: string, cssDir: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote, ref: string) => {
    const mime = ASSET_MIME[extname(ref.split(/[?#]/)[0]).toLowerCase()];
    if (!mime || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return match;
    const data = readFileSync(join(cssDir, ref.split(/[?#]/)[0]));
    return `url(data:${mime};base64,${data.toString("base64")})`;
  });
}

/** Inlines the built CSS, JS and the assets they reference into index.html. Works fully offline. */
export function bundleHtml(outputDir: string): void {
  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");

  // Font preloads point at files that are inlined into the CSS below
  html = html.replace(/<link\s+rel="preload"[^>]*href="\.\/assets\/[^"]+"[^>]*>\s*/g, "");

  html = html.replace(
    /<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+\.css)">/g,
    (_, href: string) => {
      const cssPath = join(outputDir, href);
      return `<style>${inlineCssUrls(readFileSync(cssPath, "utf-8"), dirname(cssPath))}</style>`;
    }
  );

  html = html.replace(
    /<script type="module" crossorigin src="(\.\/assets\/[^"]+\.js)"><\/script>/g,
    (_, src: string) => {
      const js = readFileSync(join(outputDir, src), "utf-8");
      return `<script type="module">${js}</script>`;
    }
  );

  writeFileSync(indexPath, html);
  rmSync(join(outputDir, "assets"), { recursive: true, force: true });
}

const isHtmlPath = (p: string) => p.toLowerCase().endsWith(".html");
const isJsonPath = (p: string) => p.toLowerCase().endsWith(".json");

export type OutputTarget =
  | { kind: "tui" }
  // A .html path is always a single self-contained file; a directory bundles with --bundle.
  | { kind: "html"; path: string; singleFile: boolean; bundle: boolean }
  // Without a path, the JSON goes to stdout.
  | { kind: "json"; path?: string }
  // The findings document; without a path, it goes to stdout.
  | { kind: "findings"; path?: string }
  // A Markdown report, the requests as CSV or Mermaid diagrams; without a path, to stdout.
  | { kind: TextFormat; path?: string }
  // No report: only the result of --budget and --fail-on, on stdout.
  | { kind: "check" };

/** The --budget and --fail-on checks to run, or null when neither was given. */
export function checkOptions(args: Args): CheckOptions | null {
  if (!args.budgets?.length && !args.failOn) return null;
  return {
    budgets: args.budgets ?? [],
    strict: args.budgetStrict === true,
    ...(args.failOn ? { failOn: args.failOn } : {}),
  };
}

/**
 * Where the report goes, from --output and --format: no --output shows it in the terminal,
 * or only prints the check result with --budget or --fail-on; a .json path or --format json
 * writes JSON, any other path writes HTML.
 */
export function outputTarget(args: Args, stdoutIsTerminal: boolean): OutputTarget {
  const { output } = args;
  // A .md or .csv path asks for that format when --format is absent, as .json does.
  const format =
    args.format ??
    (hasExtension(output, TEXT_EXTENSIONS.markdown)
      ? "markdown"
      : hasExtension(output, TEXT_EXTENSIONS.csv)
        ? "csv"
        : undefined);
  if (format === "tui" && output) {
    throw new Error("--format tui shows the report in the terminal: drop --output");
  }
  const checks = checkOptions(args) !== null;
  if (format === "tui" && checks) {
    throw new Error(
      "--budget and --fail-on print a check result instead of the terminal report: drop --format tui"
    );
  }
  if (format === "html" && (!output || isJsonPath(output))) {
    throw new Error("--format html needs -o <dir|file.html>");
  }
  if ((format === "json" || format === "findings") && output && !isJsonPath(output)) {
    throw new Error(
      `--format ${format} needs a .json --output path, or no --output to print to stdout`
    );
  }
  if (format === "markdown" || format === "csv" || format === "mermaid") {
    if (output && !hasExtension(output, TEXT_EXTENSIONS[format])) {
      throw new Error(
        `--format ${format} needs a ${TEXT_EXTENSIONS[format].join(" or ")} --output path, or no --output to print to stdout`
      );
    }
    return output ? { kind: format, path: output } : { kind: format };
  }
  if (format === "findings") {
    return output ? { kind: "findings", path: output } : { kind: "findings" };
  }
  if (format === "json" || isJsonPath(output))
    return output ? { kind: "json", path: output } : { kind: "json" };
  if (output) {
    const singleFile = isHtmlPath(output);
    return { kind: "html", path: output, singleFile, bundle: singleFile || args.bundle };
  }
  if (checks) return { kind: "check" };
  if (!stdoutIsTerminal) {
    throw new Error(
      "The terminal report needs an interactive terminal: pass -o report.html, -o report.json or --format json."
    );
  }
  return { kind: "tui" };
}

export const USAGE = `Usage: htv <file.har[.gz]> [<trace.json[.gz]>] [-o <dir|file.html|file.json>] [--format tui|html|json|findings|markdown|csv|mermaid] [options]
       htv --page <name> --har <file.har[.gz]> [--trace <file.json[.gz]>] [--page <name> ...] [options]`;

export const HELP = `${USAGE}

Analyzes HAR and Chrome trace files: browses the report in the terminal, writes a
self-contained HTML report to share, or writes JSON for other tools and AI agents.

Output (where the report goes):
  (no --output)       Browse the report in the terminal: findings, waterfall,
                      metrics, steps, hosts and cache & network, one tab each.
                      Needs an interactive terminal.
  -o, --output <path> file.html: a single self-contained HTML file that opens offline.
                      file.json: the full analysis as JSON.
                      Any other path: a directory with index.html and its assets.
  --format <format>   tui | html | json | findings. --format json without --output
                      prints the JSON to stdout, e.g. to pipe it into an agent.
                      --format findings writes only the findings of each page (rule
                      id, severity, metric, summary, recommendation, evidence) and its
                      metrics as compact JSON, to stdout or a .json --output.
                      --format markdown writes a report to paste into a ticket or a
                      doc (metrics, findings and hosts per page; a comparison table
                      first for two sides), to stdout or a .md --output (-o file.md
                      alone picks it). --format csv writes one row per request of
                      every page, as RFC 4180 CSV, to stdout or a .csv --output.
                      --format mermaid writes a sequence diagram of the document
                      request per page (Browser, CDN edge, origin), to stdout or a
                      .md, .mmd or .mermaid --output.
  --bundle            For a directory --output: inline every asset into index.html.

Input:
  <file>              A HAR (.har or .har.gz) or a Chrome trace (.json or .json.gz)
                      given without its flag, attached to the preceding --page.
                      A HAR with another extension needs --har.
  --page <name>       Start a page in the report; repeat once per page.
                      The following files, --har and --trace attach to it.
  --har <file>        HAR file for the preceding --page (.har or .har.gz).
                      Without a --page, a page named "Page 1" is created.
  --trace <file>      Chrome trace for the preceding --page (.json or .json.gz).
  --select <value>    For the preceding --har with several pages (e.g. WebPageTest
                      runs): keep only the matching pages. A page id, a comma-
                      separated list of ids, or text/regex matched against id,
                      title and URL ("Run 1, First"). Default: all pages, but
                      only the median run of a WebPageTest HAR (see --runs).
  --runs <median|all|N>
                      For the preceding --har with several WebPageTest runs:
                      median keeps the median run of each view (first, repeat)
                      and step, ranked by LCP (else onLoad, else DCL), named
                      "median of N runs", with the min, median and max of every
                      metric over the runs. median:<metric> ranks by another
                      metric (ttfb, fcp, lcp, dcl, onload, ...). all keeps every
                      run, N keeps run N. Default: median without --select, all
                      with it; with both, the median of the selected pages.
  --list-pages        Print the pages (id, title, entries) of each --har and exit.

Comparison:
  --compare           Compare the two pages of the flow instead of chaining them:
                      the first page is A (top), the second B (bottom). The flow
                      must have exactly two pages, e.g. a WebPageTest first view
                      and repeat view picked with --select.
  --compare-with <file>
                      Compare the flow (A, one page) with another HAR (B).
  --compare-trace <file>
                      Chrome trace for the --compare-with HAR.
  --compare-select <value>
                      Page of a multi-page --compare-with HAR, as --select.

CI checks (each page, both sides of a comparison; the result goes to stderr after
the report, or to stdout without --output instead of the terminal report):
  --budget <metric>=<value>[,<metric>=<value>...]
                      Fail when a page goes over a limit; repeatable. Metrics:
                      ttfb, server-wait, fcp, lcp, dcl, onload, inp in ms
                      (2500, 2500ms or 2.5s); cls (0.1); requests (80);
                      transfer in bytes (500000, 500kb, 1.5mb; 1 kb = 1000 B);
                      cdn-hit-ratio and cache-hit-ratio as minimums (0.9 or 90%).
  --budget-strict     Fail a budget whose metric the page lacks (LCP without a
                      trace); by default it passes as n/a.
  --fail-on <severity>
                      critical | warning: fail when a finding of that severity or
                      worse exists: a recommendation of the cache, network or
                      other reports, or a Core Web Vital or TTFB rated poor
                      (critical) or needing improvement (warning).
  Exit codes: 0 every check passed, 2 a check failed (the report is still
  written), 1 usage or input errors.

Other:
  --region <id>       Client network region: ${CLIENT_REGIONS.join(" | ")} (default: default).
                      "cn" draws the Great Firewall before the first server.
  -h, --help          Show this help.
  -v, --version       Show the version.

Examples:
  htv page.har                                # browse in the terminal
  htv page.har trace.json.gz -o report.html   # share one HTML file, with a trace
  htv page.har --format json | my-agent       # JSON for an AI agent
  htv page.har trace.json.gz --format findings # what to fix, as compact JSON

  # Two pages, with a trace for the first one:
  htv --page "Home" --har home.har --trace home.json.gz \
      --page "Checkout" --har checkout.har -o report.html

  # WebPageTest first view vs repeat view, i.e. without and with cache:
  htv --har wpt.har --select page_1_0_1,page_1_1_1 --compare -o compare.html

  # CI: exit 2 when LCP goes over 2.5 s, the page over 1.5 MB or a warning shows up:
  htv page.har trace.json.gz --budget lcp=2.5s,transfer=1.5mb --fail-on warning

Without --bundle a directory report loads ES modules from assets/, which browsers
block over file://; serve the folder over HTTP (npx serve report/) or write a
.html file, which opens by double-click.`;

export function printUsage() {
  console.error(USAGE);
}

export function validateArgs(args: Args): string | null {
  if (args.listPages) {
    if (args.pages.length === 0) return "";
    const missing = args.pages.find((p) => !p.har);
    return missing ? `Missing --har for page "${missing.name}"` : null;
  }
  if (args.pages.length === 0) return "";
  if (args.compare && args.compareWith) return "Use either --compare or --compare-with, not both";
  if (args.compareWith && !args.compareWith.har) {
    return "--compare-trace and --compare-select need --compare-with";
  }
  for (const p of args.pages) {
    if (!p.har) return `Missing --har for page "${p.name}"`;
  }
  return null;
}

/** Describes the pages of each --har: id, entries and title. */
export async function listPagesReport(args: Args): Promise<string> {
  const lines: string[] = [];
  for (const p of args.compareWith?.har ? [...args.pages, args.compareWith] : args.pages) {
    const pages = listHarPages(parseHarPagesJson(await readTextFile(resolve(p.har))));
    lines.push(`${p.har} (${pages.length} page${pages.length === 1 ? "" : "s"})`);
    for (const page of pages) {
      lines.push(`  ${page.id}  ${page.entries} entries  ${page.title || page.url}`);
    }
  }
  return lines.join("\n");
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
  const har = parseHarPagesJson(await readTextFile(resolve(p.har)));
  const select = p.select !== undefined ? parsePageSelection(har, p.select) : undefined;
  const fileName = basename(p.har).replace(/\.har(\.gz)?$/i, "");
  const pages = expandPageFlows({
    name: "name" in p ? p.name : har.length === 1 ? fileName : undefined,
    har,
    select,
    trace: p.trace ? await parseTraceFile(resolve(p.trace)) : undefined,
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
  dcl: "DCL",
  onLoad: "onLoad",
  requests: "requests",
  cacheHits: "cache hits",
  transferBytes: "transfer",
  cdnHitRatio: "CDN hit ratio",
  browserCacheHitRatio: "browser cache hit ratio",
};

const pageId = (page: PageFlow) => page.har.pages[0].id;

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
    pages.map((flow, i) => ({ id: pageId(flow), metrics: summaries[i], flow }))
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
    if (pageFlows.length !== 2) {
      throw new Error(
        `--compare needs exactly two pages; got ${pageFlows.length}. Pick two with --select (e.g. --select page_1_0_1,page_1_1_1) or pass two --page.`
      );
    }
    return [pageFlows[0], pageFlows[1]];
  }
  if (!args.compareWith) return null;
  const other = await readPageFlows(args.compareWith);
  if (pageFlows.length !== 1 || other.length !== 1) {
    const side = pageFlows.length !== 1 ? `A has ${pageFlows.length}` : `B has ${other.length}`;
    throw new Error(
      `--compare-with needs one page on each side; ${side}. Pick one with --select or --compare-select.`
    );
  }
  return [pageFlows[0], other[0]];
}

/** The flow to report and, for a comparison, the second flow (B). */
export interface Report {
  flow: Flow;
  compare?: Flow;
}

export async function buildReport(args: Args): Promise<Report> {
  const pageFlows: PageFlow[] = [];
  const spreads = new Map<PageFlow, RunSpread>();
  for (const p of args.pages) pageFlows.push(...(await readPageFlows(p, spreads)));

  const options = { clientRegion: args.region ?? "default" } as const;
  const sides = await comparisonSides(pageFlows, args);
  const flow = generateFlow(sides ? [sides[0]] : pageFlows, options);
  const compare = sides ? generateFlow([sides[1]], options) : undefined;
  for (const f of compare ? [flow, compare] : [flow]) {
    f.pages.forEach((page, i) => {
      const spread = spreads.get(page);
      if (spread) f.pageAnalyses[i].runSpread = spread;
    });
  }

  const suggestion = flow.hints.suggestedClientRegion;
  if (suggestion && args.region === undefined) {
    console.error(
      `Note: latencies look compatible with China/GFW routing (${suggestion.reason}). Re-run with --region ${suggestion.region} to show the GFW topology.`
    );
  }
  return compare ? { flow, compare } : { flow };
}

/**
 * The report as JSON for other tools: the full flow (or both flows of a comparison), with the
 * htv version that produced it. Each flow carries its own data-model version.
 */
export function reportJson({ flow, compare }: Report, htvVersion: string): string {
  const body = compare
    ? { htvVersion, kind: "comparison", a: flow, b: compare }
    : { htvVersion, kind: "flow", flow };
  return JSON.stringify(body, null, 2);
}

/** Where the JSON schema of the findings document is published: inside this version's package. */
export const findingsSchemaUrl = (htvVersion: string) =>
  `https://unpkg.com/har-trace-viewer@${htvVersion}/dist/findings.schema.json`;

/**
 * The findings of the report as JSON: per page (both sides of a comparison), its metrics
 * summary and its findings, with the htv version and the schema that describes the document.
 */
export function reportFindings(
  { flow, compare }: Report,
  htvVersion: string,
  generatedAt = new Date().toISOString()
): string {
  const flows = compare
    ? [
        { flow, side: "a" as const },
        { flow: compare, side: "b" as const },
      ]
    : [{ flow }];
  const doc = findingsDocument(flows, {
    htvVersion,
    generatedAt,
    schema: findingsSchemaUrl(htvVersion),
  });
  return JSON.stringify(doc, null, 2);
}

/** The report as text, for the Markdown, CSV and Mermaid formats. */
export function reportText(format: TextFormat, { flow, compare }: Report): string {
  switch (format) {
    case "markdown":
      return markdownReport(flow, compare);
    case "csv":
      return requestsCsv(flow, compare);
    case "mermaid":
      return mermaidReport(flow, compare);
  }
}

/** Writes the HTML report and returns the path of its page. */
export function writeHtmlReport(
  { flow, compare }: Report,
  target: Extract<OutputTarget, { kind: "html" }>
): string {
  const path = resolve(target.path);
  const outputDir = target.singleFile ? mkdtempSync(join(tmpdir(), "htv-report-")) : path;
  try {
    return writeReport(
      flow,
      compare,
      outputDir,
      target.bundle,
      target.singleFile ? path : undefined
    );
  } finally {
    if (target.singleFile) rmSync(outputDir, { recursive: true, force: true });
  }
}

function writeReport(
  flow: Flow,
  compare: Flow | undefined,
  outputDir: string,
  bundle: boolean,
  singleFile?: string
): string {
  mkdirSync(outputDir, { recursive: true });

  const webDir = join(__dirname, "web");
  cpSync(webDir, outputDir, { recursive: true });

  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");
  const injection = buildFlowInjection(flow, compare);
  // Function replacer: a string replacement would interpret "$&", "$'" etc. found in the payload.
  html = html.replace("</head>", () => `${injection}\n</head>`);
  writeFileSync(indexPath, html);

  if (bundle) {
    bundleHtml(outputDir);
  }

  if (singleFile) {
    mkdirSync(dirname(singleFile), { recursive: true });
    try {
      renameSync(indexPath, singleFile);
    } catch {
      // Cross-device move (temp dir on another filesystem)
      writeFileSync(singleFile, readFileSync(indexPath));
    }
    return singleFile;
  }

  return indexPath;
}
