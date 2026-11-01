import { useId, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import {
  buildWaterfall,
  filterWaterfallRows,
  formatBytes,
  formatMs,
  waterfallAxisMs,
} from "@htv/core";
import type {
  ParsedHar,
  ParsedTrace,
  ResourceType,
  WaterfallAxis,
  WaterfallFilter,
  WaterfallMarks,
  WaterfallParty,
  WaterfallPhases,
  WaterfallRow,
} from "@htv/core";
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

const PHASES: { key: keyof WaterfallPhases; label: string }[] = [
  { key: "blocked", label: "Blocked" },
  { key: "dns", label: "DNS" },
  { key: "connect", label: "Connect" },
  { key: "ssl", label: "TLS" },
  { key: "send", label: "Send" },
  { key: "wait", label: "Wait" },
  { key: "receive", label: "Receive" },
];

const MARKS: { key: keyof WaterfallMarks; label: string; name: string }[] = [
  { key: "ttfb", label: "TTFB", name: "TTFB" },
  { key: "fcp", label: "FCP", name: "FCP" },
  { key: "lcp", label: "LCP", name: "LCP" },
  { key: "dcl", label: "DCL", name: "DCL" },
  { key: "onLoad", label: "Load", name: "onLoad" },
];

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
      {PHASES.map(({ key }) => {
        const ms = row.phases[key];
        return ms ? (
          <span key={key} className={styles[`phase_${key}`]} style={{ flexGrow: ms }} />
        ) : null;
      })}
    </span>
  );
}

