const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * Serializes a value as JSON that is safe to embed inside an inline <script>
 * element. Every escape used is a valid JSON string escape, so JSON.parse of
 * the output equals the input.
 */
export function serializeFlowForHtml(flow: unknown): string {
  return JSON.stringify(flow).replace(/[<>&\u2028\u2029]/g, (ch) => ESCAPES[ch]);
}

/** Script tags embedding the flow and, for a comparison report, the second flow (B). */
export function buildFlowInjection(flow: unknown, compare?: unknown): string {
  const main = `<script>window.__HTV_FLOW__ = ${serializeFlowForHtml(flow)};</script>`;
  if (compare === undefined) return main;
  return `${main}\n<script>window.__HTV_COMPARE__ = ${serializeFlowForHtml(compare)};</script>`;
}
