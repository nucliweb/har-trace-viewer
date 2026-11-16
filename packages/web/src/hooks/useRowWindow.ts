import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { revealTop, rowOffset, windowItems } from "../lib/row-window.js";
import type { RowLayout, WindowItem } from "../lib/row-window.js";

/** Lists of this many rows or fewer render every row, as any page would. */
const WINDOW_THRESHOLD = 300;
// Rows rendered beyond each edge of the view, so that a scroll shows rows before React catches up.
const OVERSCAN = 12;
// The row height until one is measured (and in a test DOM, which has no layout).
const FALLBACK_ROW_HEIGHT = 24;

interface Options {
  /** The number of rows in the list. */
  count: number;
  /** The position of the one taller row (the selected request), or null. */
  expanded: number | null;
  /** Whether the arrow keys, Home, End, PageUp and PageDown move the focus between rows. */
  arrows: boolean;
  /**
   * Changes when the rows change as a whole (sorted, filtered, another view): the list then shows
   * the row at `target`, centered, or starts from the top when `target` is null.
   */
  resetKey: unknown;
  target: number | null;
}

interface Measure {
  rowHeight: number;
  extra: number;
}

type Align = "nearest" | "center";

/** The elements of the row at a position (a table row and its actions row share one). */
const partsOf = (list: Element, index: number) =>
  list.querySelectorAll<HTMLElement>(`[data-index="${index}"]`);

const buttonsOf = (list: Element, index: number) =>
  [...partsOf(list, index)].flatMap((part) => [...part.querySelectorAll("button")]);

const topOf = (element: Element | undefined) => element?.getBoundingClientRect().top ?? 0;

const ownerOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>("[data-index]") : null;

/**
 * Renders a long list as a window: only the rows near the view are in the DOM, between gaps that
 * keep the scroll height of every row. Lists of up to WINDOW_THRESHOLD rows render in full.
 *
 * The rows carry `data-index` (their position). The list element holds them, the scroller
 * scrolls them, and the header is a sticky header above them that a revealed row must clear;
 * each takes its setter as a ref. The focused row stays rendered when the view scrolls away from
 * it, and moving the focus by keyboard past the rendered rows scrolls to the next row and focuses
 * it.
 */
