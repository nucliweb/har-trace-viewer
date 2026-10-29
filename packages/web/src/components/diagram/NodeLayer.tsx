import { nodeKind } from "@htv/core";
import type { DiagramNode, NodeId, NodeKind } from "@htv/core";
import styles from "../NodeRenderer.module.css";
import { NodeGlyph } from "./NodeGlyph.js";
import type { NodePosition } from "./layout.js";

export const NODE_COLORS: Record<NodeKind, string> = {
  browser: "var(--color-node-browser)",
  gfw: "var(--color-red)",
  edge: "var(--color-node-edge)",
  origin: "var(--color-node-origin)",
  "third-parties": "var(--color-node-third-parties)",
};

const NODE_LABELS: Record<NodeKind, string> = {
  browser: "Browser",
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
}

function statsText(node: DiagramNode): string {
  const stats = node.resourceStats!;
  if (node.id === "browser") return `${stats.count} cached`;
  const base = `${stats.count} ${stats.label ?? "req"}`;
  return stats.avgMs !== undefined ? `${base} · avg ${Math.round(stats.avgMs)}ms` : base;
}

// Caption baselines below the node centre: under the glyph, or beside a stacked cluster.
const CAPTION_BELOW = { gfw: 28, other: 34 };
const CAPTION_RIGHT = { dx: 32, firstY: -9 };

export function NodeLayer({ nodes, positions, activeNodes }: Props) {
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
        const caption = pos.captionRight
          ? { x: x + CAPTION_RIGHT.dx, y: y + CAPTION_RIGHT.firstY, anchor: "start" as const }
          : {
              x,
              y: y + (node.id === "gfw" ? CAPTION_BELOW.gfw : CAPTION_BELOW.other),
              anchor: "middle" as const,
            };

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
              fontSize={node.id === "gfw" ? 12 : 13}
              fontFamily="var(--font-mono)"
            >
              {named ? node.label : NODE_LABELS[kind]}
            </text>
            {node.subLabel && (
              <text
                x={caption.x}
                y={caption.y + LINE_HEIGHT}
                textAnchor={caption.anchor}
                fill="var(--color-text2)"
                fontSize={12}
                fontFamily="var(--font-mono)"
                opacity={0.55}
              >
                {node.subLabel}
              </text>
            )}
            {node.resourceStats && (
              <text
                x={caption.x}
                y={caption.y + (node.subLabel ? 2 : 1) * LINE_HEIGHT}
                textAnchor={caption.anchor}
                fill={color}
                fontSize={12}
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
