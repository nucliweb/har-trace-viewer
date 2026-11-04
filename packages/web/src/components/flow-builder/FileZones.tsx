import { useRef } from "react";
import styles from "../FlowBuilder.module.css";
import { describeProgress } from "./page-entry.js";
import type { PageEntry } from "./page-entry.js";

interface Props {
  entry: PageEntry;
  onHarFile: (file: File) => void;
  onTraceFile: (file: File) => void;
  /** Text of the empty HAR button. */
  dropLabel?: string;
  /** Accessible names of the file inputs, when they need one of their own. */
  harInputLabel?: string;
  traceInputLabel?: string;
}

/** The HAR button (click or drop) and the optional trace button of one recording. */
export function FileZones({
  entry,
  onHarFile,
  onTraceFile,
  dropLabel = "Drop .har",
  harInputLabel,
  traceInputLabel,
}: Props) {
  const harInputRef = useRef<HTMLInputElement>(null);
  const traceInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className={styles.harZone}>
        <input
          ref={harInputRef}
          type="file"
          accept=".har,.gz"
          className={styles.hiddenInput}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onHarFile(f);
            e.target.value = "";
          }}
          aria-hidden="true"
          aria-label={harInputLabel}
          tabIndex={-1}
        />
        <button
          className={`${styles.harBtn} ${entry.har ? styles.harLoaded : ""} ${entry.harError ? styles.harError : ""}`}
          onClick={() => harInputRef.current?.click()}
          disabled={entry.harProgress !== null}
          title={
            entry.har
              ? entry.harFileName
              : (entry.harError ?? "Click or drop a .har or .har.gz file")
          }
        >
          {entry.harProgress ? (
            <span className={styles.progressText} role="status">
              {describeProgress(entry.harProgress)}
            </span>
          ) : entry.har ? (
            <span className={styles.harName}>
              {entry.harFileName}
              {entry.har.length > 1 ? ` · ${entry.har.length} pages` : ""}
            </span>
          ) : entry.harError ? (
            <span className={styles.errorText}>{entry.harError}</span>
          ) : (
            <>
              <span className={styles.harIcon}>⬇</span> {dropLabel}
            </>
          )}
        </button>
      </div>

      <div className={styles.traceZone}>
        <input
          ref={traceInputRef}
          type="file"
          accept=".json,.gz"
          className={styles.hiddenInput}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onTraceFile(f);
            e.target.value = "";
          }}
          aria-hidden="true"
          aria-label={traceInputLabel}
          tabIndex={-1}
        />
        <button
          className={`${styles.traceBtn} ${entry.trace ? styles.traceLoaded : ""}`}
          onClick={() => traceInputRef.current?.click()}
          disabled={!entry.har || entry.traceProgress !== null}
          title={entry.trace ? entry.traceFileName : "Load a Chrome DevTools trace (optional)"}
        >
          {entry.trace ? "Trace ✓" : "Trace"}
        </button>
        {entry.traceProgress && (
          <span className={styles.progressText} role="status">
            {describeProgress(entry.traceProgress)}
          </span>
        )}
        {entry.traceError && (
          <span className={styles.traceErrorText} title={entry.traceError}>
            {entry.traceError}
          </span>
        )}
      </div>
    </>
  );
}
