import { formatBytes, formatMs, getRootDomain, shortUrl } from "@htv/core";
import type { HarEntry, PreconnectSource } from "@htv/core";
import { preconnectCandidates } from "../lib/preconnect-candidates.js";
import { groupByType } from "../lib/resource-types.js";
import styles from "./ResourceSidebar.module.css";
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupHeader,
  SidebarRow,
  SidebarRows,
  SidebarTypeHeader,
} from "./Sidebar.js";

interface DomainInfo {
  hostname: string;
  preconnect: PreconnectSource | null;
  requests: number;
  bytes: number;
}

function extractDomains(
  resources: HarEntry[],
  preconnectHints: Record<string, PreconnectSource>
): DomainInfo[] {
  const map = new Map<string, DomainInfo>();
  for (const entry of resources) {
    let hostname: string;
    try {
      hostname = new URL(entry.url).hostname;
    } catch {
      continue;
    }
    if (!map.has(hostname)) {
      map.set(hostname, {
        hostname,
        preconnect: preconnectHints[hostname] ?? null,
        requests: 0,
        bytes: 0,
      });
    }
    const info = map.get(hostname)!;
    info.requests += 1;
    info.bytes += entry.transferSize;
  }
  return [...map.values()];
}

interface Props {
  resources: HarEntry[];
  title: string;
  onClose: () => void;
  preconnectHints?: Record<string, PreconnectSource>;
  documentHostname?: string;
  /** When the page rendered (LCP, else FCP) on the HAR time base; null or absent without a trace. */
  renderDeadline?: number | null;
  /** Page overview: domains are split first-party vs third-party, with request counts and bytes. */
  overview?: boolean;
}

function PreconnectBadge({ source }: { source: PreconnectSource }) {
  return (
    <span
      className={`${styles.preconnectBadge} ${source === "early-hints" ? styles.preconnectBadgeEH : ""}`}
      title={
        source === "link-header"
          ? "preconnect via HTML Link header"
          : "preconnect via 103 Early Hints"
      }
    >
      {source === "link-header" ? "Link" : "103 EH"}
    </span>
  );
}

function DomainsSection({
  domains,
  tipCandidates,
}: {
  domains: DomainInfo[];
  tipCandidates: string[];
}) {
  return (
    <SidebarGroup>
      <SidebarGroupHeader label="Domains" count={domains.length} />
      <SidebarRows>
        {domains.map((d) => (
          <div key={d.hostname} className={styles.domainRow}>
            <span className={styles.domainName} title={d.hostname}>
              {d.hostname}
            </span>
            {d.preconnect && <PreconnectBadge source={d.preconnect} />}
          </div>
        ))}
      </SidebarRows>
      {tipCandidates.length > 0 && (
        <div className={styles.preconnectTip}>
          <span className={styles.tipIcon}>💡</span>
          <span className={styles.tipText}>
            Consider preconnecting{" "}
            {tipCandidates.map((hostname, i) => (
              <span key={hostname}>
                {i > 0 && ", "}
                <strong>{hostname}</strong>
              </span>
            ))}
            : {tipCandidates.length === 1 ? "it serves" : "they serve"} resources the first render
            waits for.
          </span>
        </div>
      )}
    </SidebarGroup>
  );
}

function summarize(domains: DomainInfo[]) {
  return domains.reduce(
    (sum, d) => ({ requests: sum.requests + d.requests, bytes: sum.bytes + d.bytes }),
    { requests: 0, bytes: 0 }
  );
}

function OverviewDomainsSection({
  domains,
  documentHostname,
}: {
  domains: DomainInfo[];
  documentHostname: string | undefined;
}) {
  const documentRoot = documentHostname ? getRootDomain(`https://${documentHostname}/`) : null;
  const isFirstParty = (d: DomainInfo) => getRootDomain(`https://${d.hostname}/`) === documentRoot;
  const parties = [
    { label: "First-party", list: domains.filter(isFirstParty) },
    { label: "Third-party", list: domains.filter((d) => !isFirstParty(d)) },
  ];

  return (
    <SidebarGroup>
      <SidebarGroupHeader label="Domains" count={domains.length} />
      {parties.map(({ label, list }) => {
        const total = summarize(list);
        return (
          <SidebarRows key={label}>
            <div className={styles.partyRow}>
              <span className={styles.partyName}>{label}</span>
              <span className={styles.domainStats}>
                {list.length} domains · {total.requests} req · {formatBytes(total.bytes)}
              </span>
            </div>
            {list.map((d) => (
              <div key={d.hostname} className={styles.domainRow}>
                <span className={styles.domainName} title={d.hostname}>
                  {d.hostname}
                </span>
                {d.preconnect && <PreconnectBadge source={d.preconnect} />}
                <span className={styles.domainStats}>
                  {d.requests} · {formatBytes(d.bytes)}
                </span>
              </div>
            ))}
          </SidebarRows>
        );
      })}
    </SidebarGroup>
  );
}

export function ResourceSidebar({
  resources,
  title,
  onClose,
  preconnectHints = {},
  documentHostname,
  renderDeadline = null,
  overview = false,
}: Props) {
  const grouped = groupByType(resources);
  const domains = extractDomains(resources, preconnectHints);
  const tipCandidates = documentHostname
    ? preconnectCandidates(resources, { documentHostname, preconnectHints, renderDeadline })
    : [];

  return (
    <Sidebar
      title={title}
      subtitle={`${resources.length} resources`}
      side="right"
      width={320}
      onClose={onClose}
    >
      {overview ? (
        <OverviewDomainsSection domains={domains} documentHostname={documentHostname} />
      ) : (
        <DomainsSection domains={domains} tipCandidates={tipCandidates} />
      )}

      {[...grouped.entries()].map(([type, entries]) => (
        <SidebarGroup key={type}>
          <SidebarTypeHeader type={type} count={entries.length} />
          <SidebarRows>
            {entries.map((entry, i) => (
              <SidebarRow
                key={i}
                url={entry.url}
                label={shortUrl(entry.url)}
                size={formatBytes(entry.transferSize)}
              >
                <span className={styles.rowDur}>{formatMs(entry.duration)}</span>
              </SidebarRow>
            ))}
          </SidebarRows>
        </SidebarGroup>
      ))}
    </Sidebar>
  );
}
