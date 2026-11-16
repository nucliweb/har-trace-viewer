import { describe, expect, it } from "vitest";
import {
  FINDING_EVIDENCE_PREVIEW,
  FINDING_SEVERITIES,
  RESOURCE_TYPE_ORDER,
  findingMetricLabel,
} from "../src/utils/presentation.js";

describe("RESOURCE_TYPE_ORDER", () => {
  it("lists every resource type once: render-critical first, then images, runtime requests, the rest", () => {
    expect(RESOURCE_TYPE_ORDER).toEqual([
      "document",
      "stylesheet",
      "script",
      "font",
      "image",
      "fetch",
      "other",
    ]);
  });
});

describe("FINDING_SEVERITIES", () => {
  it("lists the severities from the most severe to the least", () => {
    expect(FINDING_SEVERITIES).toEqual(["critical", "warning", "info", "good"]);
  });
});

describe("FINDING_EVIDENCE_PREVIEW", () => {
  it("shows three evidence rows of a finding before its evidence is expanded", () => {
    expect(FINDING_EVIDENCE_PREVIEW).toBe(3);
  });
});

describe("findingMetricLabel", () => {
  it("writes the Core Web Vitals and TTFB in capitals", () => {
    const vitals = ["ttfb", "fcp", "lcp", "cls", "inp"] as const;
    expect(vitals.map((metric) => findingMetricLabel(metric))).toEqual([
      "TTFB",
      "FCP",
      "LCP",
      "CLS",
      "INP",
    ]);
  });

  it("keeps the other metrics as they are and has no label for none", () => {
    expect(findingMetricLabel("transfer")).toBe("transfer");
    expect(findingMetricLabel("requests")).toBe("requests");
    expect(findingMetricLabel("none")).toBeNull();
  });
});
