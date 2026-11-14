import type { PageEntry } from "./page-entry.js";

export type RecordingKind = "har" | "trace";

export const TRACE_FILE = /\.json(\.gz)?$/i;

/**
 * A trace is told by its `.json` name; anything else is taken as a HAR, whose own check then
 * words the error for an extension it does not support.
 */
export function classifyRecordingFile(file: File): RecordingKind {
  return TRACE_FILE.test(file.name) ? "trace" : "har";
}

/** What a drop puts in one row: `rowId` is undefined for a row the drop has to add. */
export interface RowPlan {
  rowId?: string;
  har?: File;
  trace?: File;
}

type Row = Pick<PageEntry, "id" | "har" | "trace">;

/**
 * Decides where each dropped file goes.
 *
 * - The k-th HAR and the k-th trace share a row: a HAR and its trace dropped together are one
 *   recording. Surplus HARs make rows of their own, so do surplus traces (which then ask for
 *   their HAR).
 * - Dropped on a row (`targetId`), the first HAR, or a lone trace, goes there.
 * - Dropped elsewhere, HARs fill the rows still lacking one before new rows are added; a lone
 *   trace goes to the first row with a HAR and no trace, else to an empty row.
 */
export function planDrop(files: File[], rows: Row[], targetId?: string): RowPlan[] {
  const hars = files.filter((f) => classifyRecordingFile(f) === "har");
  const traces = files.filter((f) => classifyRecordingFile(f) === "trace");
  const used = new Set<string>();
  const take = (id: string | undefined) => {
    if (id) used.add(id);
    return id;
  };
  const free = (match: (r: Row) => boolean) => rows.find((r) => !used.has(r.id) && match(r))?.id;

  const plan: RowPlan[] = hars.map((har, k) => ({
    rowId: take(k === 0 && targetId ? targetId : free((r) => r.har === null)),
    har,
    ...(traces[k] ? { trace: traces[k] } : {}),
  }));
  traces.slice(hars.length).forEach((trace, k) => {
    const rowId =
      k === 0 && hars.length === 0 && targetId
        ? targetId
        : (free((r) => r.har !== null && r.trace === null) ??
          free((r) => r.har === null && r.trace === null));
    plan.push({ rowId: take(rowId), trace });
  });
  return plan;
}
