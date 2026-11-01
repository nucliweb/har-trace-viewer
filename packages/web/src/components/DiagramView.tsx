import { useMemo, useRef, useState } from "react";
import { analyzeHops, getStepCacheResources, getStepResources } from "@htv/core";
import type { Flow, HarEntry } from "@htv/core";
import { useDiagramState } from "../hooks/useDiagramState.js";
import { useStepKeyboard } from "../hooks/useStepKeyboard.js";
import { computeHistoricalPaths } from "../lib/historical-paths.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { StepPanel } from "./StepPanel.js";
import { ResourceSidebar } from "./ResourceSidebar.js";
import { CacheSidebar } from "./CacheSidebar.js";
import { CachePanel } from "./CachePanel.js";
import { MetricsSummary } from "./MetricsSummary.js";
import { HopsPanel } from "./HopsPanel.js";
import { ExportMenu } from "./ExportMenu.js";
import { BadgeRow } from "./BadgeRow.js";
import styles from "./DiagramView.module.css";

interface Props {
  flow: Flow;
}

export function DiagramView({ flow }: Props) {
  const state = useDiagramState(flow);
  const viewRef = useRef<HTMLDivElement>(null);
  useStepKeyboard(viewRef, state);
  const { stepIndex } = state;
  const step = flow.steps[stepIndex];
  const { pageIndex } = step;
  // Steps reference their page entries by index: resolve them once per step.
  const resources = useMemo(() => getStepResources(flow, flow.steps[stepIndex]), [flow, stepIndex]);
  const cacheResources = useMemo(
    () => getStepCacheResources(flow, flow.steps[stepIndex]),
    [flow, stepIndex]
  );
  // Indexing keeps the analysis reference stable while the user stays on a page.
  const analysis = flow.pageAnalyses[pageIndex];
  const page = flow.pages[pageIndex];
  const [sidebarResources, setSidebarResources] = useState<HarEntry[] | null>(null);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [showHops, setShowHops] = useState(false);
  const hops = useMemo(() => analyzeHops(page.har, page.har.documentEntry.url), [page.har]);

  const openSidebar = (resources: HarEntry[]) => setSidebarResources(resources);
  const closeSidebar = () => setSidebarResources(null);

  const historicalPaths = useMemo(
    () => computeHistoricalPaths(flow.steps, stepIndex),
    [flow.steps, stepIndex]
  );

  // The last step of a page is its overview ("Page loaded"). A transition step belongs to the
  // page it leads to, so the next step starting a new page also marks the end of this one.
  // Not tied to the title or the onload badge, which is absent when the load event never fired.
  const isOverviewStep = flow.steps[stepIndex + 1]?.pageIndex !== step.pageIndex;

  return (
    // The region is focusable on purpose: it is the keyboard entry point for the step shortcuts.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div ref={viewRef} className={styles.view} role="region" aria-label="Diagram" tabIndex={0}>
      {/* A band of its own above the diagram, so it never covers the zone captions. */}
      <div className={styles.toolbar}>
        <button
          className={`${styles.hopsBtn} ${showHops ? styles.cacheBtnActive : ""}`}
          onClick={() => {
            setShowHops((v) => !v);
            setShowMetrics(false);
            setShowCachePanel(false);
          }}
          aria-label="Toggle hops"
          aria-expanded={showHops}
          title="Hops per host"
        >
          Hops
        </button>
        <ExportMenu containerRef={viewRef} pageName={page.name} stepNumber={stepIndex + 1} />
        <button
          className={`${styles.metricsBtn} ${showMetrics ? styles.cacheBtnActive : ""}`}
          onClick={() => {
            setShowMetrics((v) => !v);
            setShowCachePanel(false);
            setShowHops(false);
          }}
          aria-label="Toggle metrics summary"
          aria-expanded={showMetrics}
          title="Metrics summary"
        >
          Metrics
        </button>
        <button
          className={`${styles.cacheBtn} ${showCachePanel ? styles.cacheBtnActive : ""}`}
          onClick={() => {
            setShowCachePanel((v) => !v);
            setShowMetrics(false);
            setShowHops(false);
          }}
          aria-label="Toggle cache analysis"
          title="Cache Analysis"
        >
          Cache
        </button>
      </div>
      <div className={styles.canvas}>
        {/* The cache list docks on the left: the diagram moves aside so the browser and the
            hop to its cache stay in view. */}
        <div
          className={`${styles.diagram} ${cacheResources.length > 0 ? styles.diagramBesideCache : ""}`}
        >
          <NodeRenderer
            nodes={analysis.nodes}
            paths={analysis.paths}
            activeNodes={step.activeNodes}
            activePaths={step.activePaths}
            pathTimings={step.pathTimings}
            pathDirections={step.pathDirections}
            historicalPaths={historicalPaths}
          />
        </div>
        {/* Badges belong to the active page: each page has its own TTFB, FCP, LCP and onLoad. */}
        <BadgeRow steps={flow.steps} pageIndex={pageIndex} stepIndex={stepIndex} />
        {cacheResources.length > 0 && <CacheSidebar resources={cacheResources} />}
        {sidebarResources && (
          <ResourceSidebar
            resources={sidebarResources}
            title={isOverviewStep ? "All resources" : step.title}
            overview={isOverviewStep}
            onClose={closeSidebar}
            preconnectHints={page.har.preconnectHints}
            documentHostname={new URL(page.har.documentEntry.url).hostname}
            renderDeadline={page.trace?.lcp ?? page.trace?.fcp ?? null}
          />
        )}
        {showCachePanel && (
          <CachePanel
            report={analysis.cacheReport}
            pageLabel={`Page ${pageIndex + 1} · ${page.name}`}
            onClose={() => setShowCachePanel(false)}
          />
        )}
        {showMetrics && <MetricsSummary flow={flow} onClose={() => setShowMetrics(false)} />}
        {showHops && (
          <HopsPanel
            hops={hops}
            pageLabel={`Page ${pageIndex + 1} · ${page.name}`}
            onClose={() => setShowHops(false)}
          />
        )}
      </div>
      <StepPanel state={state} resources={resources} onOpenResources={openSidebar} />
    </div>
  );
}
