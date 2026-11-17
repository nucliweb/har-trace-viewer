import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialWaterfallState,
  parseViewState,
  readWaterfallPrefs,
  setHashParams,
  writeWaterfallPrefs,
} from "../src/lib/view-state.js";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("parseViewState", () => {
  it("reads every part of a link", () => {
    expect(parseViewState("#d=waterfall&q=type%3Ascript%20app&r=3&v=table&s=size.desc")).toEqual({
      drawer: "waterfall",
      search: "type:script app",
      selected: 3,
      view: "table",
      sort: { key: "size", direction: "desc" },
    });
  });

  it("reads each view of the analysis drawer as a drawer of its own", () => {
    for (const view of ["connections", "compression", "render", "critical-path"]) {
      expect(parseViewState(`#d=${view}`)).toEqual({ drawer: view });
    }
  });

  it("ignores unknown and malformed values", () => {
    expect(parseViewState("#d=resources&r=-1&v=grid&s=size&x=1")).toEqual({});
    // An empty filter is a statement: the link wants no filter, whatever the last visit left.
    expect(parseViewState("#q=")).toEqual({ search: "" });
    expect(parseViewState("#r=1e3&s=bogus.asc")).toEqual({});
    expect(parseViewState("#s=size.desc.extra")).toEqual({});
    expect(parseViewState("")).toEqual({});
    expect(parseViewState("#%E0%A4%A")).toEqual({});
  });
});

describe("setHashParams", () => {
  it("sets and removes parts without adding history entries, keeping the rest", () => {
    const before = window.history.length;
    window.history.replaceState(null, "", "/app/?x=1#other=1");
    setHashParams({ d: "cache", q: "a b" });
    expect(window.location.pathname + window.location.search).toBe("/app/?x=1");
    expect(window.location.hash).toBe("#other=1&d=cache&q=a+b");
    setHashParams({ d: null, q: "" });
    expect(window.location.hash).toBe("#other=1&q=");
    setHashParams({ q: null });
    expect(window.location.hash).toBe("#other=1");
    window.history.replaceState(null, "", "/app/?x=1#d=cache");
    setHashParams({ d: null });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/app/?x=1"
    );
    expect(window.history.length).toBe(before);
  });

  it("leaves the page alone when the history refuses", () => {
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new Error("sandboxed");
    });
    expect(() => setHashParams({ d: "cache" })).not.toThrow();
  });
});

describe("waterfall preferences", () => {
  it("come back on the next visit", () => {
    writeWaterfallPrefs({ search: "png", view: "table", sort: { key: "time", direction: "desc" } });
    expect(readWaterfallPrefs()).toEqual({
      search: "png",
      view: "table",
      sort: { key: "time", direction: "desc" },
    });
  });

  it("prefer the link over the stored values, part by part", () => {
    writeWaterfallPrefs({ search: "png", view: "table" });
    window.history.replaceState(null, "", "/#v=waterfall&q=js");
    expect(initialWaterfallState()).toEqual({ search: "js", view: "waterfall" });
    window.history.replaceState(null, "", "/#d=hops");
    expect(initialWaterfallState()).toEqual({ search: "png", view: "table", drawer: "hops" });
  });

  it("do nothing when the storage throws", () => {
    for (const method of ["getItem", "setItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    expect(() => writeWaterfallPrefs({ search: "x" })).not.toThrow();
    expect(readWaterfallPrefs()).toEqual({});
  });
});
