import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElementSize } from "../src/hooks/useElementSize.js";

type Callback = (entries: { contentRect: { width: number; height: number } }[]) => void;

let callback: Callback | undefined;
let disconnected = false;

class StubObserver {
  constructor(cb: Callback) {
    callback = cb;
  }
  observe = vi.fn();
  disconnect() {
    disconnected = true;
  }
}

const FALLBACK = { width: 900, height: 480 };

function Probe({ onSize }: { onSize: (size: { width: number; height: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  onSize(useElementSize(ref, FALLBACK));
  return <div ref={ref} />;
}

describe("useElementSize", () => {
  beforeEach(() => {
    callback = undefined;
    disconnected = false;
    vi.stubGlobal("ResizeObserver", StubObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports the fallback while the element has no size", () => {
    const sizes: { width: number; height: number }[] = [];
    render(<Probe onSize={(s) => sizes.push(s)} />);
    expect(sizes.at(-1)).toEqual(FALLBACK);
  });

  it("follows the observer and ignores empty boxes", () => {
    const sizes: { width: number; height: number }[] = [];
    const { unmount } = render(<Probe onSize={(s) => sizes.push(s)} />);
    act(() => callback!([{ contentRect: { width: 2000, height: 700 } }]));
    expect(sizes.at(-1)).toEqual({ width: 2000, height: 700 });
    act(() => callback!([{ contentRect: { width: 0, height: 0 } }]));
    expect(sizes.at(-1)).toEqual({ width: 2000, height: 700 });
    unmount();
    expect(disconnected).toBe(true);
  });

  it("works without ResizeObserver", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", undefined);
    const sizes: { width: number; height: number }[] = [];
    render(<Probe onSize={(s) => sizes.push(s)} />);
    expect(sizes.at(-1)).toEqual(FALLBACK);
  });
});
