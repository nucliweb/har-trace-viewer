import { nodeKind } from "@htv/core";
import { regionLabel } from "../../lib/region-label.js";
import type { DiagramNode, DiagramPath, NetworkRegion, NodeId, NodeKind, PathId } from "@htv/core";
import {
  BYPASS_CAPTIONS,
  BYPASS_LABEL_OFFSET,
  BYPASS_STEEP_CONTROL_X,
  CLUSTER_LABEL,
  CLUSTER_LABEL_BASELINE,
  CLUSTER_LABEL_SLOTS_END,
  bypassed,
  pointAt,
  solveClusterFan,
} from "./cluster-fan.js";
import type { ClusterFan } from "./cluster-fan.js";
import {
  ANCHOR_RADIUS,
  CACHE_SUBZONE_Y,
  CLUSTER_CACHE_SUBZONE_Y,
  CONTROL_1,
  CONTROL_2,
  HEIGHT,
  LANE_OFFSET,
  WIDTH,
  anchors,
  bezier,
  bypassControls,
  round,
  sampleCurve,
} from "./geometry.js";
import type { BypassShape, NodePosition, NodePositions } from "./geometry.js";

export { GFW_ZONE_CAPTION_OFFSET, HEIGHT, MAX_WIDTH, WIDTH } from "./geometry.js";
export type { NodePosition } from "./geometry.js";

/**
 * Diagram geometry. The only hand-placed coordinates are the zone boundaries and the node
 * columns of each layout; path curves, request/response lanes and timing label positions are
 * derived from the node centres.
 */

export type ZoneId = "client" | "edge" | "intermediate" | "origin" | "third-parties";

interface LayoutOptions {
  // The client sits behind the Great Firewall: China zone with a GFW checkpoint column.
  hasGfw: boolean;
  hasCdn: boolean;
  // Third parties live in their own region, between the edge and the origin.
  hasIntermediateZone: boolean;
  // Several third-party clusters: their nodes stack in a right-most zone of their own.
  hasThirdPartyZone: boolean;
}

export interface Zone {
  id: ZoneId;
  label: string;
  x0: number;
  x1: number;
  color: string;
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

interface Layout {
  width: number;
  height: number;
  // Top of the browser-cache sub-zone of the client zone.
  cacheSubzoneY: number;
  zones: Zone[];
  nodes: NodePositions;
  paths: Partial<Record<PathId, PathGeometry>>;
}

type LayoutId =
  | "noGfw_cdn"
  | "noGfw_noCdn"
  | "gfw_cdn"
  | "gfw_noCdn"
  | "gfw_cdn_4"
  | "noGfw_cdn_tp"
  | "noGfw_noCdn_tp"
  | "gfw_cdn_tp"
  | "gfw_noCdn_tp";

// Node centre x per column set. Origin and a single third-parties node share a column
// unless the third parties have a zone of their own; several clusters stack in a column
// right of the origin.
const CLIENT_COLUMNS = { browser: 130, edge: 400, origin: 700, "third-parties": 700 };
const GFW_COLUMNS = { browser: 90, gfw: 210, edge: 400, origin: 700, "third-parties": 700 };
const FOUR_ZONE_COLUMNS = { browser: 75, gfw: 178, edge: 322, origin: 770, "third-parties": 535 };
const CLUSTER_COLUMNS = { browser: 100, edge: 312, origin: 505, "third-parties": 684 };
const CLUSTER_GFW_COLUMNS = { browser: 75, gfw: 200, edge: 342, origin: 515, "third-parties": 684 };
const CLUSTER_NO_CDN_COLUMNS = { browser: 110, origin: 430, "third-parties": 684 };
const CLUSTER_GFW_NO_CDN_COLUMNS = { browser: 75, gfw: 200, origin: 445, "third-parties": 684 };

interface LayoutSpec {
  // Right edge of every zone but the last one, which ends at WIDTH.
  bounds: number[];
  columns: Partial<Record<NodeKind, number>>;
}

const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  noGfw_cdn: { bounds: [265, 555], columns: CLIENT_COLUMNS },
  noGfw_noCdn: { bounds: [415], columns: CLIENT_COLUMNS },
  gfw_cdn: { bounds: [290, 555], columns: GFW_COLUMNS },
  gfw_noCdn: { bounds: [290], columns: GFW_COLUMNS },
  gfw_cdn_4: { bounds: [215, 430, 645], columns: FOUR_ZONE_COLUMNS },
  noGfw_cdn_tp: { bounds: [215, 410, 620], columns: CLUSTER_COLUMNS },
  noGfw_noCdn_tp: { bounds: [260, 620], columns: CLUSTER_NO_CDN_COLUMNS },
  gfw_cdn_tp: { bounds: [262, 425, 620], columns: CLUSTER_GFW_COLUMNS },
  gfw_noCdn_tp: { bounds: [262, 620], columns: CLUSTER_GFW_NO_CDN_COLUMNS },
};

