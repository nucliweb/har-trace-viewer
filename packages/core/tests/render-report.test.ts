import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { analyzeRender } from "../src/analysis/render-report.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { makeHar } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const har = parseHarJson(
  readFileSync(
    join(
      __dirname,
      "../../../fixtures/webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har"
    ),
    "utf8"
  )
);
const trace = parseTraceJson(
  readFileSync(join(__dirname, "fixtures/webperf-snippets-render.trace.fixture.json"), "utf8")
);

describe("analyzeRender", () => {
  it("joins the LCP attribution, the render-blocking report and their recommendations", () => {
    const report = analyzeRender(har, trace);

    expect(report.lcp?.resource?.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(report.renderBlocking.resources).toHaveLength(2);
    expect(report.recommendations.map((r) => [r.label, r.severity])).toEqual([
      ["LCP is good", "good"],
      ["Render-blocking resources delay FCP", "info"],
    ]);
  });

  it("still reports render-blocking resources from the HAR without a trace", () => {
    const report = analyzeRender(makeHar([]), undefined);

    expect(report.lcp).toBeNull();
    expect(report.renderBlocking.source).toBe("none");
    expect(report.recommendations).toEqual([]);
  });
});

describe("generateFlow — render report", () => {
  it("attaches the render report to each page analysis", () => {
    const flow = generateFlow([{ name: "Home", har, trace }]);

    expect(flow.pageAnalyses[0].renderReport).toEqual(analyzeRender(har, trace));
  });
});
