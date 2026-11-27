import { useCallback, useReducer } from "react";
import { useMessages } from "../../i18n/context.js";
import type { Messages } from "../../i18n/en.js";
import { planDrop } from "./drop-plan.js";
import { loadHarFile, loadRecordingFile, loadTraceFile, makeEntry } from "./page-entry.js";
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
  | { type: "resetCompare"; entry: PageEntry }
  | { type: "reset"; state: PageEntriesState };

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
      const moved = pages[action.index];
      const other = pages[target];
      if (!moved || !other) return state;
      pages[action.index] = other;
      pages[target] = moved;
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
    case "reset":
      return action.state;
  }
}

const isBlank = (entry: PageEntry) =>
  !entry.harFileName &&
  !entry.traceFileName &&
  !entry.harError &&
  !entry.traceError &&
  !entry.harProgress &&
  !entry.traceProgress;

/** The builder's entries with the actions on them, the files parsed in the worker. */
export function usePageEntries(messages?: Messages) {
  // The default names take the language of the moment; once given, a name is the user's.
  // A caller above the messages provider passes its messages itself.
  const fromContext = useMessages();
  const { pageName } = (messages ?? fromContext).builder;
  const initial = useCallback(
    (): PageEntriesState => ({ pages: [makeEntry(pageName(1))], compare: makeEntry() }),
    [pageName]
  );
  const [state, dispatch] = useReducer(pageEntriesReducer, null, initial);

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
    loadTrace: useCallback(
      // loadTraceFile reports a failure through `apply`, so its promise never rejects.
      (id: string, file: File) => void loadTraceFile(file, (patch) => update(id, patch)),
      [update]
    ),
    loadFiles: useCallback(
      (files: File[], targetId?: string) => {
        let added = 0;
        const addRow = () => {
          added += 1;
          const entry = makeEntry(pageName(state.pages.length + added));
          dispatch({ type: "add", entry });
          return entry.id;
        };
        for (const { rowId, har, trace } of planDrop(files, state.pages, targetId)) {
          const id = rowId ?? addRow();
          const apply = (patch: EntryPatch) => update(id, patch);
          if (har) loadHarFile(har, apply);
          if (trace) void loadTraceFile(trace, apply);
        }
      },
      [state.pages, pageName, update]
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
      (file: File) => void loadTraceFile(file, updateCompare),
      [updateCompare]
    ),
    resetCompare: useCallback(() => dispatch({ type: "resetCompare", entry: makeEntry() }), []),
    /** No file on any row: there is nothing a reset would clear. */
    blank: state.pages.length === 1 && state.pages.every(isBlank) && isBlank(state.compare),
    /** Back to one empty page. A file still being read lands on a row that is gone, so nowhere. */
    reset: useCallback(() => dispatch({ type: "reset", state: initial() }), [initial]),
  };
}

/** The builder's entries and the actions on them. */
export type PageEntries = ReturnType<typeof usePageEntries>;
