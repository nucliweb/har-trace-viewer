import type { ResourceType } from "@htv/core";

/**
 * Display order for resource groups: render-critical types first (document, CSS, JS, fonts),
 * then images, then runtime requests, then everything else.
 */
export const TYPE_ORDER: ResourceType[] = [
  "document",
  "stylesheet",
  "script",
  "font",
  "image",
  "fetch",
  "other",
];

export const TYPE_LABELS: Record<ResourceType, string> = {
  document: "Document",
  stylesheet: "CSS",
  script: "JS",
  font: "Fonts",
  image: "Images",
  fetch: "Fetch / XHR",
  other: "Other",
};

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
