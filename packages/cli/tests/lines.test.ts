import { describe, expect, it } from "vitest";
import stringWidth from "string-width";
import {
  breakText,
  fit,
  hstack,
  lineText,
  panel,
  scrollTable,
  seg,
  table,
  truncateLine,
} from "../src/tui/lines";

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

describe("panel cursor", () => {
  it("points at the cursor row from the left border, so that it shows without colour", () => {
    const lines = panel("T", [[seg("a")], [seg("b")]], 8, { cursor: 1 });
    expect(texts(lines)).toEqual(["╭─ T ──╮", "│ a    │", "│▸b    │", "╰──────╯"]);
    expect(lines[2][1]).toMatchObject({ text: "▸", bold: true });
  });
});

describe("breakText", () => {
  it("breaks a text without spaces into lines of the width, by display columns", () => {
    expect(breakText("https://example.com/a/b", 10)).toEqual(["https://ex", "ample.com/", "a/b"]);
    expect(breakText("页面加载", 5)).toEqual(["页面", "加载"]);
    expect(breakText("", 5)).toEqual([""]);
  });
});

describe("scrollTable", () => {
  const header = ["Host", "One", "Two", "Three", "Four"];
  const rows = [["example.com", "1", "22", "333", "4444"]];

  it("draws the whole table when it fits", () => {
    const shown = scrollTable(header, rows, [], 60, 0);
    expect(shown.lines.map(lineText)).toEqual(texts(table(header, rows)));
    expect(shown.maxOffset).toBe(0);
  });

  it("keeps the first column and the whole columns that fit, and says how many are hidden", () => {
    const shown = scrollTable(header, rows, [], 26, 0);
    expect(lineText(shown.lines[0])).toBe("Host         One  Two");
    expect(lineText(shown.lines[shown.lines.length - 1])).toBe("2 more columns ▸  < > scroll");
    expect(shown.maxOffset).toBe(2);
  });

  it("scrolls the columns after the first one, clamping the offset", () => {
    const shown = scrollTable(header, rows, [], 26, 9);
    expect(shown.offset).toBe(2);
    expect(lineText(shown.lines[0])).toBe("Host         Three  Four");
    expect(lineText(shown.lines[1])).toBe("example.com  333    4444");
    expect(lineText(shown.lines[2])).toBe("◂ 2 more columns  < > scroll");
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
