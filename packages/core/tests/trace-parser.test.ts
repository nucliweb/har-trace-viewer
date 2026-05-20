import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { parseTraceFile } from "../src/parsers/trace-parser-node.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = join(__dirname, "fixtures/webperf-snippets.trace.fixture.json");
const gzPath = "/Users/joanleon/projects/har-trace-viewer/fixtures/WebPerf-Snippets-Disable-Cache_Trace-20260519T123602.json.gz";

describe("parseTrace", () => {
  it("extracts navigationStart", () => {
    const json = readFileSync(fixturePath, "utf8");
    const result = parseTraceJson(json);

    expect(result.navigationStart).toBe(600415766385);
  });

  it("extracts FCP in ms relative to navigationStart", () => {
    const json = readFileSync(fixturePath, "utf8");
    const result = parseTraceJson(json);

    // firstContentfulPaint ts = 600415947914
    // navigationStart ts     = 600415766385
    // diff = 181529 μs = 181.529 ms
    expect(result.fcp).not.toBeNull();
    expect(result.fcp!).toBeCloseTo(181.53, 0);
  });

  it("extracts LCP from last largestContentfulPaint::Candidate", () => {
    const json = readFileSync(fixturePath, "utf8");
    const result = parseTraceJson(json);

    expect(result.lcp).not.toBeNull();
    expect(result.lcp!).toBeCloseTo(181.53, 0);
  });

  it("returns null for missing events gracefully", () => {
    const emptyTrace = JSON.stringify({
      traceEvents: [
        {
          name: "navigationStart",
          ts: 1000000,
          args: { data: { isOutermostMainFrame: true } },
        },
      ],
    });
    const result = parseTraceJson(emptyTrace);

    expect(result.fcp).toBeNull();
    expect(result.lcp).toBeNull();
  });

  it("parses .json.gz file", async () => {
    const result = await parseTraceFile(gzPath);

    expect(result.fcp).not.toBeNull();
    expect(result.fcp!).toBeCloseTo(181.53, 0);
    expect(result.lcp).not.toBeNull();
  });
});
