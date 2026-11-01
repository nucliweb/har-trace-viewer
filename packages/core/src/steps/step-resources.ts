import type { DiagramStep, Flow, HarEntry } from "../types.js";

function resolveRefs(flow: Flow, step: DiagramStep, refs: number[] | undefined): HarEntry[] {
  if (!refs || refs.length === 0) return [];
  const entries = flow.pages[step.pageIndex]?.har.entries ?? [];
  return refs.map((ref) => entries[ref]).filter((entry) => entry !== undefined);
}

/** Network requests of a step, resolved from its page entries. */
export function getStepResources(flow: Flow, step: DiagramStep): HarEntry[] {
  return resolveRefs(flow, step, step.resourceRefs);
}

/** Browser-cache hits of a step, resolved from its page entries. */
export function getStepCacheResources(flow: Flow, step: DiagramStep): HarEntry[] {
  return resolveRefs(flow, step, step.cacheResourceRefs);
}
