import stringWidth from "string-width";
import type { DeltaRating, MetricRating } from "@htv/core";

/** A run of text with one style. */
export interface Segment {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
}

/** One terminal line: the TUI scrolls a list of them. */
export type Line = Segment[];

type Cell = Segment | string;

const toSegment = (cell: Cell): Segment => (typeof cell === "string" ? { text: cell } : cell);

export const seg = (text: string, style: Omit<Segment, "text"> = {}): Segment => ({
  text,
  ...style,
});

export const line = (...cells: Cell[]): Line => cells.map(toSegment);

export const BLANK: Line = [];

export const heading = (text: string): Line => [seg(text, { bold: true, color: "cyan" })];

export const RATING_COLOR: Record<MetricRating, string | undefined> = {
  good: "green",
  "needs-improvement": "yellow",
  poor: "red",
  none: undefined,
};

export const DELTA_COLOR: Record<DeltaRating, string | undefined> = {
  better: "green",
  worse: "red",
  same: "gray",
  none: undefined,
};

type Align = "left" | "right";

/** The terminal columns a text takes: a CJK character or an emoji takes two. */
const textWidth = (text: string): number => stringWidth(text);

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The longest start of the text that fits in `width` columns, cut between characters. */
function cut(text: string, width: number): string {
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    used += textWidth(segment);
    if (used > width) break;
    out += segment;
  }
  return out;
}

const pad = (text: string, width: number, align: Align) => {
  const gap = " ".repeat(Math.max(0, width - textWidth(text)));
  return align === "right" ? gap + text : text + gap;
};

/** The text cut to `width` columns with an ellipsis; `pad` fills a shorter one with spaces. */
export function fit(text: string, width: number, options: { pad?: boolean } = {}): string {
  if (textWidth(text) > width) return `${cut(text, width - 1)}…`;
  return options.pad ? pad(text, width, "left") : text;
}

/**
 * A table: a dim header and one line per row, each column as wide as its widest cell and
 * columns two spaces apart. Numbers align right by passing "right" for their column.
 */
export function table(header: string[], rows: Cell[][], aligns: Align[] = []): Line[] {
  const widths = header.map((title, i) =>
    Math.max(textWidth(title), ...rows.map((row) => toSegment(row[i] ?? "").text).map(textWidth))
  );
  const render = (cells: Cell[]): Line =>
    cells.flatMap((cell, i) => {
      const segment = toSegment(cell);
      const padded = { ...segment, text: pad(segment.text, widths[i], aligns[i] ?? "left") };
      return i === 0 ? [padded] : [seg("  "), padded];
    });
  return [render(header.map((title) => seg(title, { dim: true }))), ...rows.map(render)];
}

/**
 * The first column and the whole columns after it that fit in `width`, starting `offset`
 * columns past the first, with a line below them that counts the columns hidden on each side.
 * `offset` is clamped to `maxOffset`, the first one that shows the last column.
 */
export function scrollTable(
  header: string[],
  rows: Cell[][],
  aligns: Align[],
  width: number,
  offset: number
): { lines: Line[]; offset: number; maxOffset: number } {
  const widths = header.map((title, i) =>
    Math.max(textWidth(title), ...rows.map((row) => toSegment(row[i] ?? "").text).map(textWidth))
  );
  const span = (columns: number[]) =>
    columns.reduce((sum, i) => sum + widths[i], 0) + 2 * (columns.length - 1);
  const rest = widths.map((_, i) => i).slice(1);
  if (span([0, ...rest]) <= width) {
    return { lines: table(header, rows, aligns), offset: 0, maxOffset: 0 };
  }
  let maxOffset = 0;
  while (maxOffset < rest.length - 1 && span([0, ...rest.slice(maxOffset)]) > width) maxOffset++;
  const start = Math.min(Math.max(0, offset), maxOffset);
  const shown = [0];
  for (const i of rest.slice(start)) {
    if (shown.length > 1 && span([...shown, i]) > width) break;
    shown.push(i);
  }
  const pick = <T>(cells: T[]) => shown.map((i) => cells[i]);
  const right = rest.length - start - (shown.length - 1);
  const more = (n: number) => `${n} more ${n === 1 ? "column" : "columns"}`;
  const note = [start > 0 ? `◂ ${more(start)}` : null, right > 0 ? `${more(right)} ▸` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    lines: [
      ...table(pick(header), rows.map(pick), pick(aligns)),
      [seg(`${note}  < > scroll`, { dim: true })],
    ],
    offset: start,
    maxOffset,
  };
}

