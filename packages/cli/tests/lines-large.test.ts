import { describe, it, expect } from "vitest";
import { scrollTable, table } from "../src/tui/lines.js";

// Above about 100k elements a spread into Math.max overflows the call stack.
const ROWS = 200_000;
const rows = Array.from({ length: ROWS }, (_, i) => [`https://example.com/${i}`, String(i)]);

describe("tables of 200k rows", () => {
  it("size each column to its widest cell", () => {
    const lines = table(["URL", "Size"], rows, ["left", "right"]);

    expect(lines).toHaveLength(ROWS + 1);
    const widest = `https://example.com/${ROWS - 1}`.length;
    expect(lines[1][0].text).toHaveLength(widest);
  });

  it("scroll across their columns", () => {
    const { lines, maxOffset } = scrollTable(["URL", "Size"], rows, ["left", "right"], 20, 0);

    expect(lines).toHaveLength(ROWS + 2);
    expect(maxOffset).toBe(0);
  });
});
