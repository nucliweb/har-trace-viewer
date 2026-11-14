import { pageDocument } from "../parsers/har-parser.js";
import { analyzeRenderBlocking, renderBlockingRecommendations } from "./critical-path.js";
import { attributeLcp, lcpRecommendations } from "./lcp.js";
import type { ParsedHar, ParsedTrace, RenderReport } from "../types.js";

/**
 * What delayed the page's paints: the LCP attribution (from the trace) and the render-blocking
 * resources with their critical chains (from the trace, else the HAR), with what to fix.
 * A page without an HTML document renders nothing: its report is empty.
 */
export function analyzeRender(har: ParsedHar, trace: ParsedTrace | undefined): RenderReport {
  if (!pageDocument(har)) {
    return {
      lcp: null,
      renderBlocking: {
        source: "none",
        fcpMs: trace?.fcp ?? null,
        documentEndMs: null,
        resources: [],
        totalBytes: 0,
        heldMs: 0,
        chains: [],
      },
      recommendations: [],
    };
  }
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
