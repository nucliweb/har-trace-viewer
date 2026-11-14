import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { makeEntry } from "../src/components/flow-builder/page-entry.js";
import {
  pageEntriesReducer,
  usePageEntries,
} from "../src/components/flow-builder/usePageEntries.js";
import { MessagesContext } from "../src/i18n/context.js";
import { en } from "../src/i18n/en.js";
import { harJson, makeFile, traceJson } from "./fixtures.js";
import type { PageEntriesState } from "../src/components/flow-builder/usePageEntries.js";

const entry = (id: string, name: string) => ({ ...makeEntry(name), id });

const initial = (): PageEntriesState => ({
  pages: [entry("a", "Page 1"), entry("b", "Page 2"), entry("c", "Page 3")],
  compare: entry("x", ""),
});

const names = (state: PageEntriesState) => state.pages.map((p) => p.name);

describe("pageEntriesReducer", () => {
  it("patches one page by id and leaves the others untouched", () => {
    const state = initial();
    const next = pageEntriesReducer(state, { type: "update", id: "b", patch: { name: "Cart" } });

    expect(names(next)).toEqual(["Page 1", "Cart", "Page 3"]);
    expect(next.pages[0]).toBe(state.pages[0]);
    expect(next.compare).toBe(state.compare);
  });

  it("moves a page up or down and ignores a move off either end", () => {
    const state = initial();

    expect(names(pageEntriesReducer(state, { type: "move", index: 1, delta: -1 }))).toEqual([
      "Page 2",
      "Page 1",
      "Page 3",
    ]);
    expect(names(pageEntriesReducer(state, { type: "move", index: 1, delta: 1 }))).toEqual([
      "Page 1",
      "Page 3",
      "Page 2",
    ]);
    expect(pageEntriesReducer(state, { type: "move", index: 0, delta: -1 })).toBe(state);
    expect(pageEntriesReducer(state, { type: "move", index: 2, delta: 1 })).toBe(state);
  });

  it("adds a page at the end and removes one by id", () => {
    const state = initial();
    const added = pageEntriesReducer(state, { type: "add", entry: entry("d", "Page 4") });
    expect(names(added)).toEqual(["Page 1", "Page 2", "Page 3", "Page 4"]);

    const removed = pageEntriesReducer(added, { type: "remove", id: "b" });
    expect(names(removed)).toEqual(["Page 1", "Page 3", "Page 4"]);
  });

  it("patches the comparison entry and resets it to a fresh one", () => {
    const state = initial();
    const patched = pageEntriesReducer(state, {
      type: "updateCompare",
      patch: { harFileName: "repeat.har" },
    });
    expect(patched.compare.harFileName).toBe("repeat.har");
    expect(patched.pages).toBe(state.pages);

    const reset = pageEntriesReducer(patched, { type: "resetCompare", entry: entry("y", "") });
    expect(reset.compare.id).toBe("y");
    expect(reset.compare.harFileName).toBe("");
  });
});

describe("usePageEntries.loadFiles", () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MessagesContext.Provider, { value: en }, children);
  const setup = () => renderHook(() => usePageEntries(), { wrapper });

  it("loads a HAR and its trace dropped together into the same row", async () => {
    const { result } = setup();
    const rowId = result.current.pages[0].id;
    act(() =>
      result.current.loadFiles([makeFile(traceJson, "t.json"), makeFile(harJson, "a.har")], rowId)
    );

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(1);
      expect(result.current.pages[0].harFileName).toBe("a.har");
      expect(result.current.pages[0].traceFileName).toBe("t.json");
    });
  });

  it("adds a row for each further HAR and keeps the good files when one is unreadable", async () => {
    const { result } = setup();
    act(() =>
      result.current.loadFiles([
        makeFile(harJson, "a.har"),
        makeFile("{ not json", "b.har"),
        makeFile(harJson, "c.har"),
      ])
    );

    await waitFor(() => {
      const [first, second, third] = result.current.pages;
      expect(first.harFileName).toBe("a.har");
      expect(second.harError).not.toBeNull();
      expect(third.harFileName).toBe("c.har");
    });
    expect(result.current.pages.map((p) => p.name)).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("keeps a trace that came without a HAR in its row, waiting for it", async () => {
    const { result } = setup();
    act(() => result.current.loadFiles([makeFile(traceJson, "t.json")]));

    await waitFor(() => expect(result.current.pages[0].traceFileName).toBe("t.json"));
    expect(result.current.pages[0].har).toBeNull();
  });
});
