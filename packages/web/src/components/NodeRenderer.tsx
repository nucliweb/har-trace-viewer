import { memo, useMemo, useRef } from "react";
import type { DiagramNode, DiagramPath, NodeId, PathId } from "@htv/core";
import { useElementSize } from "../hooks/useElementSize.js";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import type { HistoricalPath } from "../types.js";
import { labelScale } from "./diagram/labels.js";
import { HEIGHT, MAX_WIDTH, WIDTH, layout, layoutOptions } from "./diagram/layout.js";
import { NodeLayer } from "./diagram/NodeLayer.js";
import { GlowFilter, PathLayer } from "./diagram/PathLayer.js";
import { ZoneBands } from "./diagram/ZoneBands.js";
import styles from "./NodeRenderer.module.css";

// Both WIDTH and MAX_WIDTH are multiples of it.
const WIDTH_STEP = 50;

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
  /**
   * The diagram is one image of the step it shows: its name (the step title) and description.
   * As an image, its labels and paths stay out of the accessibility tree.
   */
  label?: string;
  description?: string;
  /** The language of the label and description, when it is not the page's. */
  lang?: string;
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
  label,
  description,
  lang,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const options = useMemo(() => layoutOptions(nodes), [nodes]);
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useElementSize(svgRef, { width: WIDTH, height: HEIGHT });
  // The diagram is as wide as the container's aspect ratio asks, so it fills it both ways, in
  // steps: the layout is solved again when the width crosses a step, not on every pixel of a
  // resize.
  const width = Math.min(
    MAX_WIDTH,
    Math.max(WIDTH, Math.round((HEIGHT * size.width) / size.height / WIDTH_STEP) * WIDTH_STEP)
  );
  const geometry = useMemo(
    () => layout(nodes, paths, options, { width }),
    [nodes, paths, options, width]
  );
  // The drawing keeps its ratio inside the box: it shows as wide as the tighter side allows.
  const scale = labelScale(
    Math.min(size.width, (size.height * geometry.width) / geometry.height),
    geometry.width
  );

  return (
    <svg
      ref={svgRef}
      id={`${idPrefix}diagram-svg`}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      width="100%"
      height="100%"
      className={styles.svg}
      role="img"
      aria-label={label}
      aria-describedby={description ? `${idPrefix}diagram-desc` : undefined}
      lang={lang}
    >
      {description && <desc id={`${idPrefix}diagram-desc`}>{description}</desc>}
      <defs>
        <GlowFilter idPrefix={idPrefix} />
      </defs>
      <ZoneBands
        zones={geometry.zones}
        height={geometry.height}
        hasGfw={options.hasGfw}
        cacheSubzoneY={geometry.cacheSubzoneY}
        hasCacheNode={geometry.nodes.cache?.present ?? false}
        labelScale={scale}
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
        labelScale={scale}
      />
      <NodeLayer
        nodes={nodes}
        positions={geometry.nodes}
        activeNodes={new Set(activeNodes)}
        zones={geometry.zones}
        labelScale={scale}
      />
    </svg>
  );
}

export const NodeRenderer = memo(NodeRendererView);
