import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseHarPages } from "../src/parsers/har-parser.js";
import { expandPageFlows } from "../src/steps/expand-page-flows.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { summarizeFlowMetrics } from "../src/analysis/metrics-summary.js";
import { collectFindings, findingsDocument } from "../src/analysis/findings.js";
import { markdownReport, mermaidReport, requestsCsv } from "../src/analysis/export.js";
import { buildWaterfall } from "../src/analysis/waterfall.js";
import { suggestClientRegion } from "../src/inference/node-detector.js";
import { firefoxEntry } from "./helpers/firefox-har.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const schema = JSON.parse(readFileSync(join(root, "schema/findings.schema.json"), "utf8"));

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

// An API capture as a proxy records it: no pages, JSON only, slow DNS to a .cn host, an
// http:// call, and headers that would read as document findings on an HTML response.
function apiCapture() {
  const json = (url: string, ms: number, headers: { name: string; value: string }[] = []) =>
    firefoxEntry(url, "application/json", {
      pageref: undefined,
      startedDateTime: at(ms),
      response: {
        status: 200,
        headers: [{ name: "Content-Type", value: "application/json" }, ...headers],
        content: { mimeType: "application/json", size: 4000 },
        bodySize: 4000,
        headersSize: 200,
      },
      timings: { blocked: 1, dns: 400, connect: 600, ssl: 0, send: 1, wait: 2500, receive: 9 },
    });
  return {
    log: {
      entries: [
        json("https://api.example.cn/v1/session", 0, [
          { name: "Cache-Control", value: "no-store" },
          { name: "Server-Timing", value: "db;dur=120" },
          { name: "Link", value: "<https://api.example.cn/v1/items>; rel=preload" },
          { name: "X-Cache", value: "MISS" },
        ]),
        json("https://api.example.cn/v1/items", 3000),
        json("http://telemetry.vendor.io/collect", 3100),
        json("https://api.example.cn/v1/items?page=2", 3200),
      ],
    },
  };
}

function apiFlow() {
  return generateFlow(expandPageFlows({ har: parseHarPages(apiCapture()) }));
}

const NONSENSE = /NaN|undefined|Invalid Date/;

describe("API capture without an HTML document", () => {
  it("tells no TTFB story and keeps every step's time a number", () => {
    const { steps } = apiFlow();

    expect(steps.map((s) => s.kind)).toEqual(["connection", "request", "third-party", "loaded"]);
    for (const step of steps) {
      expect(`${step.title} ${step.description}`).not.toMatch(/HTML|document/i);
      if (step.timestamp !== undefined) expect(Number.isFinite(step.timestamp)).toBe(true);
    }
  });

  it("lists the primary request with the other requests of the page", () => {
    const flow = apiFlow();
    const loaded = flow.steps.find((s) => s.kind === "loaded")!;

    expect(loaded.resourceRefs).toHaveLength(4);
  });

  it("has no TTFB or server wait in its metrics", () => {
    const [summary] = summarizeFlowMetrics(apiFlow());

    expect(summary).toMatchObject({ ttfb: null, serverWait: null, requests: 4 });
  });

  it("raises no document finding, and no TTFB finding", () => {
    const findings = collectFindings(apiFlow());
    const ids = findings.map((f) => f.id);

    expect(ids).not.toContain("slow-ttfb");
    expect(findings.filter((f) => /document/i.test(`${f.title} ${f.summary}`))).toEqual([]);
  });

  it("reports no document cache, Server-Timing, mixed content or render data", () => {
    const [analysis] = apiFlow().pageAnalyses;

    expect(analysis.cacheReport.recommendations.map((r) => r.label)).not.toContain(
      "Document not cached"
    );
    expect(analysis.connectionsReport?.serverTiming).toEqual([]);
    expect(analysis.networkReport?.mixedContent).toEqual([]);
    expect(analysis.renderReport).toMatchObject({
      lcp: null,
      renderBlocking: { source: "none", documentEndMs: null, resources: [], heldMs: 0 },
      recommendations: [],
    });
  });

  it("takes the busiest domain as the first party", () => {
    const [analysis] = apiFlow().pageAnalyses;

    expect(analysis.thirdPartyReport?.entities.map((e) => e.name)).toEqual(["vendor.io"]);
    const waterfall = buildWaterfall(apiFlow().pages[0].har);
    expect(waterfall.rows.map((r) => r.party)).toEqual(["first", "first", "third", "first"]);
    expect(waterfall.marks.ttfb).toBeNull();
  });

  it("does not read the region from a document it does not have", () => {
    expect(suggestClientRegion(parseHarPages(apiCapture())[0])?.reason ?? "").not.toMatch(
      /document/
    );
  });

  it("writes reports without NaN, undefined or Invalid Date", () => {
    const flow = apiFlow();

    for (const report of [markdownReport(flow), mermaidReport(flow), requestsCsv(flow)]) {
      expect(report).not.toMatch(NONSENSE);
    }
    expect(mermaidReport(flow)).not.toMatch(/TTFB/);
  });

  it("lists no page-load metric in the Markdown report, only what the capture has", () => {
    const report = markdownReport(apiFlow());

    expect(report).toMatch(/^\| Requests \| \d+ \|/m);
    for (const metric of ["TTFB", "Server wait", "FCP", "LCP", "CLS", "INP", "TBT"]) {
      expect(report, metric).not.toMatch(new RegExp(`^\\| ${metric}\\b`, "m"));
    }
  });

  it("writes a findings document that the schema accepts", () => {
    const meta = { htvVersion: "9.9.9", generatedAt: "2026-11-01T00:00:00.000Z", schema: "s.json" };
    const doc = findingsDocument([{ flow: apiFlow() }], meta);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

    expect(doc.pages[0].metrics).toMatchObject({ ttfb: null, serverWait: null });
    expect(validate(JSON.parse(JSON.stringify(doc))), JSON.stringify(validate.errors)).toBe(true);
  });
});
