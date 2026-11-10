import type { ResourceType } from "@htv/core";

/**
 * Display order for resource groups: render-critical types first (document, CSS, JS, fonts),
 * then images, then runtime requests, then everything else.
 */
const TYPE_ORDER: ResourceType[] = [
  "document",
  "stylesheet",
  "script",
  "font",
  "image",
  "fetch",
  "other",
];

export function groupByType<T extends { resourceType: ResourceType }>(
  entries: T[]
): Map<ResourceType, T[]> {
  const map = new Map<ResourceType, T[]>();
  for (const type of TYPE_ORDER) {
    const group = entries.filter((e) => e.resourceType === type);
    if (group.length > 0) map.set(type, group);
  }
  return map;
}
