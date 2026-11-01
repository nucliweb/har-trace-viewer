import { suggestClientRegion } from "../inference/node-detector.js";
import { analyzeCacheForHar } from "../inference/cache-analyzer.js";
import { analyzeNetwork } from "../analysis/network-report.js";
import { analyzeCompression } from "../analysis/compression.js";
import { analyzeConnections } from "../analysis/connections.js";
import { analyzeRender } from "../analysis/render-report.js";
import { describePage, type PageContext } from "./page-context.js";
import { generatePageSteps, generateTransitionStep } from "./page-steps.js";
import { pageTopology } from "./topology.js";
import type {
  ClientRegion,
  DiagramStep,
  Flow,
  FlowOptions,
  PageAnalysis,
  PageFlow,
} from "../types.js";

// Bump when the Flow shape changes in a way readers must detect.
// 2: per-page topology and cache report (Flow.pageAnalyses, DiagramStep.pageIndex).
// 3: steps reference page entries by index (DiagramStep.resourceRefs, cacheResourceRefs)
//    instead of carrying copies (resources, cacheResources).
// 4: third parties grouped by CDN provider and region (PageAnalysis.thirdPartyClusters);
//    a page with several clusters has one `third-parties:<id>` node per cluster.
// 5: steps carry their kind (DiagramStep.kind).
// 6: cache reports count inferred and revalidated browser-cache hits (CacheReport.browser
//    inferred, revalidated); WebPageTest repeat views carry ParsedHar.inferredCacheHits.
export const FLOW_VERSION = 6;

export const CLIENT_REGIONS: readonly ClientRegion[] = ["default", "cn"];

export function isClientRegion(value: unknown): value is ClientRegion {
  return CLIENT_REGIONS.includes(value as ClientRegion);
}

// The topology of a page and every report about it.
function analyzePage(ctx: PageContext, pageFlow: PageFlow): PageAnalysis {
  const { har } = pageFlow;
  const { nodes, paths } = pageTopology(ctx);
  return {
    nodes,
    paths,
    cacheReport: analyzeCacheForHar(har),
    thirdPartyClusters: ctx.thirdPartyClusters,
    networkReport: analyzeNetwork(har),
    compressionReport: analyzeCompression(har),
    connectionsReport: analyzeConnections(har),
    renderReport: analyzeRender(har, pageFlow.trace),
  };
}

export function generateFlow(pages: PageFlow[], options: FlowOptions = {}): Flow {
  if (pages.length === 0) {
    throw new Error("Flow requires at least one page");
  }

  const clientRegion: ClientRegion = options.clientRegion ?? "default";
  // The GFW topology is opt-in: latencies alone cannot tell China routing
  // apart from a slow or mobile network.
  const hasGfw = clientRegion === "cn";
  const suggestion = suggestClientRegion(pages[0].har);
  const contexts = pages.map((page) => describePage(page, hasGfw));

  const steps: DiagramStep[] = [];
  pages.forEach((page, pageIndex) => {
    // The transition belongs to the page it leads to.
    const pageSteps = generatePageSteps(contexts[pageIndex]);
    if (pageIndex > 0) {
      pageSteps.unshift(generateTransitionStep(pages[pageIndex - 1].name, page.name));
    }
    steps.push(...pageSteps.map((step) => ({ pageIndex, ...step })));
  });

  const pageAnalyses = pages.map((page, pageIndex) => analyzePage(contexts[pageIndex], page));

  return {
    version: FLOW_VERSION,
    clientRegion,
    hints: suggestion ? { suggestedClientRegion: suggestion } : {},
    pages,
    pageAnalyses,
    steps,
  };
}
