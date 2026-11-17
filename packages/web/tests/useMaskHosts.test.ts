import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMaskHosts } from "../src/hooks/useMaskHosts.js";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useMaskHosts", () => {
  it("is off until chosen, and the next visit keeps the choice", () => {
    const first = renderHook(() => useMaskHosts());
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    expect(first.result.current[0]).toBe(true);
    first.unmount();

    const second = renderHook(() => useMaskHosts());
    expect(second.result.current[0]).toBe(true);
    act(() => second.result.current[1](false));
    second.unmount();

    expect(renderHook(() => useMaskHosts()).result.current[0]).toBe(false);
    expect(window.localStorage.getItem("htv-redact")).toBeNull();
  });

  it("reads the three-level choice stored before: mask-hosts is checked", () => {
    window.localStorage.setItem("htv-redact", "mask-hosts");
    expect(renderHook(() => useMaskHosts()).result.current[0]).toBe(true);
  });

  it("reads the stored secrets level, and any other value, as unchecked, and clears it", () => {
    for (const stored of ["secrets", "everything", "off"]) {
      window.localStorage.setItem("htv-redact", stored);
      expect(renderHook(() => useMaskHosts()).result.current[0], stored).toBe(false);
      expect(window.localStorage.getItem("htv-redact"), stored).toBeNull();
    }
  });

  it("keeps working for the page when localStorage throws", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    const { result } = renderHook(() => useMaskHosts());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});
