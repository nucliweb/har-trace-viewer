import type { ClientRegionSuggestion } from "@htv/core";
import styles from "./RegionNotice.module.css";

interface Props {
  suggestion: ClientRegionSuggestion;
  // Absent when the raw pages are unavailable (flow embedded in a report).
  onShowGfwTopology?: () => void;
  onDismiss: () => void;
}

export function RegionNotice({ suggestion, onShowGfwTopology, onDismiss }: Props) {
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>
        <span className={styles.title}>China / GFW routing?</span> Latencies look compatible with a
        client behind the Great Firewall ({suggestion.reason}). A slow or mobile network shows the
        same latencies, so the diagram keeps the default topology.
        {!onShowGfwTopology && (
          <>
            {" "}
            Generate the report with <code className={styles.code}>--region cn</code> to show the
            GFW topology.
          </>
        )}
      </p>
      <div className={styles.actions}>
        {onShowGfwTopology && (
          <button className={styles.applyBtn} onClick={onShowGfwTopology}>
            Show GFW topology
          </button>
        )}
        <button className={styles.dismissBtn} onClick={onDismiss} aria-label="Dismiss notice">
          ×
        </button>
      </div>
    </div>
  );
}