function Tooltip({ row, id }: { row: WaterfallRow; id: string }) {
  const facts = [
    row.status > 0 ? String(row.status) : null,
    row.resourceType,
    row.priority ? `${row.priority} priority` : null,
    row.fromCache ? `${row.fromCache} cache` : formatBytes(row.transferSize),
  ].filter(Boolean);
  const notes = [
    row.isLcpResource ? "LCP resource" : null,
    row.renderBlocking ? "Render-blocking" : null,
  ].filter(Boolean);
  return (
    <span className={styles.tooltip} role="tooltip" id={id}>
      <span className={styles.tooltipUrl}>{row.url}</span>
      {row.redirectURL && <span className={styles.tooltipMeta}>→ {row.redirectURL}</span>}
      <span className={styles.tooltipMeta}>{facts.join(" · ")}</span>
      <span className={styles.tooltipMeta}>
        Starts at {formatMs(row.startMs)} · takes {formatMs(row.endMs - row.startMs)}
      </span>
      {notes.length > 0 && <span className={styles.tooltipNote}>{notes.join(" · ")}</span>}
      <span className={styles.tooltipPhases}>
        {PHASES.map(({ key, label }) => (
          <span key={key} className={styles.tooltipPhase}>
            <span className={`${styles.swatch} ${styles[`phase_${key}`]}`} aria-hidden="true" />
            <span>{label}</span>
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
          {row.isLcpResource && (
            <span className={`${styles.badge} ${styles.badgeLcp}`} title="LCP resource">
              LCP
            </span>
          )}
          {row.renderBlocking && (
            <span className={`${styles.badge} ${styles.badgeBlocking}`} title="Render-blocking">
              RB
            </span>
          )}
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

function Ruler({ marks, totalMs }: { marks: PlacedMark[]; totalMs: number }) {
  const lanes = Math.max(1, ...marks.map((m) => m.lane + 1));
  const name = `Time ruler: ${MARKS.flatMap(({ key, name }) => {
    const mark = marks.find((m) => m.key === key);
    return mark ? [`${name} ${formatMs(mark.ms)}`] : [];
  }).join(", ")}`;
  return (
    <div className={styles.rulerRow}>
      <span className={styles.headCell}>Name</span>
      <span className={styles.headCell}>Type</span>
      <span className={styles.headCell}>Status</span>
      <span className={`${styles.headCell} ${styles.size}`}>Size</span>
      <div
        className={styles.ruler}
        role="img"
        aria-label={name}
        style={{ "--lanes": lanes } as CSSProperties}
      >
        {ticks(totalMs)
          .filter((t) => pct(t, totalMs) <= AXIS_END_PCT)
          .map((t) => (
            <span key={t} className={styles.tick} style={{ left: `${pct(t, totalMs)}%` }}>
              {formatMs(t)}
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
 * The page's requests on one time axis: a filter bar (type, party, host, URL text), a ruler
 * with the page's marks (TTFB, FCP, LCP, DCL, onLoad) and one row per request, its bar split
 * into phases. The axis spans the whole recording or zooms on the page load. Renders 300 rows
 * at a time.
 */
export function WaterfallPanel({ har, trace, pageLabel, onClose }: Props) {
  const waterfall = useMemo(() => buildWaterfall(har, trace), [har, trace]);
  const [filter, setFilterState] = useState<WaterfallFilter>({});
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [activeRow, setActiveRow] = useState<number | null>(null);
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
    return TYPE_ORDER.filter((t) => present.has(t));
  }, [allRows]);
  const hosts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allRows) counts.set(row.host, (counts.get(row.host) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([host]) => host);
  }, [allRows]);
  const rows = useMemo(() => filterWaterfallRows(allRows, filter), [allRows, filter]);
  const marks = useMemo(() => placeMarks(waterfall.marks, totalMs), [waterfall.marks, totalMs]);
  const shown = rows.slice(0, limit);

  const setFilter = (change: Partial<WaterfallFilter>) => {
    setFilterState((current) => ({ ...current, ...change }));
    setLimit(PAGE_SIZE);
  };
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
          <span className={styles.headerTitle}>Waterfall</span>
          <h2 className={styles.pageLabel}>{pageLabel}</h2>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close waterfall">
          ✕
        </button>
      </div>
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label="Resource types">
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
            <span className={styles.fieldLabel}>Party</span>
            <select
              id={partyId}
              className={styles.select}
              value={filter.party ?? ""}
              onChange={(e) =>
                setFilter({ party: (e.target.value || undefined) as WaterfallParty | undefined })
              }
            >
              <option value="">All</option>
              <option value="first">First party</option>
              <option value="third">Third party</option>
            </select>
          </label>
          <label className={styles.field} htmlFor={hostId}>
            <span className={styles.fieldLabel}>Host</span>
            <select
              id={hostId}
              className={styles.select}
              value={filter.host ?? ""}
              onChange={(e) => setFilter({ host: e.target.value || undefined })}
            >
              <option value="">All hosts</option>
              {hosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field} htmlFor={axisId}>
            <span className={styles.fieldLabel}>Axis</span>
            <select
              id={axisId}
              className={styles.select}
              value={axis}
              onChange={(e) => setAxis(e.target.value as WaterfallAxis)}
            >
              <option value="end">Whole recording</option>
              <option value="load">Page load</option>
            </select>
          </label>
          <input
            id={searchId}
            className={styles.search}
            type="search"
            aria-label="Search URLs"
            placeholder="Filter URLs"
            value={filter.search ?? ""}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
        </div>
        <div className={styles.legend} aria-hidden="true">
          {PHASES.map(({ key, label }) => (
            <span key={key} className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles[`phase_${key}`]}`} />
              {label}
            </span>
          ))}
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.swatchCached}`} />
            Cache hit
          </span>
        </div>
        <p className={styles.count} aria-live="polite">
          {rows.length === allRows.length
            ? `${allRows.length} requests`
            : `${rows.length} of ${allRows.length} requests`}
        </p>
      </div>
      {/* Scrollable region must be keyboard focusable (WCAG 2.1.1, axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label="Waterfall details" tabIndex={0}>
        <div className={styles.table}>
          <Ruler marks={marks} totalMs={totalMs} />
          <div className={styles.markLines} aria-hidden="true">
            {marks.map((mark) => (
              <span
                key={mark.key}
                className={`${styles.markLine} ${styles[`mark_${mark.key}`]}`}
                style={at(mark.at)}
              />
            ))}
          </div>
          {rows.length === 0 ? (
            <p className={styles.empty}>No request matches the filters.</p>
          ) : (
            <ol className={styles.rows} aria-label={`Requests, ${rows.length}`}>
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
              {`Show ${Math.min(PAGE_SIZE, rows.length - shown.length)} more (${rows.length - shown.length} left)`}
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
  return (
    <button
      className={`${className} ${active ? activeClassName : ""}`}
      onClick={onClick}
      aria-label="Toggle waterfall"
      aria-expanded={active}
      title="Request waterfall"
    >
      Waterfall
    </button>
  );
}
