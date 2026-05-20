import type { DiagramNode, DiagramPath, NetworkRegion, NodeId, PathId } from "@htv/core/types.js";
import styles from "./NodeRenderer.module.css";

type HistoricalPath = { timing?: string; direction?: "request" | "response" };

interface Props {
  nodes: DiagramNode[];
  paths: DiagramPath[];
  activeNodes: NodeId[];
  activePaths: string[];
  pathTimings?: Partial<Record<PathId, string>>;
  pathDirections?: Partial<Record<PathId, "request" | "response">>;
  historicalPaths?: Partial<Record<PathId, HistoricalPath>>;
}

// Positions — 3-zone layout, no GFW
const NODE_POS_NO_GFW: Record<NodeId, { x: number; y: number }> = {
  browser:         { x: 130, y: 240 },
  gfw:             { x: 0,   y: 0   },
  edge:            { x: 400, y: 240 },
  origin:          { x: 700, y: 200 },
  "third-parties": { x: 700, y: 310 },
};

// Positions — 3-zone layout, with GFW
const NODE_POS_WITH_GFW: Record<NodeId, { x: number; y: number }> = {
  browser:         { x: 90,  y: 240 },
  gfw:             { x: 210, y: 240 },
  edge:            { x: 400, y: 240 },
  origin:          { x: 700, y: 200 },
  "third-parties": { x: 700, y: 310 },
};

// Positions — 4-zone layout (china | apac | intermediate | origin)
const NODE_POS_4ZONE: Record<NodeId, { x: number; y: number }> = {
  browser:         { x: 75,  y: 240 },
  gfw:             { x: 178, y: 240 },
  edge:            { x: 322, y: 240 },
  origin:          { x: 770, y: 215 },
  "third-parties": { x: 535, y: 310 },
};

// Zone bounds [xStart, xEnd] for each layout
const ZONE_BOUNDS = {
  noGfw_cdn:   { client: [0, 265],  edge:  [265, 555], origin: [555, 900] },
  noGfw_noCdn: { client: [0, 415],                     origin: [415, 900] },
  gfw_cdn:     { china:  [0, 290],  edge:  [290, 555], origin: [555, 900] },
  gfw_cdn_4:   { china:  [0, 215],  edge:  [215, 430], inter:  [430, 645], origin: [645, 900] },
} as const;

const ZONE_LABELS: Partial<Record<NetworkRegion, string>> = {
  "china":         "CHINA",
  "asia-pacific":  "ASIA-PACIFIC",
  "europe":        "EUROPE",
  "azure-cloud":   "AZURE CLOUD",
  "united-states": "UNITED STATES",
  "client":        "CLIENT",
  "edge":          "EDGE / CDN",
  "origin":        "ORIGIN",
};

const ZONE_COLORS: Partial<Record<NetworkRegion, string>> = {
  "china":         "var(--color-red)",
  "asia-pacific":  "var(--color-cyan)",
  "europe":        "var(--color-orange)",
  "azure-cloud":   "var(--color-orange)",
  "united-states": "var(--color-green)",
  "client":        "var(--color-cyan)",
  "edge":          "var(--color-orange)",
  "origin":        "var(--color-green)",
};

const PATH_GLOW_FILTER: Partial<Record<PathId, string>> = {
  "browser-gfw":           "glow-red",
  "gfw-edge":              "glow-cyan",
  "browser-edge":          "glow-cyan",
  "edge-origin":           "glow-green",
  "browser-origin":        "glow-green",
  "browser-third-parties": "glow-orange",
};

// Center paths
const PATH_DATA: Partial<Record<PathId, string>> = {
  "browser-gfw":           "M 112,240 C 145,240 170,240 193,240",
  "gfw-edge":              "M 228,240 C 282,240 340,240 381,240",
  "browser-edge":          "M 150,240 C 230,240 320,240 380,240",
  "edge-origin":           "M 420,235 C 500,225 600,210 680,200",
  "browser-origin":        "M 150,238 C 320,230 530,210 680,200",
  "browser-third-parties": "M 150,242 C 320,255 530,290 680,310",
};

