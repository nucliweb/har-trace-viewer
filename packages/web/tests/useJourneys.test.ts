import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useJourneys } from "../src/hooks/useJourneys.js";

afterEach(() => vi.restoreAllMocks());

describe("useJourneys", () => {
  it("is off until turned on, and the next visit keeps the choice", () => {
    const first = renderHook(() => useJourneys());
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    expect(first.result.current[0]).toBe(true);
    first.unmount();

    expect(renderHook(() => useJourneys()).result.current[0]).toBe(true);
  });

  it("turned off again, the next visit starts off", () => {
    const first = renderHook(() => useJourneys());
    act(() => first.result.current[1](true));
    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    first.unmount();

    expect(renderHook(() => useJourneys()).result.current[0]).toBe(false);
  });

  it("keeps working for the page when localStorage throws", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    const { result } = renderHook(() => useJourneys());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});