// Node rows: the request chain runs along one row; origin and third parties stack in their column.
const ROW_Y = 240;
const THIRD_PARTIES_Y = 310;
const ORIGIN_STACKED_Y = 200;
const ORIGIN_ALONE_Y = 215;

// Cluster nodes stack evenly around this centre, at most this far apart. A node with its
// three-line caption beside it spans from 19 px above its centre to 23 px below it.
const CLUSTER_STACK_CENTRE_Y = 262;
const CLUSTER_STACK_SPAN = 280;
const CLUSTER_MAX_SPACING = 80;

// Hops shorter than this leave no room between the nodes: their label sits above the row.
const SHORT_HOP = 180;
const SHORT_HOP_LABEL_RISE = 35;
// Label baselines relative to the midpoint of a path, per lane.
const LABEL_OFFSET = { centre: -9.25, request: -16.25, response: 22.75 };
// Paths heading down (to the third parties) label just above their target, response below it.
const DOWNWARD_LABEL_OFFSET = { centre: -2, response: 20 };

// Zone captions are the region labels, uppercased; the zones that are not places keep
// captions of their own.
const ZONE_LABELS: Partial<Record<NetworkRegion, string>> = {
  client: "CLIENT",
  edge: "EDGE / CDN",
  origin: "ORIGIN",
};
const zoneLabel = (region: NetworkRegion) =>
  ZONE_LABELS[region] ?? regionLabel(region).toUpperCase();

const ZONE_COLORS: Partial<Record<NetworkRegion, string>> = {
  china: "var(--color-red)",
  "asia-pacific": "var(--color-cyan)",
  europe: "var(--color-orange)",
  "azure-cloud": "var(--color-orange)",
  "united-states": "var(--color-green)",
  "north-america": "var(--color-green)",
  "south-america": "var(--color-orange)",
  africa: "var(--color-orange)",
  "middle-east": "var(--color-cyan)",
  client: "var(--color-cyan)",
  edge: "var(--color-orange)",
  origin: "var(--color-green)",
};

const find = (nodes: DiagramNode[], id: NodeId) => nodes.find((n) => n.id === id);

const isCluster = (id: NodeId) => id !== "third-parties" && nodeKind(id) === "third-parties";

export function layoutOptions(nodes: DiagramNode[]): LayoutOptions {
  const hasGfw = find(nodes, "gfw")?.present ?? false;
  const hasCdn = find(nodes, "edge")?.present ?? false;
  const thirdParties = find(nodes, "third-parties");
  const thirdPartyRegion = thirdParties?.region ?? "origin";
  const originRegion = find(nodes, "origin")?.region ?? "origin";
  return {
    hasGfw,
    hasCdn,
    hasThirdPartyZone: nodes.filter((n) => isCluster(n.id) && n.present).length > 1,
    hasIntermediateZone:
      hasGfw &&
      hasCdn &&
      !!thirdParties?.present &&
      thirdPartyRegion !== "origin" &&
      thirdPartyRegion !== originRegion,
  };
}

function layoutId({
  hasGfw,
  hasCdn,
  hasIntermediateZone,
  hasThirdPartyZone,
}: LayoutOptions): LayoutId {
  if (hasThirdPartyZone) {
    if (hasGfw) return hasCdn ? "gfw_cdn_tp" : "gfw_noCdn_tp";
    return hasCdn ? "noGfw_cdn_tp" : "noGfw_noCdn_tp";
  }
  if (hasIntermediateZone) return "gfw_cdn_4";
  if (hasGfw) return hasCdn ? "gfw_cdn" : "gfw_noCdn";
  return hasCdn ? "noGfw_cdn" : "noGfw_noCdn";
}

// Regions that say how a node is reached rather than where it is.
const NON_GEOGRAPHIC_REGIONS = new Set<NetworkRegion>(["client", "edge", "origin"]);
// The cluster zone when its clusters span several regions (or none in particular).
const THIRD_PARTIES_ZONE = "third-parties";
type ZoneRegion = NetworkRegion | typeof THIRD_PARTIES_ZONE;

