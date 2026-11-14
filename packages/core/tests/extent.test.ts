import { describe, it, expect } from "vitest";
import { maxOf, minOf } from "../src/utils/extent.js";

const ROWS = 200_000;
const rows = Array.from({ length: ROWS }, (_, i) => (i * 7919) % ROWS);

describe("maxOf and minOf", () => {
  it("find the extremes of an array too long to spread into Math.max", () => {
    expect(() => Math.max(...rows)).toThrow(RangeError);
    expect(maxOf(rows)).toBe(ROWS - 1);
    expect(minOf(rows)).toBe(0);
  });

  it("return the fallback for an empty array", () => {
    expect(maxOf([], 5)).toBe(5);
    expect(minOf([], 5)).toBe(5);
  });

  it("start from the fallback, like Math.max(fallback, ...values)", () => {
    expect(maxOf([1, 2], 10)).toBe(10);
    expect(minOf([4, 9], 1)).toBe(1);
    expect(maxOf([-3, -1])).toBe(-1);
    expect(minOf([3, 1])).toBe(1);
  });
});
