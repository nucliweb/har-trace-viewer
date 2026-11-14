import { describe, expect, it } from "vitest";
import stringWidth from "string-width";
import { fit, hstack, lineText, panel, seg, table, truncateLine } from "../src/tui/lines";

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

describe("display width", () => {
  const widths = (lines: ReturnType<typeof panel>) =>
    lines.map((line) => stringWidth(lineText(line)));

  it("frames wide characters by the columns they take, not by their length", () => {
    expect(widths(panel("标题", [[seg("页面加载")], [seg("ok 👍")]], 16))).toEqual([
      16, 16, 16, 16,
    ]);
  });

  it("truncates wide characters to the panel without splitting one", () => {
    const [, row] = panel("", [[seg("页面加载页面加载")]], 10);
    expect(lineText(row)).toBe("│ 页面…  │");
    expect(stringWidth(lineText(row))).toBe(10);
  });

  it("never cuts an emoji in half", () => {
    const cut = lineText(truncateLine([seg("ab👍👍👍")], 5));
    expect(cut).toBe("ab👍…");
  });

  it("pads the columns of a table by display width", () => {
    const [, first, second] = table(
      ["name", "n"],
      [
        ["页面", "1"],
        ["abcdef", "2"],
      ]
    );
    expect(stringWidth(lineText(first))).toBe(stringWidth(lineText(second)));
  });

  it("fits a text to a width, padding it on request", () => {
    expect(fit("页面加载", 5)).toBe("页面…");
    expect(fit("ab", 4)).toBe("ab");
    expect(fit("ab", 4, { pad: true })).toBe("ab  ");
    expect(fit("页", 4, { pad: true })).toBe("页  ");
  });
});
