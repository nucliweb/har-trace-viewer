import { describe, expect, it } from "vitest";
import { MOUSE_OFF, MOUSE_ON, createMouseParser } from "../src/tui/mouse";

const ESC = "\u001B";
const sgr = (code: number, x: number, y: number, final: "M" | "m" = "M") =>
  `${ESC}[<${code};${x};${y}${final}`;

describe("the mouse reporting sequences", () => {
  it("turns on button reporting in the SGR encoding and turns both off in reverse", () => {
    expect(MOUSE_ON).toBe(`${ESC}[?1000h${ESC}[?1006h`);
    expect(MOUSE_OFF).toBe(`${ESC}[?1006l${ESC}[?1000l`);
  });
});

describe("the mouse parser", () => {
  it("reads a left press and its release with the 1-based cell", () => {
    const parser = createMouseParser();
    const { text, events } = parser.push(sgr(0, 12, 3) + sgr(0, 12, 3, "m"));
    expect(text).toBe("");
    expect(events).toEqual([
      { type: "press", button: 0, x: 12, y: 3 },
      { type: "release", button: 0, x: 12, y: 3 },
    ]);
  });

  it("reads the wheel in both directions, with or without modifiers", () => {
    const { events } = createMouseParser().push(sgr(64, 1, 1) + sgr(65, 1, 1) + sgr(64 + 4, 1, 1));
    expect(events.map((e) => e.type)).toEqual(["wheel-up", "wheel-down", "wheel-up"]);
  });

  it("reads the other buttons and the motion of a drag", () => {
    const { events } = createMouseParser().push(sgr(1, 5, 5) + sgr(2, 5, 5) + sgr(32, 6, 5));
    expect(events).toEqual([
      { type: "press", button: 1, x: 5, y: 5 },
      { type: "press", button: 2, x: 5, y: 5 },
      { type: "move", button: 0, x: 6, y: 5 },
    ]);
  });

  it("leaves the keys around a sequence as text, in order", () => {
    const { text, events } = createMouseParser().push(`ab${sgr(0, 2, 2)}c${ESC}[Bd`);
    expect(text).toBe(`abc${ESC}[Bd`);
    expect(events).toHaveLength(1);
  });

  it("passes the escape sequences of keys through untouched", () => {
    const keys = `${ESC}[A${ESC}[6~${ESC}OP${ESC}${ESC}[C`;
    expect(createMouseParser().push(keys)).toEqual({ text: keys, events: [] });
  });

  it("joins a sequence split across chunks at any point", () => {
    const whole = sgr(0, 120, 45);
    for (let cut = 1; cut < whole.length; cut++) {
      const parser = createMouseParser();
      const first = parser.push(`x${whole.slice(0, cut)}`);
      const second = parser.push(`${whole.slice(cut)}y`);
      expect(first.text + second.text, `cut at ${cut}`).toBe("xy");
      expect([...first.events, ...second.events], `cut at ${cut}`).toEqual([
        { type: "press", button: 0, x: 120, y: 45 },
      ]);
    }
  });

  it("holds a lone Esc until it knows it is not a sequence, then lets it go", () => {
    const parser = createMouseParser();
    expect(parser.push(ESC)).toEqual({ text: "", events: [] });
    expect(parser.flush()).toBe(ESC);
    expect(parser.flush()).toBe("");
    expect(parser.push(ESC).text).toBe("");
    expect(parser.push("q")).toEqual({ text: `${ESC}q`, events: [] });
  });

  it("drops a malformed mouse sequence instead of handing it on as keys", () => {
    const parser = createMouseParser();
    for (const junk of [
      `${ESC}[<1;2;3X`,
      `${ESC}[<;;M`,
      `${ESC}[<99999999;1;1M`,
      `${ESC}[<0;0;0M`,
    ]) {
      expect(parser.push(`a${junk}b`), junk).toEqual({ text: "ab", events: [] });
    }
  });

  it("does not hold back typing after a sequence that never ends", () => {
    const parser = createMouseParser();
    const first = parser.push(`${ESC}[<${"1;".repeat(20)}`);
    const second = parser.push("hello");
    expect(first.events).toEqual([]);
    expect(first.text + second.text).toBe("hello");
  });
});
