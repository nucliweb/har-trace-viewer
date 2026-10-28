import type { DiagramNode, DiagramPath, NetworkRegion, NodeId, PathId } from "@htv/core";

/**
 * Diagram geometry. The only hand-placed coordinates are the zone boundaries and the node
 * columns of each layout; path curves, request/response lanes and timing label positions are
 * derived from the node centres.
 */

export const WIDTH = 900;
export const HEIGHT = 480;

export type ZoneId = "client" | "edge" | "intermediate" | "origin";

export interface LayoutOptions {
  // The client sits behind the Great Firewall: China zone with a GFW checkpoint column.
  hasGfw: boolean;
  hasCdn: boolean;
  // Third parties live in their own region, between the edge and the origin.
  hasIntermediateZone: boolean;
}

export interface Zone {
  id: ZoneId;
  label: string;
  x0: number;
  x1: number;
  color: string;
}

export interface NodePosition {
  cx: number;
  cy: number;
  present: boolean;
}

export interface PathGeometry {
  d: string;
  requestD: string;
  responseD: string;
  labelX: number;
  labelY: number;
  // The centre-lane label hangs below its anchor (paths heading down to the third parties).
  labelBelow: boolean;
  requestLabelY: number;
  responseLabelY: number;
}

export interface Layout {
  width: number;
  height: number;
  zones: Zone[];
  nodes: Partial<Record<NodeId, NodePosition>>;
  paths: Partial<Record<PathId, PathGeometry>>;
}

type LayoutId = "noGfw_cdn" | "noGfw_noCdn" | "gfw_cdn" | "gfw_noCdn" | "gfw_cdn_4";

// Node centre x per column set. Origin and third parties share a column unless the third
// parties have a zone of their own.
const CLIENT_COLUMNS = { browser: 130, edge: 400, origin: 700, "third-parties": 700 };
const GFW_COLUMNS = { browser: 90, gfw: 210, edge: 400, origin: 700, "third-parties": 700 };
const FOUR_ZONE_COLUMNS = { browser: 75, gfw: 178, edge: 322, origin: 770, "third-parties": 535 };

interface LayoutSpec {
  // Right edge of every zone but the last one, which ends at WIDTH.
  bounds: number[];
  columns: Partial<Record<NodeId, number>>;
}

const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  noGfw_cdn: { bounds: [265, 555], columns: CLIENT_COLUMNS },
  noGfw_noCdn: { bounds: [415], columns: CLIENT_COLUMNS },
  gfw_cdn: { bounds: [290, 555], columns: GFW_COLUMNS },
  gfw_noCdn: { bounds: [290], columns: GFW_COLUMNS },
  gfw_cdn_4: { bounds: [215, 430, 645], columns: FOUR_ZONE_COLUMNS },
};

// Node rows: the request chain runs along one row; origin and third parties stack in their column.
const ROW_Y = 240;
const THIRD_PARTIES_Y = 310;
const ORIGIN_STACKED_Y = 200;
const ORIGIN_ALONE_Y = 215;

// Distance from a node centre to where its paths attach, roughly half the glyph width.
const ANCHOR_RADIUS: Record<NodeId, number> = {
  browser: 20,
  gfw: 17,
  edge: 19,
  origin: 19,
  "third-parties": 19,
};
// Paths leave their source slightly tilted towards the target, so fanned-out paths separate.
const SOURCE_LEAN = 3;
// Request lane above the path, response lane below.
const LANE_OFFSET = 5;
// Bezier control points as fractions of the run (x) and the rise (y) between the anchors.
const CONTROL_1 = { x: 0.33, y: 0.25 };
const CONTROL_2 = { x: 0.72, y: 0.75 };

// Hops shorter than this leave no room between the nodes: their label sits above the row.
const SHORT_HOP = 180;
const SHORT_HOP_LABEL_RISE = 35;
// Label baselines relative to the midpoint of a path, per lane.
const LABEL_OFFSET = { centre: -9.25, request: -16.25, response: 22.75 };
// Paths heading down (to the third parties) label just above their target, response below it.
const DOWNWARD_LABEL_OFFSET = { centre: -2, response: 20 };

// Browser → 3rd parties dips under the captions of the nodes it passes (GFW checkpoint, edge).
// Per node: the caption's last baseline plus descender below the node centre, its half-width,
// and how deep below the node centre the control points of the curve sit.
const BYPASS_CAPTIONS: Partial<
  Record<NodeId, { bottom: number; halfWidth: number; controlDepth: number }>
