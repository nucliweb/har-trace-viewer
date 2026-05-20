import type { HarEntry, ResourceType } from "@htv/core/types.js";
import styles from "./CacheSidebar.module.css";

interface Props {
  resources: HarEntry[];
}

const TYPE_LABELS: Record<ResourceType, string> = {
  document:   "HTML",
  stylesheet: "CSS",
  script:     "JS",
  image:      "Images",
  font:       "Fonts",
  fetch:      "Fetch",
  other:      "Other",
};

const TYPE_ORDER: ResourceType[] = ["document", "stylesheet", "script", "image", "font", "fetch", "other"];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function urlLabel(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    const short = pathname.split("/").at(-1) || pathname;
    return search ? `${short}${search}` : short || pathname;
  } catch {
    return url;
  }
}

function ResourceTypeIcon({ type }: { type: ResourceType }) {
  switch (type) {
    case "stylesheet":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <line x1="3" y1="4" x2="7" y2="4" stroke="currentColor" strokeWidth="1"/>
          <line x1="3" y1="6.5" x2="9" y2="6.5" stroke="currentColor" strokeWidth="1"/>
          <line x1="3" y1="9" x2="6" y2="9" stroke="currentColor" strokeWidth="1"/>
        </svg>
      );
    case "script":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <polyline points="4,3.5 1.5,6 4,8.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          <polyline points="8,3.5 10.5,6 8,8.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          <line x1="7" y1="2.5" x2="5" y2="9.5" stroke="currentColor" strokeWidth="1" opacity="0.7"/>
        </svg>
      );
    case "image":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="2" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <circle cx="4" cy="5" r="1" fill="currentColor"/>
          <polyline points="1,9 4,6 6.5,8.5 8,7 11,9" stroke="currentColor" strokeWidth="1" fill="none"/>
        </svg>
      );
    case "font":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <text x="2" y="9.5" fontSize="9" fontFamily="serif" fill="currentColor">A</text>
        </svg>
      );
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="2" y="1" width="7" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <line x1="4" y1="4" x2="7" y2="4" stroke="currentColor" strokeWidth="1"/>
          <line x1="4" y1="6" x2="7" y2="6" stroke="currentColor" strokeWidth="1"/>
        </svg>
      );
  }
}

export function CacheSidebar({ resources }: Props) {
  const grouped = new Map<ResourceType, HarEntry[]>();
  for (const entry of resources) {
    const list = grouped.get(entry.resourceType) ?? [];
    list.push(entry);
    grouped.set(entry.resourceType, list);
  }

  const orderedGroups = TYPE_ORDER
    .filter((type) => grouped.has(type))
    .map((type) => ({ type, entries: grouped.get(type)! }));

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Cache</span>
        <span className={styles.headerCount}>{resources.length} resources</span>
      </div>

      <div className={styles.body}>
        {orderedGroups.map(({ type, entries }) => (
          <details key={type} className={styles.group} open={entries.length <= 6}>
            <summary className={styles.groupHeader}>
              <span className={`${styles.typeIcon} ${styles[`type_${type}`]}`}>
                <ResourceTypeIcon type={type} />
              </span>
              <span className={`${styles.groupLabel} ${styles[`type_${type}`]}`}>
                {TYPE_LABELS[type]}
              </span>
              <span className={styles.groupCount}>{entries.length}</span>
            </summary>

            <div className={styles.rows}>
              {entries.map((entry, i) => (
                <div key={i} className={styles.row} title={entry.url}>
                  <span className={styles.rowUrl}>{urlLabel(entry.url)}</span>
                  <span className={styles.rowSize}>{formatBytes(entry.transferSize)}</span>
                  <span className={entry.fromCache === "memory" ? styles.badgeMemory : styles.badgeDisk}>
                    {entry.fromCache === "memory" ? "mem" : "disk"}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
