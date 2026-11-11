import {
  THIRD_PARTY_CATEGORY_LABEL,
  formatBytes,
  formatMs,
  pct,
  protocolLabel,
  summarizeHops,
} from "@htv/core";
import type { HostHop, ThirdPartyReport } from "@htv/core";
import { useMemo } from "react";
import { useCoreLang, useMessages } from "../i18n/context.js";
import type { Messages } from "../i18n/en.js";
import styles from "./HopsPanel.module.css";

interface Props {
  hops: HostHop[];
  /** The page's third parties by entity; absent for flows generated before it existed. */
  thirdParties?: ThirdPartyReport;
  pageLabel: string;
  onClose: () => void;
}

function formatConnection(hop: HostHop, t: Messages["hops"]): string {
  const c = hop.connection;
  if (!c) return t.reused;
  return [c.dns, c.connect, c.ssl].map(formatMs).join(" / ");
}

const cost = (c: { requests: number; bytes: number }) => `${c.requests} (${formatBytes(c.bytes)})`;

function ThirdPartiesSection({ report }: { report: ThirdPartyReport }) {
  const t = useMessages().hops;
  const lang = useCoreLang();
  const count = report.entities.length;
  const summary =
    count === 0
      ? t.noThirdParties
      : t.thirdPartySummary(
          count,
          pct(report.byteShare),
          pct(report.requestShare),
          report.totals.renderBlocking,
          report.consentManager
        );
  return (
    <>
      <h3 className={styles.sectionTitle}>{t.thirdParties}</h3>
      <p className={styles.sectionSummary}>{summary}</p>
      {count > 0 && (
        <table className={styles.table}>
          <caption className={styles.caption}>{t.perEntity}</caption>
          <thead>
            <tr>
              <th scope="col">{t.thirdParty}</th>
              <th scope="col">{t.category}</th>
              <th scope="col">{t.hosts}</th>
              <th scope="col">{t.requests}</th>
              <th scope="col" title={t.cachedTitle}>
                {t.cached}
              </th>
              <th scope="col">{t.bytes}</th>
              <th scope="col" title={t.beforeOnLoadTitle}>
                {t.beforeOnLoad}
              </th>
              <th scope="col" title={t.afterOnLoadCostTitle}>
                {t.afterOnLoad}
              </th>
              <th scope="col" title={t.renderBlockingTitle}>
                {t.renderBlocking}
              </th>
              <th scope="col" title={t.entityMedianTtfbTitle}>
                {t.medianTtfb}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.entities.map((e) => (
              <tr key={`${e.category}:${e.name}`}>
                <th scope="row">{e.name}</th>
                <td lang={lang}>{THIRD_PARTY_CATEGORY_LABEL[e.category]}</td>
                <td className={styles.hosts}>{e.hosts.join(", ")}</td>
                <td className={styles.num}>{e.requests}</td>
                <td className={styles.num}>{e.cacheHits}</td>
                <td className={styles.num}>{formatBytes(e.bytes)}</td>
                <td className={styles.num}>{cost(e.beforeLoad)}</td>
                <td className={styles.num}>{cost(e.afterLoad)}</td>
                <td className={styles.num}>{e.renderBlocking}</td>
                <td className={styles.num}>{formatMs(e.medianTtfbMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function HopsPanel({ hops, thirdParties, pageLabel, onClose }: Props) {
  const t = useMessages().hops;
  const summary = useMemo(() => summarizeHops(hops), [hops]);
  // Stable sort keeps the requests order inside each party.
  const ordered = useMemo(
    () => [...hops].sort((a, b) => Number(b.party === "first") - Number(a.party === "first")),
    [hops]
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.headerText}>
          <span className={styles.title}>{t.title}</span>{" "}
          <span className={styles.pageLabel}>{pageLabel}</span>
        </h2>
        <button className={styles.closeBtn} onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </div>
      <p className={styles.summary}>
        {t.summary(hops.length, summary.providers.length, summary.regions.length)}
      </p>
      {/* Scrollable region must be keyboard focusable (axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label={t.details} tabIndex={0}>
        <table className={styles.table}>
          <caption className={styles.caption}>{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.host}</th>
              <th scope="col">{t.party}</th>
              <th scope="col">{t.provider}</th>
              <th scope="col">{t.pop}</th>
              <th scope="col">{t.requests}</th>
              <th scope="col" title={t.cachedTitle}>
                {t.cached}
              </th>
              <th scope="col">{t.bytes}</th>
              <th scope="col">{t.hitRatio}</th>
              <th scope="col" title={t.medianTtfbTitle}>
                {t.medianTtfb}
              </th>
              <th scope="col" title={t.afterOnLoadTitle}>
                {t.afterOnLoad}
              </th>
              <th scope="col" title={t.connectionTitle}>
                {t.connection}
              </th>
              <th scope="col" title={t.protocolTitle}>
                {t.protocol}
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((hop) => {
              const judged = hop.cacheHits + hop.cacheMisses > 0;
              return (
                <tr key={hop.host}>
                  <th scope="row" className={styles.host}>
                    <span
                      className={`${styles.dot} ${styles[`dot_${hop.provider}`] ?? ""}`}
                      aria-hidden="true"
                    />
                    {hop.host}
                  </th>
                  <td>{hop.party === "first" ? t.first : t.third}</td>
                  <td>{hop.providerName}</td>
                  <td>{hop.pop ? `${hop.pop.city} · ${t.regions[hop.pop.region]}` : t.na}</td>
                  <td className={styles.num}>{hop.requests}</td>
                  <td className={styles.num}>{hop.browserCacheHits}</td>
                  <td className={styles.num}>{formatBytes(hop.bytes)}</td>
                  <td className={styles.num}>{judged ? pct(hop.hitRatio) : t.na}</td>
                  <td className={styles.num}>{formatMs(hop.medianTtfbMs)}</td>
                  <td className={styles.num}>{formatMs(hop.afterLoadMedianTtfbMs)}</td>
                  <td className={styles.num}>{formatConnection(hop, t)}</td>
                  <td>{protocolLabel(hop)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {thirdParties && <ThirdPartiesSection report={thirdParties} />}
      </div>
    </div>
  );
}
