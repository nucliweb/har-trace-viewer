import { describe, it, expect } from "vitest";
import { clusterNode, clusterThirdParties } from "../src/steps/third-party-clusters.js";
import { makeEntry } from "./helpers/synthetic-har.js";

describe("clusterNode", () => {
  const [cluster] = clusterThirdParties(
    [makeEntry({ url: "https://tracker.example.net/t.js" })],
    500
  );

  it("captions a direct cluster with its busiest host", () => {
    expect(clusterNode(cluster!).subLabel).toBe("tracker.example.net");
  });

  it("has no caption for a cluster without hosts instead of failing on an undefined host", () => {
    expect(clusterNode({ ...cluster!, hosts: [] }).subLabel).toBe("");
  });
});
