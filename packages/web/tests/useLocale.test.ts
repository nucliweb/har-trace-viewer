import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_STORAGE_KEY, useLocale } from "../src/i18n/useLocale.js";

const html = document.documentElement;

function browserLanguages(...languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

afterEach(() => vi.restoreAllMocks());

describe("useLocale", () => {
  it("speaks English by default and writes it to <html lang>", () => {
    browserLanguages("fr-FR", "de");
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe("en");
    expect(result.current.t.settings.title).toBe("Settings");
    expect(html).toHaveAttribute("lang", "en");
  });

  it("follows the first browser language it speaks", () => {
    browserLanguages("fr-FR", "ca-ES", "es");
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe("ca");
    expect(html).toHaveAttribute("lang", "ca");
  });

  it("uses the stored choice over the browser languages", () => {
    browserLanguages("ca");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    expect(renderHook(() => useLocale()).result.current.locale).toBe("es");
  });

  it("ignores an invalid stored value", () => {
    browserLanguages("es-MX");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "klingon");
    expect(renderHook(() => useLocale()).result.current.locale).toBe("es");
  });

  it("cycles English, Spanish and Catalan, and persists the choice", () => {
    browserLanguages("en-US");
    const { result } = renderHook(() => useLocale());

    act(() => result.current.cycleLocale());
    expect(result.current.locale).toBe("es");
    expect(result.current.t.settings.title).toBe("Configuración");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(html).toHaveAttribute("lang", "es");

    act(() => result.current.cycleLocale());
    expect(result.current.locale).toBe("ca");
    expect(result.current.t.settings.title).toBe("Configuració");

    act(() => result.current.cycleLocale());
    expect(result.current.locale).toBe("en");
  });

  it("sets a language directly", () => {
    const { result } = renderHook(() => useLocale());
    act(() => result.current.setLocale("ca"));
    expect(result.current.locale).toBe("ca");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ca");
  });

  it("keeps working when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    browserLanguages("en");
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe("en");
    act(() => result.current.cycleLocale());
    expect(result.current.locale).toBe("es");
  });
});
