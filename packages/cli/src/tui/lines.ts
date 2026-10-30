import type { DeltaRating, MetricRating } from "@htv/core";

/** A run of text with one style. */
export interface Segment {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
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
