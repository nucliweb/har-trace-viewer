import { formatBytes, formatMs } from "@htv/core";
import type { ResourceSort, ResourceSortKey, WaterfallParty, WaterfallRow } from "@htv/core";
import { BLANK, panel, seg, table } from "./lines.js";
import type { Line } from "./lines.js";
import { TYPE_LABEL, filterLine } from "./waterfall-view.js";
import type { FilterState } from "./waterfall-view.js";

/** What the resources table shows: the filter, the party and the sort. */
export interface ResourcesViewState extends FilterState {
  party: WaterfallParty | null;
  sort: ResourceSort;
}

// The columns s cycles through, each with the direction it starts in: the measures largest
// first, the names and categories in their order.
export const SORT_CYCLE: { key: ResourceSortKey; direction: ResourceSort["direction"] }[] = [
  { key: "start", direction: "asc" },
  { key: "size", direction: "desc" },
  { key: "time", direction: "desc" },
  { key: "ttfb", direction: "desc" },
  { key: "name", direction: "asc" },
  { key: "host", direction: "asc" },
  { key: "type", direction: "asc" },
  { key: "status", direction: "desc" },
  { key: "priority", direction: "asc" },
  { key: "protocol", direction: "asc" },
  { key: "encoding", direction: "asc" },
];

const SORT_LABEL: Record<ResourceSortKey, string> = {
  start: "start",
  size: "size",
  time: "time",
  ttfb: "TTFB",
  name: "name",
  host: "host",
  type: "type",
  status: "status",
  priority: "priority",
  protocol: "protocol",
  encoding: "encoding",
};

/** The sort after `current` in the cycle, in the direction that column starts in. */
export function nextSort(current: ResourceSort): ResourceSort {
  const index = SORT_CYCLE.findIndex((s) => s.key === current.key);
  return { ...SORT_CYCLE[(index + 1) % SORT_CYCLE.length] };
}

export const sortLabel = (sort: ResourceSort) =>
  `${SORT_LABEL[sort.key]} ${sort.direction === "asc" ? "↑" : "↓"}`;

// The widest name column, and the room the other columns need beside it.
const MAX_NAME = 40;
const MIN_NAME = 12;
const OTHER_COLUMNS = 72;
// Lines above the rows that stay in view while they scroll: the panel's top edge, the
// filter line and the column header.
const PINNED = 3;

const fit = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

const NONE = "—";

function rowCells(row: WaterfallRow, nameWidth: number) {
  const flags = `${row.isLcpResource ? "L" : ""}${row.renderBlocking ? "B" : ""}`;
  const statusColor = row.status >= 400 ? "red" : row.status >= 300 ? "yellow" : undefined;
  return [
    seg(flags, { color: row.isLcpResource ? "yellow" : "red", bold: true }),
    fit(row.shortName, nameWidth),
    seg(TYPE_LABEL[row.resourceType], { dim: true }),
    seg(row.status > 0 ? String(row.status) : NONE, { color: statusColor }),
    row.priority ?? NONE,
    row.httpVersion === null || row.httpVersion === "unknown" ? NONE : row.httpVersion,
    row.contentEncoding ?? NONE,
    seg(row.fromCache ? row.fromCache : formatBytes(row.transferSize), {
      dim: row.fromCache !== false,
    }),
    formatMs(row.ttfbMs),
    formatMs(row.endMs - row.startMs),
    formatMs(row.startMs),
  ];
}

/**
 * The page's requests as a table: name, type, status, priority, protocol, encoding, size,
 * TTFB, time and start, with `L` before the LCP resource and `B` before the render-blocking
 * requests. `rows` are the ones the filter kept, in the order of the sort; the first `pinned`
 * lines stay in view while the rest scroll.
 */
export function resourcesRegion(
  total: number,
  rows: WaterfallRow[],
  state: ResourcesViewState,
  width: number
): { lines: Line[]; pinned: number } {
  const nameWidth = Math.min(MAX_NAME, Math.max(MIN_NAME, width - 4 - OTHER_COLUMNS));
  const title =
    rows.length === total
      ? `Resources · ${total} requests`
      : `Resources · ${rows.length} of ${total} requests`;
  const header = [
    "",
    "Name",
    "Type",
    "Sts",
    "Prio",
    "Proto",
    "Enc",
    "Size",
    "TTFB",
    "Time",
    "Start",
  ];
  const aligns = header.map((_, i) => (i >= 7 ? "right" : "left") as "left" | "right");
  const body: Line[] = [
    filterLine(
      state,
      `Party: ${state.party ?? "all"}  Sort: ${sortLabel(state.sort)}`,
      "/ filter  f party  s sort  S reverse  ? help"
    ),
    ...table(
      header,
      rows.map((row) => rowCells(row, nameWidth)),
      aligns
    ),
    ...(rows.length === 0 ? [[seg("No request matches", { dim: true })]] : []),
    BLANK,
    [
      seg("L", { color: "yellow", bold: true }),
      seg(" LCP resource  ", { dim: true }),
      seg("B", { color: "red", bold: true }),
      seg(" render-blocking", { dim: true }),
    ],
  ];
  return { lines: panel(title, body, width), pinned: PINNED };
}