> = {
  gfw: { bottom: 45, halfWidth: 50, controlDepth: 150 },
  edge: { bottom: 64, halfWidth: 75, controlDepth: 110 },
};
// The GFW caption sits close to the browser: the curve leaves almost straight down to clear it.
const BYPASS_STEEP_CONTROL_X = 0.1;
// The timing label of a bypassing path hangs under the lowest point of its curve.
const BYPASS_LABEL_OFFSET = { centre: 12, response: 20 };

const ZONE_LABELS: Partial<Record<NetworkRegion, string>> = {
  china: "CHINA",
  "asia-pacific": "ASIA-PACIFIC",
  europe: "EUROPE",
  "azure-cloud": "AZURE CLOUD",
  "united-states": "UNITED STATES",
  client: "CLIENT",
  edge: "EDGE / CDN",
  origin: "ORIGIN",
};

const ZONE_COLORS: Partial<Record<NetworkRegion, string>> = {
  china: "var(--color-red)",
  "asia-pacific": "var(--color-cyan)",
  europe: "var(--color-orange)",
  "azure-cloud": "var(--color-orange)",
  "united-states": "var(--color-green)",
  client: "var(--color-cyan)",
  edge: "var(--color-orange)",
  origin: "var(--color-green)",
};

const find = (nodes: DiagramNode[], id: NodeId) => nodes.find((n) => n.id === id);

export function layoutOptions(nodes: DiagramNode[]): LayoutOptions {
  const hasGfw = find(nodes, "gfw")?.present ?? false;
  const hasCdn = find(nodes, "edge")?.present ?? false;
  const thirdParties = find(nodes, "third-parties");
  const thirdPartyRegion = thirdParties?.region ?? "origin";
  const originRegion = find(nodes, "origin")?.region ?? "origin";
  return {
    hasGfw,
    hasCdn,
    hasIntermediateZone:
      hasGfw &&
      hasCdn &&
      !!thirdParties?.present &&
      thirdPartyRegion !== "origin" &&
      thirdPartyRegion !== originRegion,
  };
}

function layoutId({ hasGfw, hasCdn, hasIntermediateZone }: LayoutOptions): LayoutId {
  if (hasIntermediateZone) return "gfw_cdn_4";
  if (hasGfw) return hasCdn ? "gfw_cdn" : "gfw_noCdn";
  return hasCdn ? "noGfw_cdn" : "noGfw_noCdn";
}

function zoneRegions(
  nodes: DiagramNode[],
  options: LayoutOptions
): { id: ZoneId; region: NetworkRegion }[] {
  const regions: { id: ZoneId; region: NetworkRegion }[] = [
    { id: "client", region: options.hasGfw ? "china" : "client" },
  ];
  if (options.hasCdn) regions.push({ id: "edge", region: find(nodes, "edge")?.region ?? "edge" });
  if (options.hasIntermediateZone) {
    regions.push({
      id: "intermediate",
      region: find(nodes, "third-parties")?.region ?? "origin",
    });
  }
  regions.push({ id: "origin", region: find(nodes, "origin")?.region ?? "origin" });
  return regions;
}

function zones(nodes: DiagramNode[], options: LayoutOptions, bounds: number[]): Zone[] {
  const edges = [0, ...bounds, WIDTH];
  return zoneRegions(nodes, options).map(({ id, region }, i) => ({
    id,
    label: ZONE_LABELS[region] ?? region.toUpperCase(),
    x0: edges[i],
    x1: edges[i + 1],
    color: ZONE_COLORS[region] ?? "var(--color-cyan)",
  }));
}

function nodeY(id: NodeId, columns: LayoutSpec["columns"]): number {
  if (id === "third-parties") return THIRD_PARTIES_Y;
  if (id === "origin") {
    return columns.origin === columns["third-parties"] ? ORIGIN_STACKED_Y : ORIGIN_ALONE_Y;
  }
  return ROW_Y;
}

function positions(
  nodes: DiagramNode[],
  columns: LayoutSpec["columns"]
): Partial<Record<NodeId, NodePosition>> {
  const result: Partial<Record<NodeId, NodePosition>> = {};
  for (const node of nodes) {
    const cx = columns[node.id];
    if (cx === undefined) continue;
    result[node.id] = { cx, cy: nodeY(node.id, columns), present: node.present };
  }
  return result;
}

const round = (value: number) => Math.round(value);

// With `controlY` both control points sit at that height instead of between the anchors.
function bezier(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bypass?: { controlY: number; control1X: number }
): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const points = [
    [x0, y0],
    [x0 + (bypass?.control1X ?? CONTROL_1.x) * dx, bypass?.controlY ?? y0 + CONTROL_1.y * dy],
    [x0 + CONTROL_2.x * dx, bypass?.controlY ?? y0 + CONTROL_2.y * dy],
    [x1, y1],
  ].map(([x, y]) => `${round(x)},${round(y)}`);
  return `M ${points[0]} C ${points.slice(1).join(" ")}`;
}

