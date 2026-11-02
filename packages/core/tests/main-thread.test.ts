import { describe, it, expect } from "vitest";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseTrace } from "../src/parsers/trace-parser.js";
import { parseTraceFile } from "../src/parsers/trace-parser-node.js";
import { profileMainThread } from "../src/parsers/main-thread.js";
import type { RawTraceEvent } from "../src/parsers/main-thread.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const gzPath = join(
  __dirname,
  "../../../fixtures/WebPerf-Snippets-Disable-Cache_Trace-20260519T123602.json.gz"
);

const NAV_US = 1_000_000;
const MAIN = { pid: 1, tid: 2 };
const OWN = "https://example.com/app.js";
const VENDOR = "https://cdn.vendor.com/tag.js";
const EXTENSION = "chrome-extension://abcdef/content.js";

// A complete event on the main thread, at `startMs` for `durMs`.
const X = (name: string, startMs: number, durMs: number, data: object = {}): RawTraceEvent => ({
  name,
  ph: "X",
  ts: NAV_US + startMs * 1000,
  dur: durMs * 1000,
  ...MAIN,
  args: { data },
});
const script = (name: string, url: string, startMs: number, durMs: number) =>
  X(name, startMs, durMs, { url, functionName: "f" });

const nav: RawTraceEvent = {
  name: "navigationStart",
  ph: "I",
  ts: NAV_US,
  ...MAIN,
  args: { data: { isOutermostMainFrame: true, documentLoaderURL: "https://example.com/" } },
};
const threadName: RawTraceEvent = {
  name: "thread_name",
  ph: "M",
  ts: 0,
  ...MAIN,
  args: { name: "CrRendererMain" },
};

// Four tasks: a short one before FCP (100 ms), a 120 ms one with a vendor script and layout,
// a 70 ms one of an extension, and a 100 ms one after the first interaction (600 ms).
function tasks(): RawTraceEvent[] {
  return [
    X("RunTask", 20, 15),
    script("FunctionCall", OWN, 22, 10),
    X("RunTask", 200, 120),
    script("FunctionCall", VENDOR, 200, 60),
    script("v8.compile", VENDOR, 200, 10),
    X("Layout", 270, 30),
    script("FunctionCall", "", 300, 5),
    X("RunTask", 400, 70),
    script("EvaluateScript", EXTENSION, 405, 60),
    X("RunTask", 700, 100),
    script("FunctionCall", OWN, 705, 90),
  ];
}

const profile = (events: RawTraceEvent[], fcp: number | null, firstInput: number | null) =>
  profileMainThread([threadName, nav, ...events], nav, fcp, firstInput)!;

describe("profileMainThread", () => {
  it("adds up the tasks' time by category from each event's self time", () => {
    const p = profile(tasks(), 100, 600);
    expect(p.busyMs).toBe(305);
    expect(p.byCategory).toEqual({
      scripting: 225,
      rendering: 30,
      painting: 0,
      parsing: 0,
      gc: 0,
      other: 50,
    });
  });

  it("attributes the time to the nearest script URL, anonymous functions aside", () => {
    const p = profile(tasks(), 100, 600);
    expect(p.scripts.map((s) => [s.url, s.ms, s.tasks])).toEqual([
      [OWN, 100, 2],
      [VENDOR, 60, 1],
      [EXTENSION, 60, 1],
    ]);
    expect(p.extensionMs).toBe(60);
  });

  it("lists the long tasks with their blocking time and what took most of them", () => {
    const p = profile(tasks(), 100, 600);
    expect(p.longTasks).toEqual([
      { startMs: 200, durationMs: 120, blockingMs: 70, url: VENDOR, category: "scripting" },
      { startMs: 400, durationMs: 70, blockingMs: 20, url: EXTENSION, category: "scripting" },
      { startMs: 700, durationMs: 100, blockingMs: 50, url: OWN, category: "scripting" },
    ]);
  });

  it("names the script that took most of a long task with several scripts", () => {
    const p = profile(
      [
        X("RunTask", 200, 120),
        script("FunctionCall", OWN, 200, 30),
        script("FunctionCall", VENDOR, 240, 70),
      ],
      100,
      null
    );
    expect(p.longTasks).toEqual([
      { startMs: 200, durationMs: 120, blockingMs: 70, url: VENDOR, category: "scripting" },
    ]);
  });

  it("sums the Total Blocking Time from FCP to the first interaction and shares it out by script", () => {
    const p = profile(tasks(), 100, 600);
    expect(p).toMatchObject({ tbtMs: 90, tbtFromMs: 100, tbtToMs: 600, tbtEndedBy: "interaction" });
    const blocking = Object.fromEntries(p.scripts.map((s) => [s.url, s.blockingMs]));
    expect(blocking[VENDOR]).toBe(35); // 70 × 60 / 120
    expect(blocking[EXTENSION]).toBeCloseTo(17.143, 2); // 20 × 60 / 70
    expect(blocking[OWN]).toBe(0); // its long task ran after the interaction
  });

  it("runs the window to the end of the recording without an interaction, and has no TBT without an FCP", () => {
    const toEnd = profile(tasks(), 100, null);
    expect(toEnd).toMatchObject({ tbtMs: 140, tbtToMs: 800, tbtEndedBy: "recording" });
    const noPaint = profile(tasks(), null, null);
    expect(noPaint.tbtMs).toBeNull();
    expect(noPaint.tbtFromMs).toBeNull();
    expect(noPaint.longTasks).toHaveLength(3);
  });

  it("is null for a trace without main-thread tasks", () => {
    expect(profileMainThread([threadName, nav], nav, 100, null)).toBeNull();
  });

  it("falls back to the CrRendererMain thread of the navigation's process", () => {
    const elsewhere = { ...nav, tid: 9 };
    const p = profileMainThread([threadName, elsewhere, ...tasks()], elsewhere, 100, null);
    expect(p?.busyMs).toBe(305);
  });

  it("reads the real recording: a fast page with no long task and extension scripts", async () => {
    const trace = await parseTraceFile(gzPath);
    const p = trace.mainThread!;
    expect(p.busyMs).toBeGreaterThan(250);
    expect(p.busyMs).toBeLessThan(275);
    expect(p.longTasks).toEqual([]);
    expect(p.tbtMs).toBe(0);
    expect(p.tbtEndedBy).toBe("recording");
    expect(p.byCategory.scripting).toBeGreaterThan(p.byCategory.rendering);
    expect(p.scripts.some((s) => s.url.startsWith("https://www.googletagmanager.com/"))).toBe(true);
    expect(p.extensionMs).toBeGreaterThan(0);
  });

  it("is kept on the parsed trace", () => {
    const parsed = parseTrace({ traceEvents: [threadName, nav, ...tasks()] });
    expect(parsed.mainThread?.busyMs).toBe(305);
  });
});
