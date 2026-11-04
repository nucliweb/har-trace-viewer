import type { DiagramPath, NodeKind } from "@htv/core";
import {
  CLUSTER_CACHE_SUBZONE_Y,
  GFW_ZONE_CAPTION_OFFSET,
  HEIGHT,
  anchors,
  bypassControls,
  inside,
  overlaps,
  sampleCurve,
} from "./geometry.js";
import type { BypassShape, NodePosition, NodePositions, Rect } from "./geometry.js";

/**
 * Paths that dip under the captions of the nodes they pass (browser → 3rd parties), and the
 * fan of paths to stacked third-party clusters: each one, in stack order, takes the gentlest
 * start and the shallowest dip that keeps it clear of every obstacle and one gap below the
 * path above it, with its timing label clear of the captions.
 */

// Browser → 3rd parties dips under the captions of the nodes it passes (GFW checkpoint, edge).
// Per node: the caption's last baseline plus descender below the node centre, its half-width,
// and how deep below the node centre the control points of the curve sit.
// Paths to stacked clusters also pass the origin.
export const BYPASS_CAPTIONS: Partial<
  Record<NodeKind, { bottom: number; halfWidth: number; controlDepth: number }>
> = {
  gfw: { bottom: 45, halfWidth: 50, controlDepth: 150 },
  edge: { bottom: 64, halfWidth: 75, controlDepth: 110 },
  origin: { bottom: 64, halfWidth: 75, controlDepth: 110 },
};
// Paths fanning out to stacked clusters dip under every caption they pass and turn up late
// towards their cluster. Each one, in stack order, takes the gentlest start and then the
// shallowest dip that keeps it clear of every obstacle and at least CLUSTER_FAN_GAP below the
// path above it once out of the client zone (where they all leave the browser together,
// without crossing), so they run side by side.
export const CLUSTER_FAN_GAP = 10;
const CLUSTER_CONTROL_1_XS = [0.33, 0.25, 0.18, 0.1];
const CLUSTER_CONTROL_2_X = 0.9;
const CONTROL_DEPTH_STEP = 2;
// Besides the captions they pass, the paths keep clear (their lanes included) of the GFW zone
// caption, of the cache sub-zone, of the bottom of the diagram and, when they can, of the
// browser caption.
const CAPTION_CLEARANCE = 12;
const BROWSER_CAPTION = { halfWidth: 30, top: 18, bottom: 42 };
const GFW_ZONE_CAPTION = {
  halfWidth: 84,
  top: CLUSTER_CACHE_SUBZONE_Y - GFW_ZONE_CAPTION_OFFSET - 18,
};
const CACHE_SUBZONE_TOP = CLUSTER_CACHE_SUBZONE_Y - 8;
const DIAGRAM_FLOOR_Y = HEIGHT - 16;
// Their timing labels sit on the dip, centred on their path, one slot each between the client
// zone and this fraction of the run, clear of the captions the paths pass.
export const CLUSTER_LABEL_SLOTS_END = 0.86;
// Labels read "avg 1234ms" at most. Past the room for them side by side, the slots
// interleave (paths 1, 3, 5 first, then 2, 4), so neighbouring slots hold labels of paths at
// least two fan gaps apart.
export const CLUSTER_LABEL = { halfWidth: 40, above: 10, below: 4, clearance: 8 };
export const CLUSTER_LABEL_BASELINE = 4;
// The GFW caption sits close to the browser: the curve leaves almost straight down to clear it.
export const BYPASS_STEEP_CONTROL_X = 0.1;
// The timing label of a bypassing path hangs under the lowest point of its curve.
export const BYPASS_LABEL_OFFSET = { centre: 12, response: 20 };

// Nodes of the request chain that lie between the two ends of a path, with a caption to avoid.
export function bypassed(from: NodePosition, to: NodePosition, nodes: NodePositions) {
  const [lo, hi] = [Math.min(from.cx, to.cx), Math.max(from.cx, to.cx)];
  return (["gfw", "edge", "origin"] as const).filter((id) => {
    const node = nodes[id];
    return node?.present && node.cx > lo && node.cx < hi;
  });
}

const clusterShape = (controlY: number, control1X: number): BypassShape => ({
  controlY,
  control1X,
  control2X: CLUSTER_CONTROL_2_X,
});

