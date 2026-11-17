/**
 * The arithmetic of a windowed list: a long list renders only the rows near its view, with gaps of
 * the right height for the others, so that it scrolls as if every row were there.
 *
 * Rows share one height, measured in the page; at most one of them (the selected request, which
 * shows its actions) is taller by `extra`.
 */
export interface RowLayout {
  count: number;
  rowHeight: number;
  /** The position of the expanded row, or null. */
  expanded: number | null;
  extra: number;
}

/** The rendered rows and the gaps that stand for the others, top to bottom. */
export type WindowItem =
  { kind: "row"; index: number } | { kind: "gap"; height: number; key: string };

interface WindowOptions {
  /** Lists of this many rows or fewer render every row. */
  threshold: number;
  /** Rows rendered beyond each edge of the view. */
  overscan: number;
  /** Rows rendered wherever the view is: the focused one, for one. */
  keep: readonly number[];
}

/** Where a row starts, from the top of the list. */
export function rowOffset(layout: RowLayout, index: number): number {
  const { rowHeight, expanded, extra } = layout;
  return index * rowHeight + (expanded !== null && index > expanded ? extra : 0);
}

export function listHeight(layout: RowLayout): number {
  return rowOffset(layout, layout.count);
}

/** The row at an offset from the top of the list; an offset outside the list gives its end row. */
export function rowAt(layout: RowLayout, offset: number): number {
  const { count, rowHeight, expanded, extra } = layout;
  let index = Math.floor(offset / rowHeight);
  if (expanded !== null && index > expanded) {
    // Past the start of the expanded row: inside it, or one of the rows it pushed down.
    index =
      offset < rowOffset(layout, expanded + 1)
        ? expanded
        : Math.floor((offset - extra) / rowHeight);
  }
  return Math.min(count - 1, Math.max(0, index));
}

/**
 * The items to render for a view (its top and height, from the top of the list): every row when
 * the list is short, else the rows the view meets, `overscan` more each side and the kept ones.
 */
export function windowItems(
  layout: RowLayout,
  view: { top: number; height: number },
  { threshold, overscan, keep }: WindowOptions
): WindowItem[] {
  const { count } = layout;
  if (count <= threshold) {
    return Array.from({ length: count }, (_, index) => ({ kind: "row", index }));
  }
  const start = Math.max(0, rowAt(layout, view.top) - overscan);
  const end = Math.min(count, rowAt(layout, view.top + view.height) + 1 + overscan);
  const rows = new Set<number>();
  for (let index = start; index < end; index++) rows.add(index);
  for (const index of keep) if (index >= 0 && index < count) rows.add(index);

  const items: WindowItem[] = [];
  // The first row the items have not covered yet.
  let next = 0;
  for (const index of [...rows].sort((a, b) => a - b)) {
    if (index > next) {
      const height = rowOffset(layout, index) - rowOffset(layout, next);
      items.push({ kind: "gap", height, key: `gap-${next}` });
    }
    items.push({ kind: "row", index });
    next = index + 1;
  }
  if (next < count) {
    const height = listHeight(layout) - rowOffset(layout, next);
    items.push({ kind: "gap", height, key: "gap-end" });
  }
  return items;
}

/**
 * The scroll position that shows a row (its top and height, in the scroller's content) in a view
 * whose top `header` pixels are covered by a sticky header: "nearest" scrolls only as far as
 * needed, "center" puts the row in the middle of the room below the header. A row taller than
 * that room (the selected request with its detail) shows its top right below the header.
 */
export function revealTop({
  rowTop,
  rowHeight,
  scrollTop,
  viewHeight,
  header,
  align,
}: {
  rowTop: number;
  rowHeight: number;
  scrollTop: number;
  viewHeight: number;
  header: number;
  align: "nearest" | "center";
}): number {
  let top = scrollTop;
  if (rowHeight > viewHeight - header) {
    top = rowTop - header;
  } else if (align === "center") {
    top = rowTop - header - (viewHeight - header - rowHeight) / 2;
  } else if (rowTop < scrollTop + header) {
    top = rowTop - header;
  } else if (rowTop + rowHeight > scrollTop + viewHeight) {
    top = rowTop + rowHeight - viewHeight;
  }
  return Math.max(0, top);
}
