import { nodeKind } from "@htv/core";
import { regionLabel } from "../../lib/region-label.js";
import type { DiagramNode, DiagramPath, NetworkRegion, NodeId, NodeKind, PathId } from "@htv/core";

/**
 * Diagram geometry. The only hand-placed coordinates are the zone boundaries and the node
 * columns of each layout; path curves, request/response lanes and timing label positions are
 * derived from the node centres.
 */

export const WIDTH = 900;
export const HEIGHT = 480;
// The client zone's browser-cache sub-zone starts here; the GFW zone caption sits just above.
// With stacked third-party clusters it starts lower, leaving their paths room to fan out.
const CACHE_SUBZONE_Y = 370;
const CLUSTER_CACHE_SUBZONE_Y = 430;
export const GFW_ZONE_CAPTION_OFFSET = 8;

export type ZoneId = "client" | "edge" | "intermediate" | "origin" | "third-parties";

export interface LayoutOptions {
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

export interface NodePosition {
  cx: number;
  cy: number;
  present: boolean;
  // Stacked third-party clusters caption themselves right of their glyph, so the paths
  // arriving from the left never cross a caption.
  captionRight?: boolean;
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
  // Top of the browser-cache sub-zone of the client zone.
  cacheSubzoneY: number;
  zones: Zone[];
  nodes: Partial<Record<NodeId, NodePosition>>;
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

// Distance from a node centre to where its paths attach, roughly half the glyph width.
const ANCHOR_RADIUS: Record<NodeKind, number> = {
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
// Paths to stacked clusters also pass the origin.
const BYPASS_CAPTIONS: Partial<
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
const CLUSTER_FAN_GAP = 10;
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
const CLUSTER_LABEL_SLOTS_END = 0.86;
// Labels read "avg 1234ms" at most. Past the room for them side by side, the slots
// interleave (paths 1, 3, 5 first, then 2, 4), so neighbouring slots hold labels of paths at
// least two fan gaps apart.
const CLUSTER_LABEL = { halfWidth: 40, above: 10, below: 4, clearance: 8 };
const CLUSTER_LABEL_BASELINE = 4;
// The GFW caption sits close to the browser: the curve leaves almost straight down to clear it.
const BYPASS_STEEP_CONTROL_X = 0.1;
// The timing label of a bypassing path hangs under the lowest point of its curve.
const BYPASS_LABEL_OFFSET = { centre: 12, response: 20 };

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

function zones(nodes: DiagramNode[], options: LayoutOptions, bounds: number[]): Zone[] {
  const edges = [0, ...bounds, WIDTH];
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
  options: LayoutOptions
): Partial<Record<NodeId, NodePosition>> {
  const result: Partial<Record<NodeId, NodePosition>> = {};
  const clusters = options.hasThirdPartyZone ? nodes.filter((n) => isCluster(n.id)) : [];
  const stackYs = clusterYs(clusters.length);
  for (const node of nodes) {
    const kind = nodeKind(node.id);
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

const round = (value: number) => Math.round(value);

// A curve that dips under captions: both control points sit at `controlY`, at these
// fractions of the run.
interface BypassShape {
  controlY: number;
  control1X: number;
  control2X: number;
}

// With `bypass` both control points sit at its height instead of between the anchors.
function bezier(x0: number, y0: number, x1: number, y1: number, bypass?: BypassShape): string {
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

// Nodes of the request chain that lie between the two ends of a path, with a caption to avoid.
function bypassed(from: NodePosition, to: NodePosition, nodes: Layout["nodes"]) {
  const [lo, hi] = [Math.min(from.cx, to.cx), Math.max(from.cx, to.cx)];
  return (["gfw", "edge", "origin"] as const).filter((id) => {
    const node = nodes[id];
    return node?.present && node.cx > lo && node.cx < hi;
  });
}

// A point of a cubic Bezier curve given by its four control points.
function cubicPoint(px: number[], py: number[], t: number) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: w.reduce((sum, k, j) => sum + k * px[j], 0),
    y: w.reduce((sum, k, j) => sum + k * py[j], 0),
  };
}

interface Anchors {
  run: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function anchors(from: NodePosition, to: NodePosition, path: DiagramPath): Anchors {
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

function bypassControls({ x0, y0, x1, y1 }: Anchors, shape: BypassShape) {
  const dx = x1 - x0;
  return {
    px: [x0, x0 + shape.control1X * dx, x0 + shape.control2X * dx, x1],
    py: [y0, shape.controlY, shape.controlY, y1],
  };
}

const clusterShape = (controlY: number, control1X: number): BypassShape => ({
  controlY,
  control1X,
  control2X: CLUSTER_CONTROL_2_X,
});

const sampleCurve = ({ px, py }: { px: number[]; py: number[] }) =>
  Array.from({ length: 101 }, (_, i) => cubicPoint(px, py, i / 100));

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const inside = (r: Rect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Where the paths to stacked clusters must not run: above the bottom of the captions they pass
// (as far as each caption reaches), the browser caption, the bottom of the client zone and of
// the diagram.
function clusterObstacles(
  skipped: ReturnType<typeof bypassed>,
  nodes: Layout["nodes"],
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
const pointAt = (points: { x: number; y: number }[], x: number, run: number) =>
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
function solveClusterFan(
  clusterPaths: ClusterPath[],
  nodes: Layout["nodes"],
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
interface ClusterFan {
  shape: BypassShape;
  labelX: number;
}

function pathGeometry(
  from: NodePosition,
  to: NodePosition,
  path: DiagramPath,
  nodes: Layout["nodes"],
  fan?: ClusterFan
): PathGeometry {
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
  options: LayoutOptions = layoutOptions(nodes)
): Layout {
  const spec = LAYOUTS[layoutId(options)];
  const nodePositions = positions(nodes, spec.columns, options);
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
    const start = spec.bounds[0];
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
    const shapes = solveClusterFan(clusterPaths, nodePositions, spec.bounds[0]);
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
    width: WIDTH,
    height: HEIGHT,
    cacheSubzoneY: options.hasThirdPartyZone ? CLUSTER_CACHE_SUBZONE_Y : CACHE_SUBZONE_Y,
    zones: zones(nodes, options, spec.bounds),
    nodes: nodePositions,
    paths: pathGeometries,
  };
}
