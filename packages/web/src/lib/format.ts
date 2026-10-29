/**
 * Formats a byte count with decimal units (1 KB = 1000 B).
 * Whole bytes below 1 KB, then KB and MB with one decimal under 10 and none from 10 up.
 * Examples: 0 -> "0 B", 512 -> "512 B", 1234 -> "1.2 KB", 15600 -> "16 KB", 2500000 -> "2.5 MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

/**
 * Formats a duration: whole milliseconds below 1 s ("340 ms"), seconds with one decimal
 * from 1 s up ("1.2 s"), and "n/a" when there is no value.
 */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "n/a";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export type DeltaUnit = "ms" | "bytes" | "count" | "ratio" | "score";

const MINUS = "\u2212";
const sign = (value: number) => (value > 0 ? "+" : value < 0 ? MINUS : "");

/**
 * Formats a signed difference (B − A) in the unit of its metric, with a "+" or a minus
 * sign: "−300 ms", "+16 KB", "−2", "+45 pp" (ratios, in percentage points), "−0.004"
 * (unitless scores such as CLS); "n/a" without a value.
 */
export function formatDelta(delta: number | null, unit: DeltaUnit): string {
  if (delta === null) return "n/a";
  const size = Math.abs(delta);
  const body = {
    ms: () => formatMs(size),
    bytes: () => formatBytes(size),
    count: () => String(Math.round(size)),
    ratio: () => `${Math.round(size * 100)} pp`,
    score: () => size.toFixed(3),
  }[unit]();
  return `${sign(delta)}${body}`;
}

/** Formats a percentage change, rounded: "−60%", "+12%"; empty without a value. */
export function formatDeltaPct(pct: number | null): string {
  return pct === null ? "" : `${sign(Math.round(pct))}${Math.abs(Math.round(pct))}%`;
}

const MAX_URL_LABEL = 36;

/**
 * Short label for a resource URL: the last path segment plus the query string,
 * truncated to 36 characters with an ellipsis. Falls back to the hostname for a bare
 * origin and to the raw (truncated) string when the URL cannot be parsed.
 */
export function shortUrl(url: string): string {
  let label: string;
  try {
    const { pathname, search, hostname } = new URL(url);
    const segment = pathname.split("/").pop() || pathname;
    label = segment && segment !== "/" ? `${segment}${search}` : hostname;
  } catch {
    label = url;
  }
  return label.length > MAX_URL_LABEL ? `${label.slice(0, MAX_URL_LABEL - 2)}…` : label;
}