// Request lane: 5px above center
const PATH_DATA_REQUEST: Partial<Record<PathId, string>> = {
  "browser-gfw":           "M 112,235 C 145,235 170,235 193,235",
  "gfw-edge":              "M 228,235 C 282,235 340,235 381,235",
  "browser-edge":          "M 150,235 C 230,235 320,235 380,235",
  "edge-origin":           "M 420,230 C 500,220 600,205 680,195",
  "browser-origin":        "M 150,233 C 320,225 530,205 680,195",
  "browser-third-parties": "M 150,237 C 320,250 530,285 680,305",
};

// Response lane: 5px below center
const PATH_DATA_RESPONSE: Partial<Record<PathId, string>> = {
  "browser-gfw":           "M 112,245 C 145,245 170,245 193,245",
  "gfw-edge":              "M 228,245 C 282,245 340,245 381,245",
  "browser-edge":          "M 150,245 C 230,245 320,245 380,245",
  "edge-origin":           "M 420,240 C 500,230 600,215 680,205",
  "browser-origin":        "M 150,243 C 320,235 530,215 680,205",
  "browser-third-parties": "M 150,247 C 320,260 530,295 680,315",
};

const PATH_LABEL_POS: Partial<Record<PathId, { x: number; y: number; below?: boolean }>> = {
  "browser-gfw":           { x: 153, y: 228 },
  "gfw-edge":              { x: 305, y: 228 },
  "browser-edge":          { x: 265, y: 228 },
  "edge-origin":           { x: 550, y: 210 },
  "browser-origin":        { x: 415, y: 212 },
  "browser-third-parties": { x: 415, y: 294, below: true },
};

const PATH_LABEL_POS_REQUEST: Partial<Record<PathId, { x: number; y: number }>> = {
  "browser-gfw":           { x: 153, y: 222 },
  "gfw-edge":              { x: 305, y: 222 },
  "browser-edge":          { x: 265, y: 222 },
  "edge-origin":           { x: 550, y: 202 },
  "browser-origin":        { x: 415, y: 204 },
  "browser-third-parties": { x: 415, y: 288 },
};

const PATH_LABEL_POS_RESPONSE: Partial<Record<PathId, { x: number; y: number }>> = {
  "browser-gfw":           { x: 153, y: 262 },
  "gfw-edge":              { x: 305, y: 262 },
  "browser-edge":          { x: 265, y: 262 },
  "edge-origin":           { x: 550, y: 242 },
  "browser-origin":        { x: 415, y: 244 },
  "browser-third-parties": { x: 415, y: 330 },
};

// 4-zone path data (china | apac | intermediate | origin)
const PATH_DATA_4ZONE: Partial<Record<PathId, string>> = {
  "browser-gfw":           "M 93,240 C 118,240 140,240 162,240",
  "gfw-edge":              "M 193,240 C 233,238 268,238 305,240",
  "edge-origin":           "M 340,235 C 480,226 630,218 753,215",
  "browser-origin":        "M 93,235 C 310,226 565,218 753,215",
  "browser-third-parties": "M 93,244 C 220,264 390,295 518,310",
};
const PATH_DATA_4ZONE_REQUEST: Partial<Record<PathId, string>> = {
  "browser-gfw":           "M 93,235 C 118,235 140,235 162,235",
  "gfw-edge":              "M 193,235 C 233,233 268,233 305,235",
  "edge-origin":           "M 340,230 C 480,221 630,213 753,210",
  "browser-origin":        "M 93,230 C 310,221 565,213 753,210",
  "browser-third-parties": "M 93,239 C 220,259 390,290 518,305",
};
const PATH_DATA_4ZONE_RESPONSE: Partial<Record<PathId, string>> = {
  "browser-gfw":           "M 93,245 C 118,245 140,245 162,245",
  "gfw-edge":              "M 193,245 C 233,243 268,243 305,245",
  "edge-origin":           "M 340,240 C 480,231 630,223 753,220",
  "browser-origin":        "M 93,240 C 310,231 565,223 753,220",
  "browser-third-parties": "M 93,249 C 220,269 390,300 518,315",
};
const PATH_LABEL_POS_4ZONE: Partial<Record<PathId, { x: number; y: number; below?: boolean }>> = {
  "browser-gfw":           { x: 128, y: 228 },
  "gfw-edge":              { x: 249, y: 228 },
  "edge-origin":           { x: 546, y: 214 },
  "browser-origin":        { x: 423, y: 216 },
  "browser-third-parties": { x: 305, y: 292, below: true },
};
const PATH_LABEL_POS_4ZONE_REQUEST: Partial<Record<PathId, { x: number; y: number }>> = {
  "browser-gfw":           { x: 128, y: 222 },
  "gfw-edge":              { x: 249, y: 222 },
  "edge-origin":           { x: 546, y: 208 },
  "browser-origin":        { x: 423, y: 210 },
  "browser-third-parties": { x: 305, y: 286 },
};
const PATH_LABEL_POS_4ZONE_RESPONSE: Partial<Record<PathId, { x: number; y: number }>> = {
  "browser-gfw":           { x: 128, y: 260 },
  "gfw-edge":              { x: 249, y: 260 },
  "edge-origin":           { x: 546, y: 246 },
  "browser-origin":        { x: 423, y: 248 },
  "browser-third-parties": { x: 305, y: 330 },
};

