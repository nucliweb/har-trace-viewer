import { formatBytes, formatMs, waterfallAxisMs } from "@htv/core";
import type {
  ResourceType,
  Waterfall,
  WaterfallAxis,
  WaterfallMarks,
  WaterfallParty,
  WaterfallRow,
} from "@htv/core";
import { BLANK, panel, seg } from "./lines.js";
import type { Line, Segment } from "./lines.js";

/**
 * What the waterfall shows: the URL search (and whether its prompt is open), the party and
 * where the time axis ends.
 */
export interface WaterfallViewState {
  search: string;
  searching: boolean;
  party: WaterfallParty | null;
  axis: WaterfallAxis;
}

const TYPE_LABEL: Record<ResourceType, string> = {
  document: "doc",
  stylesheet: "css",
  script: "script",
  font: "font",
  image: "img",
  fetch: "fetch",
  other: "other",
};

const MARKS: { key: keyof WaterfallMarks; letter: string; name: string; color: string }[] = [
  { key: "ttfb", letter: "T", name: "TTFB", color: "cyan" },
  { key: "fcp", letter: "F", name: "FCP", color: "green" },
  { key: "lcp", letter: "L", name: "LCP", color: "yellow" },
  { key: "dcl", letter: "D", name: "DCL", color: "blue" },
  { key: "onLoad", letter: "O", name: "onLoad", color: "red" },
];

// The bar's characters: queueing, connection setup (dns, connect, tls), request and wait,
// download; a browser-cache hit is hollow.
const BLOCKED = { char: "░", color: "gray" };
const CONNECT = { char: "▒", color: "yellow" };
const WAIT = { char: "█", color: "green" };
const RECEIVE = { char: "▓", color: "cyan" };
const CACHED = { char: "╌", color: "cyan" };
// A request that starts after the end of a zoomed axis.
const LATER = { char: "›", dim: true };

// Column widths around the name, which takes about a quarter of the panel.
const FLAGS = 2;
const TYPE = 6;
const STATUS = 3;
const SIZE = 7;
const GAPS = 5;
const MIN_NAME = 12;
const MAX_NAME = 40;
const MIN_BAR = 10;
// Lines above the rows that stay in view while they scroll: the panel's top edge, the
// filter line, the column header with the time ticks and the axis with the marks.
const PINNED = 4;

interface Layout {
  name: number;
  bar: number;
  totalMs: number;
}

function layoutFor(inner: number, totalMs: number): Layout {
  const name = Math.min(MAX_NAME, Math.max(MIN_NAME, Math.floor(inner * 0.24)));
  const bar = Math.max(MIN_BAR, inner - name - FLAGS - TYPE - STATUS - SIZE - GAPS);
  return { name, bar, totalMs };
}

const column = (ms: number, { bar, totalMs }: Layout) =>
  totalMs > 0 ? Math.min(bar - 1, Math.max(0, Math.floor((ms / totalMs) * bar))) : 0;

const fit = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);

interface Cell {
  char: string;
  color?: string;
  dim?: boolean;
}

/** Joins runs of cells with the same style into segments. */
function cellsToSegments(cells: Cell[]): Segment[] {
  const out: Segment[] = [];
  for (const cell of cells) {
    const last = out[out.length - 1];
    if (last && last.color === cell.color && last.dim === cell.dim) last.text += cell.char;
    else out.push({ text: cell.char, color: cell.color, dim: cell.dim });
  }
  return out;
}

interface PlacedMark {
  letter: string;
  color: string;
  column: number;
}

/** The marks the page has, each on its column, moved right when another took the column. */
function placeMarks(marks: WaterfallMarks, layout: Layout): PlacedMark[] {
  const taken = new Set<number>();
  return MARKS.flatMap(({ key, letter, color }) => {
    const ms = marks[key];
    if (ms === null) return [];
    let col = column(ms, layout);
    while (taken.has(col) && col < layout.bar - 1) col++;
    taken.add(col);
    return [{ letter, color, column: col }];
  });
}

/** Ruler ticks at a round step (1, 2 or 5 × 10ⁿ ms), at most one per twelve columns. */
function ticks(layout: Layout): number[] {
  const { totalMs, bar } = layout;
  if (totalMs <= 0) return [0];
  const rough = totalMs / Math.max(1, Math.floor(bar / 12));
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  // The largest round step that keeps that many ticks, so that a short axis gets more than one.
  const step = [10, 5, 2, 1].map((m) => m * magnitude).find((s) => s <= rough) ?? rough;
  const out: number[] = [];
  for (let t = 0; t < totalMs; t += step) out.push(t);
  return out;
}

const prefixWidth = (layout: Layout) => FLAGS + layout.name + TYPE + STATUS + SIZE + GAPS;

function headerLine(layout: Layout): Line {
  const labels = `${" ".repeat(FLAGS)} ${"Name".padEnd(layout.name)} ${"Type".padEnd(TYPE)} ${"Sts".padEnd(STATUS)} ${"Size".padStart(SIZE)} `;
  const axis = Array.from({ length: layout.bar }, () => " ");
  let free = 0;
  for (const t of ticks(layout)) {
    const col = column(t, layout);
    const label = formatMs(t);
    if (col < free || col + label.length > layout.bar) continue;
    for (let i = 0; i < label.length; i++) axis[col + i] = label[i];
    free = col + label.length + 1;
  }
  return [seg(labels, { dim: true }), seg(axis.join(""), { dim: true })];
}

function axisLine(marks: PlacedMark[], layout: Layout): Line {
  const cells: Cell[] = Array.from({ length: layout.bar }, () => ({ char: "─", dim: true }));
  for (const mark of marks) cells[mark.column] = { char: mark.letter, color: mark.color };
  return [seg(" ".repeat(prefixWidth(layout))), ...cellsToSegments(cells)];
}

