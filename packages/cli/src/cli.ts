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
  CLIENT_REGIONS,
} from "@htv/core";
import type { ClientRegion, Flow, PageFlow } from "@htv/core";
import { parseTraceFile, readTextFile } from "@htv/core/node";
import { buildFlowInjection } from "./serialize";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PageArg {
  name: string;
  har: string;
  trace?: string;
  /** Page id(s) or text selecting which pages of a multi-page HAR to expand. */
  select?: string;
}

/** The recording a comparison report puts below the main flow (B). */
export interface CompareArg {
  har: string;
  trace?: string;
  select?: string;
}

/** Where the report goes: the terminal, an HTML report or JSON. */
export type OutputFormat = "tui" | "html" | "json";

const OUTPUT_FORMATS: readonly OutputFormat[] = ["tui", "html", "json"];

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
  help?: boolean;
  version?: boolean;
}

const HAR_FILE = /\.har(\.gz)?$/i;
const TRACE_FILE = /\.json(\.gz)?$/i;

function parseFormat(value: string | undefined): OutputFormat {
  if (OUTPUT_FORMATS.includes(value as OutputFormat)) return value as OutputFormat;
  throw new Error(`Invalid --format "${value ?? ""}". Valid values: ${OUTPUT_FORMATS.join(", ")}.`);
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
      "list-pages": { type: "boolean" },
      compare: { type: "boolean" },
      "compare-with": { type: "string" },
      "compare-trace": { type: "string" },
      "compare-select": { type: "string" },
      output: { type: "string", short: "o" },
      format: { type: "string" },
      bundle: { type: "boolean" },
      region: { type: "string" },
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
  | { kind: "json"; path?: string };

/**
 * Where the report goes, from --output and --format: no --output shows it in the terminal,
 * a .json path or --format json writes JSON, any other path writes HTML.
 */
export function outputTarget(args: Args, stdoutIsTerminal: boolean): OutputTarget {
  const { output, format } = args;
  if (format === "tui" && output) {
    throw new Error("--format tui shows the report in the terminal: drop --output");
  }
  if (format === "html" && (!output || isJsonPath(output))) {
    throw new Error("--format html needs -o <dir|file.html>");
  }
  if (format === "json" && output && !isJsonPath(output)) {
    throw new Error("--format json needs a .json --output path, or no --output to print to stdout");
  }
  if (format === "json" || isJsonPath(output))
    return output ? { kind: "json", path: output } : { kind: "json" };
  if (output) {
    const singleFile = isHtmlPath(output);
    return { kind: "html", path: output, singleFile, bundle: singleFile || args.bundle };
  }
  if (!stdoutIsTerminal) {
    throw new Error(
      "The terminal report needs an interactive terminal: pass -o report.html, -o report.json or --format json."
    );
  }
  return { kind: "tui" };
}

export const USAGE = `Usage: htv <file.har[.gz]> [<trace.json[.gz]>] [-o <dir|file.html|file.json>] [--format tui|html|json] [options]
       htv --page <name> --har <file.har[.gz]> [--trace <file.json[.gz]>] [--page <name> ...] [options]`;

export const HELP = `${USAGE}

Analyzes HAR and Chrome trace files: browses the report in the terminal, writes a
self-contained HTML report to share, or writes JSON for other tools and AI agents.

Output (where the report goes):
  (no --output)       Browse the report in the terminal: metrics, steps, hosts and
                      cache, one tab each. Needs an interactive terminal.
  -o, --output <path> file.html: a single self-contained HTML file that opens offline.
                      file.json: the full analysis as JSON.
                      Any other path: a directory with index.html and its assets.
  --format <format>   tui | html | json. --format json without --output prints
                      the JSON to stdout, e.g. to pipe it into an agent.
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
                      title and URL ("Run 1, First"). Default: all pages.
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

Other:
  --region <id>       Client network region: ${CLIENT_REGIONS.join(" | ")} (default: default).
                      "cn" draws the Great Firewall before the first server.
  -h, --help          Show this help.
  -v, --version       Show the version.

Examples:
  htv page.har                                # browse in the terminal
  htv page.har trace.json.gz -o report.html   # share one HTML file, with a trace
  htv page.har --format json | my-agent       # JSON for an AI agent

  # Two pages, with a trace for the first one:
  htv --page "Home" --har home.har --trace home.json.gz \
      --page "Checkout" --har checkout.har -o report.html

  # WebPageTest first view vs repeat view, i.e. without and with cache:
  htv --har wpt.har --select page_1_0_1,page_1_1_1 --compare -o compare.html

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
async function readPageFlows(p: PageArg | CompareArg): Promise<PageFlow[]> {
  const har = parseHarPagesJson(await readTextFile(resolve(p.har)));
  const select = p.select !== undefined ? parsePageSelection(har, p.select) : undefined;
  const fileName = basename(p.har).replace(/\.har(\.gz)?$/i, "");
  const expanded = expandPageFlows({
    name: "name" in p ? p.name : har.length === 1 ? fileName : undefined,
    har,
    select,
    trace: p.trace ? await parseTraceFile(resolve(p.trace)) : undefined,
  });
  if (har.length > 1) {
    console.error(
      `Note: ${p.har} contains ${har.length} pages; expanded into ${expanded.length} flow page${expanded.length === 1 ? "" : "s"}.`
    );
  }
  return expanded;
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
  for (const p of args.pages) pageFlows.push(...(await readPageFlows(p)));

  const options = { clientRegion: args.region ?? "default" } as const;
  const sides = await comparisonSides(pageFlows, args);
  const flow = generateFlow(sides ? [sides[0]] : pageFlows, options);
  const compare = sides ? generateFlow([sides[1]], options) : undefined;

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
