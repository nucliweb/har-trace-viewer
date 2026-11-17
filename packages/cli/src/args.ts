import { parseArgs as nodeParseArgs } from "node:util";
import {
  parseResourceQuery,
  isClientRegion,
  CLIENT_REGIONS,
  parseRunMetric,
  RUN_METRIC_CHOICES,
} from "@htv/core";
import type { ClientRegion, RunMetric } from "@htv/core";
import { STDIN } from "./recording";
import { parseBudgets, parseFailOn } from "./budget";
import { parseCheckFormat } from "./check-format";
import type { CheckFormat } from "./check-format";
import type { Budget, CheckOptions, FailOnSeverity } from "./budget";

export interface PageArg {
  name: string;
  har: string;
  trace?: string;
  /**
   * The files given as `.json` without a flag, when there are two or more: their content, not
   * their order, tells which is the HAR and which the trace.
   */
  jsonFiles?: string[];
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
  /** Reports the built-in example instead of a recording. */
  demo?: boolean;
  /** A request filter (the resource query language): only the matching requests are emitted. */
  filter?: string;
  region?: ClientRegion; // undefined when --region is absent
  /** B's region in a comparison; undefined when --compare-region is absent. */
  compareRegion?: ClientRegion;
  /** Every --budget, in the order given. */
  budgets?: Budget[];
  failOn?: FailOnSeverity;
  /** Fails a budget whose metric the page cannot provide instead of passing it. */
  budgetStrict?: boolean;
  /** The format of the check result; text when absent. */
  checkFormat?: CheckFormat;
  /** Writes the check result, in --check-format, to this file. */
  checkOutput?: string;
  /** Replaces third-party hostnames with placeholders in the report (--mask-hosts). */
  maskHosts?: boolean;
  /** One line per deprecated option given, for stderr. */
  deprecations?: string[];
  /** Starts the terminal report without the mouse reported; the m key turns it on. */
  noMouse?: boolean;
  /** Writes diagnostics to stderr. */
  debug?: boolean;
  help?: boolean;
  version?: boolean;
}

const HAR_FILE = /\.har(\.gz)?$/i;
const TRACE_FILE = /\.json(\.gz)?$/i;

function parseFormat(value: string | undefined): OutputFormat {
  if (OUTPUT_FORMATS.includes(value as OutputFormat)) return value as OutputFormat;
  throw new Error(`Invalid --format "${value ?? ""}". Valid values: ${OUTPUT_FORMATS.join(", ")}.`);
}

