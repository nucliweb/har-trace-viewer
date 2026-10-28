import { describe, expect, it } from "vitest";
import { formatBytes, formatMs, shortUrl } from "../src/lib/format.js";

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
