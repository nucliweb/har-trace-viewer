import { createReadStream } from "fs";
import { createGunzip } from "zlib";
import { readFile } from "fs/promises";
import { parseTraceJson } from "./trace-parser.js";
import type { ParsedTrace } from "../types.js";

/** Reads a UTF-8 text file, gunzipping it first when the path ends in `.gz`. */
export async function readTextFile(filePath: string): Promise<string> {
  if (filePath.endsWith(".gz")) return readGzipFile(filePath);
  return readFile(filePath, "utf8");
}

export async function parseTraceFile(filePath: string): Promise<ParsedTrace> {
  return parseTraceJson(await readTextFile(filePath));
}

function readGzipFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath).pipe(createGunzip());
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}
