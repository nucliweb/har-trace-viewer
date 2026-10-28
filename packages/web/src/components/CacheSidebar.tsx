import type { HarEntry } from "@htv/core";
import { formatBytes, shortUrl } from "../lib/format.js";
import { groupByType } from "../lib/resource-types.js";
import styles from "./CacheSidebar.module.css";
import { Sidebar, SidebarGroup, SidebarRow, SidebarRows, SidebarTypeHeader } from "./Sidebar.js";

interface Props {
  resources: HarEntry[];
}

export function CacheSidebar({ resources }: Props) {
  return (
    <Sidebar title="Cache" subtitle={`${resources.length} resources`} side="left" width={280}>
      {[...groupByType(resources)].map(([type, entries]) => (
        <SidebarGroup as="details" key={type} open={entries.length <= 6}>
          <SidebarTypeHeader as="summary" type={type} count={entries.length} />
          <SidebarRows>
            {entries.map((entry, i) => (
              <SidebarRow
                key={i}
                url={entry.url}
                label={shortUrl(entry.url)}
                size={formatBytes(entry.transferSize)}
              >
                <span
                  className={entry.fromCache === "memory" ? styles.badgeMemory : styles.badgeDisk}
                >
                  {entry.fromCache === "memory" ? "mem" : "disk"}
                </span>
              </SidebarRow>
            ))}
          </SidebarRows>
        </SidebarGroup>
      ))}
    </Sidebar>
  );
}
