import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseTraceJson } from "../src/parsers/trace-parser.js";
import { parseTraceFile } from "../src/parsers/trace-parser-node.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = join(__dirname, "fixtures/webperf-snippets.trace.fixture.json");
const gzPath = join(
  __dirname,
  "../../../fixtures/WebPerf-Snippets-Disable-Cache_Trace-20260519T123602.json.gz"
);

describe("parseTrace", () => {
  it("extracts navigationStart", () => {
    const json = readFileSync(fixturePath, "utf8");
    const result = parseTraceJson(json);

    expect(result.navigationStart).toBe(600415766427);
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

  describe("navigation awareness", () => {
    const nav = (ts: number, navigationId: string | undefined, url: string, outermost = true) => ({
      name: "navigationStart",
      ts,
      args: { data: { isOutermostMainFrame: outermost, documentLoaderURL: url, navigationId } },
    });

    it("uses the navigation that owns FCP/LCP in the real fixture", () => {
      const result = parseTraceJson(readFileSync(fixturePath, "utf8"));

      expect(result.navigationId).toMatch(/^2D6A0C86/);
      expect(result.url).toBe("https://webperf-snippets.nucliweb.net/");
      expect(result.navigationStart).toBe(600415766427);
      expect(result.fcp).toBeCloseTo((600415947914 - 600415766427) / 1000, 6);
      expect(result.lcp).toBeCloseTo((600415947914 - 600415766427) / 1000, 6);
    });

    it("ignores other navigations and iframe LCP candidates", () => {
      const trace = {
        traceEvents: [
          nav(1_000_000, "A", ""),
          nav(1_000_100, "B", "https://example.com/"),
          { name: "firstContentfulPaint", ts: 1_050_000, args: { data: { navigationId: "A" } } },
          { name: "firstContentfulPaint", ts: 1_200_100, args: { data: { navigationId: "B" } } },
          {
            name: "largestContentfulPaint::Candidate",
            ts: 1_300_100,
            args: { data: { navigationId: "B", isOutermostMainFrame: true, isMainFrame: true } },
          },
          {
            name: "largestContentfulPaint::Candidate",
            ts: 1_900_000,
            args: { data: { navigationId: "C", isOutermostMainFrame: false, isMainFrame: false } },
          },
        ],
      };
      const result = parseTraceJson(JSON.stringify(trace));

      expect(result.navigationId).toBe("B");
      expect(result.url).toBe("https://example.com/");
      expect(result.navigationStart).toBe(1_000_100);
      expect(result.fcp).toBeCloseTo(200, 6);
      expect(result.lcp).toBeCloseTo(300, 6);
    });

    it("falls back to the last navigation with a URL when no paint events exist", () => {
      const trace = {
        traceEvents: [nav(10, "A", ""), nav(20, "B", "https://a.test/"), nav(30, "C", "")],
      };
      const result = parseTraceJson(JSON.stringify(trace));

      expect(result.navigationStart).toBe(20);
      expect(result.navigationId).toBe("B");
    });

    it("still parses traces without navigationId fields", () => {
      const trace = {
        traceEvents: [
          { name: "navigationStart", ts: 1_000, args: { data: { isOutermostMainFrame: true } } },
          { name: "firstContentfulPaint", ts: 51_000, args: { data: {} } },
          { name: "largestContentfulPaint::Candidate", ts: 101_000, args: { data: {} } },
        ],
      };
      const result = parseTraceJson(JSON.stringify(trace));

      expect(result.navigationId).toBeNull();
      expect(result.url).toBeNull();
      expect(result.fcp).toBeCloseTo(50, 6);
      expect(result.lcp).toBeCloseTo(100, 6);
    });

    it("throws when there is no outermost navigationStart", () => {
      const trace = { traceEvents: [nav(1, "A", "https://x.test/", false)] };

      expect(() => parseTraceJson(JSON.stringify(trace))).toThrow(
        "No navigationStart found in trace"
      );
    });
  });
});
