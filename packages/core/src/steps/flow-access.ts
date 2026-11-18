import type { DiagramStep, Flow, PageAnalysis, PageFlow } from "../types.js";

// The views ask only for the pages and steps a flow has: an index outside it is a bug, and it
// throws with what was missing rather than failing later on an undefined value.

/** The flow's page at `index`. */
export function pageAt(flow: Flow, index: number): PageFlow {
  const page = flow.pages[index];
  if (!page) throw new Error(`The flow has no page ${index + 1}`);
  return page;
}

/** The analysis of the flow's page at `index`. */
export function pageAnalysisAt(flow: Flow, index: number): PageAnalysis {
  const analysis = flow.pageAnalyses[index];
  if (!analysis) throw new Error(`The flow has no analysis of page ${index + 1}`);
  return analysis;
}

/** The flow's step at `index`. */
export function stepAt(flow: Flow, index: number): DiagramStep {
  const step = flow.steps[index];
  if (!step) throw new Error(`The flow has no step ${index + 1}`);
  return step;
}
