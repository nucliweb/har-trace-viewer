import type { HarEntry, PreconnectSource, ResourceType } from "@htv/core/types.js";
import styles from "./ResourceSidebar.module.css";

interface DomainInfo {
  hostname: string;
  resourceTypes: Set<ResourceType>;
  preconnect: PreconnectSource | null;
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
      });
    }
    map.get(hostname)!.resourceTypes.add(entry.resourceType);
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
}

function ResourceTypeIcon({ type }: { type: ResourceType }) {
  switch (type) {
    case "document":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect
            x="1"
            y="0.5"
            width="8"
            height="11"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <line x1="3" y1="3.5" x2="7" y2="3.5" stroke="currentColor" strokeWidth="1" />
          <line x1="3" y1="5.5" x2="7" y2="5.5" stroke="currentColor" strokeWidth="1" />
          <line x1="3" y1="7.5" x2="5.5" y2="7.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case "stylesheet":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect
            x="0.6"
            y="0.6"
            width="10.8"
            height="10.8"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <line x1="2" y1="4" x2="10" y2="4" stroke="currentColor" strokeWidth="1" />
          <line x1="2" y1="6" x2="8" y2="6" stroke="currentColor" strokeWidth="1" />
          <line x1="2" y1="8" x2="9" y2="8" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case "script":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <polyline
            points="1,4 4,6 1,8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
          <line
            x1="6"
            y1="8.5"
            x2="11"
            y2="8.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "image":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect
            x="0.6"
            y="1.6"
            width="10.8"
            height="8.8"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <circle cx="4" cy="4.5" r="1" fill="currentColor" />
          <polyline
            points="0.6,8.5 3.5,5.5 5.5,7.5 7.5,5.5 11.4,8.5"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "font":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <text x="1" y="10" fontSize="10" fontFamily="serif" fill="currentColor" fontWeight="bold">
            A
          </text>
        </svg>
      );
    case "fetch":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line
            x1="6"
            y1="1"
            x2="6"
            y2="11"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <polyline
            points="3,4 6,1 9,4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
          <polyline
            points="3,8 6,11 9,8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <text x="6" y="9.5" textAnchor="middle" fontSize="7" fill="currentColor">
            ?
          </text>
        </svg>
      );
  }
}

const TYPE_ORDER: ResourceType[] = [
  "document",
  "stylesheet",
  "script",
  "fetch",
  "image",
  "font",
  "other",
];

function groupByType(entries: HarEntry[]): Map<ResourceType, HarEntry[]> {
  const map = new Map<ResourceType, HarEntry[]>();
  for (const type of TYPE_ORDER) {
    const group = entries.filter((e) => e.resourceType === type);
    if (group.length > 0) map.set(type, group);
  }
  return map;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").pop() || u.pathname;
    return path.length > 36 ? path.slice(0, 34) + "…" : path || u.hostname;
  } catch {
    return url.slice(0, 36);
  }
}

const TYPE_LABELS: Record<ResourceType, string> = {
  document: "Document",
  stylesheet: "CSS",
  script: "JS",
  image: "Images",
  font: "Fonts",
  fetch: "Fetch / XHR",
  other: "Other",
};

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
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <span className={styles.groupLabel}>Domains</span>
        <span className={styles.groupCount}>{domains.length}</span>
      </div>
      <div className={styles.rows}>
        {domains.map((d) => (
          <div key={d.hostname} className={styles.domainRow}>
            <span className={styles.domainName} title={d.hostname}>
              {d.hostname}
            </span>
            {d.preconnect && <PreconnectBadge source={d.preconnect} />}
          </div>
        ))}
      </div>
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
    </div>
  );
}

export function ResourceSidebar({
  resources,
  title,
  onClose,
  preconnectHints = {},
  documentHostname,
}: Props) {
  const grouped = groupByType(resources);
  const domains = extractDomains(resources, preconnectHints);

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        <span className={styles.headerCount}>{resources.length} resources</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={styles.body}>
        <DomainsSection domains={domains} documentHostname={documentHostname} />

        {[...grouped.entries()].map(([type, entries]) => (
          <div key={type} className={styles.group}>
            <div className={styles.groupHeader}>
              <span className={`${styles.typeIcon} ${styles[`type_${type}`]}`}>
                <ResourceTypeIcon type={type} />
              </span>
              <span className={styles.groupLabel}>{TYPE_LABELS[type]}</span>
              <span className={styles.groupCount}>{entries.length}</span>
            </div>

            <div className={styles.rows}>
              {entries.map((entry, i) => (
                <div key={i} className={styles.row}>
                  <span className={styles.rowUrl} title={entry.url}>
                    {shortUrl(entry.url)}
                  </span>
                  <span className={styles.rowSize}>{formatBytes(entry.transferSize)}</span>
                  <span className={styles.rowDur}>{Math.round(entry.duration)}ms</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