export function useRowWindow({ count, expanded, arrows, resetKey, target }: Options) {
  const scrollerRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  // Counts the changes of those elements, for the effects that listen to them.
  const [elements, elementChanged] = useReducer((n: number) => n + 1, 0);
  const setScroller = useCallback((element: HTMLElement | null) => {
    scrollerRef.current = element;
    elementChanged();
  }, []);
  const setList = useCallback((element: HTMLElement | null) => {
    listRef.current = element;
    elementChanged();
  }, []);
  const setHeader = useCallback((element: HTMLElement | null) => {
    headerRef.current = element;
  }, []);

  const windowed = count > WINDOW_THRESHOLD;
  const [measure, setMeasure] = useState<Measure>({ rowHeight: FALLBACK_ROW_HEIGHT, extra: 0 });
  // The view, from the top of the list.
  const [view, setView] = useState(() => ({ top: 0, height: window.innerHeight }));
  // The row that has the focus, and the row the keyboard is moving the focus to.
  const [focused, setFocused] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  const layout = useMemo<RowLayout>(
    () => ({ count, rowHeight: measure.rowHeight, expanded, extra: measure.extra }),
    [count, measure, expanded]
  );
  // What the event handlers read: the latest options and layout, and the list's top in the
  // scroller's content.
  const latest = useRef({ layout, target, arrows, listTop: 0 });

  const items = useMemo<WindowItem[]>(() => {
    const keep = [focused, pending].filter((index) => index !== null);
    return windowItems(layout, view, { threshold: WINDOW_THRESHOLD, overscan: OVERSCAN, keep });
  }, [layout, view, focused, pending]);

  // The view as the scroller shows it. Its height never counts less than the window's, so that
  // the drawer can grow (a closed disclosure, a turned phone) without a scroll. A list that renders
  // every row has no use for it: scrolling it renders nothing.
  const readView = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || latest.current.layout.count <= WINDOW_THRESHOLD) return;
    const top = scroller.scrollTop - latest.current.listTop;
    const height = Math.max(scroller.clientHeight, window.innerHeight);
    setView((prev) => (prev.top === top && prev.height === height ? prev : { top, height }));
  }, []);

  // The list's top in the scroller's content, and the row heights as the distance between
  // consecutive rows (it includes the borders, collapsed or not).
  const measureRows = useCallback(() => {
    const scroller = scrollerRef.current;
    const list = listRef.current;
    if (!scroller || !list) return;
    const { layout } = latest.current;
    const { expanded } = layout;
    const firsts = new Map<number, HTMLElement>();
    for (const part of list.querySelectorAll<HTMLElement>("[data-index]")) {
      const index = Number(part.dataset.index);
      if (!firsts.has(index)) firsts.set(index, part);
    }
    // From a row between two rendered rows: in a table with collapsed borders, a row after a gap
    // (or the first one) lacks the half of the border it shares with the row above.
    let rowHeight = 0;
    for (const [index, part] of firsts) {
      const next = firsts.get(index + 1);
      if (firsts.has(index - 1) && index !== expanded && next) {
        rowHeight = topOf(next) - topOf(part);
        break;
      }
    }
    // No layout (a test DOM): the fallbacks stand.
    if (rowHeight <= 0) return;
    latest.current.listTop =
      topOf(list) - topOf(scroller) + scroller.scrollTop - scroller.clientTop;
    let { extra } = layout;
    if (expanded !== null && firsts.has(expanded) && firsts.has(expanded + 1)) {
      extra = Math.max(
        0,
        topOf(firsts.get(expanded + 1)) - topOf(firsts.get(expanded)) - rowHeight
      );
    }
    latest.current.layout = { ...layout, rowHeight, extra };
    setMeasure((prev) =>
      prev.rowHeight === rowHeight && prev.extra === extra ? prev : { rowHeight, extra }
    );
  }, []);

  // After each render: what the handlers read, and the rows of a windowed list measured.
  useLayoutEffect(() => {
    latest.current = { ...latest.current, layout, target, arrows };
    if (windowed) measureRows();
  }, [layout, target, arrows, windowed, items, elements, measureRows]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.addEventListener("scroll", readView, { passive: true });
    window.addEventListener("resize", readView);
    return () => {
      scroller.removeEventListener("scroll", readView);
      window.removeEventListener("resize", readView);
    };
  }, [elements, readView]);

  /** Scrolls so that the row at a position shows below the header. */
  const reveal = useCallback(
    (index: number, align: Align) => {
      const scroller = scrollerRef.current;
      const list = listRef.current;
      if (!scroller || !list) return;
      const parts = partsOf(list, index);
      const current = latest.current.layout;
      let rowTop: number;
      let rowHeight: number;
      if (parts.length > 0) {
        rowTop = topOf(parts[0]) - topOf(scroller) + scroller.scrollTop - scroller.clientTop;
        rowHeight = [...parts].reduce((sum, part) => sum + part.getBoundingClientRect().height, 0);
      } else {
        rowTop = latest.current.listTop + rowOffset(current, index);
        rowHeight = rowOffset(current, index + 1) - rowOffset(current, index);
      }
      scroller.scrollTop = revealTop({
        rowTop,
        rowHeight,
        scrollTop: scroller.scrollTop,
        viewHeight: scroller.clientHeight || window.innerHeight,
        header: headerRef.current?.getBoundingClientRect().height ?? 0,
        align,
      });
      readView();
    },
    [readView]
  );

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const { target } = latest.current;
    if (target !== null) {
      reveal(target, "center");
    } else if (scroller) {
      scroller.scrollTop = 0;
      readView();
    }
  }, [resetKey, elements, reveal, readView]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    /** Moves the focus to the row at a position, rendering it first when it is out of view. */
    const focusRow = (index: number, last: boolean) => {
      flushSync(() => {
        setPending(index);
        reveal(index, "nearest");
      });
      const buttons = buttonsOf(list, index);
      (last ? buttons.at(-1) : buttons[0])?.focus({ preventScroll: true });
    };
    const onFocusIn = (event: FocusEvent) => {
      const owner = ownerOf(event.target);
      if (owner) setFocused(Number(owner.dataset.index));
      setPending(null);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!list.contains(event.relatedTarget as Node | null)) setFocused(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const owner = ownerOf(event.target);
      if (!owner) return;
      const { layout } = latest.current;
      const index = Number(owner.dataset.index);
      const buttons = buttonsOf(list, index);
      if (event.key === "Tab") {
        // Tab past the last rendered row goes on to the next row, as if every row were there.
        const to = event.shiftKey ? index - 1 : index + 1;
        const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
        if (event.target !== edge || to < 0 || to >= layout.count) return;
        if (partsOf(list, to).length > 0) return;
        event.preventDefault();
        focusRow(to, event.shiftKey);
        return;
      }
      if (!latest.current.arrows || event.target !== buttons[0]) return;
      const room =
        (scrollerRef.current?.clientHeight || window.innerHeight) -
        (headerRef.current?.offsetHeight ?? 0);
      const page = Math.max(1, Math.floor(room / layout.rowHeight) - 1);
      const to = {
        ArrowDown: index + 1,
        ArrowUp: index - 1,
        Home: 0,
        End: layout.count - 1,
        PageDown: index + page,
        PageUp: index - page,
      }[event.key];
      if (to === undefined) return;
      // Handled here, so the diagram's Home/End step shortcuts leave it alone.
      event.preventDefault();
      focusRow(Math.min(layout.count - 1, Math.max(0, to)), false);
    };
    list.addEventListener("focusin", onFocusIn);
    list.addEventListener("focusout", onFocusOut);
    list.addEventListener("keydown", onKeyDown);
    return () => {
      list.removeEventListener("focusin", onFocusIn);
      list.removeEventListener("focusout", onFocusOut);
      list.removeEventListener("keydown", onKeyDown);
    };
  }, [elements, reveal]);

  return { items, windowed, setScroller, setList, setHeader };
}
