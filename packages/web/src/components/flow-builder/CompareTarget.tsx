import { useId, useState } from "react";
import { listHarPages } from "@htv/core";
import { useMessages } from "../../i18n/context.js";
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
  const t = useMessages().builder;
  const [dragging, setDragging] = useState(false);
  const pageSelectId = useId();
  const pages = entry.har && entry.har.length > 1 ? listHarPages(entry.har) : null;
  return (
    <fieldset className={styles.compare}>
      <legend className={styles.compareLegend}>{t.compareLegend}</legend>
      <p className={styles.compareHint}>{t.compareHint}</p>
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
          dropLabel={t.dropToCompare}
          harInputLabel={t.harToCompare}
          traceInputLabel={t.traceToCompare}
        />
        <button
          className={styles.removeBtn}
          onClick={onRemove}
          disabled={!entry.har && !entry.harError}
          title={t.removeComparison}
          aria-label={t.removeComparison}
        >
          ×
        </button>
      </div>
      {pages && (
        <span className={styles.pairField}>
          <label className={styles.pairLabel} htmlFor={pageSelectId}>
            {t.page}
          </label>
          <select
            id={pageSelectId}
            className={styles.regionSelect}
            value={entry.selectedPageIds[0]}
            onChange={(e) => onPageChange(e.target.value)}
          >
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {pageOptionLabel(page, t)}
              </option>
            ))}
          </select>
        </span>
      )}
    </fieldset>
  );
}
