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

const flow = makeFlow();
const analysis = flow.pageAnalyses[0];
const step = flow.steps[1];
// The secondary caption lines: a node's city or provider, under its name.
const subLabels = analysis.nodes.filter((n) => n.present && n.subLabel).map((n) => n.subLabel!);

function renderAt(width: number, height: number) {
  const { container } = render(
    <NodeRenderer
      nodes={analysis.nodes}
      paths={analysis.paths}
      activeNodes={step.activeNodes}
      activePaths={step.activePaths}
    />
  );
  act(() => callback!([{ contentRect: { width, height } }]));
  const svg = container.querySelector("svg")!;
  const drawingWidth = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
  const texts = [...svg.querySelectorAll("text")];
  return {
    texts: texts.map((t) => t.textContent),
    renderedPx: texts.map((t) => (Number(t.getAttribute("font-size")) * width) / drawingWidth),
  };
}

describe("NodeRenderer labels on a small screen (A-11)", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", StubObserver));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the labels and their secondary lines where the drawing has room", () => {
    expect(subLabels.length).toBeGreaterThan(0);
    const { texts, renderedPx } = renderAt(900, 480);
    for (const sub of subLabels) expect(texts).toContain(sub);
    expect(Math.min(...renderedPx)).toBe(12);
  });

  it("on a phone, renders every label at 10px or more and drops the secondary lines", () => {
    const { texts, renderedPx } = renderAt(360, 192);
    expect(Math.min(...renderedPx)).toBeGreaterThanOrEqual(10 - 1e-9);
    for (const sub of subLabels) expect(texts).not.toContain(sub);
    expect(texts).toContain("Browser");
  });
});
