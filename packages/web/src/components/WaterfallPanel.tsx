import { useId, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import {
  RESOURCE_QUERY_HELP,
  buildWaterfall,
  filterWaterfallRows,
  formatBytes,
  formatMs,
  parseResourceQuery,
  sortWaterfallRows,
  waterfallAxisMs,
} from "@htv/core";
import type {
  ParsedHar,
  ParsedTrace,
  ResourceSort,
  ResourceSortKey,
  ResourceType,
  WaterfallAxis,
  WaterfallFilter,
  WaterfallMarks,
  WaterfallParty,
  WaterfallPhases,
  WaterfallRow,
} from "@htv/core";
import { useMessages } from "../i18n/context.js";
import styles from "./WaterfallPanel.module.css";

interface Props {
  har: ParsedHar;
  trace?: ParsedTrace;
  pageLabel: string;
  onClose: () => void;
}

// Rows rendered at once: a 10 000-request HAR renders its first rows and waits for "Show more".
const PAGE_SIZE = 300;
// Mark labels closer than this share of the axis (in %) go on separate lanes of the ruler;
// marks at the same millisecond share one label ("FCP · LCP").
const LABEL_GAP_PCT = 9;
// Labels and ticks this close to the end of the axis (in %) would run past it: mark labels
// turn to its left, ticks are left out.
const AXIS_END_PCT = 88;

const TYPE_ORDER: ResourceType[] = [
  "document",
  "stylesheet",
  "script",
  "font",
  "image",
  "fetch",
  "other",
];

const PHASES: (keyof WaterfallPhases)[] = [
  "blocked",
  "dns",
  "connect",
  "ssl",
  "send",
  "wait",
  "receive",
];

const MARKS: { key: keyof WaterfallMarks; label: string; name: string }[] = [
  { key: "ttfb", label: "TTFB", name: "TTFB" },
  { key: "fcp", label: "FCP", name: "FCP" },
  { key: "lcp", label: "LCP", name: "LCP" },
  { key: "dcl", label: "DCL", name: "DCL" },
  { key: "onLoad", label: "Load", name: "onLoad" },
];

// The columns of the table view, which also name the sorts: the measures start largest
// first, the names and categories in their order.
const COLUMNS: { key: ResourceSortKey; numeric: boolean }[] = [
  { key: "name", numeric: false },
  { key: "type", numeric: false },
  { key: "status", numeric: false },
  { key: "priority", numeric: false },
  { key: "protocol", numeric: false },
  { key: "encoding", numeric: false },
  { key: "size", numeric: true },
  { key: "ttfb", numeric: true },
  { key: "time", numeric: true },
  { key: "start", numeric: true },
];
const DEFAULT_DIRECTION: Record<ResourceSortKey, ResourceSort["direction"]> = {
  start: "asc",
  name: "asc",
  host: "asc",
  type: "asc",
  status: "desc",
  priority: "asc",
  protocol: "asc",
  encoding: "asc",
  size: "desc",
  ttfb: "desc",
  time: "desc",
};
const START_ORDER: ResourceSort = { key: "start", direction: "asc" };

/**
 * The sort after a click on a column: the column in its starting direction, reversed on a
 * second click, and the start order on a third.
 */
function cycleSort(current: ResourceSort, key: ResourceSortKey): ResourceSort {
  if (current.key !== key) return { key, direction: DEFAULT_DIRECTION[key] };
  if (current.direction === DEFAULT_DIRECTION[key]) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return START_ORDER;
}

type View = "waterfall" | "table";

const NONE = "—";

const pct = (ms: number, totalMs: number) => (totalMs > 0 ? (ms / totalMs) * 100 : 0);

/** Ruler ticks at a round step (1, 2 or 5 × 10ⁿ ms), about six of them. */
function ticks(totalMs: number): number[] {
  if (totalMs <= 0) return [0];
  const rough = totalMs / 6;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const out: number[] = [];
  for (let t = 0; t <= totalMs; t += step) out.push(t);
  return out;
}

interface PlacedMark {
  key: keyof WaterfallMarks;
  label: string;
  name: string;
  ms: number;
  at: number; // % of the axis
  lane: number;
  // The label drawn for this mark and the ones at the same time; null when an earlier mark
  // at the same time carries it.
  text: string | null;
}

/** The marks the page has, in time order, each on the first ruler lane where its label fits. */
function placeMarks(marks: WaterfallMarks, totalMs: number): PlacedMark[] {
  const present = MARKS.flatMap((mark) => {
    const ms = marks[mark.key];
    return ms === null
      ? []
      : [{ ...mark, ms, at: pct(ms, totalMs), lane: 0, text: mark.label as string | null }];
  }).sort((a, b) => a.ms - b.ms);
  const laneEnds: number[] = [];
  let labelled: PlacedMark | null = null;
  for (const mark of present) {
    if (labelled && Math.round(labelled.ms) === Math.round(mark.ms)) {
      labelled.text = `${labelled.text} · ${mark.label}`;
      mark.text = null;
      mark.lane = labelled.lane;
      continue;
    }
    // One lane per mark at most, so that no two labels overlap.
    let lane = laneEnds.findIndex((end) => mark.at - end >= LABEL_GAP_PCT);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = mark.at;
    mark.lane = lane;
    labelled = mark;
  }
  return present;
}

function sizeText(row: WaterfallRow): string {
  if (row.fromCache) return row.fromCache;
  return formatBytes(row.transferSize);
}

const at = (value: number): CSSProperties => ({ "--at": value / 100 }) as CSSProperties;

function Bar({ row, totalMs }: { row: WaterfallRow; totalMs: number }) {
  const style: CSSProperties = {
    left: `${pct(row.startMs, totalMs)}%`,
    width: `${pct(row.endMs - row.startMs, totalMs)}%`,
  };
  if (row.fromCache) return <span className={`${styles.bar} ${styles.barCached}`} style={style} />;
  return (
    <span className={styles.bar} style={style}>
      {PHASES.map((key) => {
        const ms = row.phases[key];
        return ms ? (
          <span key={key} className={styles[`phase_${key}`]} style={{ flexGrow: ms }} />
        ) : null;
      })}
    </span>
  );
}

function Tooltip({ row, id }: { row: WaterfallRow; id: string }) {
  const t = useMessages().waterfall;
  const facts = [
    row.status > 0 ? String(row.status) : null,
    row.resourceType,
    row.priority ? t.priority(row.priority) : null,
    row.fromCache ? t.cachedFrom(row.fromCache) : formatBytes(row.transferSize),
  ].filter(Boolean);
  const notes = [
    row.isLcpResource ? t.lcpResource : null,
    row.renderBlocking ? t.renderBlocking : null,
  ].filter(Boolean);
  return (
    <span className={styles.tooltip} role="tooltip" id={id}>
      <span className={styles.tooltipUrl}>{row.url}</span>
      {row.redirectURL && <span className={styles.tooltipMeta}>→ {row.redirectURL}</span>}
      <span className={styles.tooltipMeta}>{facts.join(" · ")}</span>
      <span className={styles.tooltipMeta}>
        {t.timing(formatMs(row.startMs), formatMs(row.endMs - row.startMs))}
      </span>
      {notes.length > 0 && <span className={styles.tooltipNote}>{notes.join(" · ")}</span>}
      <span className={styles.tooltipPhases}>
        {PHASES.map((key) => (
          <span key={key} className={styles.tooltipPhase}>
            <span className={`${styles.swatch} ${styles[`phase_${key}`]}`} aria-hidden="true" />
            <span>{t.phases[key]}</span>
            <span className={styles.tooltipValue}>{formatMs(row.phases[key])}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** Arrow keys, Home and End move the focus between the rows' buttons. */
function focusSibling(event: KeyboardEvent<HTMLButtonElement>) {
  const item = event.currentTarget.parentElement;
  const list = item?.parentElement;
  const target = {
    ArrowDown: item?.nextElementSibling,
    ArrowUp: item?.previousElementSibling,
    Home: list?.firstElementChild,
    End: list?.lastElementChild,
  }[event.key];
  if (target === undefined) return;
  // Handled here, so the diagram's Home/End step shortcuts leave it alone.
  event.preventDefault();
  target?.querySelector("button")?.focus();
}

function Row({
  row,
  totalMs,
  active,
  onActivate,
  onDeactivate,
}: {
  row: WaterfallRow;
  totalMs: number;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const tooltipId = useId();
  // A button per row: the keyboard reaches the tooltip like the pointer does, and a tap shows
  // it on touch screens. The tooltip sits beside the button, out of its accessible name.
  return (
    <li className={styles.item}>
      <button
        type="button"
        className={`${styles.row} ${active ? styles.rowActive : ""}`}
        aria-describedby={active ? tooltipId : undefined}
        onMouseEnter={onActivate}
        onMouseLeave={onDeactivate}
        onFocus={onActivate}
        onBlur={onDeactivate}
        onClick={onActivate}
        onKeyDown={focusSibling}
      >
        <span className={styles.name}>
          <span className={styles.nameText} data-name>
            {row.shortName}
          </span>
          <Badges row={row} />
        </span>
        <span className={styles.cell}>{row.resourceType}</span>
        <span className={`${styles.cell} ${row.status >= 400 ? styles.statusError : ""}`}>
          {row.status > 0 ? row.status : "—"}
        </span>
        <span className={`${styles.cell} ${styles.size}`}>{sizeText(row)}</span>
        <span className={styles.track}>
          <Bar row={row} totalMs={totalMs} />
        </span>
      </button>
      {active && <Tooltip row={row} id={tooltipId} />}
    </li>
  );
}

/** A column header that sorts the rows: its label, and an arrow when it is the sort. */
function SortButton({
  column,
  sort,
  onSort,
}: {
  column: ResourceSortKey;
  sort: ResourceSort;
  onSort: (key: ResourceSortKey) => void;
}) {
  const t = useMessages().waterfall;
  const active = sort.key === column;
  const label = t.columns[column];
  return (
    <button
      type="button"
      className={`${styles.sortBtn} ${active ? styles.sortBtnActive : ""}`}
      aria-label={t.sortBy(label)}
      onClick={() => onSort(column)}
    >
      {label}
      {active && <span aria-hidden="true">{sort.direction === "asc" ? " ↑" : " ↓"}</span>}
    </button>
  );
}

function Badges({ row }: { row: WaterfallRow }) {
  const t = useMessages().waterfall;
  return (
    <>
      {row.isLcpResource && (
        <span className={`${styles.badge} ${styles.badgeLcp}`} title={t.lcpResource}>
          LCP
        </span>
      )}
      {row.renderBlocking && (
        <span className={`${styles.badge} ${styles.badgeBlocking}`} title={t.renderBlocking}>
          RB
        </span>
      )}
    </>
  );
}

/** The requests as a table, one column per field, each header sorting the rows. */
function Table({
  rows,
  count,
  sort,
  onSort,
}: {
  rows: WaterfallRow[];
  count: number;
  sort: ResourceSort;
  onSort: (key: ResourceSortKey) => void;
}) {
  const t = useMessages().waterfall;
  return (
    <table className={styles.grid} aria-label={t.requests(count)}>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={column.numeric ? styles.num : undefined}
              aria-sort={
                sort.key === column.key
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <SortButton column={column.key} sort={sort} onSort={onSort} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.entryIndex}>
            <td className={styles.nameCell} title={row.url}>
              <span className={styles.name}>
                <span className={styles.nameText} data-name>
                  {row.shortName}
                </span>
                <Badges row={row} />
              </span>
            </td>
            <td>{row.resourceType}</td>
            <td className={row.status >= 400 ? styles.statusError : undefined}>
              {row.status > 0 ? row.status : NONE}
            </td>
            <td>{row.priority ?? NONE}</td>
            <td>{row.httpVersion && row.httpVersion !== "unknown" ? row.httpVersion : NONE}</td>
            <td>{row.contentEncoding ?? NONE}</td>
            <td className={styles.num}>{sizeText(row)}</td>
            <td className={styles.num}>{formatMs(row.ttfbMs)}</td>
            <td className={styles.num}>{formatMs(row.endMs - row.startMs)}</td>
            <td className={styles.num}>{formatMs(row.startMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The fields of the filter language, behind a disclosure. */
function FilterHelp() {
  const t = useMessages().waterfall;
  return (
    <details className={styles.help}>
      <summary className={styles.helpSummary}>{t.filterSyntax}</summary>
      <div className={styles.helpBody}>
        <p className={styles.helpText}>
          {t.helpWords} <code>field:value</code> {t.helpField} <code>-</code> {t.helpNegate}
        </p>
        <table className={styles.helpTable}>
          <thead>
            <tr>
              <th scope="col">{t.field}</th>
              <th scope="col">{t.values}</th>
              <th scope="col">{t.example}</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_QUERY_HELP.map((help) => (
              <tr key={help.field}>
                <td>
                  <code>{help.field}</code>
                </td>
                <td>{help.values}</td>
                <td>
                  <code>{help.example}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Ruler({
  marks,
  totalMs,
  sort,
  onSort,
}: {
  marks: PlacedMark[];
  totalMs: number;
  sort: ResourceSort;
  onSort: (key: ResourceSortKey) => void;
}) {
  const t = useMessages().waterfall;
  const lanes = Math.max(1, ...marks.map((m) => m.lane + 1));
  const name = t.ruler(
    MARKS.flatMap(({ key, name }) => {
      const mark = marks.find((m) => m.key === key);
      return mark ? [`${name} ${formatMs(mark.ms)}`] : [];
    }).join(", ")
  );
  return (
    <div className={styles.rulerRow}>
      {(["name", "type", "status", "size"] as const).map((key) => (
        <span key={key} className={`${styles.headCell} ${key === "size" ? styles.size : ""}`}>
          <SortButton column={key} sort={sort} onSort={onSort} />
        </span>
      ))}
      <div
        className={styles.ruler}
        role="img"
        aria-label={name}
        style={{ "--lanes": lanes } as CSSProperties}
      >
        {ticks(totalMs)
          .filter((tick) => pct(tick, totalMs) <= AXIS_END_PCT)
          .map((tick) => (
            <span key={tick} className={styles.tick} style={{ left: `${pct(tick, totalMs)}%` }}>
              {formatMs(tick)}
            </span>
          ))}
        {marks.map((mark) =>
          mark.text === null ? null : (
            <span
              key={mark.key}
              className={`${styles.markLabel} ${styles[`mark_${mark.key}`]} ${mark.at > AXIS_END_PCT ? styles.markLabelEnd : ""}`}
              style={{ left: `${mark.at}%`, "--lane": mark.lane } as CSSProperties}
            >
              {mark.text}
            </span>
          )
        )}
      </div>
    </div>
  );
}

/**
 * The page's requests on one time axis: a filter bar (type, party, host, and a query in the
 * field language of parseResourceQuery), a ruler with the page's marks (TTFB, FCP, LCP, DCL,
 * onLoad) and one row per request, its bar split into phases, or the same requests as a
 * table with their priority, protocol, encoding and timings. The column headers sort the
 * rows. The axis spans the whole recording or zooms on the page load. Renders 300 rows at a
 * time.
 */
export function WaterfallPanel({ har, trace, pageLabel, onClose }: Props) {
  const t = useMessages().waterfall;
  const waterfall = useMemo(() => buildWaterfall(har, trace), [har, trace]);
  const [filter, setFilterState] = useState<WaterfallFilter>({});
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [sort, setSort] = useState<ResourceSort>(START_ORDER);
  const [view, setView] = useState<View>("waterfall");
  const searchId = useId();
  const partyId = useId();
  const hostId = useId();
  const axisId = useId();
  const [axis, setAxis] = useState<WaterfallAxis>("end");

  const { rows: allRows } = waterfall;
  // The axis every bar and mark is drawn on: the whole recording, or zoomed on the load.
  const totalMs = waterfallAxisMs(waterfall, axis);
  const types = useMemo(() => {
    const present = new Set(allRows.map((r) => r.resourceType));
    return TYPE_ORDER.filter((type) => present.has(type));
  }, [allRows]);
  const hosts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allRows) counts.set(row.host, (counts.get(row.host) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([host]) => host);
  }, [allRows]);
  const rows = useMemo(
    () => sortWaterfallRows(filterWaterfallRows(allRows, filter), sort),
    [allRows, filter, sort]
  );
  const problems = useMemo(() => parseResourceQuery(filter.search ?? "").problems, [filter.search]);
  const marks = useMemo(() => placeMarks(waterfall.marks, totalMs), [waterfall.marks, totalMs]);
  const shown = rows.slice(0, limit);

  const setFilter = (change: Partial<WaterfallFilter>) => {
    setFilterState((current) => ({ ...current, ...change }));
    setLimit(PAGE_SIZE);
  };
  const onSort = (key: ResourceSortKey) => setSort((current) => cycleSort(current, key));
  const sortText =
    sort.key === START_ORDER.key && sort.direction === START_ORDER.direction
      ? ""
      : t.sortedBy(t.columns[sort.key], sort.direction === "asc" ? "↑" : "↓");
  const toggleType = (type: ResourceType) => {
    const selected = new Set(filter.types ?? []);
    if (selected.has(type)) selected.delete(type);
    else selected.add(type);
    setFilter({ types: [...selected] });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.headerTitle}>{t.title}</span>
          <h2 className={styles.pageLabel}>{pageLabel}</h2>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label={t.types}>
          {types.map((type) => {
            const pressed = filter.types?.includes(type) ?? false;
            return (
              <button
                key={type}
                type="button"
                className={`${styles.chip} ${pressed ? styles.chipActive : ""}`}
                aria-pressed={pressed}
                onClick={() => toggleType(type)}
              >
                {type}
              </button>
            );
          })}
        </div>
        <div className={styles.fields}>
          <label className={styles.field} htmlFor={partyId}>
            <span className={styles.fieldLabel}>{t.party}</span>
            <select
              id={partyId}
              className={styles.select}
              value={filter.party ?? ""}
              onChange={(e) =>
                setFilter({ party: (e.target.value || undefined) as WaterfallParty | undefined })
              }
            >
              <option value="">{t.allParties}</option>
              <option value="first">{t.firstParty}</option>
              <option value="third">{t.thirdParty}</option>
            </select>
          </label>
          <label className={styles.field} htmlFor={hostId}>
            <span className={styles.fieldLabel}>{t.host}</span>
            <select
              id={hostId}
              className={styles.select}
              value={filter.host ?? ""}
              onChange={(e) => setFilter({ host: e.target.value || undefined })}
            >
              <option value="">{t.allHosts}</option>
              {hosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field} htmlFor={axisId}>
            <span className={styles.fieldLabel}>{t.axis}</span>
            <select
              id={axisId}
              className={styles.select}
              value={axis}
              onChange={(e) => setAxis(e.target.value as WaterfallAxis)}
            >
              <option value="end">{t.wholeRecording}</option>
              <option value="load">{t.pageLoad}</option>
            </select>
          </label>
          <input
            id={searchId}
            className={styles.search}
            type="search"
            aria-label={t.filter}
            placeholder={t.filterPlaceholder}
            value={filter.search ?? ""}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
          <FilterHelp />
        </div>
        {problems.length > 0 && (
          <p className={styles.problems} role="status">
            {problems.join(" · ")}
          </p>
        )}
        <div className={styles.legend} aria-hidden="true">
          {PHASES.map((key) => (
            <span key={key} className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles[`phase_${key}`]}`} />
              {t.phases[key]}
            </span>
          ))}
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.swatchCached}`} />
            {t.cacheHit}
          </span>
        </div>
        <div className={styles.status}>
          <p className={styles.count} aria-live="polite">
            {`${t.count(rows.length, allRows.length)}${sortText}`}
          </p>
          <div className={styles.chips} role="group" aria-label={t.view}>
            {(["waterfall", "table"] as const).map((name) => (
              <button
                key={name}
                type="button"
                className={`${styles.chip} ${view === name ? styles.chipActive : ""}`}
                aria-pressed={view === name}
                onClick={() => setView(name)}
              >
                {name === "waterfall" ? t.waterfallView : t.tableView}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* Scrollable region must be keyboard focusable (WCAG 2.1.1, axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label={t.details} tabIndex={0}>
        <div className={view === "table" ? styles.tableView : styles.table}>
          {view === "waterfall" && (
            <>
              <Ruler marks={marks} totalMs={totalMs} sort={sort} onSort={onSort} />
              <div className={styles.markLines} aria-hidden="true">
                {marks.map((mark) => (
                  <span
                    key={mark.key}
                    className={`${styles.markLine} ${styles[`mark_${mark.key}`]}`}
                    style={at(mark.at)}
                  />
                ))}
              </div>
            </>
          )}
          {rows.length === 0 ? (
            <p className={styles.empty}>{t.empty}</p>
          ) : view === "table" ? (
            <Table rows={shown} count={rows.length} sort={sort} onSort={onSort} />
          ) : (
            <ol className={styles.rows} aria-label={t.requests(rows.length)}>
              {shown.map((row) => (
                <Row
                  key={row.entryIndex}
                  row={row}
                  totalMs={totalMs}
                  active={activeRow === row.entryIndex}
                  onActivate={() => setActiveRow(row.entryIndex)}
                  onDeactivate={() =>
                    setActiveRow((current) => (current === row.entryIndex ? null : current))
                  }
                />
              ))}
            </ol>
          )}
          {rows.length > shown.length && (
            <button
              type="button"
              className={styles.more}
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
            >
              {t.showMore(
                Math.min(PAGE_SIZE, rows.length - shown.length),
                rows.length - shown.length
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The toolbar button that opens the waterfall. */
export function WaterfallButton({
  active,
  onClick,
  className,
  activeClassName,
}: {
  active: boolean;
  onClick: () => void;
  className: string;
  activeClassName: string;
}) {
  const t = useMessages().waterfall;
  return (
    <button
      className={`${className} ${active ? activeClassName : ""}`}
      onClick={onClick}
      aria-label={t.toggle}
      aria-expanded={active}
      title={t.buttonTitle}
    >
      {t.title}
    </button>
  );
}
