import { describe, it, expect } from "vitest";
import { generateFlow } from "../src/steps/step-generator.js";
import { markdownReport, mermaidReport, requestsCsv } from "../src/analysis/export.js";
import type { Flow, PageAnalysis } from "../src/types.js";
import { makeEntry, makeHar, makeTrace } from "./helpers/synthetic-har.js";

function flowNamed(name: string): Flow {
  const har = makeHar([
    makeEntry({ url: "https://example.com/missing.js", status: 404, transferSize: 450 }),
    makeEntry({ url: "https://example.com/app.js", startTime: 120, transferSize: 9_000 }),
    makeEntry({ url: "https://example.com/app.js", startTime: 240, transferSize: 9_000 }),
    makeEntry({
      url: "https://cdn.example.net/a,b.css",
      method: "GET",
      httpVersion: "h2",
      contentEncoding: "br",
      timing: {
        dns: 0,
        connect: 0,
        ssl: 0,
        send: 1,
        wait: 10.26,
        receive: 5,
        blocked: 2,
        notApplicable: ["dns", "connect", "ssl"],
      },
    }),
  ]);
  return generateFlow([{ name, har, trace: makeTrace(900, 5_000, { cls: 0.3, inp: 80 }) }]);
}

describe("requestsCsv", () => {
  const lines = requestsCsv(flowNamed("Home")).split("\r\n");
  const cdnRow = lines.find((l) => l.includes("cdn.example.net")) ?? "";

  it("starts with the header row and ends with a line break", () => {
    expect(lines[0]).toBe(
      "page,side,url,host,type,method,status,protocol,encoding,from_cache,start_ms,blocked_ms,dns_ms,connect_ms,ssl_ms,send_ms,wait_ms,receive_ms,duration_ms,transfer_bytes,body_bytes,priority"
    );
    expect(lines.at(-1)).toBe("");
  });

  it("writes one row per request", () => {
    // header, the document, four entries and the empty string after the last line break
    expect(lines).toHaveLength(1 + 5 + 1);
  });

  it("quotes fields with commas and starts each row with the page and an empty side", () => {
    expect(cdnRow).toContain('"https://cdn.example.net/a,b.css"');
    expect(cdnRow.startsWith("Home,,")).toBe(true);
  });

  it("doubles the quotes of a quoted field", () => {
    const csv = requestsCsv(flowNamed('He said "hi", twice'));
    expect(csv.split("\r\n")[1].startsWith('"He said ""hi"", twice",,')).toBe(true);
  });

  it("leaves not-applicable phases empty and rounds ms to one decimal", () => {
    expect(cdnRow).toContain(",h2,br,false,");
    // blocked 2, dns, connect and ssl empty, send 1, wait 10.3, receive 5
    expect(cdnRow).toContain(",2,,,,1,10.3,5,");
  });

  it("names the side of a comparison", () => {
    const rows = requestsCsv(flowNamed("A"), flowNamed("B")).split("\r\n");
    expect(rows[1].split(",")[1]).toBe("a");
    expect(rows.find((r) => r.startsWith("B,"))?.split(",")[1]).toBe("b");
  });
});