// Nodes of the request chain that lie between the two ends of a path, with a caption to avoid.
function bypassed(from: NodePosition, to: NodePosition, nodes: Layout["nodes"]) {
  const [lo, hi] = [Math.min(from.cx, to.cx), Math.max(from.cx, to.cx)];
  return (["gfw", "edge"] as const).filter((id) => {
    const node = nodes[id];
    return node?.present && node.cx > lo && node.cx < hi;
  });
}

function pathGeometry(
  from: NodePosition,
  to: NodePosition,
  path: DiagramPath,
  nodes: Layout["nodes"]
): PathGeometry {
  const run = Math.sign(to.cx - from.cx) || 1;
  const rise = Math.sign(to.cy - from.cy);
  const x0 = from.cx + run * ANCHOR_RADIUS[path.from];
  const y0 = from.cy + rise * SOURCE_LEAN;
  const x1 = to.cx - run * ANCHOR_RADIUS[path.to];
  const y1 = to.cy;
  const skipped = path.id === "browser-third-parties" ? bypassed(from, to, nodes) : [];
  const controlY = Math.max(
    ...skipped.map((id) => nodes[id]!.cy + BYPASS_CAPTIONS[id]!.controlDepth)
  );
  const control1X = skipped.includes("gfw") ? BYPASS_STEEP_CONTROL_X : CONTROL_1.x;
  const lane = (offset: number) =>
    bezier(
      x0,
      y0 + offset,
      x1,
      y1 + offset,
      skipped.length ? { controlY: controlY + offset, control1X } : undefined
    );

  if (skipped.length) {
    // Lowest point of the centre curve, sampled.
    const dx = x1 - x0;
    const px = [x0, x0 + control1X * dx, x0 + CONTROL_2.x * dx, x1];
    const py = [y0, controlY, controlY, y1];
    let low = { x: x0, y: y0 };
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const y = w.reduce((sum, k, j) => sum + k * py[j], 0);
      if (y > low.y) low = { x: w.reduce((sum, k, j) => sum + k * px[j], 0), y };
    }
    const y = low.y + BYPASS_LABEL_OFFSET.centre;
    return {
      d: lane(0),
      requestD: lane(-LANE_OFFSET),
      responseD: lane(LANE_OFFSET),
      labelX: low.x,
      labelY: y,
      labelBelow: true,
      requestLabelY: y,
      responseLabelY: low.y + BYPASS_LABEL_OFFSET.response,
    };
  }

  const labelX = (x0 + x1) / 2;
  const midY = (y0 + y1) / 2;
  let labels: Pick<PathGeometry, "labelY" | "labelBelow" | "requestLabelY" | "responseLabelY">;
  if (Math.abs(x1 - x0) < SHORT_HOP) {
    const y = Math.min(from.cy, to.cy) - SHORT_HOP_LABEL_RISE;
    labels = { labelY: y, labelBelow: false, requestLabelY: y, responseLabelY: y };
  } else if (rise > 0) {
    const y = y1 + DOWNWARD_LABEL_OFFSET.centre;
    labels = {
      labelY: y,
      labelBelow: true,
      requestLabelY: y,
      responseLabelY: y1 + DOWNWARD_LABEL_OFFSET.response,
    };
  } else {
    labels = {
      labelY: midY + LABEL_OFFSET.centre,
      labelBelow: false,
      requestLabelY: midY + LABEL_OFFSET.request,
      responseLabelY: midY + LABEL_OFFSET.response,
    };
  }

  return {
    d: lane(0),
    requestD: lane(-LANE_OFFSET),
    responseD: lane(LANE_OFFSET),
    labelX,
    ...labels,
  };
}

export function layout(
  nodes: DiagramNode[],
  paths: DiagramPath[],
  options: LayoutOptions = layoutOptions(nodes)
): Layout {
  const spec = LAYOUTS[layoutId(options)];
  const nodePositions = positions(nodes, spec.columns);
  const pathGeometries: Partial<Record<PathId, PathGeometry>> = {};
  for (const path of paths) {
    const from = nodePositions[path.from];
    const to = nodePositions[path.to];
    if (from && to) pathGeometries[path.id] = pathGeometry(from, to, path, nodePositions);
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    zones: zones(nodes, options, spec.bounds),
    nodes: nodePositions,
    paths: pathGeometries,
  };
}
