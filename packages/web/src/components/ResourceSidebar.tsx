import { useMemo } from "react";
import { formatBytes, formatMs, getRootDomain, shortUrl } from "@htv/core";
import type { HarEntry, PreconnectSource } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import { preconnectCandidates } from "../lib/preconnect-candidates.js";
import { groupByType } from "../lib/resource-types.js";
import styles from "./ResourceSidebar.module.css";
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupHeader,
  SidebarPagedRows,
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
  const t = useMessages().resources;
  return (
    <span
      className={`${styles.preconnectBadge} ${source === "early-hints" ? styles.preconnectBadgeEH : ""}`}
      title={source === "link-header" ? t.viaLinkHeader : t.viaEarlyHints}
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
  const t = useMessages().resources;
  return (
    <SidebarGroup>
      <SidebarGroupHeader label={t.domains} count={domains.length} />
      <SidebarPagedRows
        items={domains}
        render={(d) => (
          <div key={d.hostname} className={styles.domainRow}>
            <span className={styles.domainName} title={d.hostname}>
              {d.hostname}
            </span>
            {d.preconnect && <PreconnectBadge source={d.preconnect} />}
          </div>
        )}
      />
      {tipCandidates.length > 0 && (
        <div className={styles.preconnectTip}>
          <span className={styles.tipIcon}>💡</span>
          <span className={styles.tipText}>
            {t.tipBefore}{" "}
            {tipCandidates.map((hostname, i) => (
              <span key={hostname}>
                {i > 0 && ", "}
                <strong>{hostname}</strong>
              </span>
            ))}
            {t.tipAfter(tipCandidates.length)}
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
  const t = useMessages().resources;
  const documentRoot = documentHostname ? getRootDomain(`https://${documentHostname}/`) : null;
  const isFirstParty = (d: DomainInfo) => getRootDomain(`https://${d.hostname}/`) === documentRoot;
  const parties = [
    { label: t.firstParty, list: domains.filter(isFirstParty) },
    { label: t.thirdParty, list: domains.filter((d) => !isFirstParty(d)) },
  ];

  return (
    <SidebarGroup>
      <SidebarGroupHeader label={t.domains} count={domains.length} />
      {parties.map(({ label, list }) => {
        const total = summarize(list);
        return (
          <SidebarRows key={label}>
            <div className={styles.partyRow}>
              <span className={styles.partyName}>{label}</span>
              <span className={styles.domainStats}>
                {t.partyStats(list.length, total.requests, formatBytes(total.bytes))}
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

const NO_HINTS: Record<string, PreconnectSource> = {};

export function ResourceSidebar({
  resources,
  title,
  onClose,
  preconnectHints = NO_HINTS,
  documentHostname,
  renderDeadline = null,
  overview = false,
}: Props) {
  const t = useMessages().sidebar;
  // Memoized so "Show more" keeps its page: a new array per render would start every list over.
  const grouped = useMemo(() => groupByType(resources), [resources]);
  const domains = useMemo(
    () => extractDomains(resources, preconnectHints),
    [resources, preconnectHints]
  );
  const tipCandidates = useMemo(
    () =>
      documentHostname
        ? preconnectCandidates(resources, { documentHostname, preconnectHints, renderDeadline })
        : [],
    [resources, documentHostname, preconnectHints, renderDeadline]
  );

  return (
    <Sidebar
      title={title}
      subtitle={t.resources(resources.length)}
      side="right"
      width={480}
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
          <SidebarPagedRows
            items={entries}
            render={(entry, i) => (
              <SidebarRow
                key={i}
                url={entry.url}
                label={shortUrl(entry.url)}
                size={formatBytes(entry.transferSize)}
              >
                <span className={styles.rowDur}>{formatMs(entry.duration)}</span>
              </SidebarRow>
            )}
          />
        </SidebarGroup>
      ))}
    </Sidebar>
  );
}
