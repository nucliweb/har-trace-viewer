import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRedaction } from "../src/hooks/useRedaction.js";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useRedaction", () => {
  it("is off until chosen, and the next visit keeps each level", () => {
    const first = renderHook(() => useRedaction());
    expect(first.result.current[0]).toBe("off");
    act(() => first.result.current[1]("secrets"));
    expect(first.result.current[0]).toBe("secrets");
    first.unmount();

    const second = renderHook(() => useRedaction());
    expect(second.result.current[0]).toBe("secrets");
    act(() => second.result.current[1]("mask-hosts"));
    second.unmount();

    const third = renderHook(() => useRedaction());
    expect(third.result.current[0]).toBe("mask-hosts");
    act(() => third.result.current[1]("off"));
    third.unmount();

    expect(renderHook(() => useRedaction()).result.current[0]).toBe("off");
  });

  it("ignores a stored value it does not know", () => {
    window.localStorage.setItem("htv-redact", "everything");
    expect(renderHook(() => useRedaction()).result.current[0]).toBe("off");
  });

  it("keeps working for the page when localStorage throws", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    const { result } = renderHook(() => useRedaction());
    expect(result.current[0]).toBe("off");
    act(() => result.current[1]("mask-hosts"));
    expect(result.current[0]).toBe("mask-hosts");
    act(() => result.current[1]("off"));
    expect(result.current[0]).toBe("off");
  });
});