const PATH_COLORS: Partial<Record<PathId, string>> = {
  "browser-gfw":           "var(--color-red)",
  "gfw-edge":              "var(--color-node-browser)",
  "browser-edge":          "var(--color-node-browser)",
  "edge-origin":           "var(--color-node-origin)",
  "browser-origin":        "var(--color-node-origin)",
  "browser-third-parties": "var(--color-node-third-parties)",
};

const NODE_COLORS: Record<NodeId, string> = {
  browser:         "var(--color-node-browser)",
  gfw:             "var(--color-red)",
  edge:            "var(--color-node-edge)",
  origin:          "var(--color-node-origin)",
  "third-parties": "var(--color-node-third-parties)",
};

const NODE_LABELS: Record<NodeId, string> = {
  browser:         "Browser",
  gfw:             "GFW checkpoint",
  edge:            "Edge / CDN",
  origin:          "Origin Server",
  "third-parties": "3rd Parties",
};

const CACHE_SUBZONE_Y = 370;

function BrowserNode({ x, y, active }: { x: number; y: number; active: boolean }) {
  const color = "var(--color-node-browser)";
  return (
    <g transform={`translate(${x},${y})`} opacity={active ? 1 : 0.25} className={styles.node}>
      <circle r={22} fill="var(--color-bg)" stroke={color} strokeWidth={1.5} />
      <circle r={16} fill={`color-mix(in srgb, ${color} 7%, transparent)`} />
      <rect x={-9} y={-8} width={18} height={12} rx={2} fill="none" stroke={color} strokeWidth={1.5} />
      <line x1={-4} y1={4} x2={4} y2={4} stroke={color} strokeWidth={1.5} />
      <line x1={0} y1={4} x2={0} y2={7} stroke={color} strokeWidth={1.5} />
      <line x1={-3} y1={7} x2={3} y2={7} stroke={color} strokeWidth={1.5} />
      {active && <circle r={26} fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />}
    </g>
  );
}

function GfwNode({ x, y, active }: { x: number; y: number; active: boolean }) {
  const color = "var(--color-red)";
  return (
    <g transform={`translate(${x},${y})`} opacity={active ? 1 : 0.3} className={styles.node}>
      <rect
        x={-13} y={-20} width={26} height={40} rx={2}
        fill={`color-mix(in srgb, ${color} 6%, transparent)`}
        stroke={color} strokeWidth={1.5} strokeDasharray="4 3"
      />
      <line x1={-7} y1={-8} x2={7} y2={-8} stroke={color} strokeWidth={1} opacity={0.6} />
      <line x1={-7} y1={0}  x2={4} y2={0}  stroke={color} strokeWidth={1} opacity={0.6} />
      <line x1={-7} y1={8}  x2={5} y2={8}  stroke={color} strokeWidth={1} opacity={0.6} />
      {active && <rect x={-17} y={-24} width={34} height={48} rx={3} fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />}
    </g>
  );
}

