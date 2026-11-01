// The flow generator's public surface, split across the modules of this folder:
// page-context (what a page's document and entries say), topology (nodes and paths),
// page-steps (the steps of a page), flow (generateFlow) and flow-migrations (normalizeFlow).
export { CLIENT_REGIONS, FLOW_VERSION, generateFlow, isClientRegion } from "./flow.js";
export { normalizeFlow, stepKindFromTitle } from "./flow-migrations.js";

// Readers of a flow resolve step resources through these.
export { getStepCacheResources, getStepResources } from "./step-resources.js";
export {
  MAX_THIRD_PARTY_CLUSTERS,
  clusterThirdParties,
  nodeKind,
  thirdPartyNodeId,
  thirdPartyPathId,
} from "./third-party-clusters.js";
