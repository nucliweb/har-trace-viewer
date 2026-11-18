import { useId } from "react";
import type { ReactNode } from "react";
import { shortUrl } from "@htv/core";
import { useMessages } from "../../i18n/context.js";
import styles from "../AnalysisPanel.module.css";

/** A titled part of a view: an h3, then what it holds. */
export function Section({
  title,
  children,
}: {
  title: string;
  /** Gets the heading's id, for the table it names. */
  children: (headingId: string) => ReactNode;
}) {
  const id = useId();
  return (
    <>
      <h3 className={styles.title} id={id}>
        {title}
      </h3>
      {children(id)}
    </>
  );
}

interface Column {
  label: string;
  title?: string;
  /** A number column, right-aligned. */
  num?: boolean;
}

interface TableProps<T> {
  head: Column[];
  rows: T[];
  /** The cells of a row, one per column. */
  cells: (row: T, index: number) => ReactNode[];
  /** The column that heads each row. */
  rowHeader?: number;
}

/** A table that scrolls sideways inside the drawer when it is wider than the screen. */
export function Table<T>({
  head,
  rows,
  cells,
  rowHeader = 0,
  labelledBy,
  caption,
}: TableProps<T> & { labelledBy?: string; caption?: string }) {
  const num = (column: number) => (head[column]?.num ? styles.num : undefined);
  return (
    <div className={styles.scroll}>
      <table className={styles.table} aria-labelledby={labelledBy}>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {head.map((column, i) => (
              <th key={column.label} scope="col" title={column.title} className={num(i)}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {cells(row, r).map((cell, i) =>
                i === rowHeader ? (
                  <th key={i} scope="row" className={num(i)}>
                    {cell}
                  </th>
                ) : (
                  <td key={i} className={num(i)}>
                    {cell}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A titled table, or a sentence under the title when it would be empty. */
export function TableSection<T>({
  title,
  empty,
  ...table
}: TableProps<T> & { title: string; empty?: string }) {
  const t = useMessages().analysis;
  return (
    <Section title={title}>
      {(id) =>
        table.rows.length === 0 ? <p>{empty ?? t.none}</p> : <Table labelledBy={id} {...table} />
      }
    </Section>
  );
}

/** A request's short name, the whole URL on hover. */
export function Url({ url }: { url: string }) {
  return <span title={url}>{shortUrl(url)}</span>;
}