function EdgeNode({ x, y, active }: { x: number; y: number; active: boolean }) {
  const color = "var(--color-node-edge)";
  return (
    <g transform={`translate(${x},${y})`} opacity={active ? 1 : 0.25} className={styles.node}>
      <polygon points="0,-22 19,11 -19,11" fill="var(--color-bg)" stroke={color} strokeWidth={1.5} />
      <circle r={7} fill={`color-mix(in srgb, ${color} 15%, transparent)`} />
      <circle r={3} fill={color} />
      {active && <polygon points="0,-28 24,14 -24,14" fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />}
    </g>
  );
}

function OriginNode({ x, y, active }: { x: number; y: number; active: boolean }) {
  const color = "var(--color-node-origin)";
  return (
    <g transform={`translate(${x},${y})`} opacity={active ? 1 : 0.25} className={styles.node}>
      <rect x={-22} y={-15} width={44} height={30} rx={4} fill="var(--color-bg)" stroke={color} strokeWidth={1.5} />
      <line x1={-14} y1={-5} x2={14} y2={-5} stroke={color} strokeWidth={1} opacity={0.6} />
      <line x1={-14} y1={1} x2={8}  y2={1}  stroke={color} strokeWidth={1} opacity={0.6} />
      <line x1={-14} y1={7} x2={4}  y2={7}  stroke={color} strokeWidth={1} opacity={0.6} />
      {active && <rect x={-26} y={-19} width={52} height={38} rx={6} fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />}
    </g>
  );
}

