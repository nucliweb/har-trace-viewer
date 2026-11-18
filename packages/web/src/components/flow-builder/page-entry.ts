import {
  defaultComparePageIds,
  defaultSelectedPageIds,
  expandPageFlows,
  listHarPages,
  webPageTestLabel,
} from "@htv/core";
import type { ClientRegion, FlowOptions, PageFlow, ParsedHar, ParsedTrace } from "@htv/core";
import type { Messages } from "../../i18n/en.js";
import { ParserCrashError, parseInWorker } from "../../lib/parse-client.js";
import type { ParseProgress } from "../../lib/parse-protocol.js";
import { TRACE_FILE, classifyRecordingFile } from "./drop-plan.js";

/** One recording of the builder: its HAR, its optional trace and what loading them is up to. */
export interface PageEntry {
  id: string;
  name: string;
  har: ParsedHar[] | null;
  /** Ids of the HAR pages to expand; only meaningful when the HAR has several pages. */
  selectedPageIds: string[];
  harFileName: string;
  trace: ParsedTrace | null;
  traceFileName: string;
  harError: EntryError | null;
  traceError: EntryError | null;
  harProgress: ParseProgress | null;
  traceProgress: ParseProgress | null;
  /** Two page ids of a multi-page HAR proposed for a comparison (first vs repeat view). */
  comparePair: [string, string] | null;
  /** Compare comparePair[0] (A) with comparePair[1] (B) instead of building a flow. */
  comparePages: boolean;
}

export type EntryPatch = Partial<PageEntry>;

/** Why a file did not load: the parsers' own messages, or one the interface words itself. */
export type EntryError =
  | { kind: "har-extension" }
  | { kind: "trace-extension" }
  | { kind: "parser-crash"; detail?: string }
  // A parser's error: its code and parameters are worded in the interface language, so the row
  // re-words itself when the language changes; the English message stands in for an unknown code.
  | { kind: "parse"; code: string; params: Record<string, string>; message: string }
  // Any other message is shown as it is.
  | { kind: "message"; message: string };

type BuilderMessages = Messages["builder"];

const PARSE_ERROR_TEXT = {
  "not-json": "notJson",
  "unrecognized-json": "unrecognizedJson",
  "wrong-kind": "wrongKind",
  "har-no-entries": "harNoEntries",
  "har-no-usable-entries": "harNoUsableEntries",
  "trace-no-navigation": "traceNoNavigation",
  "gzip-unsupported": "gzipUnsupported",
  "gzip-invalid": "gzipInvalid",
} as const satisfies Record<string, keyof BuilderMessages["parseErrors"]>;

const parseErrorText = (code: string) =>
  Object.hasOwn(PARSE_ERROR_TEXT, code)
    ? PARSE_ERROR_TEXT[code as keyof typeof PARSE_ERROR_TEXT]
    : undefined;

/** Whether the interface words the error, as opposed to showing an English message as it is. */
export const isWordedByInterface = (error: EntryError): boolean =>
  error.kind === "parse" ? parseErrorText(error.code) !== undefined : error.kind !== "message";

export function describeEntryError(error: EntryError, t: BuilderMessages): string {
  switch (error.kind) {
    case "har-extension":
      return t.harExtension;
    case "trace-extension":
      return t.traceExtension;
    case "parser-crash":
      return t.parserCrash(error.detail);
    case "parse": {
      const key = parseErrorText(error.code);
      if (key === undefined) return error.message;
      const text = t.parseErrors[key];
      return typeof text === "function" ? text(error.params) : text;
    }
    case "message":
      return error.message;
  }
}

export function makeEntry(name = ""): PageEntry {
  return {
    id: crypto.randomUUID(),
    name,
    har: null,
    selectedPageIds: [],
    harFileName: "",
    trace: null,
    traceFileName: "",
    harError: null,
    traceError: null,
    harProgress: null,
    traceProgress: null,
    comparePair: null,
    comparePages: false,
  };
}

export function describeProgress(
  { phase, loaded, total }: ParseProgress,
  t: BuilderMessages
): string {
  const label = `${t.progress[phase]}…`;
  return phase === "parsing" || total === 0
    ? label
    : `${label} ${Math.min(100, Math.round((loaded / total) * 100))} %`;
}

/** A loaded HAR contributes pages unless it has several and none is ticked. */
export function hasFlowPages(p: PageEntry): boolean {
  return p.har !== null && (p.har.length === 1 || p.selectedPageIds.length > 0);
}

export const isEntryParsing = (p: PageEntry) => p.harProgress !== null || p.traceProgress !== null;

/** A trace only adds detail to the HAR of its recording: without one, the entry is incomplete. */
export const needsHar = (p: PageEntry) => p.har === null && p.trace !== null;

/** A parser's error carries a `code` and its `params` (see ParseError in @htv/core). */
const codeOf = (error: unknown): { code: string; params: Record<string, string> } | null => {
  if (!(error instanceof Error)) return null;
  const { code, params } = error as { code?: unknown; params?: unknown };
  return typeof code === "string" && typeof params === "object" && params !== null
    ? { code, params: params as Record<string, string> }
    : null;
};

