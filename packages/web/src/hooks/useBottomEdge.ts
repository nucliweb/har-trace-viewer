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
    // A scroll can fire many times per frame: one measurement per frame is all that shows.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    window.addEventListener("scroll", onScroll, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll, true);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [ref]);

  return bottom;
}
