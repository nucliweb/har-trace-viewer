import { useCallback, useReducer } from "react";
import { useMessages } from "../../i18n/context.js";
import { loadRecordingFile, loadTraceFile, makeEntry } from "./page-entry.js";
import type { EntryPatch, PageEntry } from "./page-entry.js";

/** The pages of the flow and the optional recording to compare them with. */
export interface PageEntriesState {
  pages: PageEntry[];
  compare: PageEntry;
}

type PageEntriesAction =
  | { type: "update"; id: string; patch: EntryPatch }
  | { type: "move"; index: number; delta: -1 | 1 }
  | { type: "add"; entry: PageEntry }
  | { type: "remove"; id: string }
  | { type: "updateCompare"; patch: EntryPatch }
  | { type: "resetCompare"; entry: PageEntry };

export function pageEntriesReducer(
  state: PageEntriesState,
  action: PageEntriesAction
): PageEntriesState {
  switch (action.type) {
    case "update":
      return {
        ...state,
        pages: state.pages.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };
    case "move": {
      const target = action.index + action.delta;
      if (target < 0 || target >= state.pages.length) return state;
      const pages = [...state.pages];
      [pages[action.index], pages[target]] = [pages[target], pages[action.index]];
      return { ...state, pages };
    }
    case "add":
      return { ...state, pages: [...state.pages, action.entry] };
    case "remove":
      return { ...state, pages: state.pages.filter((p) => p.id !== action.id) };
    case "updateCompare":
      return { ...state, compare: { ...state.compare, ...action.patch } };
    case "resetCompare":
      return { ...state, compare: action.entry };
  }
}

/** The builder's entries with the actions on them, the files parsed in the worker. */
export function usePageEntries() {
  // The default names take the language of the moment; once given, a name is the user's.
  const { pageName } = useMessages().builder;
  const [state, dispatch] = useReducer(pageEntriesReducer, null, () => ({
    pages: [makeEntry(pageName(1))],
    compare: makeEntry(),
  }));

  const update = useCallback(
    (id: string, patch: EntryPatch) => dispatch({ type: "update", id, patch }),
    []
  );
  const updateCompare = useCallback(
    (patch: EntryPatch) => dispatch({ type: "updateCompare", patch }),
    []
  );

  return {
    pages: state.pages,
    compare: state.compare,
    update,
    loadFile: useCallback(
      (id: string, file: File) => loadRecordingFile(file, (patch) => update(id, patch)),
      [update]
    ),
    loadTrace: useCallback(
      (id: string, file: File) => loadTraceFile(file, (patch) => update(id, patch)),
      [update]
    ),
    move: useCallback(
      (index: number, delta: -1 | 1) => dispatch({ type: "move", index, delta }),
      []
    ),
    add: useCallback(
      () => dispatch({ type: "add", entry: makeEntry(pageName(state.pages.length + 1)) }),
      [state.pages.length, pageName]
    ),
    remove: useCallback((id: string) => dispatch({ type: "remove", id }), []),
    updateCompare,
    loadCompareFile: useCallback(
      (file: File) => loadRecordingFile(file, updateCompare),
      [updateCompare]
    ),
    loadCompareTrace: useCallback(
      (file: File) => loadTraceFile(file, updateCompare),
      [updateCompare]
    ),
    resetCompare: useCallback(() => dispatch({ type: "resetCompare", entry: makeEntry() }), []),
  };
}
