import { rateDelta, rateMetric } from "@htv/core";
import type {
  ComparedMetric,
  ComparisonCaveat,
  DeltaRating,
  FlowComparison,
  HopPair,
} from "@htv/core";
import { formatBytes, formatDelta, formatDeltaPct, formatMs } from "../lib/format.js";
import type { DeltaUnit } from "../lib/format.js";
import { RATING_CLASS, RATING_TEXT } from "./MetricsSummary.js";
import metricsStyles from "./MetricsSummary.module.css";
import hopsStyles from "./HopsPanel.module.css";
import styles from "./DeltasPanel.module.css";

interface Props {
  comparison: FlowComparison;
  /** Names of flow A and flow B, shown in the column headers. */
  names: { a: string; b: string };
  onClose: () => void;
}

const UNITS: Record<ComparedMetric, DeltaUnit> = {
  ttfb: "ms",
  fcp: "ms",
  lcp: "ms",
  cls: "score",
  inp: "ms",
  dcl: "ms",
  onLoad: "ms",
  requests: "count",
  bytes: "bytes",
  cdnHitRatio: "ratio",
  browserCacheHitRatio: "ratio",
};

function formatValue(unit: DeltaUnit, value: number | null): string {
  if (value === null) return "n/a";
  switch (unit) {
    case "ms":
      return formatMs(value);
    case "bytes":
      return formatBytes(value);
    case "ratio":
      return `${Math.round(value * 100)}%`;
    case "score":
      return value.toFixed(3);
    default:
      return String(value);
  }
}

/** B against A: better reads like a good rating, worse like a poor one. */
export const DELTA_CLASS: Record<DeltaRating, string> = {
  better: metricsStyles.good,
  worse: metricsStyles.poor,
  same: styles.same,
  none: "",
};

const DELTA_TEXT: Record<DeltaRating, string> = {
  better: "better",
  worse: "worse",
  same: "no change",
  none: "",
};

/** A delta cell: the signed value, its rating colour and the rating in words for screen readers. */
export function DeltaCell({ text, rating }: { text: string; rating: DeltaRating }) {
  return (
    <td className={`${hopsStyles.num} ${DELTA_CLASS[rating]}`} data-rating={rating}>
      {text}
      {rating !== "none" && rating !== "same" && (
        <span className={metricsStyles.srOnly}>{` (${DELTA_TEXT[rating]})`}</span>
      )}
    </td>
  );
}

function HopRow({ pair }: { pair: HopPair }) {
  const { a, b, sameUrls } = pair;
  const requests = (b?.requests ?? 0) - (a?.requests ?? 0);
  // Over the URLs both flows requested: averages over all requests mix different resources.
  const ttfb = sameUrls ? Math.round(sameUrls.delta) : null;
  const provider = (b ?? a)!.provider;
  return (
    <tr>
      <th scope="row" className={hopsStyles.host}>
        <span
          className={`${hopsStyles.dot} ${hopsStyles[`dot_${provider}`] ?? ""}`}
          aria-hidden="true"
        />
        {pair.host}
      </th>
      <td className={hopsStyles.num}>{a?.requests ?? 0}</td>
      <td className={hopsStyles.num}>{b?.requests ?? 0}</td>
      <DeltaCell text={formatDelta(requests, "count")} rating={rateDelta(requests)} />
      <td className={hopsStyles.num}>{a ? formatMs(a.avgTtfbMs) : "—"}</td>
      <td className={hopsStyles.num}>{b ? formatMs(b.avgTtfbMs) : "—"}</td>
      <td
        className={hopsStyles.num}
        title={
          sameUrls
            ? `Avg TTFB over these requests: ${formatMs(sameUrls.avgTtfbA)} → ${formatMs(sameUrls.avgTtfbB)}`
            : undefined
        }
      >
        {sameUrls?.count ?? 0}
      </td>
      <DeltaCell text={ttfb === null ? "" : formatDelta(ttfb, "ms")} rating={rateDelta(ttfb)} />
      <td className={styles.left}>{(b ?? a)!.providerName}</td>
    </tr>
  );
}

