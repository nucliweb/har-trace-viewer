import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePrefersReducedMotion } from "../src/hooks/usePrefersReducedMotion.js";
import { setMedia } from "./setup.js";

const QUERY = "(prefers-reduced-motion: reduce)";

describe("usePrefersReducedMotion", () => {
  it("is false by default", () => {
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  it("reflects the current preference", () => {
    setMedia(QUERY, true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(true);
  });

  it("reacts to change events and stops listening after unmount", () => {
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    act(() => setMedia(QUERY, true));
    expect(result.current).toBe(true);
    act(() => setMedia(QUERY, false));
    expect(result.current).toBe(false);
    unmount();
    expect(() => setMedia(QUERY, true)).not.toThrow();
  });

  it("is false when matchMedia is unavailable", () => {
    const original = window.matchMedia;
    // @ts-expect-error simulating an environment without matchMedia
    window.matchMedia = undefined;
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
    window.matchMedia = original;
  });
});
