import { useState } from "react";
import type { Ref } from "react";
import {
  COMPARED_METRICS,
  THIRD_PARTY_CATEGORY_LABEL,
  formatBytes,
  formatDelta,
  formatDeltaPct,
  formatMetricValue,
  formatMs,
  pct,
  rateDelta,
  rateMetric,
} from "@htv/core";
import type {
  ComparedMetric,
  ComparisonCaveat,
  DeltaRating,
  DeltaUnit,
  FlowComparison,
  HopPair,
  ThirdPartyComparison,
} from "@htv/core";
import { useCoreLang, useMessages } from "../i18n/context.js";
import { Drawer, DrawerBody } from "./Drawer.js";
import { RequestDeltas } from "./RequestDeltas.js";
import { RATING_CLASS } from "./MetricsSummary.js";
import chipStyles from "./AnalysisPanel.module.css";
import metricsStyles from "./MetricsSummary.module.css";
import hopsStyles from "./HopsPanel.module.css";
import styles from "./DeltasPanel.module.css";

interface Props {
  ref?: Ref<HTMLDivElement>;
  comparison: FlowComparison;
  /** Names of flow A and flow B, shown in the column headers. */
  names: { a: string; b: string };
  onClose: () => void;
}

const UNITS = Object.fromEntries(COMPARED_METRICS.map((m) => [m.key, m.unit])) as Record<
  ComparedMetric,
  DeltaUnit
>;

/** B against A: better reads like a good rating, worse like a poor one. */
export const DELTA_CLASS: Record<DeltaRating, string> = {
  better: metricsStyles.good,
  worse: metricsStyles.poor,
  same: styles.same,
  none: "",
};

/** A delta cell: the signed value, its rating colour and the rating in words for screen readers. */
export function DeltaCell({ text, rating }: { text: string; rating: DeltaRating }) {
  const t = useMessages().deltas;
  return (
    <td className={`${hopsStyles.num} ${DELTA_CLASS[rating]}`} data-rating={rating}>
      {text}
      {rating !== "none" && rating !== "same" && (
        <span className={metricsStyles.srOnly}>{` (${t.rating[rating]})`}</span>
      )}
    </td>
  );
}

