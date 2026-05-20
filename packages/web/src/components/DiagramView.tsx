import { useMemo, useState } from "react";
import type { Flow, HarEntry, PathId } from "@htv/core/types.js";
import { useDiagramState } from "../hooks/useDiagramState.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { StepPanel } from "./StepPanel.js";
import { ResourceSidebar } from "./ResourceSidebar.js";
import { CacheSidebar } from "./CacheSidebar.js";
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

function computeHistoricalPaths(
  steps: Flow["steps"],
  currentStepIndex: number
): Partial<Record<PathId, HistoricalPath>> {
  const history: Partial<Record<PathId, HistoricalPath>> = {};
  for (let i = 0; i < currentStepIndex; i++) {
    const s = steps[i];
    for (const pathId of s.activePaths) {
      history[pathId as PathId] = {
        timing: s.pathTimings?.[pathId as PathId],
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
      </div>
      <StepPanel state={state} onOpenResources={openSidebar} />
    </div>
  );
}
