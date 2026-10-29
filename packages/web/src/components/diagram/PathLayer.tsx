import { nodeKind } from "@htv/core";
import type { DiagramPath, PathId } from "@htv/core";
import type { HistoricalPath } from "../../types.js";
import styles from "../NodeRenderer.module.css";
import type { PathGeometry } from "./layout.js";

export const GLOW_FILTER_ID = "glow";

const PATH_COLORS: Partial<Record<PathId, string>> = {
  "browser-gfw": "var(--color-red)",
  "gfw-edge": "var(--color-node-browser)",
  "gfw-origin": "var(--color-node-origin)",
  "browser-edge": "var(--color-node-browser)",
  "edge-origin": "var(--color-node-origin)",
  "browser-origin": "var(--color-node-origin)",
  "browser-third-parties": "var(--color-node-third-parties)",
  "browser-cache": "var(--color-node-browser)",
};

type Direction = "request" | "response";

interface Props {
  paths: DiagramPath[];
  geometry: Partial<Record<PathId, PathGeometry>>;
  activePaths: ReadonlySet<string>;
  pathTimings?: Partial<Record<PathId, string>>;
  pathDirections?: Partial<Record<PathId, Direction>>;
  historicalPaths?: Partial<Record<PathId, HistoricalPath>>;
  reducedMotion: boolean;
  /** Prefixes the path and filter ids when several diagrams share a document. */
  idPrefix?: string;
}

/**
 * One blur-and-merge filter for every path: the glow takes the colour of the stroke. Its region
 * is the whole diagram: one relative to the path's bounding box is empty for a straight
 * horizontal or vertical path (zero height or width), which would hide the path altogether.
 */
export function GlowFilter({ idPrefix = "" }: { idPrefix?: string }) {
  return (
    <filter
      id={`${idPrefix}${GLOW_FILTER_ID}`}
      filterUnits="userSpaceOnUse"
      x="0"
      y="0"
      width="100%"
      height="100%"
    >
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
}

function ForwardPacket({ pathRef, color }: { pathRef: string; color: string }) {
  return (
    <circle r={4} fill={color} opacity={0.9}>
      <animateMotion dur="1.4s" repeatCount="indefinite" rotate="auto">
        <mpath href={`#${pathRef}`} />
      </animateMotion>
    </circle>
  );
}

function ReturnPacket({ pathRef, color }: { pathRef: string; color: string }) {
  return (
    <circle r={3} fill={color} opacity={0.55}>
      <animateMotion
        dur="1.4s"
        begin="0.7s"
        repeatCount="indefinite"
        rotate="auto"
        keyPoints="1;0"
        keyTimes="0;1"
        calcMode="linear"
      >
        <mpath href={`#${pathRef}`} />
      </animateMotion>
    </circle>
  );
}

interface LabelProps {
  x: number;
  y: number;
  timing: string;
  color: string;
  below?: boolean;
  faded?: boolean;
}

function TimingLabel({ x, y, timing, color, below = false, faded = false }: LabelProps) {
  const width = timing.length * 5.8 + 8;
  return (
    <g>
      <rect
        x={x - width / 2 - 4}
        y={below ? y - 11 : y - 14}
        width={width}
        height={14}
        rx={3}
        fill="var(--color-bg)"
        opacity={faded ? 0.7 : 0.85}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        fontSize={12}
        fontFamily="var(--font-mono)"
        fill={color}
        opacity={faded ? 0.5 : 0.9}
        className={styles.pathLabel}
      >
        {timing}
      </text>
    </g>
  );
}

const laneD = (g: PathGeometry, direction?: Direction) =>
  direction === "request" ? g.requestD : direction === "response" ? g.responseD : g.d;

const laneLabelY = (g: PathGeometry, direction?: Direction) =>
  direction === "request"
    ? g.requestLabelY
    : direction === "response"
      ? g.responseLabelY
      : g.labelY;

export function PathLayer({ paths, geometry, activePaths, ...rest }: Props) {
  return (
    <>
      {paths.map((path) => {
        const g = geometry[path.id];
        if (!g) return null;
        return (
          <PathGroup key={path.id} path={path} g={g} active={activePaths.has(path.id)} {...rest} />
        );
      })}
    </>
  );
}

interface PathGroupProps extends Omit<Props, "paths" | "geometry" | "activePaths"> {
  path: DiagramPath;
  g: PathGeometry;
  active: boolean;
}

function PathGroup({
  path,
  g,
  active,
  pathTimings,
  pathDirections,
  historicalPaths,
  reducedMotion,
  idPrefix = "",
}: PathGroupProps) {
  // Every path to a third-party cluster takes the third-parties colour.
  const color =
    PATH_COLORS[nodeKind(path.to) === "third-parties" ? "browser-third-parties" : path.id] ??
    "var(--color-node-browser)";
  const timing = pathTimings?.[path.id];

  if (!active) {
    const historical = historicalPaths?.[path.id];
    if (historical !== undefined) {
      return (
        <g>
          <path
            d={laneD(g, historical.direction)}
            fill="none"
            stroke={color}
            strokeWidth={1}
            opacity={0.45}
            strokeDasharray="4 4"
          />
          {historical.timing && (
            <TimingLabel
              x={g.labelX}
              y={laneLabelY(g, historical.direction)}
              timing={historical.timing}
              color={color}
              faded
            />
          )}
        </g>
      );
    }
    return (
      <g>
        <path
          id={`${idPrefix}path-${path.id}`}
          d={g.d}
          fill="none"
          stroke={color}
          strokeWidth={0.5}
          opacity={0.15}
          strokeDasharray="4 4"
        />
      </g>
    );
  }

  const direction = pathDirections?.[path.id];
  const glow = `url(#${idPrefix}${GLOW_FILTER_ID})`;

  if (!direction) {
    const ref = `${idPrefix}path-${path.id}`;
    return (
      <g>
        <path
          id={ref}
          d={g.d}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          opacity={0.8}
          filter={glow}
        />
        {!reducedMotion && <ForwardPacket pathRef={ref} color={color} />}
        {!reducedMotion && <ReturnPacket pathRef={ref} color={color} />}
        {timing && (
          <TimingLabel
            x={g.labelX}
            y={g.labelY}
            timing={timing}
            color={color}
            below={g.labelBelow}
          />
        )}
      </g>
    );
  }

  // Two lanes: the active direction glows, the opposite one stays dimmed.
  const isRequest = direction === "request";
  const ref = `${idPrefix}path-${path.id}-${isRequest ? "req" : "res"}`;
  return (
    <g>
      <path
        d={laneD(g, isRequest ? "response" : "request")}
        fill="none"
        stroke={color}
        strokeWidth={1}
        opacity={0.18}
        strokeDasharray="4 4"
      />
      <path
        id={ref}
        d={laneD(g, direction)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={0.85}
        filter={glow}
      />
      {!reducedMotion &&
        (isRequest ? (
          <ForwardPacket pathRef={ref} color={color} />
        ) : (
          <ReturnPacket pathRef={ref} color={color} />
        ))}
      {timing && (
        <TimingLabel x={g.labelX} y={laneLabelY(g, direction)} timing={timing} color={color} />
      )}
    </g>
  );
}
