// Reads the files the CLI is given, wording every failure as one line that starts with the file.

import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseRecording, readRecordingJson, RecordingFormatError } from "@htv/core";
import type { RecordingKind, RecordingResult } from "@htv/core";
import { readTextFile } from "@htv/core/node";
import { debug } from "./debug";

const RECORDING_NOUN: Record<RecordingKind, string> = { har: "a HAR", trace: "a Chrome trace" };
const RECORDING_SHAPE: Record<RecordingKind, string> = {
  har: "(log.entries)",
  trace: "(traceEvents or an event array)",
};

/** The path that stands for the standard input. */
export const STDIN = "-";

/** How the standard input is named in messages and in a page name. */
export const STDIN_NAME = "stdin";

/** Reads the standard input as text, gunzipping it when it holds a gzip stream. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      "this is a terminal, not a HAR; pipe one in, e.g. cat page.har | htv - --format csv"
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const data = Buffer.concat(chunks);
  if (data.length === 0)
    throw new Error("no input; pipe a HAR in, e.g. cat page.har | htv - --format csv");
  const gzip = data[0] === 0x1f && data[1] === 0x8b;
  return (gzip ? gunzipSync(data) : data).toString("utf8");
}

/** The text of a file, or of the standard input for `-`. */
function readInput(file: string): Promise<string> {
  return file === STDIN ? readStdin() : readTextFile(resolve(file));
}

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
  const name = file === STDIN ? STDIN_NAME : file;
  try {
    debug.input(kind, file);
    return await debug.time(
      `read and parse ${kind === "har" ? "HAR" : "trace"} ${name}`,
      async () => parseRecording(kind, await readInput(file)),
      true
    );
  } catch (error) {
    throw readError(name, kind, error);
  }
}

/** Reads a HAR as the JSON it holds, for the commands that rewrite the file itself. */
export async function readHarJson(file: string): Promise<unknown> {
  const name = file === STDIN ? STDIN_NAME : file;
  try {
    return readRecordingJson("har", await readInput(file));
  } catch (error) {
    throw readError(name, "har", error);
  }
}
