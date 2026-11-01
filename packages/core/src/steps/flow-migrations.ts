import { isClientRegion } from "./flow.js";
import { TRANSITION_TITLE_PREFIX } from "./page-steps.js";
import type { DiagramStep, Flow, HarEntry, PageFlow, StepKind } from "../types.js";

// Readers of embedded flows bring every older shape up to the current one here. Each
// migration names the version whose shape it reads; see FLOW_VERSION for the history.

const KIND_BY_TITLE: Record<string, StepKind> = {
  "DNS + initial connection": "connection",
  "Connection reused": "connection",
  "First request in flight": "request",
  "TTFB — First byte received": "ttfb",
  "Critical resources loading": "critical",
  "Secondary resources": "secondary",
  "Third-party requests": "third-party",
  "First Contentful Paint": "fcp",
  "Largest Contentful Paint": "lcp",
  "Page loaded": "loaded",
};

const KIND_BY_BADGE: Record<NonNullable<DiagramStep["badge"]>["type"], StepKind> = {
  ttfb: "ttfb",
  fcp: "fcp",
  lcp: "lcp",
  onload: "loaded",
};

/**
 * The kind of a step generated before steps carried one (version ≤ 4), read from the titles
 * those versions used. An unknown title falls back to its badge, else to a resource group.
 */
export function stepKindFromTitle(
  title: string,
  badge?: NonNullable<DiagramStep["badge"]>["type"]
): StepKind {
  if (title.startsWith(TRANSITION_TITLE_PREFIX)) return "transition";
  return KIND_BY_TITLE[title] ?? (badge ? KIND_BY_BADGE[badge] : "secondary");
}

function withDerivedKind(steps: DiagramStep[]): DiagramStep[] {
  return steps.map((step) =>
    step.kind ? step : { ...step, kind: stepKindFromTitle(step.title, step.badge?.type) }
  );
}

// Version ≤ 1 steps carry no pageIndex: every transition step starts a new page.
function withDerivedPageIndex(steps: DiagramStep[]): DiagramStep[] {
  let pageIndex = 0;
  return steps.map((step) => {
    if (step.title.startsWith(TRANSITION_TITLE_PREFIX)) pageIndex++;
    return { ...step, pageIndex };
  });
}

// Version ≤ 2 step shape: copies of the entries instead of references.
interface InlineResourceStep extends DiagramStep {
  resources?: HarEntry[];
  cacheResources?: HarEntry[];
}

function hasInlineResources(step: InlineResourceStep): boolean {
  return step.resources !== undefined || step.cacheResources !== undefined;
}

// After JSON, a copy is matched to its page entry by url + startTime. Repeated
// pairs map to distinct entries in order; a copy with no entry is appended.
class EntryMatcher {
  private readonly byKey = new Map<string, number[]>();
  private readonly used = new Set<number>();
  readonly entries: HarEntry[];

  constructor(entries: HarEntry[]) {
    this.entries = [...entries];
    this.entries.forEach((entry, index) => this.index(entry, index));
  }

  private static key(entry: HarEntry): string {
    return `${entry.startTime} ${entry.url}`;
  }

  private index(entry: HarEntry, index: number): void {
    const key = EntryMatcher.key(entry);
    this.byKey.set(key, [...(this.byKey.get(key) ?? []), index]);
  }

  refOf(entry: HarEntry): number {
    const candidates = this.byKey.get(EntryMatcher.key(entry)) ?? [];
    const ref = candidates.find((index) => !this.used.has(index)) ?? candidates[0];
    if (ref !== undefined) {
      this.used.add(ref);
      return ref;
    }
    const appended = this.entries.push(entry) - 1;
    this.index(entry, appended);
    this.used.add(appended);
    return appended;
  }
}

/**
 * Converts the inline `resources` / `cacheResources` of version ≤ 2 steps into
 * `resourceRefs` / `cacheResourceRefs`. Returns the inputs untouched when no
 * step carries inline resources; never mutates them.
 */
export function inlineResourcesToRefs(
  pages: PageFlow[],
  steps: DiagramStep[]
): { pages: PageFlow[]; steps: DiagramStep[] } {
  if (!steps.some(hasInlineResources)) return { pages, steps };

  const matchers = new Map<number, EntryMatcher>();
  const matcherFor = (pageIndex: number): EntryMatcher | undefined => {
    const page = pages[pageIndex];
    if (!page) return undefined;
    if (!matchers.has(pageIndex)) matchers.set(pageIndex, new EntryMatcher(page.har.entries));
    return matchers.get(pageIndex);
  };

  const converted = steps.map((step: InlineResourceStep): DiagramStep => {
    if (!hasInlineResources(step)) return step;
    const { resources, cacheResources, ...rest } = step;
    const matcher = matcherFor(step.pageIndex);
    const toRefs = (list: HarEntry[] | undefined): number[] | undefined =>
      matcher && list && list.length > 0 ? list.map((entry) => matcher.refOf(entry)) : undefined;
    return {
      ...rest,
      resourceRefs: rest.resourceRefs ?? toRefs(resources),
      cacheResourceRefs: rest.cacheResourceRefs ?? toRefs(cacheResources),
    };
  });

  const convertedPages = pages.map((page, pageIndex) => {
    const matcher = matchers.get(pageIndex);
    if (!matcher || matcher.entries.length === page.har.entries.length) return page;
    return { ...page, har: { ...page.har, entries: matcher.entries } };
  });

  return { pages: convertedPages, steps: converted };
}

// Fills the fields that older embedded flows lack, so readers can rely on the
// current shape. Version 0 means "pre-versioning". Version ≤ 1 flows had a
// single topology and cache report: every page gets a copy of the top-level ones.
// Version ≤ 2 steps carried copies of their entries: they become references.
// Version ≤ 3 analyses have no third-party clusters: their single third-parties node stays.
// Version ≤ 4 steps have no kind: it is read from their title.
export function normalizeFlow(flow: Flow): Flow {
  const indexed = flow.steps.every((step) => typeof step.pageIndex === "number")
    ? flow.steps
    : withDerivedPageIndex(flow.steps);
  const steps = indexed.every((step) => step.kind) ? indexed : withDerivedKind(indexed);
  const pageCount = Math.max(flow.pages.length, (steps.at(-1)?.pageIndex ?? 0) + 1);
  // A flow without pageAnalyses (version ≤ 1) always wrote the top-level topology.
  const pageAnalyses = (
    flow.pageAnalyses ??
    Array.from({ length: pageCount }, () => ({
      nodes: flow.nodes!,
      paths: flow.paths!,
      cacheReport: flow.cacheReport!,
    }))
  ).map((analysis) =>
    analysis.thirdPartyClusters ? analysis : { ...analysis, thirdPartyClusters: [] }
  );

  const withRefs = inlineResourcesToRefs(flow.pages, steps);

  return {
    ...flow,
    version: flow.version ?? 0,
    clientRegion: isClientRegion(flow.clientRegion) ? flow.clientRegion : "default",
    hints: flow.hints ?? {},
    pageAnalyses,
    pages: withRefs.pages,
    steps: withRefs.steps,
  };
}
