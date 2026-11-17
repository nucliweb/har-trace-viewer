import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flow } from "@htv/core";
import { useDiagramState } from "../src/hooks/useDiagramState.js";

const flow = { steps: [{}, {}, {}, {}] } as unknown as Flow;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("the step in the link", () => {
  it("opens on the step of the link, 1-based", () => {
    window.history.replaceState(null, "", "/#p=3");
    const { result } = renderHook(() => useDiagramState(flow));
    expect(result.current.stepIndex).toBe(2);
  });

  it("clamps a step past the end and ignores a malformed one", () => {
    window.history.replaceState(null, "", "/#p=99");
    expect(renderHook(() => useDiagramState(flow)).result.current.stepIndex).toBe(3);
    window.history.replaceState(null, "", "/#p=0");
    expect(renderHook(() => useDiagramState(flow)).result.current.stepIndex).toBe(0);
  });

  it("follows the step without history entries, and leaves the first step out", () => {
    const before = window.history.length;
    const { result, unmount } = renderHook(() => useDiagramState(flow));
    expect(window.location.hash).toBe("");
    act(() => result.current.goTo(2));
    expect(window.location.hash).toBe("#p=3");
    act(() => result.current.goTo(0));
    expect(window.location.hash).toBe("");
    act(() => result.current.goTo(1));
    unmount();
    expect(window.location.hash).toBe("");
    expect(window.history.length).toBe(before);
  });

  it("keeps playback out of the link", () => {
    window.history.replaceState(null, "", "/#p=2&play=1");
    const { result } = renderHook(() => useDiagramState(flow));
    expect(result.current.isPlaying).toBe(false);
  });
});

describe("useDiagramState", () => {
  it("starts at the first step, paused, at 1400 ms", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    expect(result.current).toMatchObject({ stepIndex: 0, isPlaying: false, speed: 1400 });
  });

  it("clamps next and prev at both ends", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    act(() => result.current.prev());
    expect(result.current.stepIndex).toBe(0);
    act(() => result.current.goTo(3));
    act(() => result.current.next());
    expect(result.current.stepIndex).toBe(3);
  });

  it("goTo jumps and clamps out-of-range indexes", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    act(() => result.current.goTo(2));
    expect(result.current.stepIndex).toBe(2);
    act(() => result.current.goTo(99));
    expect(result.current.stepIndex).toBe(3);
    act(() => result.current.goTo(-5));
    expect(result.current.stepIndex).toBe(0);
  });

  it("advances on the interval while playing and stops at the last step", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    act(() => result.current.togglePlay());
    expect(result.current.isPlaying).toBe(true);
    act(() => void vi.advanceTimersByTime(1400));
    expect(result.current.stepIndex).toBe(1);
    act(() => void vi.advanceTimersByTime(1400));
    act(() => void vi.advanceTimersByTime(1400));
    expect(result.current.stepIndex).toBe(3);
    act(() => void vi.advanceTimersByTime(1400));
    expect(result.current.stepIndex).toBe(3);
    expect(result.current.isPlaying).toBe(false);
  });

  it("stops advancing when playback is toggled off", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    act(() => result.current.togglePlay());
    act(() => result.current.togglePlay());
    expect(vi.getTimerCount()).toBe(0);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current.stepIndex).toBe(0);
  });

  it("pauses when going back", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    act(() => result.current.goTo(2));
    act(() => result.current.togglePlay());
    act(() => result.current.prev());
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.stepIndex).toBe(1);
  });

  it("restarts from the first step when played from the end", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    act(() => result.current.goTo(3));
    act(() => result.current.togglePlay());
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.isPlaying).toBe(true);
  });

  it("uses the new speed for the next tick", () => {
    const { result } = renderHook(() => useDiagramState(flow));
    act(() => result.current.setSpeed(400));
    act(() => result.current.togglePlay());
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current.stepIndex).toBe(1);
  });

  it("clears the timer on unmount", () => {
    const { result, unmount } = renderHook(() => useDiagramState(flow));
    act(() => result.current.togglePlay());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
