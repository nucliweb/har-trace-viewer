import { describe, expect, it } from "vitest";
import { formatBytes, formatDelta, formatDeltaPct, formatMs, shortUrl } from "../src/lib/format.js";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1234, "1.2 KB"],
    [15600, "16 KB"],
    [2_500_000, "2.5 MB"],
  ])("formats %d as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatMs", () => {
  it.each([
    [340, "340 ms"],
    [1200, "1.2 s"],
    [null, "n/a"],
    [undefined, "n/a"],
    [NaN, "n/a"],
  ])("formats %s as %s", (ms, expected) => {
    expect(formatMs(ms)).toBe(expected);
  });
});

describe("shortUrl", () => {
  it("keeps the last path segment and the query", () => {
    expect(shortUrl("https://cdn.example.com/a/b/app.js?v=3")).toBe("app.js?v=3");
  });

  it("falls back to the hostname for a bare origin", () => {
    expect(shortUrl("https://example.com/")).toBe("example.com");
  });

  it("returns the raw string when the URL is invalid", () => {
    expect(shortUrl("not a url")).toBe("not a url");
  });

  it("truncates long labels to 36 characters with an ellipsis", () => {
    const label = shortUrl(`https://example.com/${"a".repeat(80)}.js`);
    expect(label).toHaveLength(35);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("formatDelta", () => {
  it.each([
    [-300, "ms", "−300 ms"],
    [1200, "ms", "+1.2 s"],
    [0, "ms", "0 ms"],
    [-15600, "bytes", "−16 KB"],
    [-2, "count", "−2"],
    [3, "count", "+3"],
    [0.45, "ratio", "+45 pp"],
    [-0.004, "score", "−0.004"],
    [null, "ms", "n/a"],
  ] as const)("formats %s (%s) as %s", (delta, unit, expected) => {
    expect(formatDelta(delta, unit)).toBe(expected);
  });
});

describe("formatDeltaPct", () => {
  it.each([
    [-60, "−60%"],
    [12.4, "+12%"],
    [0, "0%"],
    [null, ""],
  ])("formats %s as %s", (pct, expected) => {
    expect(formatDeltaPct(pct)).toBe(expected);
  });
});