const toEntryError = (error: unknown): EntryError => {
  if (error instanceof ParserCrashError) return { kind: "parser-crash", detail: error.detail };
  const coded = codeOf(error);
  if (coded) return { kind: "parse", ...coded, message: (error as Error).message };
  return { kind: "message", message: error instanceof Error ? error.message : String(error) };
};

/** Loads a file given as the recording's HAR: a trace, by its name, goes to the trace instead. */
export function loadRecordingFile(file: File, apply: (patch: EntryPatch) => void) {
  if (classifyRecordingFile(file) === "trace") void loadTraceFile(file, apply);
  else loadHarFile(file, apply);
}

/** Parses a dropped HAR in the worker, reporting progress and the result through `apply`. */
export function loadHarFile(file: File, apply: (patch: EntryPatch) => void) {
  if (!/\.har(\.gz)?$/i.test(file.name)) {
    apply({ harError: { kind: "har-extension" } });
    return;
  }
  apply({ harProgress: { phase: "reading", loaded: 0, total: file.size }, harError: null });
  parseInWorker("har", file, (harProgress) => apply({ harProgress }))
    .then((har) =>
      apply({
        har,
        selectedPageIds: defaultSelectedPageIds(har),
        comparePair: defaultComparePageIds(har),
        harFileName: file.name,
        harError: null,
        harProgress: null,
      })
    )
    .catch((error: unknown) => apply({ harError: toEntryError(error), harProgress: null }));
}

/** Parses a dropped Chrome trace in the worker, reporting progress and the result through `apply`. */
export async function loadTraceFile(file: File, apply: (patch: EntryPatch) => void) {
  if (!TRACE_FILE.test(file.name) && !file.name.endsWith(".gz")) {
    apply({ traceError: { kind: "trace-extension" } });
    return;
  }
  apply({ traceProgress: { phase: "reading", loaded: 0, total: file.size }, traceError: null });
  try {
    const trace = await parseInWorker("trace", file, (traceProgress) => apply({ traceProgress }));
    apply({ trace, traceFileName: file.name, traceError: null, traceProgress: null });
  } catch (error) {
    apply({ traceError: toEntryError(error), traceProgress: null });
  }
}

export const pageOptionLabel = (
  page: ReturnType<typeof listHarPages>[number],
  t: BuilderMessages
) => t.pageOption(webPageTestLabel(page.title) ?? (page.title || page.url), page.entries);

/** What the Generate button builds: the flow's pages, its options and the pages of B, if any. */
interface Generation {
  pages: PageFlow[];
  options: FlowOptions;
  comparePages?: PageFlow[];
}

/** Two pages of a single multi-page HAR (first vs repeat view) can be compared directly. */
export function pagePairOf(pages: PageEntry[]): [string, string] | null {
  const [first] = pages;
  if (!first) return null;
  const pickerAvailable = pages.length === 1 && (first.har?.length ?? 0) > 1;
  return pickerAvailable && first.comparePages ? first.comparePair : null;
}

/** The flows the entries describe: a comparison of two pages of one HAR, or the pages (with B). */
export function buildGeneration(
  pages: PageEntry[],
  compareEntry: PageEntry,
  clientRegion: ClientRegion | undefined,
  // The name of a page left unnamed.
  fallbackName = "Page"
): Generation {
  // Without a region the flow takes the one its latencies suggest.
  const options: FlowOptions = clientRegion ? { clientRegion } : {};
  const pagePair = pagePairOf(pages);
  const [first] = pages;
  if (pagePair && first) {
    const side = (id: string) =>
      expandPageFlows({
        name: first.name.trim() || fallbackName,
        har: first.har!,
        select: { pageIds: [id] },
        // The trace belongs to one recording: it stays with A.
        ...(first.trace && id === pagePair[0] ? { trace: first.trace } : {}),
      });
    return { pages: side(pagePair[0]), options, comparePages: side(pagePair[1]) };
  }
  const pageFlows: PageFlow[] = pages.filter(hasFlowPages).flatMap((p) =>
    expandPageFlows({
      name: p.name.trim() || fallbackName,
      har: p.har!,
      ...(p.har!.length > 1 ? { select: { pageIds: p.selectedPageIds } } : {}),
      ...(p.trace ? { trace: p.trace } : {}),
    })
  );
  const compareHar = compareEntry.har;
  if (!compareHar) return { pages: pageFlows, options };
  const comparePages = expandPageFlows({
    ...(compareHar.length === 1
      ? { name: compareEntry.harFileName.replace(/\.har$/i, "") }
      : { select: { pageIds: compareEntry.selectedPageIds.slice(0, 1) } }),
    har: compareHar,
    ...(compareEntry.trace ? { trace: compareEntry.trace } : {}),
  });
  return { pages: pageFlows, options, comparePages };
}
