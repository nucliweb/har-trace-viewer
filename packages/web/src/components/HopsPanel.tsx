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
import { regionLabel } from "../lib/region-label.js";
import styles from "./HopsPanel.module.css";

interface Props {
  hops: HostHop[];
  /** The page's third parties by entity; absent for flows generated before it existed. */
  thirdParties?: ThirdPartyReport;
  pageLabel: string;
  onClose: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatConnection(hop: HostHop): string {
  const c = hop.connection;
  if (!c) return "reused";
  return [c.dns, c.connect, c.ssl].map(formatMs).join(" / ");
}

const cost = (c: { requests: number; bytes: number }) => `${c.requests} (${formatBytes(c.bytes)})`;

function ThirdPartiesSection({ report }: { report: ThirdPartyReport }) {
  const count = report.entities.length;
  const summary =
    count === 0
      ? "No third-party requests."
      : [
          `${count} third ${count === 1 ? "party" : "parties"}`,
          `${pct(report.byteShare)} of the bytes`,
          `${pct(report.requestShare)} of the requests`,
          `${report.totals.renderBlocking} render-blocking`,
          ...(report.consentManager ? [`consent manager: ${report.consentManager}`] : []),
        ].join(" · ");
  return (
    <>
      <h3 className={styles.sectionTitle}>Third parties</h3>
      <p className={styles.sectionSummary}>{summary}</p>
      {count > 0 && (
        <table className={styles.table}>
          <caption className={styles.caption}>Third parties per entity</caption>
          <thead>
            <tr>
              <th scope="col">Third party</th>
              <th scope="col">Category</th>
              <th scope="col">Hosts</th>
              <th scope="col">Requests</th>
              <th scope="col" title="Served from the browser cache, without a request">
                Cached
              </th>
              <th scope="col">Bytes</th>
              <th scope="col" title="Network requests sent up to the load event, and their bytes">
                Before onLoad
              </th>
              <th scope="col" title="Network requests sent after the load event, and their bytes">
                After onLoad
              </th>
              <th scope="col" title="Requests that held the first paint">
                Render-blocking
              </th>
              <th
                scope="col"
                title="Median TTFB of the requests sent before onLoad, beacons and 304 revalidations aside"
              >
                Median TTFB
              </th>
            </tr>
          </thead>
          <tbody>
            {report.entities.map((e) => (
              <tr key={`${e.category}:${e.name}`}>
                <th scope="row">{e.name}</th>
                <td>{THIRD_PARTY_CATEGORY_LABEL[e.category]}</td>
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
  const summary = useMemo(() => summarizeHops(hops), [hops]);
  // Stable sort keeps the requests order inside each party.
  const ordered = useMemo(
    () => [...hops].sort((a, b) => Number(b.party === "first") - Number(a.party === "first")),
    [hops]
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.title}>Hops</span>
          <h2 className={styles.pageLabel}>{pageLabel}</h2>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close hops">
          ✕
        </button>
      </div>
      <p className={styles.summary}>
        {`${plural(hops.length, "host")} · ${plural(summary.providers.length, "provider")} · ${plural(summary.regions.length, "region")}`}
      </p>
      {/* Scrollable region must be keyboard focusable (axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label="Hops details" tabIndex={0}>
        <table className={styles.table}>
          <caption className={styles.caption}>Hops per host</caption>
          <thead>
            <tr>
              <th scope="col">Host</th>
              <th scope="col">Party</th>
              <th scope="col">Provider</th>
              <th scope="col">PoP</th>
              <th scope="col">Requests</th>
              <th scope="col" title="Served from the browser cache, without a request">
                Cached
              </th>
              <th scope="col">Bytes</th>
              <th scope="col">Hit ratio</th>
              <th
                scope="col"
                title="Median TTFB of the requests sent before onLoad, beacons (POST, ping, 204/205) and 304 revalidations aside"
              >
                Median TTFB
              </th>
              <th scope="col" title="Median TTFB of the requests sent after onLoad, beacons aside">
                After onLoad
              </th>
              <th scope="col" title="First new connection; n/a for a phase that did not happen">
                DNS / TCP / TLS
              </th>
              <th
                scope="col"
                title="HTTP version of the requests that reached the host, and the connections they used"
              >
                Protocol
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
                  <td>{hop.party === "first" ? "First" : "Third"}</td>
                  <td>{hop.providerName}</td>
                  <td>{hop.pop ? `${hop.pop.city} · ${regionLabel(hop.pop.region)}` : "n/a"}</td>
                  <td className={styles.num}>{hop.requests}</td>
                  <td className={styles.num}>{hop.browserCacheHits}</td>
                  <td className={styles.num}>{formatBytes(hop.bytes)}</td>
                  <td className={styles.num}>{judged ? pct(hop.hitRatio) : "n/a"}</td>
                  <td className={styles.num}>{formatMs(hop.medianTtfbMs)}</td>
                  <td className={styles.num}>{formatMs(hop.afterLoadMedianTtfbMs)}</td>
                  <td className={styles.num}>{formatConnection(hop)}</td>
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