function parseFilter(value: string | undefined): string {
  const query = value ?? "";
  const { problems } = parseResourceQuery(query);
  if (problems.length > 0) {
    throw new Error(`Invalid --filter "${query}": ${problems.join("; ")}.`);
  }
  return query;
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

function parseRegion(value: string | undefined, flag = "--region"): ClientRegion {
  if (isClientRegion(value)) return value;
  throw new Error(`Invalid ${flag} "${value ?? ""}". Valid values: ${CLIENT_REGIONS.join(", ")}.`);
}

// --redact took an optional level, which node:util's parser cannot express: "=mask-hosts".
const REDACT_WITH_LEVEL = "--redact=";

const REDACT_DEPRECATION =
  "--redact is deprecated and will be removed: every report masks its secrets already.";
const REDACT_HOSTS_DEPRECATION =
  "--redact=mask-hosts is deprecated and will be removed: use --mask-hosts.";

export function parseArgs(argv: string[]): Args {
  let maskHosts = false;
  const deprecations: string[] = [];
  const { tokens } = nodeParseArgs({
    args: argv.filter((arg) => {
      if (!arg.startsWith(REDACT_WITH_LEVEL)) return true;
      const level = arg.slice(REDACT_WITH_LEVEL.length);
      if (level !== "mask-hosts") {
        throw new Error(
          `Invalid --redact "${level}". --redact is deprecated: every report masks its secrets already; use --mask-hosts to mask third-party hosts.`
        );
      }
      maskHosts = true;
      deprecations.push(REDACT_HOSTS_DEPRECATION);
      return false;
    }),
    options: {
      page: { type: "string", multiple: true },
      har: { type: "string", multiple: true },
      trace: { type: "string", multiple: true },
      select: { type: "string", multiple: true },
      runs: { type: "string", multiple: true },
      "list-pages": { type: "boolean" },
      demo: { type: "boolean" },
      filter: { type: "string" },
      compare: { type: "boolean" },
      "compare-with": { type: "string" },
      "compare-trace": { type: "string" },
      "compare-select": { type: "string" },
      output: { type: "string", short: "o" },
      format: { type: "string" },
      bundle: { type: "boolean" },
      region: { type: "string" },
      "compare-region": { type: "string" },
      budget: { type: "string", multiple: true },
      "fail-on": { type: "string" },
      "budget-strict": { type: "boolean" },
      "check-format": { type: "string" },
      "check-output": { type: "string" },
      redact: { type: "boolean" },
      "mask-hosts": { type: "boolean" },
      "no-mouse": { type: "boolean" },
      debug: { type: "boolean" },
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
  let demo = false;
  let filter: string | undefined;
  let help = false;
  let version = false;
  let noMouse = false;
  let debug = false;
  let region: ClientRegion | undefined;
  let compareRegion: ClientRegion | undefined;
  let compare = false;
  let compareWith: CompareArg | undefined;
  const budgets: Budget[] = [];
  let failOn: FailOnSeverity | undefined;
  let budgetStrict = false;
  let checkFormat: CheckFormat | undefined;
  let checkOutput: string | undefined;
  const compareArg = () => (compareWith ??= { har: "" });
  const lastPage = () => {
    if (pages.length === 0) pages.push({ name: "Page 1", har: "" });
    return pages[pages.length - 1];
  };
  const jsonGiven = new Map<PageArg, string[]>();
  // A file given without its flag: a HAR by its extension, a trace by its own.
  const addPositional = (value: string) => {
    if (value === STDIN || HAR_FILE.test(value)) lastPage().har = value;
    else if (TRACE_FILE.test(value)) {
      const page = lastPage();
      const given = (jsonGiven.get(page) ?? []).concat(value);
      jsonGiven.set(page, given);
      if (given.length > 1) page.jsonFiles = given;
      page.trace = value;
    } else {
      throw new Error(
        `Unexpected argument "${value}": pass HAR files as .har or .har.gz (or - for stdin) and traces as .json or .json.gz, or use --har and --trace.`
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
      case "demo":
        demo = true;
        break;
      case "filter":
        filter = parseFilter(value);
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
      case "compare-region":
        compareRegion = parseRegion(value, "--compare-region");
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
      case "check-format":
        checkFormat = parseCheckFormat(value);
        break;
      case "check-output":
        checkOutput = value;
        break;
      case "redact":
        deprecations.push(REDACT_DEPRECATION);
        break;
      case "mask-hosts":
        maskHosts = true;
        break;
      case "no-mouse":
        noMouse = true;
        break;
      case "debug":
        debug = true;
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
    ...(demo ? { demo } : {}),
    ...(filter !== undefined ? { filter } : {}),
    ...(compare ? { compare } : {}),
    ...(compareWith ? { compareWith } : {}),
    ...(region ? { region } : {}),
    ...(compareRegion ? { compareRegion } : {}),
    ...(budgets.length > 0 ? { budgets } : {}),
    ...(failOn ? { failOn } : {}),
    ...(budgetStrict ? { budgetStrict } : {}),
    ...(checkFormat ? { checkFormat } : {}),
    ...(checkOutput ? { checkOutput } : {}),
    ...(maskHosts ? { maskHosts } : {}),
    ...(deprecations.length > 0 ? { deprecations } : {}),
    ...(noMouse ? { noMouse } : {}),
    ...(debug ? { debug } : {}),
    ...(help ? { help } : {}),
    ...(version ? { version } : {}),
  };
}

/** The --budget and --fail-on checks to run, or null when neither was given. */
export function checkOptions(args: Args): CheckOptions | null {
  if (!args.budgets?.length && !args.failOn) return null;
  return {
    budgets: args.budgets ?? [],
    strict: args.budgetStrict === true,
    ...(args.failOn ? { failOn: args.failOn } : {}),
  };
}

// A trace adds detail to a HAR: given alone, the message names it rather than a missing flag.
const missingHar = (page: PageArg) =>
  page.trace
    ? `${page.trace} is a Chrome trace: it needs the HAR of the same recording, e.g. htv page.har ${page.trace}`
    : `Missing --har for page "${page.name}"`;

/** Where the standard input is named as a trace, or more than once: it can be read once. */
function stdinError(args: Args): string | null {
  const traces = [...args.pages, ...(args.compareWith ? [args.compareWith] : [])].map(
    (p) => p.trace
  );
  if (traces.includes(STDIN)) return "Reading stdin (-) works for a HAR only, not for a trace";
  const hars = [...args.pages.map((p) => p.har), args.compareWith?.har];
  if (hars.filter((har) => har === STDIN).length > 1) return "stdin (-) can be read once";
  return null;
}

/** What --demo cannot go with: the example is one page, already analysed, with no file behind. */
function demoError(args: Args): string | null {
  const extra =
    args.pages.length > 0
      ? "a recording"
      : args.listPages
        ? "--list-pages"
        : args.compare || args.compareWith
          ? "a comparison"
          : args.region || args.compareRegion
            ? "a region"
            : null;
  return extra
    ? `--demo reports the built-in example, a single page drawn as it is: drop ${extra}`
    : null;
}

export function validateArgs(args: Args): string | null {
  if (args.demo) return demoError(args);
  const stdin = stdinError(args);
  if (stdin) return stdin;
  if (args.filter !== undefined && args.listPages) {
    return "--filter narrows the requests of --format csv and json: drop it with --list-pages";
  }
  if (args.listPages) {
    if (args.pages.length === 0) return "";
    const missing = args.pages.find((p) => !p.har);
    return missing ? missingHar(missing) : null;
  }
  if (args.pages.length === 0) return "";
  if (args.compare && args.compareWith) return "Use either --compare or --compare-with, not both";
  if (args.compareWith && !args.compareWith.har) {
    return "--compare-trace and --compare-select need --compare-with";
  }
  if (args.compareRegion && !args.compare && !args.compareWith) {
    return "--compare-region needs --compare or --compare-with";
  }
  for (const p of args.pages) {
    if (!p.har) return missingHar(p);
  }
  if (args.budgets?.some((b) => b.delta) && !args.compare && !args.compareWith) {
    return "A delta: budget limits B against A: use it with --compare or --compare-with";
  }
  if ((args.checkFormat || args.checkOutput) && !checkOptions(args)) {
    return "--check-format and --check-output need --budget or --fail-on";
  }
  return null;
}
