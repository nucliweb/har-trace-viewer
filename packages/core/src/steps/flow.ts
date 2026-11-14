import { suggestClientRegion } from "../inference/node-detector.js";
import { analyzeCacheForHar } from "../inference/cache-analyzer.js";
import { analyzeNetwork } from "../analysis/network-report.js";
import { analyzeCompression } from "../analysis/compression.js";
import { analyzeConnections } from "../analysis/connections.js";
import { analyzeRender } from "../analysis/render-report.js";
import { analyzeThirdParties } from "../analysis/third-parties.js";
import { analyzeMainThread } from "../analysis/main-thread.js";
import { describePage, type PageContext } from "./page-context.js";
import { generatePageSteps, generateTransitionStep } from "./page-steps.js";
import { pageTopology } from "./topology.js";
import type {
  ClientRegion,
  ClientRegionSuggestion,
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
// 7: steps reference the inferred browser-cache hits of their group (DiagramStep
//    inferredCacheRefs), which light the hop to the browser cache like the HAR's own hits;
//    a hit whose store the HAR does not record reads fromCache "unknown" (CacheReport.browser
//    fromUnknownStore).
export const FLOW_VERSION = 7;

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
    thirdPartyReport: analyzeThirdParties(har, pageFlow.trace),
    ...(pageFlow.trace?.mainThread
      ? { mainThreadReport: analyzeMainThread(har, pageFlow.trace) }
      : {}),
  };
}

// The region the first page whose latencies suggest one does: a recording that navigated
// several times shows them on any of its loads. The reason names that page in a multi-page flow.
function suggestFlowRegion(pages: PageFlow[]): ClientRegionSuggestion | null {
  for (const page of pages) {
    const suggestion = suggestClientRegion(page.har);
    if (!suggestion) continue;
    return pages.length > 1
      ? { ...suggestion, reason: `${page.name}: ${suggestion.reason}` }
      : suggestion;
  }
  return null;
}

export function generateFlow(pages: PageFlow[], options: FlowOptions = {}): Flow {
  if (pages.length === 0) {
    throw new Error("Flow requires at least one page");
  }

  // Without a region of its own the flow takes the suggested one: latencies alone cannot tell
  // China routing apart from a slow or mobile network, so the hint keeps the reason and an
  // explicit "default" draws the default topology.
  const suggestion = suggestFlowRegion(pages);
  const clientRegion: ClientRegion = options.clientRegion ?? suggestion?.region ?? "default";
  const hasGfw = clientRegion === "cn";
  const described = pages.map((page) => ({ page, context: describePage(page, hasGfw) }));

  const steps: DiagramStep[] = [];
  described.forEach(({ page, context }, pageIndex) => {
    // The transition belongs to the page it leads to.
    const pageSteps = generatePageSteps(context);
    const previous = pages[pageIndex - 1];
    if (previous) pageSteps.unshift(generateTransitionStep(previous.name, page.name));
    steps.push(...pageSteps.map((step) => ({ pageIndex, ...step })));
  });

  const pageAnalyses = described.map(({ page, context }) => analyzePage(context, page));

  return {
    version: FLOW_VERSION,
    clientRegion,
    hints: suggestion ? { suggestedClientRegion: suggestion } : {},
    pages,
    pageAnalyses,
    steps,
  };
}
