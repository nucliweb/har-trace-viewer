import { describe, expect, it } from "vitest";
import type { NetworkRegion } from "@htv/core";
import { regionLabel } from "../src/lib/region-label.js";

// Typed as the full union: adding a region to NetworkRegion makes this object fail to compile.
const EXPECTED: Record<NetworkRegion, string> = {
  europe: "Europe",
  "united-states": "United States",
  "north-america": "North America",
  "south-america": "South America",
  "asia-pacific": "Asia-Pacific",
  china: "China",
  "middle-east": "Middle East",
  africa: "Africa",
  "azure-cloud": "Azure Cloud",
  client: "Client",
  edge: "Edge",
  origin: "Origin",
};

describe("regionLabel", () => {
  it.each(Object.entries(EXPECTED))("labels %s as %s", (region, label) => {
    expect(regionLabel(region as NetworkRegion)).toBe(label);
  });
});
