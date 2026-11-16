import { describe, expect, it } from "vitest";
import { listHeight, revealTop, rowAt, rowOffset, windowItems } from "../src/lib/row-window.js";
import type { RowLayout, WindowItem } from "../src/lib/row-window.js";

const layout = (count: number, expanded: number | null = null, extra = 0): RowLayout => ({
  count,
  rowHeight: 25,
  expanded,
  extra,
});

const rowsOf = (items: WindowItem[]) =>
  items.flatMap((item) => (item.kind === "row" ? [item.index] : []));
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Gaps and rows stack up to the height of the whole list, wherever the window is. */
function stackedHeight(items: WindowItem[], rows: RowLayout): number {
  return items.reduce(
    (sum, item) =>
      sum +
      (item.kind === "gap"
        ? item.height
        : rows.rowHeight + (item.index === rows.expanded ? rows.extra : 0)),
    0
  );
}

describe("row offsets", () => {
  it("stacks the rows, the expanded one taller", () => {
    const rows = layout(1000, 10, 30);
    expect(rowOffset(rows, 0)).toBe(0);
    expect(rowOffset(rows, 10)).toBe(250);
    expect(rowOffset(rows, 11)).toBe(25 * 11 + 30);
    expect(listHeight(rows)).toBe(25 * 1000 + 30);
    expect(listHeight(layout(1000))).toBe(25_000);
  });

  it("finds the row at an offset, inside the expanded row too", () => {
    const rows = layout(1000, 10, 30);
    expect(rowAt(rows, 0)).toBe(0);
    expect(rowAt(rows, 249)).toBe(9);
    expect(rowAt(rows, 250)).toBe(10);
    // The expanded row runs from 250 to 305.
    expect(rowAt(rows, 300)).toBe(10);
    expect(rowAt(rows, 305)).toBe(11);
    expect(rowAt(layout(1000), 260)).toBe(10);
  });

  it("clamps an offset outside the list to its first or last row", () => {
    expect(rowAt(layout(1000), -40)).toBe(0);
    expect(rowAt(layout(1000), 1e9)).toBe(999);
  });
});

describe("windowItems", () => {
  const options = { threshold: 300, overscan: 5, keep: [] as number[] };

  it("renders every row of a list at or below the threshold, with no gap", () => {
    const items = windowItems(layout(300), { top: 0, height: 100 }, options);
    expect(items).toEqual(range(0, 300).map((index) => ({ kind: "row", index })));
  });

  it("renders the rows in view and a few beyond, and a gap for the rest", () => {
    const rows = layout(10_000);
    const items = windowItems(rows, { top: 0, height: 100 }, options);
    // Rows 0 to 4 meet the view, rows 5 to 9 are the overscan.
    expect(rowsOf(items)).toEqual(range(0, 10));
    expect(items.at(-1)).toEqual({ kind: "gap", height: 25 * (10_000 - 10), key: "gap-end" });
    expect(stackedHeight(items, rows)).toBe(listHeight(rows));
  });

  it("puts a gap above the window once the view scrolls down", () => {
    const rows = layout(10_000);
    const items = windowItems(rows, { top: 5000, height: 100 }, options);
    expect(rowsOf(items)).toEqual(range(195, 210));
    expect(items[0]).toEqual({ kind: "gap", height: 195 * 25, key: "gap-0" });
    expect(stackedHeight(items, rows)).toBe(listHeight(rows));
  });

  it("ends with the last row and no gap at the bottom", () => {
    const rows = layout(10_000);
    const items = windowItems(rows, { top: listHeight(rows) - 100, height: 100 }, options);
    expect(rowsOf(items).at(-1)).toBe(9999);
    expect(items.at(-1)).toEqual({ kind: "row", index: 9999 });
    expect(stackedHeight(items, rows)).toBe(listHeight(rows));
  });

  it("accounts for the expanded row above, inside and below the window", () => {
    for (const expanded of [3, 200, 9000]) {
      const rows = layout(10_000, expanded, 31);
      const items = windowItems(rows, { top: 5000, height: 100 }, options);
      expect(stackedHeight(items, rows)).toBe(listHeight(rows));
    }
    const above = layout(10_000, 3, 31);
    expect(rowsOf(windowItems(above, { top: 5031, height: 100 }, options))).toEqual(
      range(195, 210)
    );
  });

  it("keeps the rows asked for rendered outside the window, in order, between gaps", () => {
    const rows = layout(10_000, 40, 31);
    const items = windowItems(rows, { top: 5031, height: 100 }, { ...options, keep: [9000, 40] });
    expect(rowsOf(items)).toEqual([40, ...range(195, 210), 9000]);
    expect(items[0]).toEqual({ kind: "gap", height: 40 * 25, key: "gap-0" });
    expect(items[2]).toEqual({
      kind: "gap",
      height: rowOffset(rows, 195) - rowOffset(rows, 41),
      key: "gap-41",
    });
    expect(stackedHeight(items, rows)).toBe(listHeight(rows));
  });

  it("renders a kept row inside the window once, and ignores the ones out of the list", () => {
    const rows = layout(10_000);
    const items = windowItems(
      rows,
      { top: 0, height: 100 },
      { ...options, keep: [2, 9, -1, 10_000] }
    );
    expect(rowsOf(items)).toEqual(range(0, 10));
    expect(stackedHeight(items, rows)).toBe(listHeight(rows));
  });

  it("clamps a view outside the list", () => {
    const rows = layout(10_000);
    expect(rowsOf(windowItems(rows, { top: -500, height: 100 }, options))).toEqual(range(0, 6));
    expect(rowsOf(windowItems(rows, { top: 1e9, height: 100 }, options))).toEqual(
      range(9994, 10_000)
    );
  });
});

describe("revealTop", () => {
  const view = { scrollTop: 1000, viewHeight: 400, header: 40 };

  it("leaves the scroll alone when the row is in view below the header", () => {
    expect(revealTop({ ...view, rowTop: 1100, rowHeight: 25, align: "nearest" })).toBe(1000);
  });

  it("scrolls up to show a row hidden under the header or above the view", () => {
    expect(revealTop({ ...view, rowTop: 1020, rowHeight: 25, align: "nearest" })).toBe(980);
    expect(revealTop({ ...view, rowTop: 200, rowHeight: 25, align: "nearest" })).toBe(160);
  });

  it("scrolls down to show a row below the view, its bottom at the bottom", () => {
    expect(revealTop({ ...view, rowTop: 1390, rowHeight: 25, align: "nearest" })).toBe(1015);
  });

  it("centers a row in the room below the header", () => {
    expect(revealTop({ ...view, rowTop: 5000, rowHeight: 20, align: "center" })).toBe(
      5000 - 40 - (400 - 40 - 20) / 2
    );
  });

  it("never scrolls above the top", () => {
    expect(revealTop({ ...view, rowTop: 10, rowHeight: 25, align: "center" })).toBe(0);
  });
});
