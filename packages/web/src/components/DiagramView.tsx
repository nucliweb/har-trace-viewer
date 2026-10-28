import { useMemo, useRef, useState } from "react";
import { getStepCacheResources, getStepResources } from "@htv/core";
import type { Flow, HarEntry, PathId } from "@htv/core";
import { useDiagramState } from "../hooks/useDiagramState.js";
import { useStepKeyboard } from "../hooks/useStepKeyboard.js";
import type { HistoricalPath } from "../types.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { StepPanel } from "./StepPanel.js";
import { ResourceSidebar } from "./ResourceSidebar.js";
import { CacheSidebar } from "./CacheSidebar.js";
import { CachePanel } from "./CachePanel.js";
import { MetricsSummary } from "./MetricsSummary.js";
import styles from "./DiagramView.module.css";

interface Props {
  flow: Flow;
}

const BADGE_LABELS: Record<string, string> = {
  ttfb: "TTFB",
  fcp: "FCP",
  lcp: "LCP",
  onload: "onLoad",
};

// Strip "N items · " prefix from path timing labels when shown as historical context.
// Historical paths already have node-level resource stats; keeping per-step counts
// creates misleading comparisons (e.g. "45 secondary resources" vs "102 3rd-party req").
function toHistoricalTiming(timing: string): string {
  return timing.replace(/^\d+ .+ · (avg .+)$/, "$1");
}

// History only covers the active page: each page has its own topology.
function computeHistoricalPaths(
  steps: Flow["steps"],
  currentStepIndex: number
): Partial<Record<PathId, HistoricalPath>> {
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

  const openSidebar = (resources: HarEntry[]) => setSidebarResources(resources);
  const closeSidebar = () => setSidebarResources(null);

  const historicalPaths = useMemo(
    () => computeHistoricalPaths(flow.steps, stepIndex),
    [flow.steps, stepIndex]
  );

  // Badges belong to the active page: each page has its own TTFB, FCP, LCP and onLoad.
  const allBadges = useMemo(() => {
    const seen = new Map<string, NonNullable<Flow["steps"][number]["badge"]>>();
    for (const s of flow.steps) {
      if (s.badge && s.pageIndex === pageIndex) seen.set(s.badge.type, s.badge);
    }
    return [...seen.values()];
  }, [flow.steps, pageIndex]);

  const revealedTypes = useMemo(() => {
    const types = new Set<string>();
    for (let i = 0; i <= state.stepIndex; i++) {
      const { badge, pageIndex: stepPage } = flow.steps[i];
      if (badge && stepPage === pageIndex) types.add(badge.type);
    }
    return types;
  }, [flow.steps, state.stepIndex, pageIndex]);

  const currentBadgeType = step.badge?.type;

  return (
    // The region is focusable on purpose: it is the keyboard entry point for the step shortcuts.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div ref={viewRef} className={styles.view} role="region" aria-label="Diagram" tabIndex={0}>
      <div className={styles.canvas}>
        <NodeRenderer
          nodes={analysis.nodes}
          paths={analysis.paths}
          activeNodes={step.activeNodes}
          activePaths={step.activePaths}
          pathTimings={step.pathTimings}
          pathDirections={step.pathDirections}
          historicalPaths={historicalPaths}
        />
        {allBadges.length > 0 && (
          <div className={styles.badgeRow}>
            {allBadges.map((badge) => (
              <div
                key={badge.type}
                className={`${styles.badge} ${styles[`badge_${badge.type}`]} ${!revealedTypes.has(badge.type) ? styles.badgeHidden : badge.type !== currentBadgeType ? styles.badgeDim : ""}`}
              >
                <span className={styles.badgeLabel}>{BADGE_LABELS[badge.type]}</span>
                <span>{badge.value}</span>
              </div>
            ))}
          </div>
        )}
        {cacheResources.length > 0 && <CacheSidebar resources={cacheResources} />}
        {sidebarResources && (
          <ResourceSidebar
            resources={sidebarResources}
            title={step.title}
            onClose={closeSidebar}
            preconnectHints={page.har.preconnectHints}
            documentHostname={new URL(page.har.documentEntry.url).hostname}
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
        <button
          className={`${styles.metricsBtn} ${showMetrics ? styles.cacheBtnActive : ""}`}
          onClick={() => {
            setShowMetrics((v) => !v);
            setShowCachePanel(false);
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
          }}
          aria-label="Toggle cache analysis"
          title="Cache Analysis"
        >
          Cache
        </button>
      </div>
      <StepPanel state={state} resources={resources} onOpenResources={openSidebar} />
    </div>
  );
}
