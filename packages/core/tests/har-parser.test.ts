import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = join(__dirname, "fixtures/webperf-snippets.har.fixture.json");

describe("parseHar", () => {
  it("parses page timings", () => {
    const json = readFileSync(fixturePath, "utf8");
    const result = parseHarJson(json);

    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page.onLoad).toBeCloseTo(479.88, 0);
    expect(page.onContentLoad).toBeCloseTo(263.76, 0);
  });

  it("identifies the document entry (first HTML)", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.isDocument).toBe(true);
    expect(documentEntry.url).toContain("webperf-snippets.nucliweb.net");
  });

  it("extracts TTFB from the document entry", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.ttfb).toBeGreaterThan(0);
    expect(documentEntry.ttfb).toBeCloseTo(48.71, 0);
  });

  it("normalizes negative timing values to 0", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { entries } = parseHarJson(json);

    for (const entry of entries) {
      expect(entry.timing.dns).toBeGreaterThanOrEqual(0);
      expect(entry.timing.connect).toBeGreaterThanOrEqual(0);
      expect(entry.timing.ssl).toBeGreaterThanOrEqual(0);
    }
  });

  it("calculates startTime relative to page startedDateTime", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.startTime).toBeGreaterThanOrEqual(0);
    expect(documentEntry.startTime).toBeLessThan(100);
  });

  it("lowercases response header names", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    const headers = documentEntry.responseHeaders;
    expect(Object.keys(headers).every((k) => k === k.toLowerCase())).toBe(true);
  });

  it("exposes Vercel server header on the document entry", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { documentEntry } = parseHarJson(json);

    expect(documentEntry.responseHeaders["server"]).toBe("Vercel");
  });

  it("parses all 34 entries", () => {
    const json = readFileSync(fixturePath, "utf8");
    const { entries } = parseHarJson(json);

    expect(entries).toHaveLength(34);
  });
});
