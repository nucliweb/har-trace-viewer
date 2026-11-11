import { nodeKind } from "@htv/core";
import type { DiagramNode, NodeId, NodeKind } from "@htv/core";
import styles from "../NodeRenderer.module.css";
import { fitText } from "./labels.js";
import { NodeGlyph } from "./NodeGlyph.js";
import type { NodePosition, Zone } from "./layout.js";

const NODE_COLORS: Record<NodeKind, string> = {
  browser: "var(--color-node-browser)",
  cache: "var(--color-node-browser)",
  gfw: "var(--color-red)",
  edge: "var(--color-node-edge)",
  origin: "var(--color-node-origin)",
  "third-parties": "var(--color-node-third-parties)",
};

const NODE_LABELS: Record<NodeKind, string> = {
  browser: "Browser",
  cache: "Browser cache",
  gfw: "GFW checkpoint",
  edge: "Edge / CDN",
  origin: "Origin Server",
  "third-parties": "3rd Parties",
};

const LINE_HEIGHT = 13;

interface Props {
  nodes: DiagramNode[];
  positions: Partial<Record<NodeId, NodePosition>>;
  activeNodes: ReadonlySet<NodeId>;
  /** The zones, whose edges bound the names of the nodes in them once the labels grow. */
  zones?: Zone[];
  /** How much the labels grow on a small screen (1: drawn as designed). */
  labelScale?: number;
}

// Labels grown this much or more (a phone) keep only the node names: the city, provider and
// counts lines would not fit, and the step panel gives them in text.
const COMPACT_SCALE = 1.5;
// Room kept between a name and the edge of its zone.
const NAME_GAP = 6;

function statsText(node: DiagramNode): string {
  const stats = node.resourceStats!;
  // Flows older than the cache node counted the cache hits on the browser.
  if (node.id === "browser") return `${stats.count} cached`;
  const base = `${stats.count} ${stats.label ?? "req"}`;
  if (stats.avgMs === undefined) return base;
  // A third-party node's figure is its median TTFB: "median" does not fit a stacked caption.
  const measure = stats.avgMsKind === "median-ttfb" ? "TTFB" : "avg";
  return `${base} · ${measure} ${Math.round(stats.avgMs)}ms`;
}

// Caption baselines below the node centre: under the glyph, or beside a stacked cluster
// (and the narrower browser cache glyph).
const CAPTION_BELOW = { gfw: 28, other: 34 };
const CAPTION_RIGHT = { dx: 32, cacheDx: 18, firstY: -9 };
// Smaller node names: the GFW checkpoint, and the browser cache that fits in its band.
const SMALL_NAMES = new Set<NodeKind>(["gfw", "cache"]);

// The width a node's name has: centred under the node, twice its distance to the nearer zone
// edge; to the right of a stacked cluster, up to the zone's right edge.
function nameRoom(zones: Zone[], x: number, captionX: number, anchor: "start" | "middle"): number {
  const zone = zones.find((z) => x >= z.x0 && x <= z.x1);
  if (!zone) return Infinity;
  const room = anchor === "start" ? zone.x1 - captionX : 2 * Math.min(x - zone.x0, zone.x1 - x);
  return room - NAME_GAP;
}

export function NodeLayer({ nodes, positions, activeNodes, zones = [], labelScale = 1 }: Props) {
  const compact = labelScale >= COMPACT_SCALE;
  const lineHeight = LINE_HEIGHT * labelScale;
  return (
    <>
      {nodes.map((node) => {
        const pos = positions[node.id];
        if (!node.present || !pos) return null;
        const { cx: x, cy: y } = pos;
        const kind = nodeKind(node.id);
        const isActive = activeNodes.has(node.id);
        const color = isActive ? NODE_COLORS[kind] : "var(--color-text2)";
        // The edge and every third-party cluster are named after their provider.
        const named = node.id === "edge" || kind !== node.id;
        const nameSize = (SMALL_NAMES.has(kind) ? 12 : 13) * labelScale;
        // Grown names keep their top edge: the baseline moves down by what the letters gained.
        const grown = (nameSize - nameSize / labelScale) * 0.75;
        const caption = pos.captionRight
          ? {
              x: x + (kind === "cache" ? CAPTION_RIGHT.cacheDx : CAPTION_RIGHT.dx),
              // A lone name beside the cluster sits on its centre line.
              y: compact ? y + nameSize * 0.35 : y + CAPTION_RIGHT.firstY + grown,
              anchor: "start" as const,
            }
          : {
              x,
              y: y + (node.id === "gfw" ? CAPTION_BELOW.gfw : CAPTION_BELOW.other) + grown,
              anchor: "middle" as const,
            };
        const name = named ? node.label : NODE_LABELS[kind];

        return (
          <g key={node.id}>
            <g
              transform={`translate(${x},${y})`}
              opacity={isActive ? 1 : node.id === "gfw" ? 0.3 : 0.25}
              className={styles.node}
            >
              <NodeGlyph id={kind} color={NODE_COLORS[kind]} active={isActive} />
            </g>
            <text
              x={caption.x}
              y={caption.y}
              textAnchor={caption.anchor}
              fill={color}
              fontSize={nameSize}
              fontFamily="var(--font-mono)"
            >
              {labelScale > 1
                ? fitText(name, nameRoom(zones, x, caption.x, caption.anchor), nameSize)
                : name}
            </text>
            {!compact && node.subLabel && (
              <text
                x={caption.x}
                y={caption.y + lineHeight}
                textAnchor={caption.anchor}
                fill="var(--color-text2)"
                fontSize={12 * labelScale}
                fontFamily="var(--font-mono)"
                opacity={0.55}
              >
                {node.subLabel}
              </text>
            )}
            {!compact && node.resourceStats && (
              <text
                x={caption.x}
                y={caption.y + (node.subLabel ? 2 : 1) * lineHeight}
                textAnchor={caption.anchor}
                fill={color}
                fontSize={12 * labelScale}
                fontFamily="var(--font-mono)"
                opacity={0.7}
              >
                {statsText(node)}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}
