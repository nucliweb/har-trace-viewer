interface Span {
  top: number;
  bottom: number;
}

export type TooltipSide = "below" | "above";

/**
 * Which side of its row a tooltip opens on: below, unless it would run past the bottom of what
 * shows and more of it fits above.
 */
export function tooltipSide(row: Span, height: number, box: Span): TooltipSide {
  const below = box.bottom - row.bottom;
  if (height <= below) return "below";
  return row.top - box.top > below ? "above" : "below";
}

/** The part of the window an element can show in: its clipping ancestors cut it, one by one. */
export function visibleBox(element: Element): Span {
  const box = { top: 0, bottom: window.innerHeight };
  for (let el = element.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "visible") continue;
    const rect = el.getBoundingClientRect();
    box.top = Math.max(box.top, rect.top);
    box.bottom = Math.min(box.bottom, rect.bottom);
  }
  return box;
}
