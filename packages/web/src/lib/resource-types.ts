import { RESOURCE_TYPE_ORDER } from "@htv/core";
import type { ResourceType } from "@htv/core";

/** The entries grouped by resource type, the groups in display order, empty ones left out. */
export function groupByType<T extends { resourceType: ResourceType }>(
  entries: T[]
): Map<ResourceType, T[]> {
  const map = new Map<ResourceType, T[]>();
  for (const type of RESOURCE_TYPE_ORDER) {
    const group = entries.filter((e) => e.resourceType === type);
    if (group.length > 0) map.set(type, group);
  }
  return map;
}
