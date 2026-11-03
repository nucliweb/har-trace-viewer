import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeRenderer } from "../src/components/NodeRenderer.js";
import { makeFlow } from "./fixtures.js";

type Callback = (entries: { contentRect: { width: number; height: number } }[]) => void;
let callback: Callback | undefined;

class StubObserver {
  constructor(cb: Callback) {
    callback = cb;
  }
  observe = vi.fn();
  disconnect = vi.fn();
}

describe("NodeRenderer on resize", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", StubObserver));
  afterEach(() => vi.unstubAllGlobals());

  it("widens the diagram in steps of 50 px, not on every pixel of the container", () => {
    const flow = makeFlow();
    const analysis = flow.pageAnalyses[0];
    const step = flow.steps[0];
    const { container } = render(
      <NodeRenderer
        nodes={analysis.nodes}
        paths={analysis.paths}
        activeNodes={step.activeNodes}
        activePaths={step.activePaths}
      />
    );
    const viewBox = () => container.querySelector("svg")!.getAttribute("viewBox");
    const resize = (width: number, height: number) =>
      act(() => callback!([{ contentRect: { width, height } }]));

    expect(viewBox()).toBe("0 0 900 480");
    resize(1000, 480);
    expect(viewBox()).toBe("0 0 1000 480");
    resize(1012, 480);
    expect(viewBox()).toBe("0 0 1000 480");
    resize(1040, 480);
    expect(viewBox()).toBe("0 0 1050 480");
    // Never narrower than the base width, nor wider than the widest layout.
    resize(600, 480);
    expect(viewBox()).toBe("0 0 900 480");
    resize(9000, 480);
    expect(viewBox()).toBe("0 0 2400 480");
  });
});
