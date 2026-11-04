import { describe, expect, it } from "vitest";
import { makeEntry } from "../src/components/flow-builder/page-entry.js";
import { pageEntriesReducer } from "../src/components/flow-builder/usePageEntries.js";
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
