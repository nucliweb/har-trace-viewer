import { parseRecording } from "@htv/core";
import { readFileText } from "./read-file-text.js";
import type { ParseKind, ParseProgress, ParseResultFor } from "./parse-protocol.js";

export const GZIP_UNSUPPORTED =
  "This browser cannot decompress .gz files (no DecompressionStream): decompress the file and load it again.";

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
