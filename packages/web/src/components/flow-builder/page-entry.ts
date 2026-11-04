import {
  defaultComparePageIds,
  defaultSelectedPageIds,
  expandPageFlows,
  listHarPages,
  webPageTestLabel,
} from "@htv/core";
import type { ClientRegion, FlowOptions, PageFlow, ParsedHar, ParsedTrace } from "@htv/core";
import { parseInWorker } from "../../lib/parse-client.js";
import type { ParseProgress } from "../../lib/parse-protocol.js";

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
  harError: string | null;
  traceError: string | null;
  harProgress: ParseProgress | null;
  traceProgress: ParseProgress | null;
  /** Two page ids of a multi-page HAR proposed for a comparison (first vs repeat view). */
  comparePair: [string, string] | null;
  /** Compare comparePair[0] (A) with comparePair[1] (B) instead of building a flow. */
  comparePages: boolean;
}

export type EntryPatch = Partial<PageEntry>;

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

const PHASE_LABEL = { reading: "Reading", decompressing: "Decompressing", parsing: "Parsing" };

export function describeProgress({ phase, loaded, total }: ParseProgress): string {
  const label = `${PHASE_LABEL[phase]}…`;
  return phase === "parsing" || total === 0
    ? label
    : `${label} ${Math.min(100, Math.round((loaded / total) * 100))} %`;
}

/** A loaded HAR contributes pages unless it has several and none is ticked. */
export function hasFlowPages(p: PageEntry): boolean {
  return p.har !== null && (p.har.length === 1 || p.selectedPageIds.length > 0);
}

export const isEntryParsing = (p: PageEntry) => p.harProgress !== null || p.traceProgress !== null;

// The parsers' messages are written for the user: they are shown as they are.
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Parses a dropped HAR in the worker, reporting progress and the result through `apply`. */
export function loadHarFile(file: File, apply: (patch: EntryPatch) => void) {
  if (!/\.har(\.gz)?$/i.test(file.name)) {
    apply({ harError: "Only .har and .har.gz files are supported." });
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
    .catch((error: unknown) => apply({ harError: errorMessage(error), harProgress: null }));
}

/** Parses a dropped Chrome trace in the worker, reporting progress and the result through `apply`. */
export async function loadTraceFile(file: File, apply: (patch: EntryPatch) => void) {
  if (!file.name.endsWith(".json") && !file.name.endsWith(".gz")) {
    apply({ traceError: "Expected .json or .json.gz trace file." });
    return;
  }
  apply({ traceProgress: { phase: "reading", loaded: 0, total: file.size }, traceError: null });
  try {
    const trace = await parseInWorker("trace", file, (traceProgress) => apply({ traceProgress }));
    apply({ trace, traceFileName: file.name, traceError: null, traceProgress: null });
  } catch (error) {
    apply({ traceError: errorMessage(error), traceProgress: null });
  }
}

export const pageOptionLabel = (page: ReturnType<typeof listHarPages>[number]) =>
  `${webPageTestLabel(page.title) ?? (page.title || page.url)} (${page.entries} req)`;

/** What the Generate button builds: the flow's pages, its options and the pages of B, if any. */
export interface Generation {
  pages: PageFlow[];
  options: FlowOptions;
  comparePages?: PageFlow[];
}

/** Two pages of a single multi-page HAR (first vs repeat view) can be compared directly. */
export function pagePairOf(pages: PageEntry[]): [string, string] | null {
  const [first] = pages;
  const pickerAvailable = pages.length === 1 && (first.har?.length ?? 0) > 1;
  return pickerAvailable && first.comparePages ? first.comparePair : null;
}

/** The flows the entries describe: a comparison of two pages of one HAR, or the pages (with B). */
export function buildGeneration(
  pages: PageEntry[],
  compareEntry: PageEntry,
  clientRegion: ClientRegion
): Generation {
  const options = { clientRegion };
  const pagePair = pagePairOf(pages);
  if (pagePair) {
    const [first] = pages;
    const side = (id: string) =>
      expandPageFlows({
        name: first.name.trim() || "Page",
        har: first.har!,
        select: { pageIds: [id] },
        // The trace belongs to one recording: it stays with A.
        ...(first.trace && id === pagePair[0] ? { trace: first.trace } : {}),
      });
    return { pages: side(pagePair[0]), options, comparePages: side(pagePair[1]) };
  }
  const pageFlows: PageFlow[] = pages.filter(hasFlowPages).flatMap((p) =>
    expandPageFlows({
      name: p.name.trim() || "Page",
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
