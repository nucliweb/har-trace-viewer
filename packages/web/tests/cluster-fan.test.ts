import { describe, expect, it } from "vitest";
import type { DiagramPath, NodeId, PathId } from "@htv/core";
import {
  BYPASS_CAPTIONS,
  CLUSTER_FAN_GAP,
  solveClusterFan,
} from "../src/components/diagram/cluster-fan.js";
import { anchors, bypassControls, sampleCurve } from "../src/components/diagram/geometry.js";
import type { NodePosition, NodePositions } from "../src/components/diagram/geometry.js";

// A 3-zone layout with stacked clusters: browser, edge and origin on the row, three clusters
// stacked in the third-party zone, the client zone ending at x = 215.
const CLIENT_ZONE_END = 215;
const browser: NodePosition = { cx: 100, cy: 240, present: true };
const edge: NodePosition = { cx: 312, cy: 240, present: true };
const origin: NodePosition = { cx: 505, cy: 200, present: true };
const clusters = [170, 240, 310].map((cy, i) => ({
  id: `third-parties:cluster-${i}` as NodeId,
  position: { cx: 760, cy, present: true, captionRight: true } as NodePosition,
}));
const nodes: NodePositions = {
  browser,
  edge,
  origin,
  ...Object.fromEntries(clusters.map((c) => [c.id, c.position])),
};
const clusterPaths = clusters.map((c, i) => {
  const path: DiagramPath = { id: `browser-${c.id}` as PathId, from: "browser", to: c.id };
  return { from: browser, to: c.position, path, labelX: 300 + i * 90 };
});

interface Point {
  x: number;
  y: number;
}
const heightAt = (points: Point[], x: number): number | undefined => {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if ((a.x - x) * (b.x - x) <= 0) return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return undefined;
};

describe("solveClusterFan", () => {
  const shapes = solveClusterFan(clusterPaths, nodes, CLIENT_ZONE_END);
  const curves = clusterPaths.map((cp, i) =>
    sampleCurve(bypassControls(anchors(cp.from, cp.to, cp.path), shapes[i]))
  );

  it("gives one curve per stacked cluster, each dipping deeper than the one above", () => {
    expect(shapes).toHaveLength(3);
    expect(shapes[1].controlY).toBeGreaterThanOrEqual(shapes[0].controlY + CLUSTER_FAN_GAP);
    expect(shapes[2].controlY).toBeGreaterThanOrEqual(shapes[1].controlY + CLUSTER_FAN_GAP);
  });

  it("keeps every curve at least one fan gap below the one above it outside the client zone", () => {
    for (let i = 1; i < curves.length; i++) {
      const end = curves[i][curves[i].length - 1].x - CLUSTER_FAN_GAP;
      for (let x = CLIENT_ZONE_END + 1; x < end; x += 5) {
        const upper = heightAt(curves[i - 1], x);
        const lower = heightAt(curves[i], x);
        if (upper === undefined || lower === undefined) continue;
        expect(lower, `curve ${i} at x=${x}`).toBeGreaterThanOrEqual(upper + CLUSTER_FAN_GAP);
      }
    }
  });

  it("runs under the captions of the edge and origin nodes it passes", () => {
    for (const [i, curve] of curves.entries()) {
      for (const [id, node] of [
        ["edge", edge],
        ["origin", origin],
      ] as const) {
        const caption = BYPASS_CAPTIONS[id]!;
        const under = curve.filter((p) => Math.abs(p.x - node.cx) <= caption.halfWidth);
        expect(under.length, `curve ${i} passes ${id}`).toBeGreaterThan(0);
        for (const p of under) {
          expect(p.y, `curve ${i} under the ${id} caption at x=${p.x}`).toBeGreaterThanOrEqual(
            node.cy + caption.bottom
          );
        }
      }
    }
  });
});