describe("markdownReport", () => {
  const lines = markdownReport(flowNamed("Home")).split("\n");

  it("titles each page with its name and URL", () => {
    expect(lines).toContain("## Home");
    expect(lines).toContain("https://example.com/");
  });

  it("lists the metrics as a table with a header row and ratings", () => {
    const i = lines.indexOf("### Metrics");
    expect(lines[i + 2]).toBe("| Metric | Value | Rating |");
    expect(lines[i + 3]).toBe("| --- | --- | --- |");
    expect(lines).toContain("| LCP | 5.0 s | poor |");
    expect(lines).toContain("| CLS | 0.300 | poor |");
    expect(lines.some((l) => l.startsWith("| Requests | 5 |"))).toBe(true);
  });

  it("groups findings by severity with summary, recommendation and evidence", () => {
    expect(lines).toContain("### Findings");
    expect(lines).toContain("#### Critical");
    const i = lines.findIndex((l) => l.startsWith("- **LCP is poor"));
    expect(i).toBeGreaterThan(lines.indexOf("#### Critical"));
    const block = lines.slice(i, i + 12);
    expect(block.some((l) => l.startsWith("  - `https://example.com/` (5.0 s)"))).toBe(true);
    expect(block.some((l) => /^ {2}_Source: \w+; confidence: (high|medium|low)\._$/.test(l))).toBe(
      true
    );
  });

  it("limits the evidence to five rows per finding", () => {
    const flow = flowNamed("Many");
    const resources = Array.from({ length: 8 }, (_, n) => ({
      url: `https://example.com/${n}.js`,
      transferSize: 1000,
    }));
    const analysis = {
      ...flow.pageAnalyses[0],
      customReport: {
        recommendations: [
          { label: "Too many", description: "Eight files.", severity: "warning", resources },
        ],
      },
    } as PageAnalysis;
    const out = markdownReport({ ...flow, pageAnalyses: [analysis] }).split("\n");
    const rows = out.filter((l) => /^ {2}- `https:\/\/example\.com\/\d\.js`/.test(l));
    expect(rows).toHaveLength(5);
  });

  it("lists the hosts as a table", () => {
    const i = lines.indexOf("### Hosts");
    expect(lines[i + 2]).toBe(
      "| Host | Provider · PoP | Requests | Cache hits | Bytes | Median TTFB | Protocol |"
    );
    expect(lines.some((l) => l.startsWith("| example.com |"))).toBe(true);
  });

  it("escapes pipes in headings and table cells", () => {
    expect(markdownReport(flowNamed("a|b"))).toContain("## a\\|b");
  });

  it("puts a comparison table before the per-side sections", () => {
    const out = markdownReport(flowNamed("Cold"), flowNamed("Warm")).split("\n");
    const cmp = out.indexOf("## Comparison");
    expect(cmp).toBeGreaterThan(-1);
    expect(out[cmp + 2]).toBe("| Metric | A | B | Delta | Rating |");
    expect(cmp).toBeLessThan(out.indexOf("## A: Cold"));
    expect(out.indexOf("## A: Cold")).toBeLessThan(out.indexOf("## B: Warm"));
  });

  it("shows the page's value and the min–max of each metric for the median of several runs", () => {
    const flow = flowNamed("Run 2 · First view (median of 3 runs)");
    const runSpread = {
      lcp: { min: 2_100, median: 2_600, max: 5_200, p75: 5_200, runs: 3 },
      transferBytes: { min: 300_000, median: 320_000, max: 410_000, p75: 410_000, runs: 3 },
      browserCacheHitRatio: { min: 0, median: 0, max: 0, p75: 0, runs: 3 },
    };
    const analysis = { ...flow.pageAnalyses[0], runSpread };
    const out = markdownReport({ ...flow, pageAnalyses: [analysis] }).split("\n");
    const i = out.indexOf("### Metrics");
    expect(out[i + 2]).toBe("| Metric | Value (min–max of 3 runs) | Rating |");
    // The page's own value, rated, not the median of the metric over the runs.
    expect(out).toContain("| LCP | 5.0 s (2.1 s–5.2 s) | poor |");
    expect(out.find((l) => l.startsWith("| Transfer |"))).toMatch(
      /^\| Transfer \| .+ \(300 KB–410 KB\) \| {2}\|$/
    );
    expect(out.find((l) => l.startsWith("| Browser cache hit ratio |"))).toMatch(
      /^\| Browser cache hit ratio \| .+ \(0%–0%\) \| {2}\|$/
    );
    // A metric without a spread keeps the page's own value.
    expect(out).toContain("| CLS | 0.300 | poor |");
  });

  it("is deterministic", () => {
    expect(markdownReport(flowNamed("Home"))).toBe(markdownReport(flowNamed("Home")));
  });
});

describe("mermaidReport", () => {
  it("draws the document request and its response, one fenced block per page", () => {
    const lines = mermaidReport(flowNamed("Home")).split("\n");
    expect(lines.filter((l) => l === "```mermaid")).toHaveLength(1);
    expect(lines).toContain("sequenceDiagram");
    expect(lines.some((l) => /^ {4}Browser->>.+: GET \//.test(l))).toBe(true);
    expect(lines.some((l) => /^ {4}.+-->>Browser: 200 .*TTFB/.test(l))).toBe(true);
  });

  it("adds the GFW between the browser and the first server in the cn region", () => {
    const { har } = flowNamed("Home").pages[0];
    const flow = generateFlow([{ name: "Home", har }], { clientRegion: "cn" });
    expect(mermaidReport(flow)).toContain("participant GFW");
    expect(mermaidReport(flowNamed("Home"))).not.toContain("GFW");
  });

  it("emits a block per side of a comparison", () => {
    const out = mermaidReport(flowNamed("A"), flowNamed("B"));
    expect(out.split("\n").filter((l) => l === "```mermaid")).toHaveLength(2);
  });
});
