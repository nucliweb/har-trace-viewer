import type { ClientRegionSuggestion } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import styles from "./RegionNotice.module.css";

interface Props {
  // The side of a comparison the notice speaks for; absent for a single flow.
  side?: "A" | "B";
  suggestion: ClientRegionSuggestion;
  // The diagram draws the suggested region (the Great Firewall), not the default topology.
  applied: boolean;
  // Draws the other topology. Absent when the raw pages are unavailable (flow embedded in a
  // report): the notice names the --region flag instead.
  onSwitch?: () => void;
  // A diagram is being generated: the switch button waits, and says so when it started it.
  busy?: "self" | "other";
  onDismiss: () => void;
}

export function RegionNotice({ side, suggestion, applied, onSwitch, busy, onDismiss }: Props) {
  const messages = useMessages();
  const t = messages.region;
  const otherRegion = applied ? "default" : suggestion.region;
  // The CLI sets each side's region with its own flag: --region for A, --compare-region for B.
  const flag = side === "B" ? "--compare-region" : "--region";
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>
        <span className={styles.title}>
          {side && `${side} · `}
          {t.title(applied)}
        </span>{" "}
        {t.text(suggestion.reason, applied)}
        {!onSwitch && (
          <>
            {" "}
            {t.cliBefore}{" "}
            <code className={styles.code}>
              {flag} {otherRegion}
            </code>{" "}
            {t.cliAfter(applied)}
          </>
        )}
      </p>
      <div className={styles.actions}>
        {onSwitch && (
          <button
            className={styles.applyBtn}
            onClick={busy ? undefined : onSwitch}
            aria-disabled={busy ? true : undefined}
          >
            {busy === "self" ? messages.app.generating : applied ? t.showDefault : t.showGfw}
          </button>
        )}
        <button className={styles.dismissBtn} onClick={onDismiss} aria-label={t.dismiss}>
          ×
        </button>
      </div>
    </div>
  );
}
