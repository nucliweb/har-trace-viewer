import type { Zone } from "./layout.js";

const LABEL_Y = 22;
const CACHE_SUBZONE_Y = 370;

const zoneText = {
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  textAnchor: "middle",
} as const;

interface Props {
  zones: Zone[];
  height: number;
  hasGfw: boolean;
}

export function ZoneBands({ zones, height, hasGfw }: Props) {
  // The client zone (China behind the GFW) hosts the browser cache sub-zone.
  const client = zones[0];
  const clientWidth = client.x1 - client.x0;
  const clientCentre = client.x0 + clientWidth / 2;

  return (
    <g>
      {/* GFW overlay: a subtle red tint over the China zone, below everything else */}
      {hasGfw && (
        <rect
          x={client.x0}
          y={0}
          width={clientWidth}
          height={height}
          fill="color-mix(in srgb, var(--color-red) 3%, transparent)"
        />
      )}

      {zones.map((zone) => (
        <g key={zone.id}>
          <rect
            x={zone.x0}
            y={0}
            width={zone.x1 - zone.x0}
            height={height}
            fill={`color-mix(in srgb, ${zone.color} 4%, transparent)`}
          />
          <text
            x={(zone.x0 + zone.x1) / 2}
            y={LABEL_Y}
            {...zoneText}
            fill={zone.color}
            opacity={0.5}
            letterSpacing="0.06em"
          >
            {zone.label}
          </text>
        </g>
      ))}

      {zones.slice(1).map((zone) => (
        <line
          key={`sep-${zone.id}`}
          x1={zone.x0}
          y1={0}
          x2={zone.x0}
          y2={height}
          stroke="var(--color-border)"
          strokeWidth={1}
          opacity={0.5}
          strokeDasharray="4 6"
        />
      ))}

      <rect
        x={client.x0}
        y={CACHE_SUBZONE_Y}
        width={clientWidth}
        height={height - CACHE_SUBZONE_Y}
        fill="color-mix(in srgb, var(--color-cyan) 7%, transparent)"
      />
      <line
        x1={client.x0}
        y1={CACHE_SUBZONE_Y}
        x2={client.x1}
        y2={CACHE_SUBZONE_Y}
        stroke="var(--color-border2)"
        strokeWidth={1}
        opacity={0.6}
        strokeDasharray="3 5"
      />
      <text
        x={clientCentre}
        y={height - 8}
        {...zoneText}
        fill="var(--color-cyan)"
        opacity={0.35}
        letterSpacing="0.06em"
      >
        CACHE
      </text>

      {hasGfw && (
        <text
          x={clientCentre}
          y={CACHE_SUBZONE_Y - 8}
          {...zoneText}
          fill="var(--color-red)"
          opacity={0.5}
          letterSpacing="0.08em"
        >
          GREAT FIREWALL ZONE
        </text>
      )}
    </g>
  );
}
