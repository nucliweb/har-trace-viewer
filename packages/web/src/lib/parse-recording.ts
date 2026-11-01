import { parseHarPages, parseTrace } from "@htv/core";
import { readFileText } from "./read-file-text.js";
import type { ParseKind, ParseProgress, ParseResultFor } from "./parse-protocol.js";

type RawHar = Parameters<typeof parseHarPages>[0];
type RawTrace = Parameters<typeof parseTrace>[0];

export const UNRECOGNIZED_JSON =
  "This JSON is neither a HAR (log.entries) nor a Chrome trace (traceEvents or an event array).";

export const GZIP_UNSUPPORTED =
  "This browser cannot decompress .gz files (no DecompressionStream): decompress the file and load it again.";

const WRONG_KIND: Record<ParseKind, string> = {
  har: "This is a Chrome trace, not a HAR: load it with the Trace button.",
  trace: "This is a HAR, not a Chrome trace: load it as the page's HAR.",
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a parsed JSON value is: a HAR has `log.entries`, a Chrome trace has `traceEvents` or
 * is the bare array of its events; anything else is neither.
 */
export function detectRecordingKind(value: unknown): ParseKind | null {
  if (Array.isArray(value)) return "trace";
  if (!isObject(value)) return null;
  if (isObject(value.log) && Array.isArray(value.log.entries)) return "har";
  if (Array.isArray(value.traceEvents)) return "trace";
  return null;
}

/**
 * Parses the text of a HAR (into its pages) or of a Chrome trace. Throws an Error whose
 * message is meant for the user: the core parser's own, or one saying the text is not JSON,
 * not a recording, or the other kind of recording.
 */
export function parseRecording<K extends ParseKind>(kind: K, text: string): ParseResultFor<K> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const found = detectRecordingKind(value);
  if (found === null) throw new Error(UNRECOGNIZED_JSON);
  if (found !== kind) throw new Error(WRONG_KIND[kind]);
  const result =
    kind === "har"
      ? parseHarPages(value as RawHar)
      : parseTrace(Array.isArray(value) ? { traceEvents: value } : (value as RawTrace));
  return result as ParseResultFor<K>;
}

/** Reads a dropped HAR or trace, gunzipping a `.gz` file, and parses it. */
export async function readRecordingFile<K extends ParseKind>(
  kind: K,
  file: File,
  report?: (progress: ParseProgress, force?: boolean) => void
): Promise<ParseResultFor<K>> {
  const isGzip = file.name.toLowerCase().endsWith(".gz");
  if (isGzip && typeof DecompressionStream === "undefined") throw new Error(GZIP_UNSUPPORTED);
  const text = await readFileText(file, isGzip, report);
  report?.({ phase: "parsing", loaded: 0, total: 0 }, true);
  return parseRecording(kind, text);
}
