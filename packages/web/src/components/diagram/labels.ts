/**
 * Diagram labels on a small screen. The drawing scales to its container, and its text with it:
 * on a phone, 12-unit labels would render at about 5px. Past that point they grow so that the
 * smallest renders at MIN_LABEL_PX, and long ones are cut to the space they have.
 */

// The smallest label of the drawing, in drawing units, and the smallest it may render at.
const SMALLEST_LABEL = 12;
const MIN_LABEL_PX = 10;

// The labels use a monospaced font: every character is this share of the font size wide.
const CHAR_WIDTH = 0.6;

/**
 * How much the labels grow when the drawing (`drawingWidth` units) shows at `renderedWidth`
 * pixels: 1 while they are readable, more once the smallest would render below 10px.
 */
export function labelScale(renderedWidth: number, drawingWidth: number): number {
  if (renderedWidth <= 0) return 1;
  const pxPerUnit = renderedWidth / drawingWidth;
  return Math.max(1, MIN_LABEL_PX / (SMALLEST_LABEL * pxPerUnit));
}

/**
 * The text, cut with an ellipsis to the characters that fit `width` units at `fontSize`, with
 * `letterSpacing` em between characters (the spaced-out zone captions).
 */
export function fitText(text: string, width: number, fontSize: number, letterSpacing = 0): string {
  const fits = Math.floor(width / ((CHAR_WIDTH + letterSpacing) * fontSize));
  if (text.length <= fits) return text;
  return `${text.slice(0, Math.max(1, fits - 1)).trimEnd()}…`;
}