function HopRow({ pair }: { pair: HopPair }) {
  const t = useMessages().deltas;
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
      <td className={hopsStyles.num}>{a ? formatMs(a.medianTtfbMs) : "—"}</td>
      <td className={hopsStyles.num}>{b ? formatMs(b.medianTtfbMs) : "—"}</td>
      <td
        className={hopsStyles.num}
        title={
          sameUrls ? t.avgTtfb(formatMs(sameUrls.avgTtfbA), formatMs(sameUrls.avgTtfbB)) : undefined
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
  const t = useMessages().deltas;
  const numbers = caveats.flatMap((c, i) => (c.affects.includes(target) ? [i + 1] : []));
  if (numbers.length === 0) return null;
  return (
    <sup className={styles.noteRef}>
      <span className={metricsStyles.srOnly}>{t.seeNote}</span>
      {numbers.join(",")}
    </sup>
  );
}

/** The third parties of both flows by entity, what B added first; a consent comparison reads here. */
function ThirdPartyDeltas({ thirdParties }: { thirdParties: ThirdPartyComparison }) {
  const t = useMessages().deltas;
  const lang = useCoreLang();
  const { a, b, entities } = thirdParties;
  if (entities.length === 0) {
    return <p className={styles.sectionNote}>{t.noThirdParties}</p>;
  }
  const consent = [a.consentManager, b.consentManager].some(Boolean)
    ? t.consent(a.consentManager ?? t.none, b.consentManager ?? t.none)
    : "";
  return (
    <>
      <p className={styles.sectionNote}>
        {t.thirdPartyBytes(
          formatBytes(a.totals.bytes),
          pct(a.byteShare),
          formatBytes(b.totals.bytes),
          pct(b.byteShare),
          consent
        )}
      </p>
      <table className={`${hopsStyles.table} ${styles.table}`}>
        <caption className={hopsStyles.caption}>{t.thirdPartyCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.thirdParty}</th>
            <th scope="col" className={styles.left}>
              {t.category}
            </th>
            <th scope="col">{t.requestsA}</th>
            <th scope="col">{t.requestsB}</th>
            <th scope="col">Δ</th>
            <th scope="col">{t.bytesA}</th>
            <th scope="col">{t.bytesB}</th>
            <th scope="col">{t.bytesDelta}</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((pair) => (
            <tr key={`${pair.category}:${pair.name}`}>
              <th scope="row">{pair.name}</th>
              <td className={styles.left} lang={lang}>
                {THIRD_PARTY_CATEGORY_LABEL[pair.category]}
              </td>
              <td className={hopsStyles.num}>{pair.a?.requests ?? 0}</td>
              <td className={hopsStyles.num}>{pair.b?.requests ?? 0}</td>
              <DeltaCell
                text={formatDelta(pair.requests, "count")}
                rating={rateDelta(pair.requests)}
              />
              <td className={hopsStyles.num}>{formatBytes(pair.a?.bytes ?? 0)}</td>
              <td className={hopsStyles.num}>{formatBytes(pair.b?.bytes ?? 0)}</td>
              <DeltaCell text={formatDelta(pair.bytes, "bytes")} rating={rateDelta(pair.bytes)} />
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

type DeltasView = "summary" | "requests";
const VIEWS: DeltasView[] = ["summary", "requests"];

/**
 * Two flows side by side, with B − A for each: the summary (metrics, hosts and third parties) or
 * their requests one by one, picked in the drawer.
 */
export function DeltasPanel({ ref, comparison, names, onClose }: Props) {
  const t = useMessages().deltas;
  const [view, setView] = useState<DeltasView>("summary");
  return (
    <Drawer
      ref={ref}
      title={t.title}
      closeLabel={t.close}
      onClose={onClose}
      width="1040px"
      className={styles.panel}
    >
      <div className={chipStyles.views} role="group" aria-label={t.views}>
        {VIEWS.map((name) => (
          <button
            key={name}
            type="button"
            className={`${chipStyles.chip} ${view === name ? chipStyles.chipActive : ""}`}
            aria-pressed={view === name}
            onClick={() => setView(name)}
          >
            {t.view[name]}
          </button>
        ))}
      </div>
      {view === "summary" ? (
        <SummaryDeltas comparison={comparison} names={names} />
      ) : (
        <RequestDeltas requests={comparison.requests} />
      )}
    </Drawer>
  );
}

/** Metrics summary, hosts and third parties of two flows side by side, with B − A for each. */
function SummaryDeltas({ comparison, names }: Pick<Props, "comparison" | "names">) {
  const messages = useMessages();
  const t = messages.deltas;
  const lang = useCoreLang();
  const { metrics, hops, thirdParties, caveats } = comparison;
  return (
    <DrawerBody label={t.details} className={metricsStyles.body}>
      <h3 className={styles.sectionTitle}>{t.metrics}</h3>
      <table className={`${metricsStyles.table} ${styles.table} ${styles.metricsTable}`}>
        <caption className={metricsStyles.caption}>{t.metricsCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.metric}</th>
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
                <th scope="row" lang={lang}>
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
                      {formatMetricValue(value, unit)}
                      {rating !== "none" && (
                        <span
                          className={metricsStyles.srOnly}
                        >{` (${messages.metrics.rating[rating]})`}</span>
                      )}
                    </td>
                  );
                })}
                <DeltaCell text={formatDelta(m.delta, unit)} rating={m.rating} />
                <td className={`${hopsStyles.num} ${styles.pct}`}>{formatDeltaPct(m.deltaPct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {caveats.length > 0 && (
        <ol className={styles.notes} aria-label={t.notes}>
          {caveats.map((c) => (
            <li key={c.id + c.text} lang={lang}>
              {c.text}
            </li>
          ))}
        </ol>
      )}

      <h3 className={styles.sectionTitle}>
        {t.hosts}
        <NoteRefs caveats={caveats} target="hosts" />
      </h3>
      <table className={`${hopsStyles.table} ${styles.table}`}>
        <caption className={hopsStyles.caption}>{t.hostsCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.host}</th>
            <th scope="col">{t.requestsA}</th>
            <th scope="col">{t.requestsB}</th>
            <th scope="col">Δ</th>
            <th scope="col">{t.medianTtfbA}</th>
            <th scope="col">{t.medianTtfbB}</th>
            <th scope="col" title={t.sameUrlsTitle}>
              {t.sameUrls}
            </th>
            <th scope="col" title={t.ttfbDeltaTitle}>
              {t.ttfbDelta}
            </th>
            <th scope="col" className={styles.left}>
              {t.provider}
            </th>
          </tr>
        </thead>
        <tbody>
          {hops.map((pair) => (
            <HopRow key={pair.host} pair={pair} />
          ))}
        </tbody>
      </table>

      <h3 className={styles.sectionTitle}>{t.thirdParties}</h3>
      <ThirdPartyDeltas thirdParties={thirdParties} />
    </DrawerBody>
  );
}
