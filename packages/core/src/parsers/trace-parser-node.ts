import { createReadStream } from "fs";
import { createGunzip } from "zlib";
import { readFile } from "fs/promises";
import { parseTraceJson } from "./trace-parser.js";
import type { ParsedTrace } from "../types.js";

export async function parseTraceFile(filePath: string): Promise<ParsedTrace> {
  if (filePath.endsWith(".gz")) {
    const buffer = await readGzipFile(filePath);
    return parseTraceJson(buffer);
  }
  const content = await readFile(filePath, "utf8");
  return parseTraceJson(content);
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
