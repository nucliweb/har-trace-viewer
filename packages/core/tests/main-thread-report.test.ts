import { describe, it, expect } from "vitest";
import { analyzeMainThread } from "../src/analysis/main-thread.js";
import { analyzeThirdParties } from "../src/analysis/third-parties.js";
import { collectFindings } from "../src/analysis/findings.js";
import { compareFlows } from "../src/analysis/compare.js";
import { markdownReport } from "../src/analysis/export.js";
import { summarizeFlowMetrics, rateMetric } from "../src/analysis/metrics-summary.js";
import { generateFlow } from "../src/steps/step-generator.js";
import type { MainThreadProfile, ParsedTrace, ScriptTime } from "../src/types.js";
import { makeEntry, makeHar, makeTrace } from "./helpers/synthetic-har.js";

const OWN = "https://example.com/app.js";
const VENDOR = "https://www.googletagmanager.com/gtm.js";
const WIDGET = "https://widget.acme-chat.com/w.js";
const EXTENSION = "chrome-extension://abcdef/content.js";

const script = (url: string, ms: number, blockingMs = 0, tasks = 1): ScriptTime => ({
  url,
  ms,
  blockingMs,
  tasks,
});

function profile(over: Partial<MainThreadProfile> = {}): MainThreadProfile {
  return {
    busyMs: 400,
    byCategory: { scripting: 300, rendering: 60, painting: 20, parsing: 10, gc: 5, other: 5 },
    scripts: [script(OWN, 120, 30, 3), script(VENDOR, 90, 40, 2), script(WIDGET, 60, 20, 1)],
    longTasks: [
      { startMs: 300, durationMs: 140, blockingMs: 90, url: VENDOR, category: "scripting" },
    ],
    tbtMs: 90,
    tbtFromMs: 100,
    tbtToMs: 2000,
    tbtEndedBy: "recording",
    extensionMs: 0,
    ...over,
  };
}

const trace = (mainThread: MainThreadProfile | null): ParsedTrace => ({
  ...makeTrace(100, 400),
  mainThread,
});

const har = () =>
  makeHar([
    makeEntry({ url: OWN, resourceType: "script", transferSize: 40_000 }),
    makeEntry({ url: VENDOR, resourceType: "script", transferSize: 90_000, startTime: 150 }),
    makeEntry({ url: WIDGET, resourceType: "script", transferSize: 30_000, startTime: 200 }),
  ]);

const labels = (recs: { label: string }[]) => recs.map((r) => r.label);

describe("analyzeMainThread", () => {
  it("tells the scripts of the page, of each third party and of the browser's extensions apart", () => {
    const report = analyzeMainThread(
      har(),
      trace(profile({ scripts: [...profile().scripts, script(EXTENSION, 25)], extensionMs: 25 }))
    );
    expect(report.scripts.map((s) => [s.url, s.party, s.entity])).toEqual([
      [OWN, "first", "example.com"],
      [VENDOR, "third", "Google Tag Manager"],
      [WIDGET, "third", "acme-chat.com"],
      [EXTENSION, "extension", "Browser extensions"],
    ]);
    expect(report.parties.map((p) => [p.entity, p.ms, p.blockingMs])).toEqual([
      ["example.com", 120, 30],
      ["Google Tag Manager", 90, 40],
      ["acme-chat.com", 60, 20],
      ["Browser extensions", 25, 0],
    ]);
    expect(report.parties[1].category).toBe("tag-manager");
  });

  it("flags the long tasks by the Total Blocking Time, with the blocking scripts as evidence", () => {
    const info = analyzeMainThread(har(), trace(profile()));
    const rec = info.recommendations.find((r) => r.label === "Long tasks block the main thread");
    expect(rec?.severity).toBe("info");
    expect(rec?.description).toMatch(
      /^1 long task \(over 50 ms\) ran between the first contentful paint and the end of the recording and blocked the main thread for 90 ms in total/
    );
    expect(rec?.description).toContain(`the longest took 140 ms running ${VENDOR}`);
    expect(rec?.resources?.map((r) => [r.url, r.transferSize])).toEqual([
      [VENDOR, 90_000],
      [OWN, 40_000],
      [WIDGET, 30_000],
    ]);

    const warning = analyzeMainThread(har(), trace(profile({ tbtMs: 350 })));
    expect(warning.recommendations[0].severity).toBe("warning");
    const critical = analyzeMainThread(
      har(),
      trace(profile({ tbtMs: 900, tbtEndedBy: "interaction" }))
    );
    expect(critical.recommendations[0].severity).toBe("critical");
    expect(critical.recommendations[0].description).toContain("and the first interaction");
  });

  it("flags third-party scripts past 250 ms of main-thread time, warning past 100 ms of blocking", () => {
    const quiet = analyzeMainThread(har(), trace(profile()));
    expect(labels(quiet.recommendations)).not.toContain(
      "Third-party scripts cost main-thread time"
    );

    const heavy = analyzeMainThread(
      har(),
      trace(
        profile({ scripts: [script(OWN, 50), script(VENDOR, 200, 30), script(WIDGET, 80, 10)] })
      )
    );
    const rec = heavy.recommendations.find(
      (r) => r.label === "Third-party scripts cost main-thread time"
    );
    expect(rec?.severity).toBe("info");
    expect(rec?.description).toMatch(
      /^Scripts from 2 third parties ran for 280 ms on the main thread, 40 ms of it blocking input: Google Tag Manager \(200 ms\), acme-chat\.com \(80 ms\)\./
    );
    expect(rec?.resources?.map((r) => r.url)).toEqual([VENDOR, WIDGET]);

    const blocking = analyzeMainThread(
      har(),
      trace(profile({ scripts: [script(VENDOR, 150, 120)] }))
    );
    expect(
      blocking.recommendations.find((r) => r.label === "Third-party scripts cost main-thread time")
        ?.severity
    ).toBe("warning");
  });

  it("notes the browser's extensions apart from the page's findings", () => {
    const report = analyzeMainThread(
      har(),
      trace(
        profile({
          scripts: [script(OWN, 20), script(EXTENSION, 80, 15, 2)],
          extensionMs: 80,
          tbtMs: 0,
          longTasks: [],
        })
      )
    );
    expect(labels(report.recommendations)).toEqual([
      "Main thread stays responsive",
      "Browser extensions ran in the recording",
    ]);
    const note = report.recommendations[1];
    expect(note.severity).toBe("info");
    expect(note.description).toMatch(
      /^Scripts of the browser's extensions ran for 80 ms on the page's main thread, 15 ms of it inside long tasks/
    );
    expect(note.resources).toEqual([
      { url: EXTENSION, transferSize: 0, detail: "80 ms on the main thread · 2 tasks" },
    ]);
  });

  it("rates a main thread with no long task after the first paint as good", () => {
    const report = analyzeMainThread(har(), trace(profile({ tbtMs: 0, longTasks: [] })));
    expect(report.recommendations).toEqual([
      expect.objectContaining({
        label: "Main thread stays responsive",
        severity: "good",
        description: expect.stringContaining("main thread busy 400 ms in all"),
      }),
    ]);
  });

  it("says nothing good or bad without an FCP to open the window", () => {
    const report = analyzeMainThread(har(), trace(profile({ tbtMs: null, tbtFromMs: null })));
    expect(report.recommendations).toEqual([]);
  });
});

