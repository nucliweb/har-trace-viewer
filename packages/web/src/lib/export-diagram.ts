import type { Theme } from "../hooks/useTheme.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Presentation properties that depend on CSS variables or stylesheets and must travel with each element. */
const INLINED_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "filter",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
  "stop-color",
  "stop-opacity",
  "flood-color",
] as const;

/** Values that equal the SVG initial value: skipping them keeps the export small. */
const DEFAULT_VALUES: Record<string, string> = { opacity: "1", filter: "none" };

const BADGE_BAND = 44;
const BADGE_HEIGHT = 28;
const BADGE_GAP = 8;
const BADGE_PADDING = 12;
const MONO_ADVANCE = 0.6;
const FALLBACK_BACKGROUND: Record<Theme, string> = { light: "#f5f7fa", dark: "#060910" };

export interface ExportBadge {
  label: string;
  value: string;
  color: string;
  background?: string;
  opacity: number;
}

export interface SerializeOptions {
  theme: Theme;
  /** `@font-face` rules with data: URIs, see `collectFontFaceCss`. */
  fontCss: string;
  badges?: ExportBadge[];
  /** Injected so the serializer is testable without a layout engine. */
  getComputedStyle?: typeof window.getComputedStyle;
  /** Page background; defaults to the computed background of <body>. */
  background?: string;
}

function isTransparent(color: string): boolean {
  return !color || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);
}

function resolveBackground(options: SerializeOptions, getCS: typeof window.getComputedStyle) {
  if (options.background) return options.background;
  const body = getCS(document.body).backgroundColor;
  return isTransparent(body) ? FALLBACK_BACKGROUND[options.theme] : body;
}

function inlineComputedStyles(
  source: SVGSVGElement,
  clone: SVGSVGElement,
  getCS: typeof window.getComputedStyle
): void {
  const originals = [source, ...Array.from(source.querySelectorAll("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
  originals.forEach((original, i) => {
    const computed = getCS(original);
    const declarations: string[] = [];
    for (const prop of INLINED_PROPERTIES) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== DEFAULT_VALUES[prop]) {
        declarations.push(`${prop}:${value}`);
        copies[i].removeAttribute(prop); // the inlined style replaces var() presentation attributes
      }
    }
    const copy = copies[i];
    copy.removeAttribute("class");
    if (declarations.length > 0) copy.setAttribute("style", declarations.join(";"));
  });
}

function badgeNodes(badges: ExportBadge[], width: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  const sizes = badges.map((b) => {
    const labelWidth = b.label.length * 12 * MONO_ADVANCE;
    const valueWidth = b.value.length * 14 * MONO_ADVANCE;
    return { labelWidth, width: BADGE_PADDING * 2 + labelWidth + 6 + valueWidth };
  });
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + BADGE_GAP * (badges.length - 1);
  let x = (width - total) / 2;
  const y = -BADGE_BAND + (BADGE_BAND - BADGE_HEIGHT) / 2;
  badges.forEach((badge, i) => {
    const size = sizes[i];
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("opacity", String(badge.opacity));
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(size.width));
    rect.setAttribute("height", String(BADGE_HEIGHT));
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", badge.background ?? "none");
    rect.setAttribute("stroke", badge.color);
    rect.setAttribute("stroke-width", "1.5");
    const baseline = y + BADGE_HEIGHT / 2 + 5;
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(x + BADGE_PADDING));
    label.setAttribute("y", String(baseline));
    label.setAttribute("fill", badge.color);
    label.setAttribute("font-family", '"JetBrains Mono", monospace');
    label.setAttribute("font-size", "12");
    label.setAttribute("opacity", "0.75");
    label.textContent = badge.label;
    const value = document.createElementNS(SVG_NS, "text");
    value.setAttribute("x", String(x + BADGE_PADDING + size.labelWidth + 6));
    value.setAttribute("y", String(baseline));
    value.setAttribute("fill", badge.color);
    value.setAttribute("font-family", '"JetBrains Mono", monospace');
    value.setAttribute("font-size", "14");
    value.setAttribute("font-weight", "700");
    value.textContent = badge.value;
    g.append(rect, label, value);
    group.appendChild(g);
    x += size.width + BADGE_GAP;
  });
  return group;
}

/**
 * Serializes the live diagram into a standalone SVG: styles resolved from the cascade, animation
 * stripped, fonts embedded, opaque background, and the metric badges (HTML in the page) as text.
 */
export function serializeDiagramSvg(svg: SVGSVGElement, options: SerializeOptions): string {
  const getCS = options.getComputedStyle ?? window.getComputedStyle.bind(window);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone, getCS);
  clone
    .querySelectorAll("animateMotion, animate, animateTransform, set")
    .forEach((el) => el.remove());

  const [minX, minY, vbWidth, vbHeight] = (svg.getAttribute("viewBox") ?? "0 0 800 600")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const badges = options.badges ?? [];
  const band = badges.length > 0 ? BADGE_BAND : 0;
  const top = minY - band;
  const height = vbHeight + band;

  clone.setAttribute("viewBox", `${minX} ${top} ${vbWidth} ${height}`);
  clone.setAttribute("width", String(vbWidth));
  clone.setAttribute("height", String(height));
  clone.removeAttribute("id");
  clone.removeAttribute("style");

  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = options.fontCss;
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("x", String(minX));
  background.setAttribute("y", String(top));
  background.setAttribute("width", String(vbWidth));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", resolveBackground(options, getCS));
  clone.prepend(style, background);

  if (badges.length > 0) clone.appendChild(badgeNodes(badges, minX + vbWidth));
  return new XMLSerializer().serializeToString(clone);
}

/** Reads the visible metric badges rendered as HTML (`data-badge-state` is "active" or "dim"). */
export function readBadges(
  container: ParentNode,
  getCS: typeof window.getComputedStyle = window.getComputedStyle.bind(window)
): ExportBadge[] {
  const badges: ExportBadge[] = [];
  container.querySelectorAll<HTMLElement>("[data-badge-state]").forEach((el) => {
    const state = el.dataset.badgeState;
    if (state === "hidden") return;
    const parts = el.querySelectorAll("span");
    const computed = getCS(el);
    badges.push({
      label: parts[0]?.textContent ?? "",
      value: parts[parts.length - 1]?.textContent ?? "",
      color: computed.color,
      background: isTransparent(computed.backgroundColor) ? undefined : computed.backgroundColor,
      opacity: state === "dim" ? 0.45 : 1,
    });
  });
  return badges;
}

export function currentTheme(): Theme {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function exportFilename(pageName: string, step: number, extension: "svg" | "png"): string {
  const slug =
    pageName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page";
  return `htv-${slug}-step-${step}.${extension}`;
}
