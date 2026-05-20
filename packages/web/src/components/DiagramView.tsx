import { useMemo, useState } from "react";
import type { Flow, HarEntry, PathId } from "@htv/core/types.js";
import { useDiagramState } from "../hooks/useDiagramState.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { StepPanel } from "./StepPanel.js";
import { ResourceSidebar } from "./ResourceSidebar.js";
import { CacheSidebar } from "./CacheSidebar.js";
import { CachePanel } from "./CachePanel.js";
import styles from "./DiagramView.module.css";

interface Props {
  flow: Flow;
}

type HistoricalPath = { timing?: string; direction?: "request" | "response" };

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

function computeHistoricalPaths(
  steps: Flow["steps"],
  currentStepIndex: number
): Partial<Record<PathId, HistoricalPath>> {
  const history: Partial<Record<PathId, HistoricalPath>> = {};
  for (let i = 0; i < currentStepIndex; i++) {
    const s = steps[i];
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
  const step = flow.steps[state.stepIndex];
  const [sidebarResources, setSidebarResources] = useState<HarEntry[] | null>(null);
  const [showCachePanel, setShowCachePanel] = useState(false);

  const openSidebar = (resources: HarEntry[]) => setSidebarResources(resources);
  const closeSidebar = () => setSidebarResources(null);

  const historicalPaths = computeHistoricalPaths(flow.steps, state.stepIndex);

  const allBadges = useMemo(() => {
    const seen = new Map<string, NonNullable<Flow["steps"][number]["badge"]>>();
    for (const s of flow.steps) {
      if (s.badge) seen.set(s.badge.type, s.badge);
    }
    return [...seen.values()];
  }, [flow.steps]);

  const revealedTypes = useMemo(() => {
    const types = new Set<string>();
    for (let i = 0; i <= state.stepIndex; i++) {
      const badge = flow.steps[i].badge;
      if (badge) types.add(badge.type);
    }
    return types;
  }, [flow.steps, state.stepIndex]);

  const currentBadgeType = step.badge?.type;

  return (
    <div className={styles.view}>
      <div className={styles.canvas}>
        <NodeRenderer
          nodes={flow.nodes}
          paths={flow.paths}
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
        {step.cacheResources && step.cacheResources.length > 0 && (
          <CacheSidebar resources={step.cacheResources} />
        )}
        {sidebarResources && (
          <ResourceSidebar
            resources={sidebarResources}
            title={step.title}
            onClose={closeSidebar}
            preconnectHints={flow.pages[0].har.preconnectHints}
            documentHostname={new URL(flow.pages[0].har.documentEntry.url).hostname}
          />
        )}
        {showCachePanel && (
          <CachePanel
            report={flow.cacheReport}
            onClose={() => setShowCachePanel(false)}
          />
        )}
        <button
          className={`${styles.cacheBtn} ${showCachePanel ? styles.cacheBtnActive : ""}`}
          onClick={() => setShowCachePanel((v) => !v)}
          aria-label="Toggle cache analysis"
          title="Cache Analysis"
        >
          Cache
        </button>
      </div>
      <StepPanel state={state} onOpenResources={openSidebar} />
    </div>
  );
}
