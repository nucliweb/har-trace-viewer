import type { ClientRegionSuggestion } from "@htv/core";
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
  const otherRegion = applied ? "default" : suggestion.region;
  const otherTopology = applied ? "default topology" : "GFW topology";
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>
        <span className={styles.title}>China / GFW routing{applied ? "" : "?"}</span> Latencies look
        compatible with a client behind the Great Firewall ({suggestion.reason})
        {applied
          ? ", so the diagram draws it. A slow or mobile network shows the same latencies."
          : ". A slow or mobile network shows the same latencies, so the diagram keeps the default topology."}
        {!onSwitch && (
          <>
            {" "}
            Generate the report with <code className={styles.code}>--region {otherRegion}</code> to
            draw the {otherTopology}.
          </>
        )}
      </p>
      <div className={styles.actions}>
        {onSwitch && (
          <button className={styles.applyBtn} onClick={onSwitch}>
            {applied ? "Show default topology" : "Show GFW topology"}
          </button>
        )}
        <button className={styles.dismissBtn} onClick={onDismiss} aria-label="Dismiss notice">
          ×
        </button>
      </div>
    </div>
  );
}
