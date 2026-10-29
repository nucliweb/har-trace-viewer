import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DiagramStep, Flow } from "@htv/core";
import { NodeRenderer } from "../src/components/NodeRenderer.js";
import { makeCompareFlows } from "./fixtures.js";
import { setMedia } from "./setup.js";

const [firstView, repeatView] = makeCompareFlows();

function renderStep(flow: Flow, kind: DiagramStep["kind"]) {
  const step = flow.steps.find((s) => s.kind === kind)!;
  const { nodes, paths } = flow.pageAnalyses[step.pageIndex];
  const { container } = render(
    <NodeRenderer
      nodes={nodes}
      paths={paths}
      activeNodes={step.activeNodes}
      activePaths={step.activePaths}
      pathTimings={step.pathTimings}
      pathDirections={step.pathDirections}
    />
  );
  return container;
}

const texts = (container: HTMLElement) =>
  [...container.querySelectorAll("text")].map((t) => t.textContent);
// The group drawn around the active response lane of the cache hop.
const cacheHop = (container: HTMLElement) =>
  container.querySelector("#path-browser-cache-res")?.parentElement ?? null;

describe("NodeRenderer — browser cache", () => {
  it("draws the cache node with its stores and hits, and the active hop with its timing", () => {
    const container = renderStep(repeatView, "secondary");

    expect(texts(container)).toEqual(
      expect.arrayContaining(["Browser cache", "memory + disk", "2 from cache", "1 from cache"])
    );
    // Active nodes are drawn at full opacity: browser and cache.
    expect(container.querySelectorAll('#diagram-svg g[opacity="1"]')).toHaveLength(2);
    expect(cacheHop(container)?.querySelector("animateMotion")).not.toBeNull();
  });

  it("glows over the whole diagram, so a straight hop keeps its glow", () => {
    // A filter region relative to the bounding box is empty for a straight vertical or
    // horizontal path (zero width or height), which hides the active lane altogether.
    const container = renderStep(repeatView, "secondary");
    const filter = container.querySelector("filter")!;

    expect(filter.getAttribute("filterUnits")).toBe("userSpaceOnUse");
    expect(filter.getAttribute("width")).toBe("100%");
    expect(filter.getAttribute("height")).toBe("100%");
  });

  it("skips the hop's packets with reduced motion", () => {
    setMedia("(prefers-reduced-motion: reduce)", true);
    const container = renderStep(repeatView, "secondary");

    expect(cacheHop(container)).not.toBeNull();
    expect(cacheHop(container)?.querySelector("animateMotion")).toBeNull();
  });

  it("draws neither the node nor the hop for a page that did not use the cache", () => {
    const container = renderStep(firstView, "loaded");

    expect(texts(container)).not.toContain("Browser cache");
    expect(container.querySelector('[id^="path-browser-cache"]')).toBeNull();
  });
});