function zoneRegions(
  nodes: DiagramNode[],
  options: LayoutOptions
): { id: ZoneId; region: ZoneRegion }[] {
  const regions: { id: ZoneId; region: ZoneRegion }[] = [
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
  if (options.hasThirdPartyZone) {
    const clusterRegions = new Set(nodes.filter((n) => isCluster(n.id)).map((n) => n.region));
    const [shared] = clusterRegions;
    regions.push({
      id: "third-parties",
      // Named after the region of the clusters when they all share a geographic one.
      region:
        clusterRegions.size === 1 && shared && !NON_GEOGRAPHIC_REGIONS.has(shared)
          ? shared
          : THIRD_PARTIES_ZONE,
    });
  }
  return regions;
}

function zones(nodes: DiagramNode[], options: LayoutOptions, edges: number[]): Zone[] {
  return zoneRegions(nodes, options).map(({ id, region }, i) => ({
    id,
    label: region === THIRD_PARTIES_ZONE ? "3RD PARTIES" : zoneLabel(region),
    x0: edges[i],
    x1: edges[i + 1],
    color:
      region === THIRD_PARTIES_ZONE
        ? "var(--color-node-third-parties)"
        : (ZONE_COLORS[region] ?? "var(--color-cyan)"),
  }));
}

function nodeY(kind: NodeKind, columns: LayoutSpec["columns"]): number {
  if (kind === "third-parties") return THIRD_PARTIES_Y;
  if (kind === "origin") {
    return columns.origin === columns["third-parties"] ? ORIGIN_STACKED_Y : ORIGIN_ALONE_Y;
  }
  return ROW_Y;
}

// Centres of `count` cluster nodes stacked top to bottom, evenly spaced around the row.
function clusterYs(count: number): number[] {
  const spacing = count > 1 ? Math.min(CLUSTER_MAX_SPACING, CLUSTER_STACK_SPAN / (count - 1)) : 0;
  const top = CLUSTER_STACK_CENTRE_Y - (spacing * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => round(top + i * spacing));
}

function positions(
  nodes: DiagramNode[],
  columns: LayoutSpec["columns"],
  options: LayoutOptions,
  cacheSubzoneY: number
): Partial<Record<NodeId, NodePosition>> {
  const result: Partial<Record<NodeId, NodePosition>> = {};
  const clusters = options.hasThirdPartyZone ? nodes.filter((n) => isCluster(n.id)) : [];
  const stackYs = clusterYs(clusters.length);
  for (const node of nodes) {
    const kind = nodeKind(node.id);
    if (kind === "cache") {
      const { cx, cy } = cachePosition(columns, cacheSubzoneY);
      result[node.id] = { cx, cy, present: node.present, captionRight: true };
      continue;
    }
    const cx = columns[kind];
    if (cx === undefined) continue;
    const stackIndex = clusters.indexOf(node);
    const cy = stackIndex >= 0 ? stackYs[stackIndex] : nodeY(kind, columns);
    result[node.id] =
      stackIndex >= 0
        ? { cx, cy, present: node.present, captionRight: true }
        : { cx, cy, present: node.present };
  }
  return result;
}

// The browser cache sits in the cache sub-zone, in the browser column, centred in the band.
// Its hop from the browser leaves just under the browser caption and runs straight down.
const BROWSER_CACHE_START = 44;
// Request lane left of the hop, response lane right of it.
const VERTICAL_LANE_OFFSET = 5;
// The timing label is centred on the hop; TimingLabel draws its 14 px background above the
// baseline.
const VERTICAL_LABEL_BASELINE = 7;

function cachePosition(columns: LayoutSpec["columns"], cacheSubzoneY: number) {
  return { cx: columns.browser!, cy: round((cacheSubzoneY + HEIGHT) / 2) };
}

function verticalHop(from: NodePosition, to: NodePosition, path: DiagramPath): PathGeometry {
  const x = from.cx;
  const y0 = from.cy + BROWSER_CACHE_START;
  const y1 = to.cy - ANCHOR_RADIUS[nodeKind(path.to)];
  const lane = (offset: number) => bezier(x + offset, y0, x + offset, y1);
  const labelY = round((y0 + y1) / 2) + VERTICAL_LABEL_BASELINE;
  return {
    d: lane(0),
    requestD: lane(-VERTICAL_LANE_OFFSET),
    responseD: lane(VERTICAL_LANE_OFFSET),
    labelX: x,
    labelY,
    labelBelow: false,
    requestLabelY: labelY,
    responseLabelY: labelY,
  };
}

// The zone edges for a diagram `width` units wide: the 900-wide bounds, scaled proportionally.
function scaledEdges(bounds: number[], width: number): number[] {
  const edges = [0, ...bounds, WIDTH];
  return edges.map((edge) => (width === WIDTH ? edge : round((edge * width) / WIDTH)));
}

// Each column keeps its relative position inside its zone when the zones stretch to `width`.
function scaledColumns(
  columns: LayoutSpec["columns"],
  bounds: number[],
  width: number
): LayoutSpec["columns"] {
  if (width === WIDTH) return columns;
  const from = [0, ...bounds, WIDTH];
  const to = scaledEdges(bounds, width);
  const result: LayoutSpec["columns"] = {};
  for (const [kind, cx] of Object.entries(columns) as [NodeKind, number][]) {
    const i = Math.max(
      0,
      from.findIndex((edge, j) => j < from.length - 1 && cx >= edge && cx < from[j + 1])
    );
    result[kind] = round(to[i] + ((cx - from[i]) / (from[i + 1] - from[i])) * (to[i + 1] - to[i]));
  }
  return result;
}

function pathGeometry(
  from: NodePosition,
  to: NodePosition,
  path: DiagramPath,
  nodes: Layout["nodes"],
  fan?: ClusterFan
): PathGeometry {
  if (path.id === "browser-cache") return verticalHop(from, to, path);
  const ends = anchors(from, to, path);
  const { run, x0, y0, x1, y1 } = ends;
  const rise = Math.sign(to.cy - from.cy);
  const skipped = nodeKind(path.to) === "third-parties" ? bypassed(from, to, nodes) : [];
  const shape: BypassShape = fan
    ? fan.shape
    : {
        controlY: Math.max(
          ...skipped.map((id) => nodes[id]!.cy + BYPASS_CAPTIONS[id]!.controlDepth)
        ),
        control1X: skipped.includes("gfw") ? BYPASS_STEEP_CONTROL_X : CONTROL_1.x,
        control2X: CONTROL_2.x,
      };
  const lane = (offset: number) =>
    bezier(
      x0,
      y0 + offset,
      x1,
      y1 + offset,
      skipped.length ? { ...shape, controlY: shape.controlY + offset } : undefined
    );

  if (fan) {
    // Centred on the path at its slot.
    const at = pointAt(sampleCurve(bypassControls(ends, shape)), fan.labelX, run);
    const y = round(at.y) + CLUSTER_LABEL_BASELINE;
    return {
      d: lane(0),
      requestD: lane(-LANE_OFFSET),
      responseD: lane(LANE_OFFSET),
      labelX: fan.labelX,
      labelY: y,
      labelBelow: false,
      requestLabelY: y,
      responseLabelY: y,
    };
  }

  if (skipped.length) {
    const samples = sampleCurve(bypassControls(ends, shape));
    // Lowest point of the centre curve, sampled.
    let low = { x: x0, y: y0 };
    for (const p of samples) if (p.y > low.y) low = p;
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
  options: LayoutOptions = layoutOptions(nodes),
  { width = WIDTH }: { width?: number } = {}
): Layout {
  const spec = LAYOUTS[layoutId(options)];
  const edges = scaledEdges(spec.bounds, width);
  const clientZoneEnd = edges[1];
  const cacheSubzoneY = options.hasThirdPartyZone ? CLUSTER_CACHE_SUBZONE_Y : CACHE_SUBZONE_Y;
  const nodePositions = positions(
    nodes,
    scaledColumns(spec.columns, spec.bounds, width),
    options,
    cacheSubzoneY
  );
  // Paths to stacked clusters fan out in stack order, top first.
  const clusterIds = options.hasThirdPartyZone
    ? nodes.filter((n) => isCluster(n.id)).map((n) => n.id)
    : [];
  const stacked = clusterIds.flatMap((id) => {
    const path = paths.find((p) => p.to === id);
    const from = path && nodePositions[path.from];
    const to = nodePositions[id];
    return path && from && to ? [{ path, from, to }] : [];
  });
  // Label slots: side by side from the end of the client zone, along the dip.
  const fans = new Map<PathId, ClusterFan>();
  if (stacked.length > 0) {
    const { x0, x1 } = anchors(stacked[0].from, stacked[0].to, stacked[0].path);
    const start = clientZoneEnd;
    const slot = (x0 + CLUSTER_LABEL_SLOTS_END * (x1 - x0) - start) / stacked.length;
    const sideBySide = slot >= 2 * CLUSTER_LABEL.halfWidth + CLUSTER_LABEL.clearance;
    const order = stacked.map((_, i) => i);
    const slots = sideBySide
      ? order
      : [...order.filter((i) => i % 2 === 0), ...order.filter((i) => i % 2 === 1)];
    const clusterPaths = stacked.map((cp, i) => ({
      ...cp,
      labelX: round(start + (slots.indexOf(i) + 0.5) * slot),
    }));
    const shapes = solveClusterFan(clusterPaths, nodePositions, clientZoneEnd);
    clusterPaths.forEach(({ path, labelX }, i) => {
      fans.set(path.id, { shape: shapes[i], labelX });
    });
  }
  const pathGeometries: Partial<Record<PathId, PathGeometry>> = {};
  for (const path of paths) {
    const from = nodePositions[path.from];
    const to = nodePositions[path.to];
    if (from && to) {
      pathGeometries[path.id] = pathGeometry(from, to, path, nodePositions, fans.get(path.id));
    }
  }
  return {
    width,
    height: HEIGHT,
    cacheSubzoneY,
    zones: zones(nodes, options, edges),
    nodes: nodePositions,
    paths: pathGeometries,
  };
}
