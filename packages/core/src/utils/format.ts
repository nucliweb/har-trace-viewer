import type { MetricUnit } from "../types.js";

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

/**
 * Formats a duration for a diagram caption, where room is short: whole milliseconds with no
 * space, whatever the size ("26ms", "1234ms").
 */
export function formatCaptionMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

export type DeltaUnit = MetricUnit;

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

/**
 * Formats a metric value in its unit: "340 ms", "4.1 MB", "61", "47%" (ratios), "0.012"
 * (unitless scores such as CLS); "n/a" without a value.
 */
export function formatMetricValue(value: number | null, unit: DeltaUnit): string {
  if (value === null) return "n/a";
  switch (unit) {
    case "ms":
      return formatMs(value);
    case "bytes":
      return formatBytes(value);
    case "ratio":
      return pct(value);
    case "score":
      return value.toFixed(3);
    default:
      return String(value);
  }
}

/** Formats a percentage change, rounded: "−60%", "+12%"; empty without a value. */
export function formatDeltaPct(change: number | null): string {
  return change === null ? "" : `${sign(Math.round(change))}${Math.abs(Math.round(change))}%`;
}

/** Formats a ratio as a whole percentage: 0.456 -> "46%", 1.5 -> "150%". */
/** A span of seconds in its largest unit: "5.4 d", "3 h", "12 min", "40 s". */
export function formatDuration(seconds: number): string {
  const units: [number, string][] = [
    [86400, "d"],
    [3600, "h"],
    [60, "min"],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) {
      const value = seconds / size;
      return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} ${unit}`;
    }
  }
  return `${seconds} s`;
}

export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * The last non-empty path segment of a URL, for a compact resource name:
 * "https://cdn.example.com/a/app.js?v=1" -> "app.js". Falls back to the raw string when the
 * URL cannot be parsed or has no path segment (a bare origin).
 */
export function fileName(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

const MAX_URL_LABEL = 36;

// What must not reach a terminal or reorder a label: controls, format characters (bidi
// overrides, zero-width marks), line and paragraph separators, private use.
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}]/u;
const ESCAPES = /(?:%[0-9A-Fa-f]{2})+/g;
const strict = new TextDecoder("utf-8", { fatal: true });

const sequenceLength = (lead: number): number =>
  lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc2 ? 2 : 0;

/**
 * Turns the percent-escaped non-ASCII characters of a label into text. ASCII escapes (%2F, %3F,
 * %23, %20, ...) stay, since decoding them could change what the path says; so do invalid UTF-8,
 * malformed escapes and the characters in UNSAFE_CHAR.
 */
function decodeLabel(label: string): string {
  return label.replace(ESCAPES, (run) => {
    const bytes = run
      .slice(1)
      .split("%")
      .map((hex) => parseInt(hex, 16));
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const length = sequenceLength(bytes[i] ?? 0);
      const escape = (count: number) =>
        bytes
          .slice(i, i + count)
          .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
          .join("");
      let char: string | null = null;
      if (length > 0 && i + length <= bytes.length) {
        try {
          char = strict.decode(Uint8Array.from(bytes.slice(i, i + length)));
        } catch {
          char = null;
        }
      }
      if (char === null || UNSAFE_CHAR.test(char)) {
        const count = char === null ? 1 : length;
        out += escape(count);
        i += count;
      } else {
        out += char;
        i += length;
      }
    }
    return out;
  });
}

/**
 * Short label for a resource URL: the last path segment plus the query string, with the
 * percent-escaped non-ASCII characters shown as text, truncated to 36 characters with an
 * ellipsis. Falls back to the hostname for a bare origin and to the raw (truncated) string when
 * the URL cannot be parsed.
 */
export function shortUrl(url: string): string {
  let label: string;
  try {
    const { pathname, search, hostname } = new URL(url);
    const segment = pathname.split("/").pop() || pathname;
    label = segment && segment !== "/" ? decodeLabel(`${segment}${search}`) : hostname;
  } catch {
    label = url;
  }
  if (label.length <= MAX_URL_LABEL) return label;
  const end = MAX_URL_LABEL - 2;
  const cut = /[\uDC00-\uDFFF]/.test(label[end] ?? "") ? end - 1 : end;
  return `${label.slice(0, cut)}…`;
}
