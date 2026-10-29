import { memo, useMemo } from "react";
import type { DiagramNode, DiagramPath, NodeId, PathId } from "@htv/core";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import type { HistoricalPath } from "../types.js";
import { layout, layoutOptions } from "./diagram/layout.js";
import { NodeLayer } from "./diagram/NodeLayer.js";
import { GlowFilter, PathLayer } from "./diagram/PathLayer.js";
import { ZoneBands } from "./diagram/ZoneBands.js";
import styles from "./NodeRenderer.module.css";

interface Props {
  nodes: DiagramNode[];
  paths: DiagramPath[];
  activeNodes: NodeId[];
  activePaths: string[];
  pathTimings?: Partial<Record<PathId, string>>;
  pathDirections?: Partial<Record<PathId, "request" | "response">>;
  historicalPaths?: Partial<Record<PathId, HistoricalPath>>;
  /** Prefixes every element id, so several diagrams can share a document ("" keeps "diagram-svg"). */
  idPrefix?: string;
}

function NodeRendererView({
  nodes,
  paths,
  activeNodes,
  activePaths,
  pathTimings,
  pathDirections,
  historicalPaths,
  idPrefix = "",
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const options = useMemo(() => layoutOptions(nodes), [nodes]);
  const geometry = useMemo(() => layout(nodes, paths, options), [nodes, paths, options]);

  return (
    <svg
      id={`${idPrefix}diagram-svg`}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      width="100%"
      height="100%"
      className={styles.svg}
    >
      <defs>
        <GlowFilter idPrefix={idPrefix} />
      </defs>
      <ZoneBands
        zones={geometry.zones}
        height={geometry.height}
        hasGfw={options.hasGfw}
        cacheSubzoneY={geometry.cacheSubzoneY}
      />
      <PathLayer
        paths={paths}
        geometry={geometry.paths}
        activePaths={new Set(activePaths)}
        pathTimings={pathTimings}
        pathDirections={pathDirections}
        historicalPaths={historicalPaths}
        reducedMotion={reducedMotion}
        idPrefix={idPrefix}
      />
      <NodeLayer nodes={nodes} positions={geometry.nodes} activeNodes={new Set(activeNodes)} />
    </svg>
  );
}

export const NodeRenderer = memo(NodeRendererView);
