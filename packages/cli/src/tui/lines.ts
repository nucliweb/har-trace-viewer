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

export type Align = "left" | "right";

const pad = (text: string, width: number, align: Align) =>
  align === "right" ? text.padStart(width) : text.padEnd(width);

/**
 * A table: a dim header and one line per row, each column as wide as its widest cell and
 * columns two spaces apart. Numbers align right by passing "right" for their column.
 */
export function table(header: string[], rows: Cell[][], aligns: Align[] = []): Line[] {
  const widths = header.map((title, i) =>
    Math.max(title.length, ...rows.map((row) => toSegment(row[i] ?? "").text.length))
  );
  const render = (cells: Cell[]): Line =>
    cells.flatMap((cell, i) => {
      const segment = toSegment(cell);
      const padded = { ...segment, text: pad(segment.text, widths[i], aligns[i] ?? "left") };
      return i === 0 ? [padded] : [seg("  "), padded];
    });
  return [render(header.map((title) => seg(title, { dim: true }))), ...rows.map(render)];
}

/** Splits text into lines of at most `width` characters, breaking between words. */
export function wrap(text: string, width: number, indent = ""): Line[] {
  const lines: Line[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && indent.length + current.length + 1 + word.length > width) {
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
export const lineWidth = (line: Line): number => lineText(line).length;

/** Cuts a line to `width` characters, ending it with an ellipsis when something was cut. */
export function truncateLine(line: Line, width: number): Line {
  if (lineWidth(line) <= width) return line;
  const out: Line = [];
  let used = 0;
  for (const segment of line) {
    const room = width - 1 - used;
    if (segment.text.length < room) {
      out.push(segment);
      used += segment.text.length;
      continue;
    }
    out.push({ ...segment, text: `${segment.text.slice(0, Math.max(0, room))}…` });
    return out;
  }
  return out;
}

export function padLine(line: Line, width: number): Line {
  const current = lineWidth(line);
  return current >= width ? line : [...line, seg(" ".repeat(width - current))];
}

const FRAME = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };

/** A piece of a frame: borders are dim so the content stands out. */
export const frame = (text: string): Segment => seg(text, { dim: true });

/**
 * The body framed with rounded borders and the title in the top edge, Ratatui style. Lines
 * wider than the panel are truncated; `minHeight` pads the panel with blank rows.
 */
export function panel(
  title: string,
  body: Line[],
  width: number,
  options: { minHeight?: number } = {}
): Line[] {
  const inner = width - 4;
  const titleText = title ? ` ${title} ` : "";
  const fill = Math.max(0, width - 3 - titleText.length);
  const top: Line = [
    frame(`${FRAME.tl}${FRAME.h}`),
    ...(title ? [seg(titleText, { bold: true, color: "cyan" })] : []),
    frame(`${FRAME.h.repeat(fill)}${FRAME.tr}`),
  ];
  const rows = body.map((line): Line => [
    frame(`${FRAME.v} `),
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
