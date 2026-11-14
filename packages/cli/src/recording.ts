// Reads the files the CLI is given, wording every failure as one line that starts with the file.

import { resolve } from "node:path";
import { parseRecording, readRecordingJson, RecordingFormatError } from "@htv/core";
import type { RecordingKind, RecordingResult } from "@htv/core";
import { readTextFile } from "@htv/core/node";

const RECORDING_NOUN: Record<RecordingKind, string> = { har: "a HAR", trace: "a Chrome trace" };
const RECORDING_SHAPE: Record<RecordingKind, string> = {
  har: "(log.entries)",
  trace: "(traceEvents or an event array)",
};

function readError(file: string, kind: RecordingKind, error: unknown): Error {
  const expected = RECORDING_NOUN[kind];
  if (error instanceof RecordingFormatError) {
    if (error.reason === "not-json") {
      return new Error(`${file}: expected ${expected}, but the file is not valid JSON`, {
        cause: error,
      });
    }
    const found = error.found
      ? `this is ${RECORDING_NOUN[error.found]}`
      : "found neither a HAR nor a Chrome trace";
    const shape = error.found ? "" : ` ${RECORDING_SHAPE[kind]}`;
    return new Error(`${file}: expected ${expected}${shape} but ${found}`, { cause: error });
  }
  const code = (error as NodeJS.ErrnoException).code;
  return new Error(
    `${file}: ${code === "ENOENT" ? "no such file or directory" : (error as Error).message}`,
    { cause: error }
  );
}

/** Reads and parses a HAR or a trace. */
export async function readRecording<K extends RecordingKind>(
  kind: K,
  file: string
): Promise<RecordingResult<K>> {
  try {
    return parseRecording(kind, await readTextFile(resolve(file)));
  } catch (error) {
    throw readError(file, kind, error);
  }
}

/** Reads a HAR as the JSON it holds, for the commands that rewrite the file itself. */
export async function readHarJson(file: string): Promise<unknown> {
  try {
    return readRecordingJson("har", await readTextFile(resolve(file)));
  } catch (error) {
    throw readError(file, "har", error);
  }
}
