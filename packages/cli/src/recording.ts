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

type Classified =
  { kind: RecordingKind; result: RecordingResult<RecordingKind> } | { kind: null; error: Error };

// Files parsed to learn what they are: the report takes them from here instead of reading again.
const classified = new Map<string, RecordingResult<RecordingKind>>();
const classifiedKey = (kind: RecordingKind, file: string) => `${kind}\0${file}`;

/**
 * What a file holds, by its content: parsed as a HAR, or as a trace when it is one. A missing or
 * unreadable file throws; a file that is neither comes back with the error that words it.
 */
async function classify(file: string): Promise<Classified> {
  let text: string;
  try {
    text = await readInput(file);
  } catch (error) {
    throw readError(file, "har", error);
  }
  for (const kind of ["har", "trace"] as const) {
    try {
      const result = parseRecording(kind, text);
      classified.set(classifiedKey(kind, file), result);
      return { kind, result };
    } catch (error) {
      if (error instanceof RecordingFormatError && error.reason === "wrong-kind") continue;
      return { kind: null, error: readError(file, "har", error) };
    }
  }
  return { kind: null, error: readError(file, "har", new Error("not a recording")) };
}

/** Reads and parses a HAR or a trace. */
export async function readRecording<K extends RecordingKind>(
  kind: K,
  file: string
): Promise<RecordingResult<K>> {
  const name = file === STDIN ? STDIN_NAME : file;
  const key = classifiedKey(kind, file);
  const known = classified.get(key);
  if (known) {
    classified.delete(key);
    return known as RecordingResult<K>;
  }
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

/**
 * A file given without its flag is a HAR or a trace by its name, and some tools save a HAR as
 * `.json`. Where a page has no HAR, the content of its `.json` files decides: a HAR takes the
 * HAR's place, and of two files the one that is a HAR is the HAR whatever their order. A file
 * that does not exist is reported as missing.
 */
export async function adoptMisnamedHars(
  pages: { name?: string; har: string; trace?: string; jsonFiles?: string[] }[]
): Promise<void> {
  for (const page of pages) {
    const files = page.jsonFiles;
    delete page.jsonFiles;
    if (page.har || !page.trace || page.trace === STDIN) continue;
    if (!files) {
      // A trace keeps its place and the usual checks ask for its HAR; a file that is neither
      // says why here, rather than being called a trace.
      const one = await classify(page.trace);
      if (one.kind === null) throw one.error;
      if (one.kind === "har") {
        page.har = page.trace;
        delete page.trace;
      }
      continue;
    }
    if (files.length > 2) {
      throw new Error(
        `Page "${page.name}" has ${files.length} .json files (${files.join(", ")}): give one HAR and one trace per page, or start another page with --page.`
      );
    }
    // The arguments give a page its .json files from two on, and more than two failed above.
    const [first, second] = files;
    if (first === undefined || second === undefined) continue;
    const [a, b] = await Promise.all([classify(first), classify(second)]);
    if (a.kind === null) throw a.error;
    if (b.kind === null) throw b.error;
    if (a.kind === b.kind) {
      const noun = RECORDING_NOUN[a.kind];
      throw new Error(
        `${first} is ${noun} and ${second} is ${noun} too: a page takes one HAR and one trace, e.g. htv page.har trace.json.`
      );
    }
    [page.har, page.trace] = a.kind === "har" ? [first, second] : [second, first];
  }
}
