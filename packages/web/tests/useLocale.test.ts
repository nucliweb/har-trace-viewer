import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_STORAGE_KEY, useLocale } from "../src/i18n/useLocale.js";

const html = document.documentElement;

function browserLanguages(...languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

/** useLocale from a fresh module, with no language but English loaded yet. */
async function freshUseLocale() {
  vi.resetModules();
  return import("../src/i18n/useLocale.js");
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

  it("follows the first browser language it speaks", async () => {
    browserLanguages("fr-FR", "ca-ES", "es");
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe("ca");
    await waitFor(() => expect(html).toHaveAttribute("lang", "ca"));
  });

  it("uses the stored choice over the browser languages", async () => {
    browserLanguages("ca");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    const { result } = renderHook(() => useLocale());
    await waitFor(() => expect(result.current.locale).toBe("es"));
  });

  it("ignores an invalid stored value", async () => {
    browserLanguages("es-MX");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "klingon");
    const { result } = renderHook(() => useLocale());
    await waitFor(() => expect(result.current.locale).toBe("es"));
  });

  it("cycles English, Spanish and Catalan, and persists the choice", async () => {
    browserLanguages("en-US");
    const { result } = renderHook(() => useLocale());

    act(() => result.current.cycleLocale());
    expect(result.current.locale).toBe("es");
    await waitFor(() => expect(result.current.t.settings.title).toBe("Configuración"));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(html).toHaveAttribute("lang", "es");

    act(() => result.current.cycleLocale());
    expect(result.current.locale).toBe("ca");
    await waitFor(() => expect(result.current.t.settings.title).toBe("Configuració"));

    act(() => result.current.cycleLocale());
    expect(result.current.locale).toBe("en");
  });

  it("sets a language directly", async () => {
    const { result } = renderHook(() => useLocale());
    act(() => result.current.setLocale("ca"));
    expect(result.current.locale).toBe("ca");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ca");
  });

  it("keeps working when localStorage throws", async () => {
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
    await waitFor(() => expect(result.current.locale).toBe("es"));
  });
});

describe("useLocale loading a language", () => {
  it("keeps the language on screen until the chosen one has loaded", async () => {
    browserLanguages("en");
    const { useLocale: fresh } = await freshUseLocale();
    const { result } = renderHook(() => fresh());

    act(() => result.current.setLocale("ca"));
    expect(result.current.locale).toBe("ca");
    expect(result.current.t.settings.title).toBe("Settings");
    expect(html).toHaveAttribute("lang", "en");

    await waitFor(() => expect(result.current.t.settings.title).toBe("Configuració"));
    expect(html).toHaveAttribute("lang", "ca");
  });

  it("starts in a language loaded beforehand, with no English first", async () => {
    browserLanguages("es");
    const { initialLocale, loadMessages, useLocale: fresh } = await freshUseLocale();
    expect(initialLocale()).toBe("es");
    await loadMessages("es");

    const { result } = renderHook(() => fresh());
    expect(result.current.locale).toBe("es");
    expect(result.current.t.settings.title).toBe("Configuración");
  });

  it("drops a language that loads after a newer choice", async () => {
    browserLanguages("en");
    const { loadMessages, useLocale: fresh } = await freshUseLocale();
    const { result } = renderHook(() => fresh());

    act(() => result.current.setLocale("es"));
    act(() => result.current.setLocale("en"));
    await act(() => loadMessages("es"));
    expect(result.current.locale).toBe("en");
    expect(result.current.t.settings.title).toBe("Settings");
    expect(html).toHaveAttribute("lang", "en");
  });

  it("loads each language once", async () => {
    const { loadMessages } = await freshUseLocale();
    const [first, second] = await Promise.all([loadMessages("ca"), loadMessages("ca")]);
    expect(first).toBe(second);
    expect(await loadMessages("ca")).toBe(first);
  });
});