/** Breaks a text with no spaces to break at, such as a URL, into lines of `width` columns. */
export function breakText(text: string, width: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (textWidth(rest) > width) {
    // A character wider than the line still takes one, so that the loop ends.
    const head = cut(rest, width) || [...graphemes.segment(rest)][0].segment;
    out.push(head);
    rest = rest.slice(head.length);
  }
  out.push(rest);
  return out;
}

/** Splits text into lines of at most `width` characters, breaking between words. */
export function wrap(text: string, width: number, indent = ""): Line[] {
  const lines: Line[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && textWidth(indent) + textWidth(current) + 1 + textWidth(word) > width) {
      lines.push([seg(indent + current)]);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push([seg(indent + current)]);
  return lines;
}

export const lineText = (line: Line): string => line.map((s) => s.text).join("");
export const lineWidth = (line: Line): number => textWidth(lineText(line));

/** Cuts a line to `width` characters, ending it with an ellipsis when something was cut. */
export function truncateLine(line: Line, width: number): Line {
  if (lineWidth(line) <= width) return line;
  const out: Line = [];
  let used = 0;
  for (const segment of line) {
    const room = width - 1 - used;
    const taken = textWidth(segment.text);
    if (taken < room) {
      out.push(segment);
      used += taken;
      continue;
    }
    out.push({ ...segment, text: `${cut(segment.text, Math.max(0, room))}…` });
    return out;
  }
  return out;
}

export function padLine(line: Line, width: number): Line {
  const current = lineWidth(line);
  return current >= width ? line : [...line, seg(" ".repeat(width - current))];
}

const FRAME = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
// Points at the row under the cursor from the panel's left border, so that it shows without
// colour.
const CURSOR = "▸";

/** A piece of a frame: borders are dim so the content stands out. */
export const frame = (text: string): Segment => seg(text, { dim: true });

/**
 * The body framed with rounded borders and the title in the top edge, Ratatui style. Lines
 * wider than the panel are truncated; `minHeight` pads the panel with blank rows and `cursor`
 * points at a row of the body.
 */
export function panel(
  title: string,
  body: Line[],
  width: number,
  options: { minHeight?: number; cursor?: number } = {}
): Line[] {
  const inner = width - 4;
  const titleText = title ? ` ${title} ` : "";
  const fill = Math.max(0, width - 3 - textWidth(titleText));
  const top: Line = [
    frame(`${FRAME.tl}${FRAME.h}`),
    ...(title ? [seg(titleText, { bold: true, color: "cyan" })] : []),
    frame(`${FRAME.h.repeat(fill)}${FRAME.tr}`),
  ];
  const rows = body.map((line, i): Line => [
    ...(i === options.cursor
      ? [frame(FRAME.v), seg(CURSOR, { bold: true, color: "cyan" })]
      : [frame(`${FRAME.v} `)]),
    ...padLine(truncateLine(line, inner), inner),
    frame(` ${FRAME.v}`),
  ]);
  const blank: Line = [frame(FRAME.v), seg(" ".repeat(width - 2)), frame(FRAME.v)];
  while (rows.length + 2 < (options.minHeight ?? 0)) rows.push(blank);
  const bottom: Line = [frame(`${FRAME.bl}${FRAME.h.repeat(width - 2)}${FRAME.br}`)];
  return [top, ...rows, bottom];
}

/** Blocks side by side, each padded to its width; a shorter block gets blank rows below. */
export function hstack(blocks: { lines: Line[]; width: number }[], gap = 1): Line[] {
  const height = Math.max(0, ...blocks.map((block) => block.lines.length));
  return Array.from({ length: height }, (_, i) =>
    blocks.flatMap((block, j) => {
      const line = padLine(truncateLine(block.lines[i] ?? [], block.width), block.width);
      return j === 0 ? line : [seg(" ".repeat(gap)), ...line];
    })
  );
}
