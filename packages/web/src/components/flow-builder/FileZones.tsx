import { useRef } from "react";
import { useMessages } from "../../i18n/context.js";
import styles from "../FlowBuilder.module.css";
import { describeEntryError, describeProgress } from "./page-entry.js";
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
  dropLabel,
  harInputLabel,
  traceInputLabel,
}: Props) {
  const t = useMessages().builder;
  const harError = entry.harError && describeEntryError(entry.harError, t);
  const traceError = entry.traceError && describeEntryError(entry.traceError, t);
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
          title={entry.har ? entry.harFileName : (harError ?? t.harTitle)}
        >
          {entry.harProgress ? (
            <span className={styles.progressText} role="status">
              {describeProgress(entry.harProgress, t)}
            </span>
          ) : entry.har ? (
            <span className={styles.harName}>
              {entry.harFileName}
              {entry.har.length > 1 ? t.harPages(entry.har.length) : ""}
            </span>
          ) : harError ? (
            <span className={styles.errorText}>{harError}</span>
          ) : (
            <>
              <span className={styles.harIcon}>⬇</span> {dropLabel ?? t.dropHar}
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
          title={entry.trace ? entry.traceFileName : t.traceTitle}
        >
          {entry.trace ? t.traceLoaded : t.trace}
        </button>
        {entry.traceProgress && (
          <span className={styles.progressText} role="status">
            {describeProgress(entry.traceProgress, t)}
          </span>
        )}
        {traceError && (
          <span className={styles.traceErrorText} title={traceError}>
            {traceError}
          </span>
        )}
      </div>
    </>
  );
}
