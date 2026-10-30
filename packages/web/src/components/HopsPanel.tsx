import { formatBytes, formatMs, summarizeHops } from "@htv/core";
import type { HostHop } from "@htv/core";
import { useMemo } from "react";
import { regionLabel } from "../lib/region-label.js";
import styles from "./HopsPanel.module.css";

interface Props {
  hops: HostHop[];
  pageLabel: string;
  onClose: () => void;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatConnection(hop: HostHop): string {
  const c = hop.connection;
  if (!c) return "reused";
  return [c.dns, c.connect, c.ssl].map(formatMs).join(" / ");
}

export function HopsPanel({ hops, pageLabel, onClose }: Props) {
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
              <th scope="col">Avg TTFB</th>
              <th scope="col">DNS / TCP / TLS</th>
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
                  <td className={styles.num}>{formatMs(hop.avgTtfbMs)}</td>
                  <td className={styles.num}>{formatConnection(hop)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
