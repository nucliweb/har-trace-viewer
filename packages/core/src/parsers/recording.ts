import type { ParsedHar, ParsedTrace } from "../types.js";
import { parseHarPages } from "./har-parser.js";
import { parseTrace } from "./trace-parser.js";

type RawHar = Parameters<typeof parseHarPages>[0];
type RawTrace = Parameters<typeof parseTrace>[0];

export type RecordingKind = "har" | "trace";
export type RecordingResult<K extends RecordingKind> = K extends "har" ? ParsedHar[] : ParsedTrace;

export const UNRECOGNIZED_JSON =
  "This JSON is neither a HAR (log.entries) nor a Chrome trace (traceEvents or an event array).";

const WRONG_KIND: Record<RecordingKind, string> = {
  har: "This is a Chrome trace, not a HAR: load it with the Trace button.",
  trace: "This is a HAR, not a Chrome trace: load it as the page's HAR.",
};

/**
 * The text is not the recording that was asked for: `reason` says whether it is not JSON, JSON
 * of neither kind, or the other kind. `message` is worded for the web app; other callers can
 * word their own from the fields.
 */
export class RecordingFormatError extends Error {
  constructor(
    message: string,
    readonly reason: "not-json" | "unrecognized" | "wrong-kind",
    readonly expected: RecordingKind,
    readonly found?: RecordingKind,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "RecordingFormatError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a parsed JSON value is: a HAR has `log.entries`, a Chrome trace has `traceEvents` or
 * is the bare array of its events; anything else is neither.
 */
function detectRecordingKind(value: unknown): RecordingKind | null {
  if (Array.isArray(value)) return "trace";
  if (!isObject(value)) return null;
  if (isObject(value.log) && Array.isArray(value.log.entries)) return "har";
  if (Array.isArray(value.traceEvents)) return "trace";
  return null;
}

/**
 * The JSON value of a HAR or of a Chrome trace, checked to be the kind asked for. Throws a
 * RecordingFormatError when the text is not JSON, not a recording, or the other kind.
 */
export function readRecordingJson(kind: RecordingKind, text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new RecordingFormatError(
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "not-json",
      kind,
      undefined,
      { cause: error }
    );
  }
  const found = detectRecordingKind(value);
  if (found === null) throw new RecordingFormatError(UNRECOGNIZED_JSON, "unrecognized", kind);
  if (found !== kind) throw new RecordingFormatError(WRONG_KIND[kind], "wrong-kind", kind, found);
  return value;
}

/**
 * Parses the text of a HAR (into its pages) or of a Chrome trace. Throws a RecordingFormatError
 * when the text is not JSON, not a recording, or the other kind of recording; the core
 * parsers' own errors pass through.
 */
export function parseRecording<K extends RecordingKind>(kind: K, text: string): RecordingResult<K> {
  const value = readRecordingJson(kind, text);
  const result =
    kind === "har"
      ? parseHarPages(value as RawHar)
      : parseTrace(Array.isArray(value) ? { traceEvents: value } : (value as RawTrace));
  return result as RecordingResult<K>;
}
