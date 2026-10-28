import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { computeCls, computeInp } from "../src/parsers/web-vitals.js";
import { parseTrace, parseTraceJson } from "../src/parsers/trace-parser.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = join(__dirname, "fixtures/webperf-snippets.trace.fixture.json");

const shift = (tsMs: number, score: number, data: Record<string, unknown> = {}) => ({
  name: "LayoutShift",
  ts: tsMs * 1000,
  args: { data: { score, had_recent_input: false, is_main_frame: true, ...data } },
});

const interaction = (id: number, durationMs: number, tsMs = 0) => [
  {
    name: "EventTiming",
    ph: "b",
    ts: tsMs * 1000,
    args: { data: { type: "click", duration: durationMs, interactionId: id } },
  },
  {
    name: "EventTiming",
    ph: "e",
    ts: (tsMs + durationMs) * 1000,
    args: { data: { type: "click", interactionId: id } },
  },
];

describe("computeCls", () => {
  it("returns null without LayoutShift events", () => {
    expect(computeCls([])).toBeNull();
  });

  it("sums shifts that fall in one session window", () => {
    const cls = computeCls([shift(100, 0.05), shift(400, 0.1), shift(900, 0.02)]);
    expect(cls).toBeCloseTo(0.17, 10);
  });

  it("ignores shifts with recent input", () => {
    const cls = computeCls([shift(100, 0.05), shift(200, 0.5, { had_recent_input: true })]);
    expect(cls).toBeCloseTo(0.05, 10);
  });

  it("returns 0 when every shift had recent input", () => {
    expect(computeCls([shift(100, 0.5, { had_recent_input: true })])).toBe(0);
  });

  it("ignores shifts outside the main frame", () => {
    expect(computeCls([shift(100, 0.3, { is_main_frame: false }), shift(200, 0.01)])).toBeCloseTo(
      0.01,
      10
    );
  });

  it("starts a new window after a gap longer than 1 s and keeps the larger window", () => {
    const cls = computeCls([shift(0, 0.05), shift(500, 0.05), shift(2000, 0.2)]);
    expect(cls).toBeCloseTo(0.2, 10);
    const cls2 = computeCls([shift(0, 0.2), shift(2000, 0.05), shift(2500, 0.05)]);
    expect(cls2).toBeCloseTo(0.2, 10);
  });

  it("keeps shifts exactly 1 s apart in the same window", () => {
    expect(computeCls([shift(0, 0.1), shift(1000, 0.1)])).toBeCloseTo(0.2, 10);
  });

  it("caps a window at 5 s", () => {
    // Shifts every 900 ms: gaps are fine, so only the 5 s cap splits them.
    const events = Array.from({ length: 8 }, (_, i) => shift(i * 900, 0.1));
    // 0..4500 ms in window one (6 shifts), 5400 and 6300 in window two.
    expect(computeCls(events)).toBeCloseTo(0.6, 10);
  });

  it("sorts events by timestamp", () => {
    expect(computeCls([shift(900, 0.02), shift(100, 0.05), shift(400, 0.1)])).toBeCloseTo(0.17, 10);
  });
});

describe("computeInp", () => {
  it("returns null without interactions", () => {
    expect(computeInp([])).toBeNull();
  });

  it("returns the longest interaction when there are few", () => {
    const events = [...interaction(1, 80), ...interaction(2, 250), ...interaction(3, 120)];
    expect(computeInp(events)).toBe(250);
  });

  it("ignores events with interactionId 0 or missing", () => {
    const events = [
      ...interaction(0, 900),
      { name: "EventTiming", ph: "b", ts: 0, args: { data: { type: "mousemove", duration: 800 } } },
      ...interaction(1, 100),
    ];
    expect(computeInp(events)).toBe(100);
  });

  it("returns null when only interactionId 0 events exist", () => {
    expect(computeInp(interaction(0, 300))).toBeNull();
  });

  it("takes the max duration per interactionId", () => {
    const events = [...interaction(1, 40), ...interaction(1, 160), ...interaction(2, 100)];
    expect(computeInp(events)).toBe(160);
  });

  it("uses the 98th percentile above 50 interactions", () => {
    // 100 interactions of 1..100 ms: sorted desc, index floor(100/50)=2 -> 98.
    const events = Array.from({ length: 100 }, (_, i) => interaction(i + 1, i + 1)).flat();
    expect(computeInp(events)).toBe(98);
  });
});

describe("parseTrace web vitals", () => {
  it("returns null cls and inp for the real fixture", () => {
    const result = parseTraceJson(readFileSync(fixturePath, "utf8"));
    expect(result.cls).toBeNull();
    expect(result.inp).toBeNull();
  });

  it("reads CLS and INP of the main navigation", () => {
    const events = [
      {
        name: "navigationStart",
        ts: 0,
        args: {
          data: {
            isOutermostMainFrame: true,
            navigationId: "A",
            documentLoaderURL: "https://x.test/",
          },
        },
      },
      shift(100, 0.05, { navigationId: "A" }),
      shift(300, 0.12, { navigationId: "A" }),
      shift(350, 0.9, { navigationId: "B" }),
      ...interaction(1, 250),
    ];
    const result = parseTrace({ traceEvents: events });
    expect(result.cls).toBeCloseTo(0.17, 10);
    expect(result.inp).toBe(250);
  });
});
