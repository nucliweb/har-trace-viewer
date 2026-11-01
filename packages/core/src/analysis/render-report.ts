import { analyzeRenderBlocking, renderBlockingRecommendations } from "./critical-path.js";
import { attributeLcp, lcpRecommendations } from "./lcp.js";
import type { ParsedHar, ParsedTrace, RenderReport } from "../types.js";

/**
 * What delayed the page's paints: the LCP attribution (from the trace) and the render-blocking
 * resources with their critical chains (from the trace, else the HAR), with what to fix.
 */
export function analyzeRender(har: ParsedHar, trace: ParsedTrace | undefined): RenderReport {
  const lcp = attributeLcp(har, trace);
  const renderBlocking = analyzeRenderBlocking(har, trace);
  return {
    lcp,
    renderBlocking,
    recommendations: [
      ...(lcp ? lcpRecommendations(har, lcp) : []),
      ...renderBlockingRecommendations(renderBlocking),
    ],
  };
}
