import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { normalizeFlow } from "../src/steps/flow-migrations.js";
import { getStepCacheResources, getStepResources } from "../src/steps/step-resources.js";
import { summarizeFlowMetrics } from "../src/analysis/metrics-summary.js";
import type { DiagramStep, Flow, HarEntry, StepKind } from "../src/types.js";

// Flows written by earlier generators, from trimmed copies of the root fixtures (two pages,
// "Disable cache" with its trace and "Cache"): flow-v0 by commit 207fe81 (before versioning),
// flow-v2 by commit 23561d5 (FLOW_VERSION 2). Both carry the top-level topology and steps
// with copies of their entries.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

type StoredStep = DiagramStep & { resources?: HarEntry[]; cacheResources?: HarEntry[] };
type StoredFlow = Flow & { steps: StoredStep[] };

function loadStoredFlow(name: "flow-v0" | "flow-v2"): StoredFlow {
  return JSON.parse(
    readFileSync(join(__dirname, `fixtures/${name}.fixture.json`), "utf8")
  ) as StoredFlow;
}

// The kinds both stored flows narrate, page by page: the first page with its trace paints.
const EXPECTED_KINDS: [number, StepKind][] = [
  [0, "connection"],
  [0, "request"],
  [0, "ttfb"],
  [0, "critical"],
  [0, "fcp"],
  [0, "secondary"],
  [0, "lcp"],
  [0, "third-party"],
  [0, "loaded"],
  [1, "transition"],
  [1, "connection"],
  [1, "request"],
  [1, "ttfb"],
  [1, "critical"],
  [1, "secondary"],
  [1, "third-party"],
  [1, "loaded"],
];

const entryKey = (entry: HarEntry) => `${entry.startTime} ${entry.url}`;

describe.each(["flow-v0", "flow-v2"] as const)("normalizeFlow — stored %s", (name) => {
  it("derives the page and kind of every step from its title", () => {
    const normalized = normalizeFlow(loadStoredFlow(name));

    expect(normalized.steps.map((s) => [s.pageIndex, s.kind])).toEqual(EXPECTED_KINDS);
  });

  it("gives every page a topology and a cache report, and no third-party clusters", () => {
    const stored = loadStoredFlow(name);

    const normalized = normalizeFlow(stored);

    expect(normalized.pageAnalyses).toHaveLength(2);
    normalized.pageAnalyses.forEach((analysis, i) => {
      const source = stored.pageAnalyses?.[i] ?? stored;
      expect(analysis.nodes).toEqual(source.nodes);
      expect(analysis.paths).toEqual(source.paths);
      expect(analysis.cacheReport).toEqual(source.cacheReport);
      expect(analysis.thirdPartyClusters).toEqual([]);
      expect(analysis.nodes.map((n) => n.id)).toContain("origin");
    });
  });

  it("turns the copies of entries into references to the same page entries", () => {
    const stored = loadStoredFlow(name);

    const normalized = normalizeFlow(stored);

    let referenced = 0;
    normalized.steps.forEach((step, i) => {
      const original = stored.steps[i];
      expect(step).not.toHaveProperty("resources");
      expect(step).not.toHaveProperty("cacheResources");
      expect(getStepResources(normalized, step).map(entryKey)).toEqual(
        (original.resources ?? []).map(entryKey)
      );
      expect(getStepCacheResources(normalized, step).map(entryKey)).toEqual(
        (original.cacheResources ?? []).map(entryKey)
      );
      referenced += (step.resourceRefs?.length ?? 0) + (step.cacheResourceRefs?.length ?? 0);
    });
    expect(referenced).toBeGreaterThan(0);
    // Every copy matched an entry of its page: none was appended.
    normalized.pages.forEach((page, i) => {
      expect(page.har.entries).toHaveLength(stored.pages[i].har.entries.length);
    });
  });

  it("reads the same page metrics the stored steps show", () => {
    const [first, second] = summarizeFlowMetrics(normalizeFlow(loadStoredFlow(name)));

    expect(first.name).toBe("Disable cache");
    expect(Math.round(first.onLoad!)).toBe(480);
    expect(first.lcp).not.toBeNull();
    expect(second.name).toBe("Cache");
    expect(second.cacheHits).toBeGreaterThan(0);
  });
});

describe("normalizeFlow — version stamps", () => {
  it("reads a flow written before versioning as version 0 in the default region", () => {
    const normalized = normalizeFlow(loadStoredFlow("flow-v0"));

    expect(normalized.version).toBe(0);
    expect(normalized.clientRegion).toBe("default");
    expect(normalized.hints).toEqual({});
  });

  it("keeps the version, region and hints a version-2 flow carries", () => {
    const stored = loadStoredFlow("flow-v2");

    const normalized = normalizeFlow(stored);

    expect(normalized.version).toBe(2);
    expect(normalized.clientRegion).toBe(stored.clientRegion);
    expect(normalized.hints).toEqual(stored.hints);
  });
});
