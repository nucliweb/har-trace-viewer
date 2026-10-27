import type { DiagramStep, Flow, HarEntry, PageFlow } from "../types.js";

function resolveRefs(flow: Flow, step: DiagramStep, refs: number[] | undefined): HarEntry[] {
  if (!refs || refs.length === 0) return [];
  const entries = flow.pages[step.pageIndex]?.har.entries ?? [];
  return refs.map((ref) => entries[ref]).filter((entry) => entry !== undefined);
}

/** Network requests of a step, resolved from its page entries. */
export function getStepResources(flow: Flow, step: DiagramStep): HarEntry[] {
  return resolveRefs(flow, step, step.resourceRefs);
}

/** Browser-cache hits of a step, resolved from its page entries. */
export function getStepCacheResources(flow: Flow, step: DiagramStep): HarEntry[] {
  return resolveRefs(flow, step, step.cacheResourceRefs);
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
