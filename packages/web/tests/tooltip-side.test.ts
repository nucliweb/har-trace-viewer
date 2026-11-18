import { describe, expect, it } from "vitest";
import { tooltipSide, visibleBox } from "../src/lib/tooltip-side.js";

describe("tooltipSide", () => {
  const box = { top: 100, bottom: 500 };

  it("stays below the row when it fits there", () => {
    expect(tooltipSide({ top: 200, bottom: 224 }, 150, box)).toBe("below");
  });

  it("goes above the row when it would run past the bottom and more of it fits above", () => {
    expect(tooltipSide({ top: 450, bottom: 474 }, 150, box)).toBe("above");
  });

  it("stays below when neither side fits and below has more room", () => {
    expect(tooltipSide({ top: 140, bottom: 164 }, 400, box)).toBe("below");
  });
});

describe("visibleBox", () => {
  const rect = (top: number, bottom: number) => () => ({ top, bottom }) as DOMRect;

  it("is the part of the window that every clipping ancestor leaves visible", () => {
    const outer = document.createElement("div");
    outer.style.overflow = "hidden";
    outer.getBoundingClientRect = rect(50, 900);
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.getBoundingClientRect = rect(100, 600);
    const plain = document.createElement("div");
    plain.getBoundingClientRect = rect(0, 2000);
    const element = document.createElement("span");
    outer.append(scroller);
    scroller.append(plain);
    plain.append(element);
    document.body.append(outer);

    expect(visibleBox(element)).toEqual({ top: 100, bottom: Math.min(600, window.innerHeight) });
    outer.remove();
  });
});
