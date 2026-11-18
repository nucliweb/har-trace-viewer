import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEQUENCE_STEP_MS, useSequencePlayback } from "../src/hooks/useSequencePlayback.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = () => act(() => void vi.advanceTimersByTime(SEQUENCE_STEP_MS));

describe("useSequencePlayback", () => {
  it("shows the whole sequence until asked to play", () => {
    const { result } = renderHook(() => useSequencePlayback(4));
    expect(result.current.current).toBeNull();
    expect(result.current.isPlaying).toBe(false);
    tick();
    expect(result.current.current).toBeNull();
  });

  it("steps from the first step, one at a time, and starts over after the last", () => {
    const { result } = renderHook(() => useSequencePlayback(3));
    act(() => result.current.step());
    expect(result.current.current).toBe(0);
    act(() => result.current.step());
    act(() => result.current.step());
    expect(result.current.current).toBe(2);
    act(() => result.current.step());
    expect(result.current.current).toBe(0);
  });

  it("plays from the first step to the last and stays on it", () => {
    const { result } = renderHook(() => useSequencePlayback(3));
    act(() => result.current.togglePlay());
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.current).toBe(0);
    tick();
    expect(result.current.current).toBe(1);
    tick();
    expect(result.current.current).toBe(2);
    expect(result.current.isPlaying).toBe(false);
    tick();
    expect(result.current.current).toBe(2);
    // Played again from the last step, it starts over.
    act(() => result.current.togglePlay());
    expect(result.current.current).toBe(0);
  });

  it("pauses, resumes where it was, and pauses when stepped by hand", () => {
    const { result } = renderHook(() => useSequencePlayback(5));
    act(() => result.current.togglePlay());
    tick();
    act(() => result.current.togglePlay());
    expect(result.current.isPlaying).toBe(false);
    tick();
    expect(result.current.current).toBe(1);
    act(() => result.current.togglePlay());
    expect(result.current.current).toBe(1);
    tick();
    expect(result.current.current).toBe(2);
    act(() => result.current.step());
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.current).toBe(3);
  });

  it("shows the whole sequence again on reset, and stops playing", () => {
    const { result } = renderHook(() => useSequencePlayback(4));
    act(() => result.current.togglePlay());
    act(() => result.current.reset());
    expect(result.current.current).toBeNull();
    expect(result.current.isPlaying).toBe(false);
    tick();
    expect(result.current.current).toBeNull();
  });

  it("has nothing to play with a single step", () => {
    const { result } = renderHook(() => useSequencePlayback(1));
    act(() => result.current.togglePlay());
    expect(result.current.current).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });

  it("stops its timer when unmounted", () => {
    const { result, unmount } = renderHook(() => useSequencePlayback(4));
    act(() => result.current.togglePlay());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
