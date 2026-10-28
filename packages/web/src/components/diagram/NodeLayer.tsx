import type { DiagramNode, NodeId } from "@htv/core";
import styles from "../NodeRenderer.module.css";
import { NodeGlyph } from "./NodeGlyph.js";
import type { NodePosition } from "./layout.js";

export const NODE_COLORS: Record<NodeId, string> = {
  browser: "var(--color-node-browser)",
  gfw: "var(--color-red)",
  edge: "var(--color-node-edge)",
  origin: "var(--color-node-origin)",
  "third-parties": "var(--color-node-third-parties)",
};

const NODE_LABELS: Record<NodeId, string> = {
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

export function NodeLayer({ nodes, positions, activeNodes }: Props) {
  return (
    <>
      {nodes.map((node) => {
        const pos = positions[node.id];
        if (!node.present || !pos) return null;
        const { cx: x, cy: y } = pos;
        const isActive = activeNodes.has(node.id);
        const color = isActive ? NODE_COLORS[node.id] : "var(--color-text2)";
        const labelY = y + (node.id === "gfw" ? 28 : 34);

        return (
          <g key={node.id}>
            <g
              transform={`translate(${x},${y})`}
              opacity={isActive ? 1 : node.id === "gfw" ? 0.3 : 0.25}
              className={styles.node}
            >
              <NodeGlyph id={node.id} color={NODE_COLORS[node.id]} active={isActive} />
            </g>
            <text
              x={x}
              y={labelY}
              textAnchor="middle"
              fill={color}
              fontSize={node.id === "gfw" ? 12 : 13}
              fontFamily="var(--font-mono)"
            >
              {node.id === "edge" ? node.label : NODE_LABELS[node.id]}
            </text>
            {node.subLabel && (
              <text
                x={x}
                y={labelY + LINE_HEIGHT}
                textAnchor="middle"
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
                x={x}
                y={labelY + (node.subLabel ? 2 : 1) * LINE_HEIGHT}
                textAnchor="middle"
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
