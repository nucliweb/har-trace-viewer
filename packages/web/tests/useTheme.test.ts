import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, useTheme } from "../src/hooks/useTheme.js";
import { setMedia } from "./setup.js";

const DARK = "(prefers-color-scheme: dark)";

describe("useTheme", () => {
  it("uses the stored choice over the system preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    setMedia(DARK, true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("falls back to the system preference when nothing is stored", () => {
    setMedia(DARK, true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("ignores an invalid stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(renderHook(() => useTheme()).result.current.theme).toBe("light");
  });

  it("follows live system changes until a choice is made", () => {
    const { result } = renderHook(() => useTheme());
    act(() => setMedia(DARK, true));
    expect(result.current.theme).toBe("dark");
  });

  it("toggle flips the theme, persists it and updates data-theme", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    act(() => result.current.toggleTheme());
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("keeps working when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    vi.restoreAllMocks();
  });
});
