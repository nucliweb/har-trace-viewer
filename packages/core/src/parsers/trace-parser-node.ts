import { createReadStream } from "fs";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
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

async function readGzipFile(filePath: string): Promise<string> {
  const chunks: Buffer[] = [];
  await pipeline(
    createReadStream(filePath),
    createGunzip(),
    async (source: AsyncIterable<Buffer>) => {
      for await (const chunk of source) chunks.push(chunk);
    }
  );
  return Buffer.concat(chunks).toString("utf8");
}
