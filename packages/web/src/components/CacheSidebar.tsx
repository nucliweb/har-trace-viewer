import { formatBytes, shortUrl } from "@htv/core";
import type { HarEntry, InferredCacheHit, ResourceType } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import type { Messages } from "../i18n/en.js";
import { groupByType } from "../lib/resource-types.js";
import styles from "./CacheSidebar.module.css";
import {
  Sidebar,
  SidebarGroup,
  SidebarPagedRows,
  SidebarRow,
  SidebarTypeHeader,
} from "./Sidebar.js";

interface Props {
  resources: HarEntry[];
  // Hits a WebPageTest repeat view left out of its HAR, inferred from the first view.
  inferred?: InferredCacheHit[];
}

type Store = "memory" | "disk" | "unknown" | "inferred";

interface CacheRow {
  url: string;
  resourceType: ResourceType;
  transferSize: number;
  store: Store;
}

const badges = (
  t: Messages["cacheSidebar"]
): Record<Store, { label: string; className: string | undefined; title?: string }> => ({
  memory: { label: t.memory, className: styles.badgeMemory },
  disk: { label: t.disk, className: styles.badgeDisk },
  unknown: { label: t.unknown, className: styles.badgeUnknown, title: t.unknownTitle },
  inferred: { label: t.inferred, className: styles.badgeInferred, title: t.inferredTitle },
});

export function CacheSidebar({ resources, inferred = [] }: Props) {
  const messages = useMessages();
  const t = messages.cacheSidebar;
  const badgeOf = badges(t);
  const rows: CacheRow[] = [
    ...resources.map((e) => ({
      url: e.url,
      resourceType: e.resourceType,
      transferSize: e.transferSize,
      store: e.fromCache === false ? ("disk" as const) : e.fromCache,
    })),
    ...inferred.map((hit) => ({ ...hit, store: "inferred" as const })),
  ];
  return (
    <Sidebar
      title={t.title}
      subtitle={messages.sidebar.resources(rows.length)}
      side="left"
      width={280}
    >
      {[...groupByType(rows)].map(([type, group]) => (
        <SidebarGroup as="details" key={type} open={group.length <= 6}>
          <SidebarTypeHeader as="summary" type={type} count={group.length} />
          <SidebarPagedRows
            items={group}
            render={(row, i) => {
              const badge = badgeOf[row.store];
              return (
                <SidebarRow
                  key={i}
                  url={row.url}
                  label={shortUrl(row.url)}
                  size={formatBytes(row.transferSize)}
                >
                  <span className={badge.className} title={badge.title}>
                    {badge.label}
                  </span>
                </SidebarRow>
              );
            }}
          />
        </SidebarGroup>
      ))}
    </Sidebar>
  );
}
