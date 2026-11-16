import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { generateFlow } from "@htv/core";
import { TuiApp } from "../src/tui/App";
import type { MouseControl, MouseEvent } from "../src/tui/mouse";
import {
  criticalCss,
  makeEntry,
  makeHar,
  makeTrace,
  secondaryImage,
  thirdPartyScript,
} from "../../core/tests/helpers/synthetic-har";

const flow = generateFlow([
  {
    name: "First view",
    har: makeHar(
      [
        criticalCss(100),
        secondaryImage(200),
        thirdPartyScript(300),
        makeEntry({ url: "https://example.com/app/chunk-47TTPNLV.js", startTime: 150 }),
      ],
      { onContentLoad: 300, onLoad: 500 }
    ),
    trace: makeTrace(150, 400),
  },
]);

// A mouse that the test drives, and records the reporting switch of.
function fakeMouse() {
  const listeners = new Set<(event: MouseEvent) => void>();
  const control: MouseControl & { switched: boolean[] } = {
    enabled: true,
    switched: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setEnabled(on) {
      control.switched.push(on);
    },
  };
  const emit = (type: MouseEvent["type"], x: number, y: number, button = 0) =>
    listeners.forEach((listener) => listener({ type, button, x, y }));
  return { control, emit, listeners };
}

function open(props: { rows?: number; mouse?: MouseControl } = {}) {
  const mouse = props.mouse ?? fakeMouse().control;
  const app = render(
    <TuiApp flow={flow} version="0.0.0" columns={100} rows={30} {...props} mouse={mouse} />
  );
  const frame = () => app.lastFrame() ?? "";
  const lines = () => frame().split("\n");
  // The screen cell (1-based) of the first match of `text`.
  const cellOf = (text: string) => {
    const y = lines().findIndex((line) => line.includes(text));
    if (y < 0) throw new Error(`"${text}" is not on screen:\n${frame()}`);
    return { x: lines()[y].indexOf(text) + 1, y: y + 1 };
  };
  const until = (holds: () => boolean, what: string) =>
    vi.waitFor(() => expect(holds(), `${what}:\n${frame()}`).toBe(true), {
      timeout: 3000,
      interval: 5,
    });
  // The position the status bar ends with: the row under the cursor, or the lines in view.
  const position = () => lines().at(-1)?.trim().split(/\s+/).at(-1) ?? "";
  return { app, frame, lines, cellOf, until, position };
}