/** The numbers of the notes that touch `target`, as a superscript; nothing without any. */
function NoteRefs({
  caveats,
  target,
}: {
  caveats: ComparisonCaveat[];
  target: ComparisonCaveat["affects"][number];
}) {
  const numbers = caveats.flatMap((c, i) => (c.affects.includes(target) ? [i + 1] : []));
  if (numbers.length === 0) return null;
  return (
    <sup className={styles.noteRef}>
      <span className={metricsStyles.srOnly}> see note </span>
      {numbers.join(",")}
    </sup>
  );
}

/** Metrics summary and hosts of two flows side by side, with B − A for each. */
export function DeltasPanel({ comparison, names, onClose }: Props) {
  const { metrics, hops, caveats } = comparison;
  return (
    <div className={`${metricsStyles.panel} ${styles.panel}`}>
      <div className={metricsStyles.header}>
        <span className={metricsStyles.title}>Deltas · B − A</span>
        <button className={metricsStyles.closeBtn} onClick={onClose} aria-label="Close deltas">
          ✕
        </button>
      </div>
      {/* Scrollable region must be keyboard focusable (axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={metricsStyles.body} role="region" aria-label="Deltas" tabIndex={0}>
        <h3 className={styles.sectionTitle}>Metrics</h3>
        <table className={`${metricsStyles.table} ${styles.table} ${styles.metricsTable}`}>
          <caption className={metricsStyles.caption}>Metric deltas</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">A · {names.a}</th>
              <th scope="col">B · {names.b}</th>
              <th scope="col">Δ</th>
              <th scope="col">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const unit = UNITS[m.key];
              return (
                <tr key={m.key}>
                  <th scope="row">
                    {m.label}
                    <NoteRefs caveats={caveats} target={m.key} />
                  </th>
                  {[m.a, m.b].map((value, i) => {
                    const rating = rateMetric(m.key, value);
                    return (
                      <td
                        key={i}
                        className={`${hopsStyles.num} ${RATING_CLASS[rating]}`}
                        data-rating={rating}
                      >
                        {formatValue(unit, value)}
                        {rating !== "none" && (
                          <span
                            className={metricsStyles.srOnly}
                          >{` (${RATING_TEXT[rating]})`}</span>
                        )}
                      </td>
                    );
                  })}
                  <DeltaCell text={formatDelta(m.delta, unit)} rating={m.rating} />
                  <td className={`${hopsStyles.num} ${styles.pct}`}>
                    {formatDeltaPct(m.deltaPct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {caveats.length > 0 && (
          <ol className={styles.notes} aria-label="Notes on the deltas">
            {caveats.map((c) => (
              <li key={c.id + c.text}>{c.text}</li>
            ))}
          </ol>
        )}

        <h3 className={styles.sectionTitle}>
          Hosts
          <NoteRefs caveats={caveats} target="hosts" />
        </h3>
        <table className={`${hopsStyles.table} ${styles.table}`}>
          <caption className={hopsStyles.caption}>Host deltas</caption>
          <thead>
            <tr>
              <th scope="col">Host</th>
              <th scope="col">Requests A</th>
              <th scope="col">Requests B</th>
              <th scope="col">Δ</th>
              <th scope="col">Avg TTFB A</th>
              <th scope="col">Avg TTFB B</th>
              <th scope="col" title="Requests both flows made to the same URL">
                Same URLs
              </th>
              <th scope="col" title="B − A average TTFB over the same URLs">
                Δ TTFB
              </th>
              <th scope="col" className={styles.left}>
                Provider
              </th>
            </tr>
          </thead>
          <tbody>
            {hops.map((pair) => (
              <HopRow key={pair.host} pair={pair} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
