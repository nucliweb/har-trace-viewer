import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Where an element ends, in viewport pixels: its bottom edge, kept current as the window or the
 * element resizes (a toolbar that wraps onto another row, say) and as anything scrolls it, the
 * window or a scrolling container. 0 until it is measured.
 */
export function useBottomEdge(ref: RefObject<Element | null>): number {
  const [bottom, setBottom] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setBottom(Math.round(element.getBoundingClientRect().bottom));
    update();
    window.addEventListener("resize", update);
    // Scroll events do not bubble: a capturing listener hears those of every container.
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [ref]);

  return bottom;
}
