import { ParseError, parseRecording } from "@htv/core";
import { readFileText } from "./read-file-text.js";
import type { ParseKind, ParseProgress, ParseResultFor } from "./parse-protocol.js";

export const GZIP_UNSUPPORTED =
  "This browser cannot decompress .gz files (no DecompressionStream): decompress the file and load it again.";

/** The errors of reading a file, beside the parsers' own (see ParseError in @htv/core). */
type ReadErrorCode = "gzip-unsupported" | "gzip-invalid";

/** Reads a dropped HAR or trace, gunzipping a `.gz` file, and parses it. */
export async function readRecordingFile<K extends ParseKind>(
  kind: K,
  file: File,
  report?: (progress: ParseProgress, force?: boolean) => void
): Promise<ParseResultFor<K>> {
  const isGzip = file.name.toLowerCase().endsWith(".gz");
  if (isGzip && typeof DecompressionStream === "undefined") {
    throw new ParseError<ReadErrorCode>(GZIP_UNSUPPORTED, "gzip-unsupported");
  }
  let text: string;
  try {
    text = await readFileText(file, isGzip, report);
  } catch (error) {
    if (!isGzip) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ParseError<ReadErrorCode>(
      `Could not decompress the file${detail ? ` (${detail})` : ""}. It may be truncated or not a gzip file.`,
      "gzip-invalid",
      { detail },
      { cause: error }
    );
  }
  report?.({ phase: "parsing", loaded: 0, total: 0 }, true);
  return parseRecording(kind, text);
}