/** Splits `cells` columns among the phase groups by their share of the request's time. */
function barCells(row: WaterfallRow, layout: Layout, marks: PlacedMark[]): Cell[] {
  const cells: Cell[] = Array.from({ length: layout.bar }, () => ({ char: " " }));
  for (const mark of marks) cells[mark.column] = { char: "|", color: mark.color, dim: true };

  if (row.startMs >= layout.totalMs) {
    cells[layout.bar - 1] = LATER;
    return cells;
  }
  const start = column(row.startMs, layout);
  const end = Math.max(
    start + 1,
    Math.min(layout.bar, Math.ceil((row.endMs / Math.max(1, layout.totalMs)) * layout.bar))
  );
  const width = end - start;
  if (row.fromCache) {
    for (let i = start; i < end; i++) cells[i] = CACHED;
    return cells;
  }
  const { blocked, dns, connect, ssl, send, wait, receive } = row.phases;
  const groups = [
    { style: BLOCKED, ms: blocked ?? 0 },
    { style: CONNECT, ms: (dns ?? 0) + (connect ?? 0) + (ssl ?? 0) },
    { style: WAIT, ms: send + wait },
    { style: RECEIVE, ms: receive },
  ];
  const total = groups.reduce((sum, g) => sum + g.ms, 0);
  if (total <= 0) {
    for (let i = start; i < end; i++) cells[i] = WAIT;
    return cells;
  }
  // Cumulative rounding: the groups fill the bar exactly, a group too short for a column
  // gives it to the next one.
  let elapsed = 0;
  let from = start;
  for (const group of groups) {
    elapsed += group.ms;
    const to = start + Math.round((elapsed / total) * width);
    for (let i = from; i < to; i++) cells[i] = group.style;
    from = Math.max(from, to);
  }
  return cells;
}

function rowLine(row: WaterfallRow, layout: Layout, marks: PlacedMark[]): Line {
  const flags = `${row.isLcpResource ? "L" : ""}${row.renderBlocking ? "B" : ""}`.padEnd(FLAGS);
  const status = row.status > 0 ? String(row.status) : "—";
  const statusColor = row.status >= 400 ? "red" : row.status >= 300 ? "yellow" : undefined;
  const size = row.fromCache ? row.fromCache : formatBytes(row.transferSize);
  return [
    seg(flags, { color: row.isLcpResource ? "yellow" : "red", bold: true }),
    seg(` ${fit(row.shortName, layout.name)} `),
    seg(`${TYPE_LABEL[row.resourceType].padEnd(TYPE)} `, { dim: true }),
    seg(status.padEnd(STATUS), { color: statusColor }),
    seg(` ${size.padStart(SIZE)} `, { dim: row.fromCache !== false }),
    ...cellsToSegments(barCells(row, layout, marks)),
  ];
}

function filterLine(state: WaterfallViewState): Line {
  const party = `Party: ${state.party ?? "all"}  Axis: ${state.axis}`;
  if (state.searching) {
    return [seg(party, { dim: true }), seg("  Search: ", { dim: true }), seg(`${state.search}▏`)];
  }
  if (state.search) {
    return [seg(party, { dim: true }), seg("  Search: ", { dim: true }), seg(state.search)];
  }
  return [seg(`${party}  / search  f party  z axis`, { dim: true })];
}

function legendLines(marks: PlacedMark[]): Line[] {
  const phases: Line = [
    ...[
      [BLOCKED, "blocked"],
      [CONNECT, "dns/connect/tls"],
      [WAIT, "request/wait"],
      [RECEIVE, "download"],
      [CACHED, "cache hit"],
    ].flatMap(([style, label]) => {
      const { char, color } = style as Cell;
      return [seg(char, { color }), seg(` ${label as string}  `, { dim: true })];
    }),
  ];
  const named: Line = [
    ...marks.flatMap(({ letter, color }) => [
      seg(letter, { color, bold: true }),
      seg(` ${MARKS.find((m) => m.letter === letter)!.name}  `, { dim: true }),
    ]),
    seg("L", { color: "yellow", bold: true }),
    seg(" LCP resource  ", { dim: true }),
    seg("B", { color: "red", bold: true }),
    seg(" render-blocking", { dim: true }),
  ];
  return [phases, named];
}

/**
 * The page's requests on one time axis: a ruler with the time ticks and the marks (T TTFB,
 * F FCP, L LCP, D DCL, O onLoad), then one row per request with its name, type, status, size
 * and a bar of its phases scaled to the panel, on an axis that spans the whole recording or
 * ends at the page load (a `›` points at the requests after it). `rows` are the ones the filter kept; the first
 * `pinned` lines stay in view while the rest scroll.
 */
export function waterfallRegion(
  waterfall: Waterfall,
  rows: WaterfallRow[],
  state: WaterfallViewState,
  width: number
): { lines: Line[]; pinned: number } {
  const layout = layoutFor(width - 4, waterfallAxisMs(waterfall, state.axis));
  const marks = placeMarks(waterfall.marks, layout);
  const total = waterfall.rows.length;
  const title =
    rows.length === total
      ? `Waterfall · ${total} requests`
      : `Waterfall · ${rows.length} of ${total} requests`;
  const body: Line[] = [
    filterLine(state),
    headerLine(layout),
    axisLine(marks, layout),
    ...(rows.length === 0
      ? [[seg("No request matches", { dim: true })]]
      : rows.map((row) => rowLine(row, layout, marks))),
    BLANK,
    ...legendLines(marks),
  ];
  return { lines: panel(title, body, width), pinned: PINNED };
}
