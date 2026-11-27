import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateFlow } from "@htv/core";
import type { Flow } from "@htv/core";
import { TuiApp } from "../src/tui/App";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";
import { renderTui } from "./tui-probe";

// Counters over the real functions: the property under test is how much work a render does,
// not how long it takes.
const counts = vi.hoisted(() => ({ buildWaterfall: 0, fit: 0 }));
vi.mock("@htv/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@htv/core")>();
  return {
    ...core,
    buildWaterfall: (...args: Parameters<typeof core.buildWaterfall>) => {
      counts.buildWaterfall++;
      return core.buildWaterfall(...args);
    },
  };
});
vi.mock("../src/tui/lines", async (importOriginal) => {
  const lines = await importOriginal<typeof import("../src/tui/lines")>();
  return {
    ...lines,
    fit: (...args: Parameters<typeof lines.fit>) => {
      counts.fit++;
      return lines.fit(...args);
    },
  };
});

const ESC = "\u001B";
const DOWN = `${ESC}[B`;
const PAGE_DOWN = `${ESC}[6~`;
const END = `${ESC}[F`;
const ROWS = 50_000;
const SCREEN_ROWS = 30;
// A screen holds under 30 request rows; the budget leaves room for a few screens and for the
// fixed lines around the rows.
const SCREEN_BUDGET = 4 * SCREEN_ROWS;

let flow: Flow;

beforeAll(() => {
  const entries = Array.from({ length: ROWS }, (_, i) =>
    makeEntry({
      url: `https://${i % 7 === 0 ? "cdn.other.net" : "example.com"}/assets/${i}/file-${i}.js`,
      startTime: (i * 37) % 60_000,
      duration: 100 + (i % 400),
      mimeType: "application/javascript",
      resourceType: "script",
      transferSize: 1000 + (i % 90_000),
    })
  );
  flow = generateFlow([{ name: "Large", har: makeHar(entries) }]);
}, 60_000);

beforeEach(() => {
  counts.buildWaterfall = 0;
  counts.fit = 0;
});

// The app keeps the waterfall of each page it has built, so a test that counts the builds starts
// from pages it has not seen.
const fresh = (source: Flow): Flow => ({
  ...source,
  pages: source.pages.map((page) => ({ ...page })),
});

describe("a capture of 50k requests", () => {
  it.each([
    ["Waterfall", "2"],
    ["Resources", "3"],
  ])("formats only the rows of the screen on the %s tab", async (_name, tab) => {
    const { press, lastFrame, unmount } = renderTui(
      <TuiApp flow={fresh(flow)} version="0.0.0" rows={SCREEN_ROWS + 4} columns={110} />
    );
    await press(tab);

    expect(lastFrame()).toContain(`${ROWS + 1} requests`);
    expect(counts.fit).toBeLessThanOrEqual(SCREEN_BUDGET);
    unmount();
  });

  it("builds the waterfall once and formats a screen per key on the list tabs", async () => {
    const { press, lastFrame, unmount } = renderTui(
      <TuiApp flow={fresh(flow)} version="0.0.0" rows={SCREEN_ROWS + 4} columns={110} />
    );
    await press("2");
    const afterFirstScreen = counts.fit;

    await press(DOWN, DOWN, DOWN, PAGE_DOWN, PAGE_DOWN, END, "3", DOWN, PAGE_DOWN, "2");

    expect(counts.buildWaterfall).toBe(1);
    // Eleven keys, each drawing at most a screen of rows.
    expect(counts.fit - afterFirstScreen).toBeLessThanOrEqual(11 * SCREEN_BUDGET);
    expect(lastFrame()).toContain("Waterfall");
    unmount();
  });

  it("builds the waterfall once when the tab is left and visited again", async () => {
    const { press, unmount } = renderTui(
      <TuiApp flow={fresh(flow)} version="0.0.0" rows={SCREEN_ROWS + 4} columns={110} />
    );
    await press("2", "4", "2", "7", "3");

    expect(counts.buildWaterfall).toBe(1);
    unmount();
  });
});
