import { useId, useState } from "react";
import { listHarPages } from "@htv/core";
import styles from "../FlowBuilder.module.css";
import { FileZones } from "./FileZones.js";
import { isEntryParsing, pageOptionLabel } from "./page-entry.js";
import type { PageEntry } from "./page-entry.js";

interface Props {
  entry: PageEntry;
  onHarFile: (file: File) => void;
  onTraceFile: (file: File) => void;
  onPageChange: (id: string) => void;
  onRemove: () => void;
}

/** Optional second recording: the report then compares it (B) with the flow above (A). */
export function CompareTarget({ entry, onHarFile, onTraceFile, onPageChange, onRemove }: Props) {
  const [dragging, setDragging] = useState(false);
  const pageSelectId = useId();
  const pages = entry.har && entry.har.length > 1 ? listHarPages(entry.har) : null;
  return (
    <fieldset className={styles.compare}>
      <legend className={styles.compareLegend}>Compare with…</legend>
      <p className={styles.compareHint}>
        Optional: a second recording of the same page, e.g. with a warm cache. The first page of
        each side is compared step by step.
      </p>
      <div
        className={`${styles.row} ${dragging ? styles.rowDragging : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onHarFile(file);
        }}
        aria-busy={isEntryParsing(entry)}
      >
        <FileZones
          entry={entry}
          onHarFile={onHarFile}
          onTraceFile={onTraceFile}
          dropLabel="Drop .har to compare"
          harInputLabel="HAR file to compare with"
          traceInputLabel="Trace to compare with"
        />
        <button
          className={styles.removeBtn}
          onClick={onRemove}
          disabled={!entry.har && !entry.harError}
          title="Remove comparison"
          aria-label="Remove comparison"
        >
          ×
        </button>
      </div>
      {pages && (
        <span className={styles.pairField}>
          <label className={styles.pairLabel} htmlFor={pageSelectId}>
            Page
          </label>
          <select
            id={pageSelectId}
            className={styles.regionSelect}
            value={entry.selectedPageIds[0]}
            onChange={(e) => onPageChange(e.target.value)}
          >
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {pageOptionLabel(page)}
              </option>
            ))}
          </select>
        </span>
      )}
    </fieldset>
  );
}
