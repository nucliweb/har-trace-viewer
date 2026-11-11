import { fitText } from "./labels.js";
import { GFW_ZONE_CAPTION_OFFSET, type Zone } from "./layout.js";

const LABEL_Y = 22;
// With a cache node in the band, the band label moves to its bottom-left corner and the GFW
// zone caption, which the hop to the cache would cross, moves under the zone name.
const CORNER_INSET = 8;
const GFW_CAPTION_TOP_Y = LABEL_Y + 16;

const FONT_SIZE = 12;
const ZONE_SPACING = 0.06;
const GFW_SPACING = 0.08;

interface Props {
  zones: Zone[];
  height: number;
  hasGfw: boolean;
  cacheSubzoneY: number;
  hasCacheNode?: boolean;
  /** How much the labels grow on a small screen (1: drawn as designed). */
  labelScale?: number;
}

export function ZoneBands({
  zones,
  height,
  hasGfw,
  cacheSubzoneY,
  hasCacheNode = false,
  labelScale = 1,
}: Props) {
  // The client zone (China behind the GFW) hosts the browser cache sub-zone.
  const client = zones[0];
  const clientWidth = client.x1 - client.x0;
  const clientCentre = client.x0 + clientWidth / 2;
  const fontSize = FONT_SIZE * labelScale;
  const zoneText = { fontSize, fontFamily: "var(--font-mono)", textAnchor: "middle" } as const;
  // Grown captions keep their top edge: the baseline moves down by what the letters gained.
  const labelY = LABEL_Y + (fontSize - FONT_SIZE) * 0.75;
  // Grown captions are cut to their zone, with a little room on each side.
  const fit = (text: string, width: number, spacing: number) =>
    labelScale > 1 ? fitText(text, width - 2 * CORNER_INSET, fontSize, spacing) : text;

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
            y={labelY}
            {...zoneText}
            fill={zone.color}
            opacity={0.5}
            letterSpacing={`${ZONE_SPACING}em`}
          >
            {fit(zone.label, zone.x1 - zone.x0, ZONE_SPACING)}
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
        y={cacheSubzoneY}
        width={clientWidth}
        height={height - cacheSubzoneY}
        fill="color-mix(in srgb, var(--color-cyan) 7%, transparent)"
      />
      <line
        x1={client.x0}
        y1={cacheSubzoneY}
        x2={client.x1}
        y2={cacheSubzoneY}
        stroke="var(--color-border2)"
        strokeWidth={1}
        opacity={0.6}
        strokeDasharray="3 5"
      />
      <text
        x={hasCacheNode ? client.x0 + CORNER_INSET : clientCentre}
        y={height - 8}
        {...zoneText}
        {...(hasCacheNode ? { textAnchor: "start" } : {})}
        fill="var(--color-cyan)"
        opacity={0.35}
        letterSpacing={`${ZONE_SPACING}em`}
      >
        CACHE
      </text>

      {hasGfw && (
        <text
          x={clientCentre}
          y={
            hasCacheNode
              ? GFW_CAPTION_TOP_Y + (labelY - LABEL_Y) + (labelScale - 1) * 16
              : cacheSubzoneY - GFW_ZONE_CAPTION_OFFSET
          }
          {...zoneText}
          fill="var(--color-red)"
          opacity={0.5}
          letterSpacing={`${GFW_SPACING}em`}
        >
          {fit("GREAT FIREWALL ZONE", clientWidth, GFW_SPACING)}
        </text>
      )}
    </g>
  );
}
