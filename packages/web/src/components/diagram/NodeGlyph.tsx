import type { JSX } from "react";
import type { NodeId } from "@htv/core";

interface GlyphProps {
  color: string;
  active: boolean;
}

const tint = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

// Outline drawn around an active node.
const halo = { fill: "none", strokeWidth: 0.5, opacity: 0.3 } as const;
// Text lines sketched inside the server boxes.
const rule = { strokeWidth: 1, opacity: 0.6 } as const;

function Browser({ color, active }: GlyphProps) {
  return (
    <>
      <circle r={22} fill="var(--color-bg)" stroke={color} strokeWidth={1.5} />
      <circle r={16} fill={tint(color, 7)} />
      <rect
        x={-9}
        y={-8}
        width={18}
        height={12}
        rx={2}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
      <line x1={-4} y1={4} x2={4} y2={4} stroke={color} strokeWidth={1.5} />
      <line x1={0} y1={4} x2={0} y2={7} stroke={color} strokeWidth={1.5} />
      <line x1={-3} y1={7} x2={3} y2={7} stroke={color} strokeWidth={1.5} />
      {active && <circle r={26} stroke={color} {...halo} />}
    </>
  );
}

function Gfw({ color, active }: GlyphProps) {
  return (
    <>
      <rect
        x={-13}
        y={-20}
        width={26}
        height={40}
        rx={2}
        fill={tint(color, 6)}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <line x1={-7} y1={-8} x2={7} y2={-8} stroke={color} {...rule} />
      <line x1={-7} y1={0} x2={4} y2={0} stroke={color} {...rule} />
      <line x1={-7} y1={8} x2={5} y2={8} stroke={color} {...rule} />
      {active && <rect x={-17} y={-24} width={34} height={48} rx={3} stroke={color} {...halo} />}
    </>
  );
}

function Edge({ color, active }: GlyphProps) {
  return (
    <>
      <polygon
        points="0,-22 19,11 -19,11"
        fill="var(--color-bg)"
        stroke={color}
        strokeWidth={1.5}
      />
      <circle r={7} fill={tint(color, 15)} />
      <circle r={3} fill={color} />
      {active && <polygon points="0,-28 24,14 -24,14" stroke={color} {...halo} />}
    </>
  );
}

function Origin({ color, active }: GlyphProps) {
  return (
    <>
      <rect
        x={-22}
        y={-15}
        width={44}
        height={30}
        rx={4}
        fill="var(--color-bg)"
        stroke={color}
        strokeWidth={1.5}
      />
      <line x1={-14} y1={-5} x2={14} y2={-5} stroke={color} {...rule} />
      <line x1={-14} y1={1} x2={8} y2={1} stroke={color} {...rule} />
      <line x1={-14} y1={7} x2={4} y2={7} stroke={color} {...rule} />
      {active && <rect x={-26} y={-19} width={52} height={38} rx={6} stroke={color} {...halo} />}
    </>
  );
}

function ThirdParties({ color, active }: GlyphProps) {
  return (
    <>
      <rect
        x={-22}
        y={-13}
        width={44}
        height={26}
        rx={4}
        fill="var(--color-bg)"
        stroke={color}
        strokeWidth={1.5}
      />
      <line x1={-14} y1={-3} x2={14} y2={-3} stroke={color} {...rule} />
      <line x1={-14} y1={4} x2={6} y2={4} stroke={color} {...rule} />
      {active && <rect x={-26} y={-17} width={52} height={34} rx={6} stroke={color} {...halo} />}
    </>
  );
}

const GLYPHS: Record<NodeId, (props: GlyphProps) => JSX.Element> = {
  browser: Browser,
  gfw: Gfw,
  edge: Edge,
  origin: Origin,
  "third-parties": ThirdParties,
};

/** The shape of a node, drawn around (0, 0). */
export function NodeGlyph({ id, ...props }: GlyphProps & { id: NodeId }) {
  const Glyph = GLYPHS[id];
  return <Glyph {...props} />;
}
