import type { NetworkRegion } from "@htv/core";

// Record keeps the labels exhaustive: a new NetworkRegion fails the typecheck until labelled.
const LABELS: Record<NetworkRegion, string> = {
  china: "China",
  "asia-pacific": "Asia-Pacific",
  europe: "Europe",
  "azure-cloud": "Azure Cloud",
  "united-states": "United States",
  "north-america": "North America",
  "south-america": "South America",
  africa: "Africa",
  "middle-east": "Middle East",
  client: "Client",
  edge: "Edge",
  origin: "Origin",
};

export function regionLabel(region: NetworkRegion): string {
  return LABELS[region];
}