function ThirdPartiesNode({ x, y, active }: { x: number; y: number; active: boolean }) {
  const color = "var(--color-node-third-parties)";
  return (
    <g transform={`translate(${x},${y})`} opacity={active ? 1 : 0.25} className={styles.node}>
      <rect x={-22} y={-13} width={44} height={26} rx={4} fill="var(--color-bg)" stroke={color} strokeWidth={1.5} />
      <line x1={-14} y1={-3} x2={14} y2={-3} stroke={color} strokeWidth={1} opacity={0.6} />
      <line x1={-14} y1={4}  x2={6}  y2={4}  stroke={color} strokeWidth={1} opacity={0.6} />
      {active && <rect x={-26} y={-17} width={52} height={34} rx={6} fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />}
    </g>
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

interface ZoneDef {
  region: NetworkRegion;
  x: number;
  w: number;
}

function ZoneBands({ nodes, hasCdn, hasGfw }: { nodes: DiagramNode[]; hasCdn: boolean; hasGfw: boolean }) {
  const svgH = 480;
  const labelY = 22;

  const edgeNode = nodes.find((n) => n.id === "edge");
  const originNode = nodes.find((n) => n.id === "origin");
  const thirdPartiesNode = nodes.find((n) => n.id === "third-parties");
  const edgeRegion: NetworkRegion = edgeNode?.region ?? "edge";
  const originRegion: NetworkRegion = originNode?.region ?? "origin";
  const thirdPartyRegion: NetworkRegion = thirdPartiesNode?.region ?? "origin";

  // 4-zone layout when third-parties has a distinct intermediate region
  const hasIntermediateZone =
    hasGfw && hasCdn &&
    !!thirdPartiesNode?.present &&
    thirdPartyRegion !== "origin" &&
    thirdPartyRegion !== originRegion;

  let zones: ZoneDef[];
  if (hasIntermediateZone) {
    const b = ZONE_BOUNDS.gfw_cdn_4;
    zones = [
      { region: "china",        x: b.china[0],  w: b.china[1]  - b.china[0]  },
      { region: edgeRegion,     x: b.edge[0],   w: b.edge[1]   - b.edge[0]   },
      { region: thirdPartyRegion, x: b.inter[0], w: b.inter[1] - b.inter[0]  },
      { region: originRegion,   x: b.origin[0], w: b.origin[1] - b.origin[0] },
    ];
  } else if (hasGfw && hasCdn) {
    const bounds = ZONE_BOUNDS.gfw_cdn;
    zones = [
      { region: "china",      x: bounds.china[0],  w: bounds.china[1]  - bounds.china[0]  },
      { region: edgeRegion,   x: bounds.edge[0],   w: bounds.edge[1]   - bounds.edge[0]   },
      { region: originRegion, x: bounds.origin[0], w: bounds.origin[1] - bounds.origin[0] },
    ];
  } else if (hasCdn) {
    const bounds = ZONE_BOUNDS.noGfw_cdn;
    zones = [
      { region: "client",     x: bounds.client[0], w: bounds.client[1] - bounds.client[0] },
      { region: edgeRegion,   x: bounds.edge[0],   w: bounds.edge[1]   - bounds.edge[0]   },
      { region: originRegion, x: bounds.origin[0], w: bounds.origin[1] - bounds.origin[0] },
    ];
  } else {
    const bounds = ZONE_BOUNDS.noGfw_noCdn;
    zones = [
      { region: "client",     x: bounds.client[0], w: bounds.client[1] - bounds.client[0] },
      { region: originRegion, x: bounds.origin[0], w: bounds.origin[1] - bounds.origin[0] },
    ];
  }

  const clientOrChinaZone = zones[0];

  return (
    <g>
      {/* GFW zone overlay (subtle red tint over China zone) — drawn first, below everything */}
      {hasGfw && (
        <rect
          x={clientOrChinaZone.x} y={0}
          width={clientOrChinaZone.w} height={svgH}
          fill="color-mix(in srgb, var(--color-red) 3%, transparent)"
        />
      )}

      {zones.map((zone) => {
        const fill = ZONE_COLORS[zone.region] ?? "var(--color-cyan)";
        const label = ZONE_LABELS[zone.region] ?? zone.region.toUpperCase();
        return (
          <g key={zone.region}>
            <rect
              x={zone.x} y={0} width={zone.w} height={svgH}
              fill={`color-mix(in srgb, ${fill} 4%, transparent)`}
            />
            <text
              x={zone.x + zone.w / 2} y={labelY}
              fontSize={10} fontFamily="var(--font-mono)"
              fill={fill} opacity={0.5}
              letterSpacing="0.06em" textAnchor="middle"
            >
              {label}
            </text>
          </g>
        );
      })}

      {zones.slice(1).map((zone) => (
        <line
          key={`sep-${zone.region}`}
          x1={zone.x} y1={0} x2={zone.x} y2={svgH}
          stroke="var(--color-border)" strokeWidth={1} opacity={0.5} strokeDasharray="4 6"
        />
      ))}

      {/* Cache sub-zone within the leftmost zone */}
      <rect
        x={clientOrChinaZone.x} y={CACHE_SUBZONE_Y}
        width={clientOrChinaZone.w} height={svgH - CACHE_SUBZONE_Y}
        fill={`color-mix(in srgb, var(--color-cyan) 7%, transparent)`}
      />
      <line
        x1={clientOrChinaZone.x} y1={CACHE_SUBZONE_Y}
        x2={clientOrChinaZone.x + clientOrChinaZone.w} y2={CACHE_SUBZONE_Y}
        stroke="var(--color-border2)" strokeWidth={1} opacity={0.6} strokeDasharray="3 5"
      />
      <text
        x={clientOrChinaZone.x + clientOrChinaZone.w / 2} y={svgH - 8}
        fontSize={9} fontFamily="var(--font-mono)"
        fill="var(--color-cyan)" opacity={0.35}
        letterSpacing="0.06em" textAnchor="middle"
      >
        CACHE
      </text>

      {/* GFW zone label at the bottom of the China zone */}
      {hasGfw && (
        <text
          x={clientOrChinaZone.x + clientOrChinaZone.w / 2} y={CACHE_SUBZONE_Y - 8}
          fontSize={8} fontFamily="var(--font-mono)"
          fill="var(--color-red)" opacity={0.5}
          letterSpacing="0.08em" textAnchor="middle"
        >
          GREAT FIREWALL ZONE
        </text>
      )}
    </g>
  );
}

export function NodeRenderer({ nodes, paths, activeNodes, activePaths, pathTimings, pathDirections, historicalPaths }: Props) {
  const activeNodeSet = new Set(activeNodes);
  const activePathSet = new Set(activePaths);
  const hasCdn = nodes.find((n) => n.id === "edge")?.present ?? false;
  const hasGfw = nodes.find((n) => n.id === "gfw")?.present ?? false;
  const thirdPartiesNode = nodes.find((n) => n.id === "third-parties");
  const thirdPartyRegion = thirdPartiesNode?.region ?? "origin";
  const originRegion = nodes.find((n) => n.id === "origin")?.region ?? "origin";
  const hasIntermediateZone =
    hasGfw && hasCdn &&
    !!thirdPartiesNode?.present &&
    thirdPartyRegion !== "origin" &&
    thirdPartyRegion !== originRegion;

  const nodePositions = hasIntermediateZone
    ? NODE_POS_4ZONE
    : hasGfw ? NODE_POS_WITH_GFW : NODE_POS_NO_GFW;

  const pathData      = hasIntermediateZone ? PATH_DATA_4ZONE      : PATH_DATA;
  const pathDataReq   = hasIntermediateZone ? PATH_DATA_4ZONE_REQUEST  : PATH_DATA_REQUEST;
  const pathDataRes   = hasIntermediateZone ? PATH_DATA_4ZONE_RESPONSE : PATH_DATA_RESPONSE;
  const labelPos      = hasIntermediateZone ? PATH_LABEL_POS_4ZONE     : PATH_LABEL_POS;
  const labelPosReq   = hasIntermediateZone ? PATH_LABEL_POS_4ZONE_REQUEST  : PATH_LABEL_POS_REQUEST;
  const labelPosRes   = hasIntermediateZone ? PATH_LABEL_POS_4ZONE_RESPONSE : PATH_LABEL_POS_RESPONSE;

  return (
    <svg id="diagram-svg" viewBox="0 0 900 480" width="100%" height="100%" className={styles.svg}>
      <defs>
        <filter id="glow-cyan">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-green">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-orange">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-red">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <ZoneBands nodes={nodes} hasCdn={hasCdn} hasGfw={hasGfw} />

      {/* Paths */}
      {paths.map((path) => {
        const isActive = activePathSet.has(path.id);
        const direction = pathDirections?.[path.id];
        const color = PATH_COLORS[path.id] ?? "var(--color-node-browser)";
        const timing = pathTimings?.[path.id];
        const labelWidth = timing ? timing.length * 5.8 + 8 : 0;

        if (!isActive) {
          const historical = historicalPaths?.[path.id as PathId];
          if (historical !== undefined) {
            const isReq = historical.direction === "request";
            const isRes = historical.direction === "response";
            const histD = isReq ? pathDataReq[path.id]
                        : isRes ? pathDataRes[path.id]
                        : pathData[path.id];
            const histLabelPos = isReq ? labelPosReq[path.id]
                               : isRes ? labelPosRes[path.id]
                               : labelPos[path.id];
            if (!histD) return null;
            const histTiming = historical.timing;
            const histLabelWidth = histTiming ? histTiming.length * 5.8 + 8 : 0;
            return (
              <g key={path.id}>
                <path d={histD} fill="none" stroke={color} strokeWidth={1} opacity={0.45} strokeDasharray="4 4" />
                {histTiming && histLabelPos && (
                  <g>
                    <rect x={histLabelPos.x - histLabelWidth / 2 - 4} y={histLabelPos.y - 14} width={histLabelWidth} height={14} rx={3} fill="var(--color-bg)" opacity={0.7} />
                    <text x={histLabelPos.x} y={histLabelPos.y} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill={color} opacity={0.5} className={styles.pathLabel}>{histTiming}</text>
                  </g>
                )}
              </g>
            );
          }

          const d = pathData[path.id];
          if (!d) return null;
          return (
            <g key={path.id}>
              <path id={`path-${path.id}`} d={d} fill="none" stroke={color} strokeWidth={0.5} opacity={0.15} strokeDasharray="4 4" />
            </g>
          );
        }

        if (!direction) {
          const d = pathData[path.id];
          const lp = labelPos[path.id];
          if (!d) return null;
          const glowFilter = PATH_GLOW_FILTER[path.id];
          return (
            <g key={path.id}>
              <path id={`path-${path.id}`} d={d} fill="none" stroke={color} strokeWidth={1.5} opacity={0.8} filter={glowFilter ? `url(#${glowFilter})` : undefined} />
              <ForwardPacket pathRef={`path-${path.id}`} color={color} />
              <ReturnPacket pathRef={`path-${path.id}`} color={color} />
              {timing && lp && (
                <g>
                  <rect x={lp.x - labelWidth / 2 - 4} y={lp.below ? lp.y - 11 : lp.y - 14} width={labelWidth} height={14} rx={3} fill="var(--color-bg)" opacity={0.85} />
                  <text x={lp.x} y={lp.y} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill={color} opacity={0.9} className={styles.pathLabel}>{timing}</text>
                </g>
              )}
            </g>
          );
        }

        // Two-lane rendering
        const isRequest = direction === "request";
        const activeD = isRequest ? pathDataReq[path.id] : pathDataRes[path.id];
        const dimD = isRequest ? pathDataRes[path.id] : pathDataReq[path.id];
        if (!activeD || !dimD) return null;

        const activePathRef = `path-${path.id}-${isRequest ? "req" : "res"}`;
        const activeLabelPos = isRequest ? labelPosReq[path.id] : labelPosRes[path.id];

        return (
          <g key={path.id}>
            <path d={dimD} fill="none" stroke={color} strokeWidth={1} opacity={0.18} strokeDasharray="4 4" />
            <path id={activePathRef} d={activeD} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} filter={PATH_GLOW_FILTER[path.id] ? `url(#${PATH_GLOW_FILTER[path.id]})` : undefined} />
            {isRequest
              ? <ForwardPacket pathRef={activePathRef} color={color} />
              : <ReturnPacket pathRef={activePathRef} color={color} />
            }
            {timing && activeLabelPos && (
              <g>
                <rect x={activeLabelPos.x - labelWidth / 2 - 4} y={activeLabelPos.y - 14} width={labelWidth} height={14} rx={3} fill="var(--color-bg)" opacity={0.85} />
                <text x={activeLabelPos.x} y={activeLabelPos.y} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill={color} opacity={0.9} className={styles.pathLabel}>{timing}</text>
              </g>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        if (!node.present) return null;
        const pos = nodePositions[node.id];
        const isActive = activeNodeSet.has(node.id);
        const labelOffsetY = node.id === "gfw" ? 28 : 34;
        const nodeLabel = node.id === "edge" ? node.label : NODE_LABELS[node.id];

        return (
          <g key={node.id}>
            {node.id === "browser" && <BrowserNode x={pos.x} y={pos.y} active={isActive} />}
            {node.id === "gfw"     && <GfwNode     x={pos.x} y={pos.y} active={isActive} />}
            {node.id === "edge"    && <EdgeNode     x={pos.x} y={pos.y} active={isActive} />}
            {node.id === "origin"  && <OriginNode   x={pos.x} y={pos.y} active={isActive} />}
            {node.id === "third-parties" && <ThirdPartiesNode x={pos.x} y={pos.y} active={isActive} />}

            <text
              x={pos.x} y={pos.y + labelOffsetY}
              textAnchor="middle"
              fill={isActive ? NODE_COLORS[node.id] : "var(--color-text2)"}
              fontSize={node.id === "gfw" ? 11 : 13}
              fontFamily="var(--font-mono)"
            >
              {nodeLabel}
            </text>
            {node.subLabel && (
              <text
                x={pos.x} y={pos.y + labelOffsetY + 13}
                textAnchor="middle"
                fill="var(--color-text2)"
                fontSize={8}
                fontFamily="var(--font-mono)"
                opacity={0.55}
              >
                {node.subLabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
