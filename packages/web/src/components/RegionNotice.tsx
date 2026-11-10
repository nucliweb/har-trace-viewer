import type { ClientRegionSuggestion } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import styles from "./RegionNotice.module.css";

interface Props {
  suggestion: ClientRegionSuggestion;
  // The diagram draws the suggested region (the Great Firewall), not the default topology.
  applied: boolean;
  // Draws the other topology. Absent when the raw pages are unavailable (flow embedded in a
  // report): the notice names the --region flag instead.
  onSwitch?: () => void;
  onDismiss: () => void;
}

export function RegionNotice({ suggestion, applied, onSwitch, onDismiss }: Props) {
  const t = useMessages().region;
  const otherRegion = applied ? "default" : suggestion.region;
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>
        <span className={styles.title}>{t.title(applied)}</span>{" "}
        {t.text(suggestion.reason, applied)}
        {!onSwitch && (
          <>
            {" "}
            {t.cliBefore} <code className={styles.code}>--region {otherRegion}</code>{" "}
            {t.cliAfter(applied)}
          </>
        )}
      </p>
      <div className={styles.actions}>
        {onSwitch && (
          <button className={styles.applyBtn} onClick={onSwitch}>
            {applied ? t.showDefault : t.showGfw}
          </button>
        )}
        <button className={styles.dismissBtn} onClick={onDismiss} aria-label={t.dismiss}>
          ×
        </button>
      </div>
    </div>
  );
}
