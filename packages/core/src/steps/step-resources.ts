import type { DiagramStep, Flow, HarEntry, InferredCacheHit } from "../types.js";

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

/** Browser-cache hits of a WebPageTest repeat-view step, inferred from its first view. */
export function getStepInferredCacheHits(flow: Flow, step: DiagramStep): InferredCacheHit[] {
  const refs = step.inferredCacheRefs;
  if (!refs || refs.length === 0) return [];
  const hits = flow.pages[step.pageIndex]?.har.inferredCacheHits ?? [];
  return refs.map((ref) => hits[ref]).filter((hit) => hit !== undefined);
}