// Where the paths to stacked clusters must not run: above the bottom of the captions they pass
// (as far as each caption reaches), the browser caption, the bottom of the client zone and of
// the diagram.
function clusterObstacles(
  skipped: ReturnType<typeof bypassed>,
  nodes: NodePositions,
  clientZoneEnd: number,
  avoidBrowserCaption: boolean
): { path: Rect[]; captions: Rect[] } {
  const captions = skipped.map((id) => {
    const node = nodes[id]!;
    const caption = BYPASS_CAPTIONS[id]!;
    return {
      x0: node.cx - caption.halfWidth,
      x1: node.cx + caption.halfWidth,
      y0: -Infinity,
      y1: node.cy + caption.bottom,
    };
  });
  const browser = nodes.browser!;
  const clientCentre = clientZoneEnd / 2;
  const path: Rect[] = [
    ...captions.map((c) => ({ ...c, y1: c.y1 + CAPTION_CLEARANCE })),
    { x0: -Infinity, x1: clientZoneEnd, y0: CACHE_SUBZONE_TOP, y1: Infinity },
    { x0: -Infinity, x1: Infinity, y0: DIAGRAM_FLOOR_Y, y1: Infinity },
  ];
  if (nodes.gfw?.present) {
    path.push({
      x0: clientCentre - GFW_ZONE_CAPTION.halfWidth,
      x1: clientCentre + GFW_ZONE_CAPTION.halfWidth,
      y0: GFW_ZONE_CAPTION.top,
      y1: Infinity,
    });
  }
  if (avoidBrowserCaption) {
    path.push({
      x0: browser.cx - BROWSER_CAPTION.halfWidth,
      x1: browser.cx + BROWSER_CAPTION.halfWidth,
      y0: browser.cy + BROWSER_CAPTION.top,
      y1: browser.cy + BROWSER_CAPTION.bottom,
    });
  }
  return { captions, path };
}

// The point of a sampled curve at `x`, or its last point.
export const pointAt = (points: { x: number; y: number }[], x: number, run: number) =>
  points.find((p) => run * (p.x - x) >= 0) ?? points[points.length - 1];

// The height of a sampled curve at `x`, interpolated; undefined outside its run.
function heightAt(points: { x: number; y: number }[], x: number): number | undefined {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if ((a.x - x) * (b.x - x) <= 0) {
      return a.x === b.x ? a.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return undefined;
}

interface ClusterPath {
  from: NodePosition;
  to: NodePosition;
  path: DiagramPath;
  labelX: number;
}

// The shape of the paths to stacked clusters, in stack order (see CLUSTER_FAN_GAP), with their
// timing labels clear of the captions too. A path that cannot keep clear of the browser
// caption may graze it; one that fits nowhere takes the steepest start, one gap below the
// path above it.
export function solveClusterFan(
  clusterPaths: ClusterPath[],
  nodes: NodePositions,
  clientZoneEnd: number
): BypassShape[] {
  const shapes: BypassShape[] = [];
  const labels: Rect[] = [];
  let above: { x: number; y: number }[] | null = null;
  for (const cp of clusterPaths) {
    const ends = anchors(cp.from, cp.to, cp.path);
    const skipped = bypassed(cp.from, cp.to, nodes);
    const clearOfPathAbove = (points: { x: number; y: number }[]) =>
      !above ||
      points.every((p) => {
        const y = heightAt(above!, p.x);
        if (y === undefined || p.x <= clientZoneEnd || p.x > ends.x1 - CLUSTER_FAN_GAP) return true;
        return p.y >= y + CLUSTER_FAN_GAP;
      });
    const fits = (shape: BypassShape, avoidBrowserCaption: boolean) => {
      const obstacles = clusterObstacles(skipped, nodes, clientZoneEnd, avoidBrowserCaption);
      const points = sampleCurve(bypassControls(ends, shape));
      if (points.some((p) => obstacles.path.some((r) => inside(r, p.x, p.y)))) return null;
      if (!clearOfPathAbove(points)) return null;
      const { y } = pointAt(points, cp.labelX, ends.run);
      const { halfWidth, above: up, below, clearance } = CLUSTER_LABEL;
      const label = {
        x0: cp.labelX - halfWidth - clearance,
        x1: cp.labelX + halfWidth + clearance,
        y0: y - up - clearance,
        y1: y + below + clearance,
      };
      if (
        obstacles.captions.some((c) => overlaps(c, label)) ||
        labels.some((l) => overlaps(l, label)) ||
        label.y1 > HEIGHT
      ) {
        return null;
      }
      return points;
    };
    let found: { shape: BypassShape; points: { x: number; y: number }[] } | null = null;
    for (const avoidBrowserCaption of [true, false]) {
      for (const control1X of CLUSTER_CONTROL_1_XS) {
        for (
          let controlY = cp.from.cy;
          controlY <= 2 * HEIGHT && !found;
          controlY += CONTROL_DEPTH_STEP
        ) {
          const shape = clusterShape(controlY, control1X);
          const points = fits(shape, avoidBrowserCaption);
          if (points) found = { shape, points };
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) {
      const previous = shapes.at(-1);
      const shape = clusterShape(
        previous
          ? previous.controlY + CLUSTER_FAN_GAP
          : Math.max(...skipped.map((id) => nodes[id]!.cy + BYPASS_CAPTIONS[id]!.controlDepth)),
        BYPASS_STEEP_CONTROL_X
      );
      found = { shape, points: sampleCurve(bypassControls(ends, shape)) };
    }
    shapes.push(found.shape);
    const { y } = pointAt(found.points, cp.labelX, ends.run);
    labels.push({
      x0: cp.labelX - CLUSTER_LABEL.halfWidth,
      x1: cp.labelX + CLUSTER_LABEL.halfWidth,
      y0: y - CLUSTER_LABEL.above,
      y1: y + CLUSTER_LABEL.below,
    });
    above = found.points;
  }
  return shapes;
}

// A path to one of several stacked clusters: its curve (see solveClusterFan) and the x of
// its timing label slot.
export interface ClusterFan {
  shape: BypassShape;
  labelX: number;
}
