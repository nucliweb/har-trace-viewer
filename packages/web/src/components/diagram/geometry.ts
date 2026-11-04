import { nodeKind } from "@htv/core";
import type { DiagramPath, NodeId, NodeKind } from "@htv/core";

/**
 * Geometry primitives of the diagram: its size, where the nodes sit, the anchors of a path
 * and the Bezier curves between them, and the rectangles the paths keep clear of.
 */

export const WIDTH = 900;
export const HEIGHT = 480;
// The diagram stretches with its container, up to this many units wide.
export const MAX_WIDTH = 2400;
// The client zone's browser-cache sub-zone starts here; the GFW zone caption sits just above.
// With stacked third-party clusters it starts lower, leaving their paths room to fan out.
export const CACHE_SUBZONE_Y = 370;
export const CLUSTER_CACHE_SUBZONE_Y = 430;
export const GFW_ZONE_CAPTION_OFFSET = 8;

export type NodePositions = Partial<Record<NodeId, NodePosition>>;

export interface NodePosition {
  cx: number;
  cy: number;
  present: boolean;
  // Stacked third-party clusters caption themselves right of their glyph, so the paths
  // arriving from the left never cross a caption; so does the browser cache, low in its band.
  captionRight?: boolean;
}

// Distance from a node centre to where its paths attach, roughly half the glyph width.
export const ANCHOR_RADIUS: Record<NodeKind, number> = {
  browser: 20,
  cache: 15,
  gfw: 17,
  edge: 19,
  origin: 19,
  "third-parties": 19,
};
// Paths leave their source slightly tilted towards the target, so fanned-out paths separate.
export const SOURCE_LEAN = 3;
// Request lane above the path, response lane below.
export const LANE_OFFSET = 5;
// Bezier control points as fractions of the run (x) and the rise (y) between the anchors.
export const CONTROL_1 = { x: 0.33, y: 0.25 };
export const CONTROL_2 = { x: 0.72, y: 0.75 };

export const round = (value: number) => Math.round(value);

// A curve that dips under captions: both control points sit at `controlY`, at these
// fractions of the run.
export interface BypassShape {
  controlY: number;
  control1X: number;
  control2X: number;
}

// With `bypass` both control points sit at its height instead of between the anchors.
export function bezier(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bypass?: BypassShape
): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const points = [
    [x0, y0],
    [x0 + (bypass?.control1X ?? CONTROL_1.x) * dx, bypass?.controlY ?? y0 + CONTROL_1.y * dy],
    [x0 + (bypass?.control2X ?? CONTROL_2.x) * dx, bypass?.controlY ?? y0 + CONTROL_2.y * dy],
    [x1, y1],
  ].map(([x, y]) => `${round(x)},${round(y)}`);
  return `M ${points[0]} C ${points.slice(1).join(" ")}`;
}

// A point of a cubic Bezier curve given by its four control points.
export function cubicPoint(px: number[], py: number[], t: number) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: w.reduce((sum, k, j) => sum + k * px[j], 0),
    y: w.reduce((sum, k, j) => sum + k * py[j], 0),
  };
}

export interface Anchors {
  run: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function anchors(from: NodePosition, to: NodePosition, path: DiagramPath): Anchors {
  const run = Math.sign(to.cx - from.cx) || 1;
  const rise = Math.sign(to.cy - from.cy);
  return {
    run,
    x0: from.cx + run * ANCHOR_RADIUS[nodeKind(path.from)],
    y0: from.cy + rise * SOURCE_LEAN,
    x1: to.cx - run * ANCHOR_RADIUS[nodeKind(path.to)],
    y1: to.cy,
  };
}

export function bypassControls({ x0, y0, x1, y1 }: Anchors, shape: BypassShape) {
  const dx = x1 - x0;
  return {
    px: [x0, x0 + shape.control1X * dx, x0 + shape.control2X * dx, x1],
    py: [y0, shape.controlY, shape.controlY, y1],
  };
}

export const sampleCurve = ({ px, py }: { px: number[]; py: number[] }) =>
  Array.from({ length: 101 }, (_, i) => cubicPoint(px, py, i / 100));

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const inside = (r: Rect, x: number, y: number) =>
  x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
export const overlaps = (a: Rect, b: Rect) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
