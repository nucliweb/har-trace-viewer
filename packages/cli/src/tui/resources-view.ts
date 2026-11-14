import { formatBytes, formatMs } from "@htv/core";
import type { ResourceSort, ResourceSortKey, WaterfallParty, WaterfallRow } from "@htv/core";
import { BLANK, fit, panel, seg, table } from "./lines.js";
import type { Line } from "./lines.js";
import { TYPE_LABEL, filterLine, flagLegend } from "./waterfall-view.js";
import type { FilterState } from "./waterfall-view.js";

/** What the resources table shows: the filter, the party, the sort and the row under the cursor. */
interface ResourcesViewState extends FilterState {
  party: WaterfallParty | null;
  sort: ResourceSort;
  cursor?: number;
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

const sortLabel = (sort: ResourceSort) =>
  `${SORT_LABEL[sort.key]} ${sort.direction === "asc" ? "↑" : "↓"}`;

// The widest name column, and the room the other columns need beside it.
const MAX_NAME = 40;
const MIN_NAME = 12;
const OTHER_COLUMNS = 72;
// Lines above the rows that stay in view while they scroll: the panel's top edge, the
// filter line and the column header.
const PINNED = 3;

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
 * requests. `rows` are the ones the filter kept, in the order of the sort, and `state.cursor`
 * the index of the one under the cursor, drawn inverted; the first `pinned` lines stay in view
 * while the rest scroll. As in the waterfall, the flags are explained only for a page that
 * `hasDocument` (the default), and L only when it `hasLcp` (the default).
 */
export function resourcesRegion(
  total: number,
  rows: WaterfallRow[],
  state: ResourcesViewState,
  width: number,
  options: { hasDocument?: boolean; hasLcp?: boolean } = {}
): { lines: Line[]; pinned: number } {
  const hasDocument = options.hasDocument ?? true;
  const legend = flagLegend({
    lcp: hasDocument && (options.hasLcp ?? true),
    blocking: hasDocument,
  });
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
      "Enter details  / filter  f party  s sort  S reverse  ? help"
    ),
    ...table(
      header,
      rows.map((row) => rowCells(row, nameWidth)),
      aligns
    ).map((line, i) =>
      i === (state.cursor ?? -1) + 1 ? line.map((s) => ({ ...s, inverse: true })) : line
    ),
    ...(rows.length === 0 ? [[seg("No request matches", { dim: true })]] : []),
    ...(legend.length > 0 ? [BLANK, legend] : []),
  ];
  const cursor = state.cursor === undefined ? undefined : PINNED - 1 + state.cursor;
  return { lines: panel(title, body, width, { cursor }), pinned: PINNED };
}
