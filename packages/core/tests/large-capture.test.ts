import { describe, it, expect } from "vitest";
import { parseHar, parseHarPages } from "../src/parsers/har-parser.js";
import { analyzeConnections } from "../src/analysis/connections.js";
import { analyzeRenderBlocking } from "../src/analysis/critical-path.js";
import { suggestClientRegion } from "../src/inference/node-detector.js";
import { profileMainThread } from "../src/parsers/main-thread.js";
import type { RawTraceEvent } from "../src/parsers/main-thread.js";
import { firefoxEntry } from "./helpers/firefox-har.js";

// Above this many elements a spread into Math.max / Math.min overflows the call stack.
const ROWS = 200_000;
const T0 = Date.UTC(2026, 0, 1);
const at = (ms: number) => new Date(T0 + ms).toISOString();

type RawHar = Parameters<typeof parseHarPages>[0];

function bigEntries(rows: number, extra: (i: number) => Record<string, unknown> = () => ({})) {
  return Array.from({ length: rows }, (_, i) =>
    firefoxEntry(
      i === 0 ? "https://example.com/" : `https://cdn${i % 5}.example.com/r/${i}.js`,
      i === 0 ? "text/html" : "application/javascript",
      { startedDateTime: at(i), ...extra(i) }
    )
  );
}

const harOf = (log: Record<string, unknown>) => ({ log }) as unknown as RawHar;

// Generous: the point is to finish, and coverage instrumentation slows these down.
describe("a capture of 200k requests", { timeout: 60_000 }, () => {
  it("is parsed when its page has no valid start and takes the earliest entry", () => {
    const raw = harOf({
      pages: [{ id: "page_1", title: "Big", pageTimings: { onLoad: -1 } }],
      entries: bigEntries(ROWS),
    });

    const parsed = parseHar(raw);

    expect(parsed.entries).toHaveLength(ROWS);
    expect(parsed.documentEntry.url).toBe("https://example.com/");
  });

  it("is parsed when a Playwright capture anchors its page at the first document", () => {
    const raw = harOf({
      creator: { name: "Playwright", version: "1" },
      pages: [{ id: "page_1", title: "Big", startedDateTime: at(-5000), pageTimings: {} }],
      entries: bigEntries(ROWS, () => ({ _resourceType: "document" })),
    });

    const parsed = parseHar(raw);

    expect(parsed.entries).toHaveLength(ROWS);
  });

  it("is analysed for the requests that hold the first paint", () => {
    const parsed = parseHar(
      harOf({
        pages: [{ id: "page_1", title: "Big", startedDateTime: at(0), pageTimings: {} }],
        entries: bigEntries(ROWS, (i) =>
          i === 0
            ? {}
            : {
                _priority: "High",
                _initiator: { type: "parser", url: "https://example.com/" },
              }
        ),
      })
    );

    const report = analyzeRenderBlocking(parsed, undefined);

    expect(report.resources).toHaveLength(ROWS - 1);
  });

  it("is analysed for its connections and its region", () => {
    const parsed = parseHar(
      harOf({
        pages: [{ id: "page_1", title: "Big", startedDateTime: at(0), pageTimings: {} }],
        entries: bigEntries(ROWS, (i) => ({
          timings: {
            blocked: -1,
            dns: -1,
            connect: i % 100,
            ssl: -1,
            send: 1,
            wait: 10,
            receive: 9,
          },
        })),
      })
    );

    expect(() => analyzeConnections(parsed)).not.toThrow();
    expect(() => suggestClientRegion(parsed)).not.toThrow();
  });
});

describe("a trace of 200k main-thread tasks", { timeout: 60_000 }, () => {
  it("is profiled", () => {
    const main = { pid: 1, tid: 2 };
    const nav: RawTraceEvent = {
      name: "navigationStart",
      ph: "I",
      ts: 1_000_000,
      ...main,
      args: { data: { isOutermostMainFrame: true, documentLoaderURL: "https://example.com/" } },
    };
    const threadName: RawTraceEvent = {
      name: "thread_name",
      ph: "M",
      ts: 0,
      ...main,
      args: { name: "CrRendererMain" },
    };
    const tasks: RawTraceEvent[] = Array.from({ length: ROWS }, (_, i) => ({
      name: "RunTask",
      ph: "X",
      ts: 1_000_000 + i * 10,
      dur: 5,
      ...main,
      args: { data: {} },
    }));

    const profile = profileMainThread([nav, threadName, ...tasks], nav, 100, null);

    expect(profile).not.toBeNull();
  });
});
