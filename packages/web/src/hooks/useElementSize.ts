import { useLayoutEffect, useState, type RefObject } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * The content box of an element, kept current with a `ResizeObserver`. Until the element has a
 * measurable size (server rendering, jsdom, hidden), `fallback` stands in.
 */
export function useElementSize(ref: RefObject<Element | null>, fallback: ElementSize): ElementSize {
  const [measured, setMeasured] = useState<ElementSize | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      setMeasured((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height }
      );
    };
    const rect = element.getBoundingClientRect();
    update(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return measured ?? fallback;
}
