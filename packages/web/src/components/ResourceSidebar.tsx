import { formatBytes, formatMs, getRootDomain, shortUrl } from "@htv/core";
import type { HarEntry, PreconnectSource, ResourceType } from "@htv/core";
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
  resourceTypes: Set<ResourceType>;
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
        resourceTypes: new Set(),
        preconnect: preconnectHints[hostname] ?? null,
        requests: 0,
        bytes: 0,
      });
    }
    const info = map.get(hostname)!;
    info.resourceTypes.add(entry.resourceType);
    info.requests += 1;
    info.bytes += entry.transferSize;
  }
  return [...map.values()];
}

const CRITICAL_TYPES: ResourceType[] = ["stylesheet", "font", "image", "script"];

const FCP_LCP_PRIORITY: Partial<Record<ResourceType, number>> = {
  font: 0,
  stylesheet: 1,
  script: 2,
  image: 3,
};

function criticalityScore(info: DomainInfo): number {
  let best = Infinity;
  for (const type of info.resourceTypes) {
    const score = FCP_LCP_PRIORITY[type] ?? 99;
    if (score < best) best = score;
  }
  return best;
}

function isCriticalDomain(info: DomainInfo): boolean {
  return CRITICAL_TYPES.some((t) => info.resourceTypes.has(t));
}

function domainTipCandidates(domains: DomainInfo[], documentHostname: string): DomainInfo[] {
  return domains
    .filter((d) => d.hostname !== documentHostname && !d.preconnect && isCriticalDomain(d))
    .sort((a, b) => criticalityScore(a) - criticalityScore(b));
}

interface Props {
  resources: HarEntry[];
  title: string;
  onClose: () => void;
  preconnectHints?: Record<string, PreconnectSource>;
  documentHostname?: string;
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
  documentHostname,
}: {
  domains: DomainInfo[];
  documentHostname: string | undefined;
}) {
  const tipCandidates = documentHostname ? domainTipCandidates(domains, documentHostname) : [];

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
            {tipCandidates.length === 1 ? (
              <>
                Consider preconnecting <strong>{tipCandidates[0].hostname}</strong> to reduce
                connection overhead.
              </>
            ) : tipCandidates.length <= 4 ? (
              <>
                Consider preconnecting:{" "}
                {tipCandidates.map((d, i) => (
                  <span key={d.hostname}>
                    {i > 0 && ", "}
                    <strong>{d.hostname}</strong>
                  </span>
                ))}{" "}
                to reduce connection overhead.
              </>
            ) : (
              <>
                Preconnecting all {tipCandidates.length} cross-origin domains is counterproductive —
                too many competing connections hurt FCP/LCP. Focus on the most critical:{" "}
                {tipCandidates.slice(0, 3).map((d, i) => (
                  <span key={d.hostname}>
                    {i > 0 && ", "}
                    <strong>{d.hostname}</strong>
                  </span>
                ))}
                .
              </>
            )}
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
  overview = false,
}: Props) {
  const grouped = groupByType(resources);
  const domains = extractDomains(resources, preconnectHints);

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
        <DomainsSection domains={domains} documentHostname={documentHostname} />
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
