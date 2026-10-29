import { useMemo } from "react";
import type { DiagramStep } from "@htv/core";
import styles from "./BadgeRow.module.css";

interface Props {
  steps: DiagramStep[];
  pageIndex: number;
  stepIndex: number;
  /** Extra class for the row, e.g. to place it differently in a smaller diagram. */
  className?: string;
}

type Badge = NonNullable<DiagramStep["badge"]>;

const BADGE_LABELS: Record<Badge["type"], string> = {
  ttfb: "TTFB",
  fcp: "FCP",
  lcp: "LCP",
  onload: "onLoad",
};

/**
 * The metric badges (TTFB, FCP, LCP, onLoad) of the active page: hidden until their step is
 * reached, highlighted on it and dimmed afterwards. Each page has its own badges.
 */
export function BadgeRow({ steps, pageIndex, stepIndex, className }: Props) {
  const allBadges = useMemo(() => {
    const seen = new Map<string, Badge>();
    for (const s of steps) {
      if (s.badge && s.pageIndex === pageIndex) seen.set(s.badge.type, s.badge);
    }
    return [...seen.values()];
  }, [steps, pageIndex]);

  const revealedTypes = useMemo(() => {
    const types = new Set<string>();
    for (let i = 0; i <= stepIndex; i++) {
      const { badge, pageIndex: stepPage } = steps[i];
      if (badge && stepPage === pageIndex) types.add(badge.type);
    }
    return types;
  }, [steps, stepIndex, pageIndex]);

  if (allBadges.length === 0) return null;
  const currentBadgeType = steps[stepIndex].badge?.type;

  return (
    <div className={className ? `${styles.badgeRow} ${className}` : styles.badgeRow}>
      {allBadges.map((badge) => {
        const state = !revealedTypes.has(badge.type)
          ? "hidden"
          : badge.type !== currentBadgeType
            ? "dim"
            : "active";
        const stateClass =
          state === "hidden" ? styles.badgeHidden : state === "dim" ? styles.badgeDim : "";
        return (
          <div
            key={badge.type}
            data-badge-state={state}
            className={`${styles.badge} ${styles[`badge_${badge.type}`]} ${stateClass}`}
          >
            <span className={styles.badgeLabel}>{BADGE_LABELS[badge.type]}</span>
            <span>{badge.value}</span>
          </div>
        );
      })}
    </div>
  );
}
