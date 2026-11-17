import { useMemo, useState } from "react";
import {
  formatBytes,
  formatDelta,
  formatMs,
  rateDelta,
  requestPairChanged,
  shortUrl,
} from "@htv/core";
import type { PageRequestComparison, RequestChange, RequestPair, RequestSnapshot } from "@htv/core";
import { useRowWindow } from "../hooks/useRowWindow.js";
import { useMessages } from "../i18n/context.js";
import type { Messages } from "../i18n/en.js";
import { DeltaCell } from "./DeltasPanel.js";
import { DrawerBody } from "./Drawer.js";
import chipStyles from "./AnalysisPanel.module.css";
import metricsStyles from "./MetricsSummary.module.css";
import styles from "./RequestDeltas.module.css";

type Filter = "all" | "changed" | "added" | "removed";
const FILTERS: Filter[] = ["all", "changed", "added", "removed"];

type SortKey = "name" | "start" | "time" | "ttfb" | "size";
interface Sort {
  key: SortKey;
  /** "desc" puts the biggest change first on a delta, the end of the alphabet or the latest start
   * on the others. */
  direction: "asc" | "desc";
}
const DEFAULT_DIRECTION: Record<SortKey, Sort["direction"]> = {
  name: "asc",
  start: "asc",
  time: "desc",
  ttfb: "desc",
  size: "desc",
};
const BIGGEST_CHANGE: Sort = { key: "time", direction: "desc" };

/** A row of the table: a pair, or a request only one side made. */
interface Row {
  kind: "paired" | "added" | "removed";
  /** The request named and timed on the row: B's, or A's for a removed one. */
  shown: RequestSnapshot;
  a?: RequestSnapshot;
  b?: RequestSnapshot;
  pair?: RequestPair;
  name: string;
  /** B − A; an added request counts all its time and bytes, a removed one all of them less. */
  delta: { durationMs: number; ttfbMs: number; transferBytes: number };
}

const sideDelta = (r: RequestSnapshot, sign: 1 | -1) => ({
  durationMs: sign * r.durationMs,
  ttfbMs: sign * r.ttfbMs,
  transferBytes: sign * r.transferBytes,
});

// In the comparison's order: the biggest change of time first, then of bytes.
function rowsOf({ pairs, added, removed }: PageRequestComparison): Row[] {
  const rows: Row[] = [
    ...pairs.map((pair) => ({
      kind: "paired" as const,
      shown: pair.b,
      a: pair.a,
      b: pair.b,
      pair,
      name: shortUrl(pair.b.url),
      delta: pair.delta,
    })),
    ...added.map((b) => ({
      kind: "added" as const,
      shown: b,
      b,
      name: shortUrl(b.url),
      delta: sideDelta(b, 1),
    })),
    ...removed.map((a) => ({
      kind: "removed" as const,
      shown: a,
      a,
      name: shortUrl(a.url),
      delta: sideDelta(a, -1),
    })),
  ];
  return sortRows(rows, BIGGEST_CHANGE);
}

function sortValue(row: Row, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "start":
      return row.shown.startMs;
    case "time":
      return Math.abs(row.delta.durationMs);
    case "ttfb":
      return Math.abs(row.delta.ttfbMs);
    default:
      return Math.abs(row.delta.transferBytes);
  }
}

/** A copy of the rows sorted by a column; rows that tie keep their order. */
function sortRows(rows: Row[], { key, direction }: Sort): Row[] {
  const sign = direction === "desc" ? -1 : 1;
  const keyed = rows.map((row) => ({ row, value: sortValue(row, key) }));
  keyed.sort((x, y) => {
    // Biggest change: the bytes break a tie of time, as in the comparison.
    const tie =
      key === "time"
        ? Math.abs(y.row.delta.transferBytes) - Math.abs(x.row.delta.transferBytes)
        : 0;
    if (x.value < y.value) return -sign;
    if (x.value > y.value) return sign;
    return direction === "desc" ? tie : -tie;
  });
  return keyed.map(({ row }) => row);
}

const matches = (row: Row, filter: Filter) =>
  filter === "all" ||
  (filter === "changed"
    ? row.pair !== undefined && requestPairChanged(row.pair)
    : row.kind === filter);

const NONE = "—";

/** A side's value of an attribute, as the table shows it. */
function attribute(
  r: RequestSnapshot,
  change: RequestChange,
  source: Messages["deltas"]["source"]
): string {
  if (change === "cache") return source[r.cache];
  const value = r[change];
  return value === null ? NONE : String(value);
}

function AttributeCell({ row, change }: { row: Row; change: RequestChange }) {
  const t = useMessages().deltas;
  const { a, b } = row;
  if (a && b && row.pair?.changes.includes(change)) {
    return (
      <td className={styles.changed}>
        {`${attribute(a, change, t.source)} → ${attribute(b, change, t.source)}`}
        <span className={metricsStyles.srOnly}>{t.changed}</span>
      </td>
    );
  }
  return <td>{attribute(row.shown, change, t.source)}</td>;
}

const msDelta = (ms: number) => Math.round(ms);