describe("the main thread across the flow", () => {
  it("puts the report, the TBT metric and its findings on a page with a profiled trace", () => {
    const flow = generateFlow([
      { name: "Home", har: har(), trace: trace(profile({ tbtMs: 350 })) },
    ]);
    expect(flow.pageAnalyses[0].mainThreadReport?.tbtMs).toBe(350);
    const [summary] = summarizeFlowMetrics(flow);
    expect(summary.tbt).toBe(350);
    expect(rateMetric("tbt", 350)).toBe("needs-improvement");
    expect(rateMetric("tbt", 601)).toBe("poor");
    const findings = collectFindings(flow);
    expect(findings.find((f) => f.id === "high-tbt")).toMatchObject({
      severity: "warning",
      metric: "inp",
      source: "metrics",
    });
    expect(findings.find((f) => f.id === "long-tasks")).toMatchObject({
      source: "mainThread",
      metric: "inp",
    });
  });

  it("has no report, a null TBT and no vital finding without a profiled trace", () => {
    const flow = generateFlow([{ name: "Home", har: har(), trace: trace(null) }]);
    expect(flow.pageAnalyses[0].mainThreadReport).toBeUndefined();
    expect(summarizeFlowMetrics(flow)[0].tbt).toBeNull();
    expect(collectFindings(flow).some((f) => f.id === "high-tbt")).toBe(false);
  });

  it("gives each third party its main-thread time and blocking time", () => {
    const report = analyzeThirdParties(har(), trace(profile()));
    const gtm = report.entities.find((e) => e.name === "Google Tag Manager");
    expect(gtm).toMatchObject({ mainThreadMs: 90, blockingMs: 40 });
    const widget = report.entities.find((e) => e.name === "acme-chat.com");
    expect(widget).toMatchObject({ mainThreadMs: 60, blockingMs: 20 });
    const unprofiled = analyzeThirdParties(har(), trace(null));
    expect(unprofiled.entities[0].mainThreadMs).toBeUndefined();
  });

  it("compares the TBT of two flows after INP", () => {
    const a = generateFlow([{ name: "A", har: har(), trace: trace(profile({ tbtMs: 300 })) }]);
    const b = generateFlow([{ name: "B", har: har(), trace: trace(profile({ tbtMs: 100 })) }]);
    const { metrics } = compareFlows(a, b);
    const labelsInOrder = metrics.map((m) => m.label);
    expect(labelsInOrder.indexOf("TBT")).toBe(labelsInOrder.indexOf("INP") + 1);
    expect(metrics.find((m) => m.key === "tbt")).toMatchObject({
      a: 300,
      b: 100,
      delta: -200,
      rating: "better",
    });
  });

  it("writes a Main thread section in the Markdown report", () => {
    const flow = generateFlow([{ name: "Home", har: har(), trace: trace(profile()) }]);
    const lines = markdownReport(flow).split("\n");
    const i = lines.indexOf("### Main thread");
    expect(i).toBeGreaterThan(lines.indexOf("### Third parties"));
    expect(lines[i + 2]).toBe(
      "Main thread busy 400 ms: scripting 300 ms, rendering 60 ms, painting 20 ms, parsing 10 ms, gc 5 ms, other 5 ms · TBT 90 ms (FCP → end of recording, 2.0 s) · 1 long task"
    );
    expect(lines[i + 4]).toBe("| Script | Party | Entity | Time | Blocking | Tasks |");
    expect(lines[i + 6]).toBe(`| ${OWN} | First party | example.com | 120 ms | 30 ms | 3 |`);
    expect(lines).toContain("| TBT | 90 ms | good |");

    const bare = markdownReport(
      generateFlow([{ name: "Home", har: har(), trace: trace(null) }])
    ).split("\n");
    expect(bare[bare.indexOf("### Main thread") + 2]).toBe(
      "No main-thread profile: the trace has no main-thread tasks."
    );
  });
});
