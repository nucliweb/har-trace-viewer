import { describe, expect, it } from "vitest";
import { hstack, lineText, panel, seg, truncateLine } from "../src/tui/lines";

const texts = (lines: ReturnType<typeof panel>) => lines.map(lineText);

describe("panel", () => {
  it("frames the body with rounded borders and the title in the top edge", () => {
    expect(texts(panel("Metrics", [[seg("TTFB  50 ms")], [seg("a"), seg("b")]], 20))).toEqual([
      "╭─ Metrics ────────╮",
      "│ TTFB  50 ms      │",
      "│ ab               │",
      "╰──────────────────╯",
    ]);
  });

  it("truncates a line wider than the panel with an ellipsis, keeping the styles", () => {
    const [, row] = panel("", [[seg("abcdefgh", { bold: true }), seg("ij", { dim: true })]], 10);
    expect(lineText(row)).toBe("│ abcde… │");
    expect(row[1]).toMatchObject({ text: "abcde…", bold: true });
  });

  it("pads the body to a minimum height", () => {
    expect(texts(panel("T", [[seg("x")]], 8, { minHeight: 4 }))).toEqual([
      "╭─ T ──╮",
      "│ x    │",
      "│      │",
      "╰──────╯",
    ]);
  });
});

describe("hstack", () => {
  it("puts blocks side by side, padding each to its width and the shorter one with blank rows", () => {
    const left = panel("L", [[seg("1")], [seg("2")]], 7);
    const right = panel("R", [[seg("x")]], 7);
    expect(
      texts(
        hstack([
          { lines: left, width: 7 },
          { lines: right, width: 7 },
        ])
      )
    ).toEqual(["╭─ L ─╮ ╭─ R ─╮", "│ 1   │ │ x   │", "│ 2   │ ╰─────╯", "╰─────╯        "]);
  });
});

describe("truncateLine", () => {
  it("leaves a line that fits untouched", () => {
    const line = [seg("abc")];
    expect(truncateLine(line, 3)).toBe(line);
  });
});
