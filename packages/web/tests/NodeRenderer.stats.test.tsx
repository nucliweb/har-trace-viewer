import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NodeRenderer } from "../src/components/NodeRenderer.js";
import { makeCompareFlows } from "./fixtures.js";

const [firstView] = makeCompareFlows();

function captions(): (string | null)[] {
  const { nodes, paths } = firstView.pageAnalyses[0];
  const { container } = render(
    <NodeRenderer nodes={nodes} paths={paths} activeNodes={[]} activePaths={[]} />
  );
  return [...container.querySelectorAll("text")].map((t) => t.textContent);
}

describe("NodeRenderer — node request stats", () => {
  // "median TTFB 1234ms" would not fit the stacked cluster captions nor their path labels.
  it("names what the third parties' figure measures, their TTFB, in the room a caption has", () => {
    expect(captions()).toContain("1 req · TTFB 10ms");
  });

  it("keeps the plain average for the nodes that carry one", () => {
    // The origin served the stylesheet and both images: 50 ms each.
    expect(captions()).toContain("3 req · avg 50ms");
  });
});