function RequestRow({ row, index, ariaRow }: { row: Row; index: number; ariaRow?: number }) {
  const t = useMessages().deltas;
  const { a, b, pair } = row;
  const similar = pair?.match === "similar";
  const title = similar ? `A: ${a!.url}\nB: ${b!.url}` : row.shown.url;
  const time = msDelta(row.delta.durationMs);
  const ttfb = msDelta(row.delta.ttfbMs);
  const bytes = row.delta.transferBytes;
  return (
    <tr data-index={index} aria-rowindex={ariaRow}>
      {/* The marks go first, where a long name cut short cannot hide them. */}
      <th scope="row" className={styles.name} title={title}>
        {row.kind !== "paired" && (
          <>
            <span className={`${styles.badge} ${styles[row.kind]}`}>{t[row.kind]}</span>{" "}
          </>
        )}
        {similar && (
          <>
            <span className={styles.badge}>
              ≈<span className={metricsStyles.srOnly}>{t.similar}</span>
            </span>{" "}
          </>
        )}
        {row.name}
      </th>
      <td className={styles.num}>{formatMs(row.shown.startMs)}</td>
      <td className={styles.num}>{a ? formatMs(a.durationMs) : NONE}</td>
      <td className={styles.num}>{b ? formatMs(b.durationMs) : NONE}</td>
      <DeltaCell text={formatDelta(time, "ms")} rating={rateDelta(time)} />
      <DeltaCell text={formatDelta(ttfb, "ms")} rating={rateDelta(ttfb)} />
      <td className={styles.num}>{a ? formatBytes(a.transferBytes) : NONE}</td>
      <td className={styles.num}>{b ? formatBytes(b.transferBytes) : NONE}</td>
      <DeltaCell text={formatDelta(bytes, "bytes")} rating={rateDelta(bytes)} />
      <AttributeCell row={row} change="status" />
      <AttributeCell row={row} change="cache" />
      <AttributeCell row={row} change="protocol" />
      <AttributeCell row={row} change="priority" />
    </tr>
  );
}

// The columns after the request, each with its label and, for the sortable ones, its sort.
const COLUMNS: { label: keyof Messages["deltas"]; sort?: SortKey; num?: boolean }[] = [
  { label: "start", sort: "start", num: true },
  { label: "timeA", num: true },
  { label: "timeB", num: true },
  { label: "timeDelta", sort: "time", num: true },
  { label: "ttfbDelta", sort: "ttfb", num: true },
  { label: "sizeA", num: true },
  { label: "sizeB", num: true },
  { label: "sizeDelta", sort: "size", num: true },
  { label: "status" },
  { label: "cache" },
  { label: "protocol" },
  { label: "priority" },
];

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const t = useMessages().deltas;
  const active = sort.key === column;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={`${styles.sortBtn} ${active ? styles.sortBtnActive : ""}`}
        aria-label={t.sortBy[column]}
        onClick={() => onSort(column)}
      >
        {label}
        {active && <span aria-hidden="true">{sort.direction === "asc" ? " ↑" : " ↓"}</span>}
      </button>
    </th>
  );
}

/**
 * The requests of the two pages one by one: each pair with A's and B's time and size, B − A of
 * time, TTFB and size, and the status, cache, protocol and priority (A → B where they changed);
 * then the requests only B made (added) and only A made (removed). The biggest change of time
 * comes first; a chip narrows the rows, a header sorts them. A long list renders the rows near
 * the view only.
 */
export function RequestDeltas({ requests }: { requests: PageRequestComparison }) {
  const t = useMessages().deltas;
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>(BIGGEST_CHANGE);
  const all = useMemo(() => rowsOf(requests), [requests]);
  const rows = useMemo(
    () =>
      sortRows(
        all.filter((row) => matches(row, filter)),
        sort
      ),
    [all, filter, sort]
  );
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f, all.filter((row) => matches(row, f)).length])),
    [all]
  );
  const { items, windowed, setScroller, setList, setHeader } = useRowWindow({
    count: rows.length,
    expanded: null,
    arrows: false,
    resetKey: `${filter}:${sort.key}:${sort.direction}`,
    target: null,
  });
  const onSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: DEFAULT_DIRECTION[key] }
    );
  const similar = requests.pairs.filter((p) => p.match === "similar").length;
  const aria = (index: number) => (windowed ? index : undefined);

  return (
    <>
      <div className={chipStyles.views} role="group" aria-label={t.requestFilters}>
        {FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            className={`${chipStyles.chip} ${filter === name ? chipStyles.chipActive : ""}`}
            aria-pressed={filter === name}
            onClick={() => setFilter(name)}
          >
            {t.requestFilter[name]} {counts[name]}
          </button>
        ))}
      </div>
      <DrawerBody ref={setScroller} label={t.requestsCaption} className={styles.body}>
        <p className={styles.summary}>{t.pairedRequests(requests.pairs.length, similar)}</p>
        {rows.length === 0 ? (
          <p className={styles.summary}>{t.noRequests}</p>
        ) : (
          <table className={styles.table} aria-rowcount={aria(rows.length + 1)}>
            <caption className={metricsStyles.caption}>{t.requestsCaption}</caption>
            <thead ref={setHeader}>
              <tr aria-rowindex={aria(1)}>
                <SortHeader
                  label={t.request}
                  column="name"
                  sort={sort}
                  onSort={onSort}
                  className={styles.name}
                />
                {COLUMNS.map(({ label, sort: column, num }) =>
                  column ? (
                    <SortHeader
                      key={label}
                      label={t[label] as string}
                      column={column}
                      sort={sort}
                      onSort={onSort}
                      className={styles.num}
                    />
                  ) : (
                    <th key={label} scope="col" className={num ? styles.num : undefined}>
                      {t[label] as string}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody ref={setList}>
              {items.map((item) =>
                item.kind === "gap" ? (
                  <tr key={item.key} className={styles.gap} aria-hidden="true">
                    <td colSpan={COLUMNS.length + 1} style={{ height: item.height }} />
                  </tr>
                ) : (
                  <RequestRow
                    key={`${rows[item.index].kind}:${rows[item.index].shown.entryIndex}`}
                    row={rows[item.index]}
                    index={item.index}
                    ariaRow={aria(item.index + 2)}
                  />
                )
              )}
            </tbody>
          </table>
        )}
      </DrawerBody>
    </>
  );
}
