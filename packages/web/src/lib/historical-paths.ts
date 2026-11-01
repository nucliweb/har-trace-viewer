import type { DiagramStep, PathId } from "@htv/core";
import type { HistoricalPath } from "../types.js";

// Strip "N items · " prefix from path timing labels when shown as historical context.
// Historical paths already have node-level resource stats; keeping per-step counts
// creates misleading comparisons (e.g. "45 secondary resources" vs "102 3rd-party req").
function toHistoricalTiming(timing: string): string {
  return timing.replace(/^\d+ .+ · ((?:avg|TTFB) .+)$/, "$1");
}

/** Paths lit by the earlier steps of the current step's page, with their last timing and direction. */
export function computeHistoricalPaths(
  steps: DiagramStep[],
  currentStepIndex: number
): Partial<Record<PathId, HistoricalPath>> {
  // History only covers the active page: each page has its own topology.
  const history: Partial<Record<PathId, HistoricalPath>> = {};
  const { pageIndex } = steps[currentStepIndex];
  for (let i = 0; i < currentStepIndex; i++) {
    const s = steps[i];
    if (s.pageIndex !== pageIndex) continue;
    for (const pathId of s.activePaths) {
      const raw = s.pathTimings?.[pathId as PathId];
      history[pathId as PathId] = {
        timing: raw ? toHistoricalTiming(raw) : raw,
        direction: s.pathDirections?.[pathId as PathId],
      };
    }
  }
  return history;
}