describe("the mouse in the terminal report", () => {
  it("switches to the tab that is clicked", async () => {
    const mouse = fakeMouse();
    const { cellOf, until, frame } = open({ mouse: mouse.control });
    await until(() => mouse.listeners.size === 1, "the app listening");
    const tab = cellOf("3 Resources");
    mouse.emit("press", tab.x + 2, tab.y);
    await until(() => frame().includes("Resources · 5 requests"), "the resources tab");
    expect(cellOf("3 Resources").y).toBe(2);
  });

  it("moves the row cursor to the request that is clicked, in the waterfall and the resources", async () => {
    const mouse = fakeMouse();
    const { cellOf, until, frame, lines } = open({ mouse: mouse.control });
    await until(() => mouse.listeners.size === 1, "the app listening");
    // The cursor stays with the request when the tab changes.
    for (const [tab, name] of [
      ["2 Waterfall", "chunk-47TTPNLV"],
      ["3 Resources", "image-200"],
    ]) {
      const at = cellOf(tab);
      mouse.emit("press", at.x, at.y);
      await until(() => frame().includes(`${tab.slice(2)} · 5 requests`), `the list of ${tab}`);
      const row = cellOf(name);
      mouse.emit("press", row.x, row.y);
      await until(
        () => lines().some((line) => line.includes("▸") && line.includes(name)),
        `the cursor on ${name} in ${tab}`
      );
    }
  });

  it("ignores a click that is not on a row, and the other buttons", async () => {
    const mouse = fakeMouse();
    const { cellOf, until, position } = open({ mouse: mouse.control });
    await until(() => mouse.listeners.size === 1, "the app listening");
    const at = cellOf("2 Waterfall");
    mouse.emit("press", at.x, at.y);
    await until(() => position() === "1/5", "the waterfall");
    const row = cellOf("chunk-47TTPNLV");
    mouse.emit("press", row.x, row.y, 2);
    mouse.emit("release", row.x, row.y);
    mouse.emit("press", row.x, 1);
    mouse.emit("press", row.x, 29);
    mouse.emit("press", row.x, 400);
    mouse.emit("wheel-down", 1, 1);
    await until(() => position() === "4/5", "only the wheel moved the cursor");
  });

  it("moves the cursor with the wheel over a list, and scrolls with it elsewhere", async () => {
    const mouse = fakeMouse();
    const { cellOf, until, position } = open({ mouse: mouse.control, rows: 12 });
    await until(() => mouse.listeners.size === 1, "the app listening");
    const overview = cellOf("4 Overview");
    mouse.emit("press", overview.x, overview.y);
    await until(() => position().startsWith("1-"), "the overview, longer than the screen");
    mouse.emit("wheel-down", 5, 5);
    await until(() => position().startsWith("4-"), "the overview scrolled by three lines");
    mouse.emit("wheel-up", 5, 5);
    await until(() => position().startsWith("1-"), "the overview back at the top");
    const waterfall = cellOf("2 Waterfall");
    mouse.emit("press", waterfall.x, waterfall.y);
    await until(() => position() === "1/5", "the waterfall");
    mouse.emit("wheel-down", 5, 5);
    await until(() => position() === "4/5", "the cursor three rows down");
    mouse.emit("wheel-up", 5, 5);
    await until(() => position() === "1/5", "the cursor back");
  });

  it("scrolls the help with the wheel and does not leave it on a click", async () => {
    const mouse = fakeMouse();
    const { app, cellOf, until, frame, position } = open({ mouse: mouse.control, rows: 14 });
    await until(() => mouse.listeners.size === 1, "the app listening");
    const tab = cellOf("2 Waterfall");
    app.stdin.write("?");
    await until(() => frame().includes("Keys"), "the help");
    mouse.emit("wheel-down", 5, 5);
    await until(() => position().startsWith("4-"), "the help scrolled");
    mouse.emit("press", tab.x, tab.y);
    mouse.emit("wheel-down", 5, 5);
    await until(() => position().startsWith("7-"), "the help still open");
  });

  it("turns the reporting off and on with m, and ignores the mouse while it is off", async () => {
    const mouse = fakeMouse();
    const { app, cellOf, until, frame } = open({ mouse: mouse.control });
    await until(() => mouse.listeners.size === 1, "the app listening");
    app.stdin.write("m");
    await until(() => mouse.control.switched.length === 1, "the first switch");
    expect(mouse.control.switched).toEqual([false]);
    const tab = cellOf("3 Resources");
    mouse.emit("press", tab.x, tab.y);
    app.stdin.write("m");
    await until(() => mouse.control.switched.length === 2, "the second switch");
    expect(mouse.control.switched).toEqual([false, true]);
    expect(frame()).not.toContain("Resources · 5 requests");
  });

  it("types m in the filter instead of switching the mouse", async () => {
    const mouse = fakeMouse();
    const { app, until, frame, position } = open({ mouse: mouse.control });
    await until(() => mouse.listeners.size === 1, "the app listening");
    app.stdin.write("2");
    await until(() => position() === "1/5", "the waterfall");
    app.stdin.write("/");
    await until(() => frame().includes("type to filter"), "the filter");
    app.stdin.write("m");
    await until(() => frame().includes("Filter: m"), "the letter in the filter");
    expect(mouse.control.switched).toEqual([]);
  });

  it("stops listening when it unmounts", async () => {
    const mouse = fakeMouse();
    const { app, until } = open({ mouse: mouse.control });
    await until(() => mouse.listeners.size === 1, "the app listening");
    app.unmount();
    expect(mouse.listeners.size).toBe(0);
  });
});
