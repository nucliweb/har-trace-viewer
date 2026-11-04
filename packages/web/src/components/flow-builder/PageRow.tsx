import { useId } from "react";
import { listHarPages } from "@htv/core";
import type { ParsedHar } from "@htv/core";
import styles from "../FlowBuilder.module.css";
import { FileZones } from "./FileZones.js";
import { isEntryParsing, pageOptionLabel } from "./page-entry.js";
import type { PageEntry } from "./page-entry.js";

interface Props {
  page: PageEntry;
  idx: number;
  total: number;
  isDraggingOver: boolean;
  onNameChange: (name: string) => void;
  onHarFile: (file: File) => void;
  onSelectedPagesChange: (ids: string[]) => void;
  /** Offers to compare two pages of this HAR instead of building a flow. */
  showComparePicker: boolean;
  onComparePagesChange: (patch: Pick<PageEntry, "comparePair" | "comparePages">) => void;
  onTraceFile: (file: File) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
}

/** One page of the flow: its order, name, files, and the pickers of a multi-page HAR. */
export function PageRow({
  page,
  idx,
  total,
  isDraggingOver,
  onNameChange,
  onHarFile,
  onSelectedPagesChange,
  showComparePicker,
  onComparePagesChange,
  onTraceFile,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragOver,
  onDragLeave,
}: Props) {
  const handleHarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDragLeave();
    const file = e.dataTransfer.files[0];
    if (file) onHarFile(file);
  };

  return (
    <div className={styles.rowGroup}>
      <div
        className={`${styles.row} ${isDraggingOver ? styles.rowDragging : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver();
        }}
        onDragLeave={onDragLeave}
        onDrop={handleHarDrop}
        aria-busy={isEntryParsing(page)}
      >
        <div className={styles.rowOrder}>
          <button
            className={styles.orderBtn}
            onClick={onMoveUp}
            disabled={idx === 0}
            title="Move up"
            aria-label="Move page up"
          >
            ↑
          </button>
          <button
            className={styles.orderBtn}
            onClick={onMoveDown}
            disabled={idx === total - 1}
            title="Move down"
            aria-label="Move page down"
          >
            ↓
          </button>
        </div>

        <input
          className={styles.nameInput}
          type="text"
          value={page.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Page name"
          aria-label={`Page ${idx + 1} name`}
        />

        <FileZones entry={page} onHarFile={onHarFile} onTraceFile={onTraceFile} />

        <button
          className={styles.removeBtn}
          onClick={onRemove}
          disabled={total === 1}
          title="Remove page"
          aria-label="Remove page"
        >
          ×
        </button>
      </div>
      {page.har && page.har.length > 1 && !(showComparePicker && page.comparePages) && (
        <PageChecklist
          har={page.har}
          selected={page.selectedPageIds}
          name={page.name || `Page ${idx + 1}`}
          onChange={onSelectedPagesChange}
        />
      )}
      {showComparePicker && page.har && page.comparePair && (
        <ComparePagesPicker
          har={page.har}
          pair={page.comparePair}
          enabled={page.comparePages}
          onChange={onComparePagesChange}
        />
      )}
    </div>
  );
}

interface ComparePagesPickerProps {
  har: ParsedHar[];
  pair: [string, string];
  enabled: boolean;
  onChange: (patch: Pick<PageEntry, "comparePair" | "comparePages">) => void;
}

/** Compares two pages of one HAR, e.g. the first and the repeat view of a WebPageTest run. */
function ComparePagesPicker({ har, pair, enabled, onChange }: ComparePagesPickerProps) {
  const pages = listHarPages(har);
  const idA = useId();
  const idB = useId();
  const pick = (side: 0 | 1, id: string) => {
    const next: [string, string] = [...pair];
    next[side] = id;
    onChange({ comparePair: next, comparePages: enabled });
  };
  return (
    <fieldset className={styles.checklist}>
      <legend className={styles.checklistLegend}>Compare pages</legend>
      <label className={styles.checklistItem}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ comparePair: pair, comparePages: e.target.checked })}
        />
        <span>Compare two pages of this HAR</span>
      </label>
      {([0, 1] as const).map((side) => (
        <span key={side} className={styles.pairField}>
          <label className={styles.pairLabel} htmlFor={side === 0 ? idA : idB}>
            {side === 0 ? "A" : "B"}
          </label>
          <select
            id={side === 0 ? idA : idB}
            className={styles.regionSelect}
            value={pair[side]}
            disabled={!enabled}
            onChange={(e) => pick(side, e.target.value)}
          >
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {pageOptionLabel(page)}
              </option>
            ))}
          </select>
        </span>
      ))}
    </fieldset>
  );
}

interface PageChecklistProps {
  har: ParsedHar[];
  selected: string[];
  name: string;
  onChange: (ids: string[]) => void;
}

/** Which pages of a multi-page HAR (e.g. the runs and views of a WebPageTest export) join the flow. */
function PageChecklist({ har, selected, name, onChange }: PageChecklistProps) {
  const pages = listHarPages(har);
  const allSelected = selected.length === pages.length;
  const toggle = (id: string) =>
    onChange(pages.map((p) => p.id).filter((pid) => (pid === id) !== selected.includes(pid)));
  return (
    <fieldset className={styles.checklist}>
      <legend className={styles.checklistLegend}>Pages to include from {name}</legend>
      <button
        type="button"
        className={styles.checklistToggle}
        onClick={() => onChange(allSelected ? [] : pages.map((p) => p.id))}
      >
        {allSelected ? "Select none" : "Select all"}
      </button>
      <ul className={styles.checklistItems}>
        {pages.map((page) => (
          <li key={page.id}>
            <label className={styles.checklistItem}>
              <input
                type="checkbox"
                checked={selected.includes(page.id)}
                onChange={() => toggle(page.id)}
              />
              <span>{pageOptionLabel(page)}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
