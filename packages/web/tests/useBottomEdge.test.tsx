import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBottomEdge } from "../src/hooks/useBottomEdge.js";

let resized: (() => void) | undefined;
let disconnected = false;

class StubObserver {
  constructor(cb: () => void) {
    resized = cb;
  }
  observe = vi.fn();
  disconnect() {
    disconnected = true;
  }
}

let bottom = 0;

function Probe({ onBottom, attach = true }: { onBottom: (b: number) => void; attach?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  onBottom(useBottomEdge(ref));
  return attach ? <div ref={ref} /> : null;
}

describe("useBottomEdge", () => {
  beforeEach(() => {
    resized = undefined;
    disconnected = false;
    bottom = 113.4;
    vi.stubGlobal("ResizeObserver", StubObserver);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ bottom }) as DOMRect
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports where the element ends, in whole pixels", () => {
    const seen: number[] = [];
    render(<Probe onBottom={(b) => seen.push(b)} />);
    expect(seen.at(-1)).toBe(113);
  });

  it("follows the window and the element as they resize", () => {
    const seen: number[] = [];
    render(<Probe onBottom={(b) => seen.push(b)} />);

    bottom = 161;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(seen.at(-1)).toBe(161);

    bottom = 209;
    act(() => resized!());
    expect(seen.at(-1)).toBe(209);
  });

  it("follows a scroll anywhere on the page, a scrolling view's included", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const seen: number[] = [];
    const { container } = render(<Probe onBottom={(b) => seen.push(b)} />);

    bottom = 53;
    container.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(seen.at(-1)).toBe(53);
  });

  it("measures once per frame however many scroll events arrive", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { container } = render(<Probe onBottom={() => undefined} />);
    const measure = vi.mocked(Element.prototype.getBoundingClientRect);
    measure.mockClear();

    for (let i = 0; i < 20; i++) container.dispatchEvent(new Event("scroll"));
    expect(measure).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(measure).toHaveBeenCalledTimes(1);

    container.dispatchEvent(new Event("scroll"));
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("drops a pending measurement when unmounted", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { container, unmount } = render(<Probe onBottom={() => undefined} />);
    const measure = vi.mocked(Element.prototype.getBoundingClientRect);

    container.dispatchEvent(new Event("scroll"));
    measure.mockClear();
    unmount();
    vi.advanceTimersToNextFrame();
    expect(measure).not.toHaveBeenCalled();
  });

  it("stops following once unmounted", () => {
    const seen: number[] = [];
    const { unmount } = render(<Probe onBottom={(b) => seen.push(b)} />);
    unmount();
    expect(disconnected).toBe(true);

    const count = seen.length;
    bottom = 300;
    window.dispatchEvent(new Event("resize"));
    document.body.dispatchEvent(new Event("scroll"));
    expect(seen).toHaveLength(count);
  });

  it("is 0 without an element, or without ResizeObserver until the window resizes", () => {
    const seen: number[] = [];
    render(<Probe onBottom={(b) => seen.push(b)} attach={false} />);
    expect(seen.at(-1)).toBe(0);

    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", undefined);
    const later: number[] = [];
    render(<Probe onBottom={(b) => later.push(b)} />);
    expect(later.at(-1)).toBe(113);
  });
});
