import type { ResourceSort, ResourceSortKey } from "@htv/core";

/** The views of the analysis drawer: each one opens it, from a key or a link, on that view. */
export const ANALYSIS_VIEWS = ["connections", "compression", "render", "critical-path"] as const;
export type AnalysisView = (typeof ANALYSIS_VIEWS)[number];

export const isAnalysisView = (drawer: string | null): drawer is AnalysisView =>
  (ANALYSIS_VIEWS as readonly (string | null)[]).includes(drawer);

/** The drawers a link can open: the toolbar's, in its order, the analysis by its views. */
export const LINKED_DRAWERS = [
  "findings",
  "waterfall",
  "hops",
  "metrics",
  "cache",
  ...ANALYSIS_VIEWS,
] as const;
type DrawerName = (typeof LINKED_DRAWERS)[number];
export type WaterfallView = "waterfall" | "table";

/** The views of the comparison's Deltas drawer and the filters of its Requests view. */
export const DELTAS_VIEWS = ["summary", "requests"] as const;
export type DeltasView = (typeof DELTAS_VIEWS)[number];
export const REQUEST_FILTERS = ["all", "changed", "added", "removed"] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];
export type Side = "a" | "b";

/** The view state a link carries, each part absent when the link does not say it. */
export interface ViewState {
  drawer?: DrawerName;
  /** The waterfall's filter text. */
  search?: string;
  /** The entry index of the selected request. */
  selected?: number;
  view?: WaterfallView;
  sort?: ResourceSort;
  /** The step on screen, 1-based as people read it; the step alone identifies its page. */
  step?: number;
  /** The pane of a comparison the drawer belongs to. */
  side?: Side;
  /** The comparison's Deltas drawer is open, on this view and filter when the link says them. */
  deltas?: { view?: DeltasView; filter?: RequestFilter };
}

// The hash is `#d=waterfall&q=text&r=3&v=table&s=size.desc&p=4`: a hash works from file:// and
// under any sub-path, and is never sent to a server. A comparison adds `side=b` (the pane of the
// drawer) and, for the Deltas drawer, `d=deltas&dv=requests&df=added`.
type Key = "d" | "q" | "r" | "v" | "s" | "p" | "side" | "dv" | "df";

const SORT_KEYS: Record<ResourceSortKey, true> = {
  start: true,
  name: true,
  host: true,
  type: true,
  status: true,
  priority: true,
  protocol: true,
  encoding: true,
  size: true,
  ttfb: true,
  time: true,
};

/** The sort as a link writes it: `size.desc`. */
export const formatSort = (sort: ResourceSort): string => `${sort.key}.${sort.direction}`;

function parseSort(value: string | null): ResourceSort | undefined {
  const [key, direction, ...rest] = (value ?? "").split(".");
  if (rest.length > 0 || (direction !== "asc" && direction !== "desc")) return undefined;
  return key in SORT_KEYS ? { key: key as ResourceSortKey, direction } : undefined;
}

/** Reads a hash or query string; what is unknown or malformed is left out. */
export function parseViewState(params: string): ViewState {
  const query = new URLSearchParams(params.replace(/^#/, ""));
  const state: ViewState = {};
  const drawer = query.get("d");
  if ((LINKED_DRAWERS as readonly string[]).includes(drawer ?? "")) {
    state.drawer = drawer as DrawerName;
  }
  if (drawer === "deltas") {
    const view = query.get("dv");
    const filter = query.get("df");
    state.deltas = {
      ...((DELTAS_VIEWS as readonly string[]).includes(view ?? "") && {
        view: view as DeltasView,
      }),
      ...((REQUEST_FILTERS as readonly string[]).includes(filter ?? "") && {
        filter: filter as RequestFilter,
      }),
    };
  }
  const side = query.get("side");
  if (side === "a" || side === "b") state.side = side;
  const step = query.get("p");
  if (step !== null && /^\d{1,9}$/.test(step) && Number(step) > 0) state.step = Number(step);
  const search = query.get("q");
  if (search !== null) state.search = search;
  const selected = query.get("r");
  if (selected !== null && /^\d{1,9}$/.test(selected)) state.selected = Number(selected);
  const view = query.get("v");
  if (view === "waterfall" || view === "table") state.view = view;
  const sort = parseSort(query.get("s"));
  if (sort) state.sort = sort;
  return state;
}

/**
 * Sets (a string, even empty) or removes (null) parts of the page's hash with `replaceState`, so
 * typing adds no history entry. Other parts of the hash stay as they are.
 */
export function setHashParams(patch: Partial<Record<Key, string | null>>): void {
  const query = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string") query.set(key, value);
    else query.delete(key);
  }
  const hash = query.toString();
  const url = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ""}`;
  try {
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // A sandboxed frame can refuse: the link stops following the view.
  }
}

const PREFS_KEY = "htv-waterfall";

/** The waterfall's filter text, sort and view of the last visit; empty when none or no storage. */
export function readWaterfallPrefs(): ViewState {
  try {
    return parseViewState(window.localStorage.getItem(PREFS_KEY) ?? "");
  } catch {
    return {};
  }
}

export function writeWaterfallPrefs(prefs: Pick<ViewState, "search" | "view" | "sort">): void {
  const query = new URLSearchParams();
  if (prefs.search) query.set("q", prefs.search);
  if (prefs.view) query.set("v", prefs.view);
  if (prefs.sort) query.set("s", formatSort(prefs.sort));
  try {
    window.localStorage.setItem(PREFS_KEY, query.toString());
  } catch {
    // Storage is unavailable (private mode, blocked site data): the choice lasts for this page only.
  }
}

/** The state a waterfall opens with: what the link says, else what the last visit left. */
export function initialWaterfallState(): ViewState {
  return { ...readWaterfallPrefs(), ...parseViewState(window.location.hash) };
}
