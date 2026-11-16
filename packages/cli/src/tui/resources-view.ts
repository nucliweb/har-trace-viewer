import { formatBytes, formatMs } from "@htv/core";
import type { ResourceSort, ResourceSortKey, WaterfallParty, WaterfallRow } from "@htv/core";
import { BLANK, fit, fitWidth, seg, tableRow, tableWidths, textWidth } from "./lines.js";
import type { Line } from "./lines.js";
import { TYPE_LABEL, filterLine, flagLegend, listView } from "./waterfall-view.js";
import type { FilterState, ListView } from "./waterfall-view.js";

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

const HEADER = ["", "Name", "Type", "Sts", "Prio", "Proto", "Enc", "Size", "TTFB", "Time", "Start"];
const ALIGNS = HEADER.map((_, i) => (i >= 7 ? "right" : "left") as "left" | "right");

/** The text of each cell of a request's row but its name, which is cut to the name column. */
function rowTexts(row: WaterfallRow) {
  return {
    flags: `${row.isLcpResource ? "L" : ""}${row.renderBlocking ? "B" : ""}`,
    type: TYPE_LABEL[row.resourceType],
    status: row.status > 0 ? String(row.status) : NONE,
    priority: row.priority ?? NONE,
    protocol: row.httpVersion === null || row.httpVersion === "unknown" ? NONE : row.httpVersion,
    encoding: row.contentEncoding ?? NONE,
    size: row.fromCache ? row.fromCache : formatBytes(row.transferSize),
    ttfb: formatMs(row.ttfbMs),
    time: formatMs(row.endMs - row.startMs),
    start: formatMs(row.startMs),
  };
}

function rowCells(row: WaterfallRow, nameWidth: number) {
  const text = rowTexts(row);
  const statusColor = row.status >= 400 ? "red" : row.status >= 300 ? "yellow" : undefined;
  return [
    seg(text.flags, { color: row.isLcpResource ? "yellow" : "red", bold: true }),
    fit(row.shortName, nameWidth),
    seg(text.type, { dim: true }),
    seg(text.status, { color: statusColor }),
    text.priority,
    text.protocol,
    text.encoding,
    seg(text.size, { dim: row.fromCache !== false }),
    text.ttfb,
    text.time,
    text.start,
  ];
}

/** The width of each cell of a row, as `rowCells` draws it, for sizing the columns. */
function cellWidths(row: WaterfallRow, nameWidth: number): number[] {
  const text = rowTexts(row);
  return [
    textWidth(text.flags),
    fitWidth(row.shortName, nameWidth),
    textWidth(text.type),
    textWidth(text.status),
    textWidth(text.priority),
    textWidth(text.protocol),
    textWidth(text.encoding),
    textWidth(text.size),
    textWidth(text.ttfb),
    textWidth(text.time),
    textWidth(text.start),
  ];
}

// The column widths of a list of rows, kept for as long as the list is the same one: they take a
// pass over every row, and the list stays while the filter prompt opens or the width settles.
const widthsOf = new WeakMap<WaterfallRow[], { nameWidth: number; widths: number[] }>();
function columnWidths(rows: WaterfallRow[], nameWidth: number): number[] {
  const kept = widthsOf.get(rows);
  if (kept && kept.nameWidth === nameWidth) return kept.widths;
  const widths = tableWidths(HEADER, rows.length, (i) => cellWidths(rows[i], nameWidth));
  widthsOf.set(rows, { nameWidth, widths });
  return widths;
}

/**
 * The page's requests as a table: name, type, status, priority, protocol, encoding, size,
 * TTFB, time and start, with `L` before the LCP resource and `B` before the render-blocking
 * requests. `rows` are the ones the filter kept, in the order of the sort; the first `pinned`
 * lines stay in view while the rest scroll. As in the waterfall, the flags are explained only
 * for a page that `hasDocument` (the default), and L only when it `hasLcp` (the default). The
 * columns are sized to every row, but a row is drawn only when `lines` asks for it.
 */
export function resourcesList(
  total: number,
  rows: WaterfallRow[],
  state: Omit<ResourcesViewState, "cursor">,
  width: number,
  options: { hasDocument?: boolean; hasLcp?: boolean } = {}
): ListView {
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
  const widths = columnWidths(rows, nameWidth);
  return listView(
    title,
    {
      head: [
        filterLine(
          state,
          `Party: ${state.party ?? "all"}  Sort: ${sortLabel(state.sort)}`,
          "Enter details  / filter  f party  s sort  S reverse  ? help"
        ),
        tableRow(
          HEADER.map((title) => seg(title, { dim: true })),
          widths,
          ALIGNS
        ),
      ],
      count: rows.length,
      rowAt: (i, selected) => {
        const line = tableRow(rowCells(rows[i], nameWidth), widths, ALIGNS);
        return selected ? line.map((s) => ({ ...s, inverse: true })) : line;
      },
      empty: [seg("No request matches", { dim: true })],
      tail: legend.length > 0 ? [BLANK, legend] : [],
    },
    width,
    PINNED
  );
}

/** The whole resources panel, for a list short enough to draw whole; `state.cursor` as above. */
export function resourcesRegion(
  total: number,
  rows: WaterfallRow[],
  state: ResourcesViewState,
  width: number,
  options: { hasDocument?: boolean; hasLcp?: boolean } = {}
): { lines: Line[]; pinned: number } {
  const view = resourcesList(total, rows, state, width, options);
  return { lines: view.lines(0, view.length, state.cursor), pinned: view.pinned };
}
