import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expandPageFlows, generateFlow, parseHarPagesJson, parseTraceJson } from "@htv/core";
import type { Flow } from "@htv/core";

const dir = resolve(import.meta.dirname, "../../core/tests/fixtures");

export const harJson = readFileSync(resolve(dir, "webperf-snippets.har.fixture.json"), "utf8");
export const traceJson = readFileSync(resolve(dir, "webperf-snippets.trace.fixture.json"), "utf8");

/**
 * jsdom's File has no `stream()`, which the main-thread parser relies on. Node's File
 * (same Web API, with streams) is accepted by the file input and exercises the real parser.
 */
export function makeFile(content: string, name: string): File {
  return new NodeFile([content], name, { type: "application/json" }) as unknown as File;
}

export function makeFlow(): Flow {
  const pages = expandPageFlows({
    name: "Home",
    har: parseHarPagesJson(harJson),
    trace: parseTraceJson(traceJson),
  });
  return generateFlow(pages);
}
