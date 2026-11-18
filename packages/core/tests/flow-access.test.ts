import { describe, it, expect } from "vitest";
import { generateFlow } from "../src/steps/flow.js";
import { pageAnalysisAt, pageAt, stepAt } from "../src/steps/flow-access.js";
import { makeHar } from "./helpers/synthetic-har.js";

const flow = generateFlow([
  { name: "Home", har: makeHar([]) },
  { name: "Cart", har: makeHar([]) },
]);

describe("flow access by index", () => {
  it("gives the page, its analysis and the step at an index", () => {
    expect(pageAt(flow, 1).name).toBe("Cart");
    expect(pageAnalysisAt(flow, 1)).toBe(flow.pageAnalyses[1]);
    expect(stepAt(flow, 0)).toBe(flow.steps[0]);
  });

  it("throws on an index the flow does not have: a view asked for something that is not there", () => {
    expect(() => pageAt(flow, 2)).toThrow("The flow has no page 3");
    expect(() => pageAnalysisAt(flow, -1)).toThrow("The flow has no analysis of page 0");
    expect(() => stepAt(flow, flow.steps.length)).toThrow(
      `The flow has no step ${flow.steps.length + 1}`
    );
  });
});
